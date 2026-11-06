import * as admin from 'firebase-admin';
import type { ApiKeyRecord } from './apiKeys';
import { AccountUnavailableError, liveAccountInTransaction } from './accountAccess';
import { agentUidValid } from './agentAccountContract';
import { parseAgentVaultAdmission } from './agentVaultContract';
import { assertAgentVaultAdmission } from './agentVaultAccess';
import { teamRevisionParent } from './teamRevisions';
import { recordMemoryRetrieval } from './memoryLedger';
import { clampLimit, filterMemoriesByTagsIds, rankByCosine, SEARCH_TRADEOFF, toPublicMemory,
  type MemoryApi, type PublicMemory } from './memoryPublic';

type Row = { id: string; data: Record<string, unknown> };
export const AGENT_TEAM_SCAN_BYTES = 8 * 1024 * 1024;
export const AGENT_TEAM_RESULT_BYTES = 3 * 1024 * 1024;
const TEAM_TRADEOFF = SEARCH_TRADEOFF + ' A pesquisa de equipa examina no máximo 500 documentos elegíveis ou 8 MiB de dados; resultados limitados a 3 MiB. Não é uma pesquisa exaustiva do cofre.';
/** The authenticated grant selects the team. Request arguments cannot select another vault. */
export function createTeamAgentMemoryApi(key: ApiKeyRecord, db: FirebaseFirestore.Firestore = admin.firestore()): MemoryApi {
  const vault = parseAgentVaultAdmission(key.vault), uid = key.uid;
  if (vault.kind !== 'team' || key.credentialKind !== 'agent-grant' || !agentUidValid(uid)) throw new AccountUnavailableError();
  const teamVault = vault;
  const guard = async (actor: string, authors: string[] = []) => {
    if (actor !== uid) throw new AccountUnavailableError();
    await db.runTransaction(async tx => {
      if (!await liveAccountInTransaction(tx, db, uid)) throw new AccountUnavailableError();
      await assertAgentVaultAdmission(tx, db, uid, teamVault);
      const refs = [...new Set(authors)].flatMap(author => [db.doc(`users/${author}`), db.doc(`accountDeletions/${author}`)]);
      if (refs.length) {
        const snapshots = await tx.getAll(...refs);
        for (let i = 0; i < snapshots.length; i += 2) if (snapshots[i].data()?.deletionState === 'deleting' || snapshots[i + 1].exists) throw new AccountUnavailableError();
      }
    });
  };
  const usable = (snapshot: FirebaseFirestore.DocumentSnapshot): Row | null => {
    try {
      const before = teamRevisionParent(snapshot, teamVault.teamId, teamVault.keyEpoch);
      return { id: snapshot.id, data: before.row };
    } catch { return null; }
  };
  const liveRows = async (rows: Row[]): Promise<Row[]> => {
    const authors = [...new Set(rows.map(row => row.data.uid as string))];
    if (!authors.length) return rows;
    const snapshots = await db.getAll(...authors.flatMap(author => [db.doc(`users/${author}`), db.doc(`accountDeletions/${author}`)]), { fieldMask: ['deletionState'] });
    const revoked = new Set(authors.filter((_author, index) => snapshots[index * 2].data()?.deletionState === 'deleting' || snapshots[index * 2 + 1].exists));
    return rows.filter(row => !revoked.has(row.data.uid as string));
  };
  const scan = async (wanted: number, startAfter?: string): Promise<{ rows: Row[]; more: boolean }> => {
    const base = db.collection('sessions').where('teamId', '==', teamVault.teamId).orderBy('timestamp', 'desc');
    let cursor: FirebaseFirestore.DocumentSnapshot | undefined;
    if (startAfter) {
      if (!agentUidValid(startAfter)) throw new AccountUnavailableError();
      const snapshot = await db.doc(`sessions/${startAfter}`).get();
      if (!usable(snapshot)) throw new AccountUnavailableError();
      cursor = snapshot;
    }
    const rows: Row[] = []; let scanned = 0, bytes = 0;
    while (rows.length < wanted && scanned < 2_000) {
      const size = Math.min(10, 2_000 - scanned), page = await (cursor ? base.startAfter(cursor) : base).limit(size).get();
      if (page.empty) return { rows, more: false };
      scanned += page.size;
      const candidates = page.docs.map(usable).filter((row): row is Row => row !== null);
      for (const row of await liveRows(candidates)) {
        bytes += Buffer.byteLength(JSON.stringify(row.data));
        if (bytes > AGENT_TEAM_SCAN_BYTES) {
          if (!rows.length) throw new AccountUnavailableError();
          return { rows, more: true };
        }
        rows.push(row);
        if (rows.length >= wanted) return { rows, more: true };
      }
      cursor = page.docs[page.docs.length - 1];
      if (page.size < size) return { rows, more: false };
    }
    if (scanned >= 2_000) throw new AccountUnavailableError();
    return { rows, more: false };
  };
  const project = (row: Row, includeEmbedding = false, score?: number): PublicMemory => {
    const memory = toPublicMemory(row.id, row.data, { includeEmbedding, score });
    // usable() already validated the exact v1/v2 envelope and its key epoch.
    const enc = row.data.enc as { v: number; iv: string; ct: string };
    return { ...memory, encrypted: true, enc: { v: enc.v, iv: enc.iv, ct: enc.ct }, teamId: teamVault.teamId,
      keyEpoch: (row.data.keyEpoch as number | undefined) ?? 1, keyId: (row.data.keyId as string | undefined) ?? null };
  };
  const bounded = (rows: Row[], includeEmbedding = false) => {
    const memories: PublicMemory[] = []; let bytes = 0;
    for (const row of rows) {
      const memory = project(row, includeEmbedding, 'score' in row ? row.score as number : undefined);
      bytes += Buffer.byteLength(JSON.stringify(memory));
      if (bytes > AGENT_TEAM_RESULT_BYTES) {
        if (!memories.length) throw new AccountUnavailableError();
        break;
      }
      memories.push(memory);
    }
    return { memories, included: rows.slice(0, memories.length) };
  };
  const finish = async (actor: string, operation: 'list' | 'get' | 'search', rows: Row[]) => {
    await recordMemoryRetrieval(db, uid, operation, rows.length);
    await guard(actor, rows.map(row => row.data.uid as string));
  };
  return {
    async list(actor, opts) {
      await guard(actor);
      const limit = clampLimit(opts.limit, 50, 100), scanned = await scan(limit + 1, opts.startAfter);
      const { included, memories } = bounded(scanned.rows.slice(0, limit)), hasMore = scanned.more || scanned.rows.length > included.length;
      await finish(actor, 'list', included);
      return { memories, nextStartAfter: hasMore ? included.at(-1)!.id : null };
    },
    async get(actor, id) {
      await guard(actor);
      if (!agentUidValid(id)) throw new AccountUnavailableError();
      const row = usable(await db.doc(`sessions/${id}`).get()), rows = await liveRows(row ? [row] : []);
      const memory = rows.length ? bounded(rows, true).memories[0] : null;
      await finish(actor, 'get', rows); return memory;
    },
    async search(actor, opts) {
      await guard(actor);
      const scanned = await scan(500), filtered = filterMemoriesByTagsIds(scanned.rows, opts), limit = clampLimit(opts.limit, 20, 20);
      const vector = opts.embedding?.length ? opts.embedding : null;
      const ranked = vector ? rankByCosine(filtered, vector, limit, opts.embeddingModel) : filtered.slice(0, limit);
      const { memories: results, included } = bounded(ranked, true);
      await finish(actor, 'search', included);
      return { results, mode: vector ? 'cosine' : 'tags_ids', tradeoff: TEAM_TRADEOFF };
    },
    async create() { throw new AccountUnavailableError(); },
  };
}
