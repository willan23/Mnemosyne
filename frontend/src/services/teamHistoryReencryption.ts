import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, startAfter, where, type Firestore } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { TEAM_HISTORY_REENCRYPTION_ENABLED } from '../config/releaseGates';
import { decryptMemoryEnvelope, encryptMemoryFields, isEncryptedMemoryEnvelope, isMemoryCryptoReady, onMemoryCryptoChanged, type EncryptedMemoryEnvelope } from './memoryCrypto';
import { loadTeamForRotationRecovery, roleOf, type TeamRecord } from './teamsService';
import { unlockTeamKey } from './teamKeyAccess';
import { getTeamKeyCacheGeneration } from './teamVault';
import { applyTeamHistoryEntry, cancelTeamHistoryChangeWithinJob, recoverTeamHistoryChangeWithinJob, type TeamHistoryChangeClientDeps, type TeamHistoryChangeConfirmation } from './teamHistoryChangeRecovery';
import { confirmTeamHistoryCheckpoint, parseTeamHistoryCheckpoint, saveTeamHistoryCheckpoint, teamHistoryCheckpointKey, type TeamHistoryCheckpoint } from './teamHistoryCheckpoint';
export type { TeamHistoryCheckpoint } from './teamHistoryCheckpoint';

export class TeamHistoryReencryptionError extends Error {
  readonly reason: 'closed' | 'access-changed' | 'unavailable' | 'obsolete' | 'invalid' | 'conflict' | 'storage' | 'unsupported' | 'busy' | 'interrupted';
  constructor(reason: TeamHistoryReencryptionError['reason']) { super('Não foi possível recifrar o histórico. O progresso confirmado foi conservado quando disponível.'); this.reason = reason; }
}
export interface TeamHistoryEntry { sessionId: string; versionId?: string; data: Record<string, unknown> }
export async function readTeamHistoryPage(teamId: string, sessionId: string | null, after: string | null, size: number, firestore = db) {
  if (!idOk(teamId) || (sessionId !== null && !idOk(sessionId)) || (after !== null && !idOk(after)) || !Number.isSafeInteger(size) || size < 1 || size > 10) {
    throw new TeamHistoryReencryptionError('invalid');
  }
  const base = sessionId ? collection(firestore, 'sessions', sessionId, 'versions') : collection(firestore, 'sessions');
  const filters = sessionId ? [] : [where('teamId', '==', teamId)];
  const snapshot = await getDocsFromServer(query(base, ...filters, orderBy(documentId()), ...(after ? [startAfter(after)] : []), limit(size)));
  return snapshot.docs.map(item => ({ sessionId: sessionId ?? item.id, ...(sessionId ? { versionId: item.id } : {}), data: item.data() }));
}
export type TeamHistoryControl = 'run' | 'pause' | 'cancel';
export interface TeamHistoryDeps {
  firestore: Firestore;
  currentUid: () => string | null;
  cryptoReady: () => boolean;
  subscribeCrypto: (callback: () => void) => () => void;
  cacheGeneration: () => number;
  now: () => number;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  loadTeam: (teamId: string) => Promise<TeamRecord>;
  loadSession: (sessionId: string) => Promise<TeamHistoryEntry>;
  page: (teamId: string, sessionId: string | null, after: string | null, size: number) => Promise<TeamHistoryEntry[]>;
  encryptCheckpoint: (data: { text: string }) => Promise<EncryptedMemoryEnvelope>;
  decryptCheckpoint: (envelope: EncryptedMemoryEnvelope) => Promise<{ text: string }>;
  unlock: typeof unlockTeamKey;
  changeClient?: TeamHistoryChangeClientDeps;
  cancelEntry?: typeof cancelTeamHistoryChangeWithinJob;
  recoverEntry?: typeof recoverTeamHistoryChangeWithinJob;
  rewrite: (entry: TeamHistoryEntry, team: TeamRecord, uid: string, jobId: string, mnemonic: string[], guard: () => void, confirmed?: TeamHistoryChangeConfirmation) => Promise<'rewritten' | 'already-target'>;
}
const checkpointKey = teamHistoryCheckpointKey;
export function hasTeamHistoryCheckpoint(uid: string, teamId: string) {
  try { return localStorage.getItem(checkpointKey(uid, teamId)) !== null; } catch { return false; }
}
const idOk = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/');
const uuidOk = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function validateCheckpoint(value: unknown, uid: string, teamId: string): TeamHistoryCheckpoint {
  try { return parseTeamHistoryCheckpoint(value, uid, teamId); } catch { throw new TeamHistoryReencryptionError('invalid'); }
}
function requireActiveAdmin(team: TeamRecord | null, uid: string): asserts team is TeamRecord & { activeKeyEpoch: number; activeKeyId: string } {
  if (!team || !team.memberUids.includes(uid) || !['owner', 'admin'].includes(roleOf(team, uid)) ||
      team.keyRotationStatus !== 'active' || team.pendingRotationId || !team.activeKeyEpoch || !uuidOk(team.activeKeyId)) {
    throw new TeamHistoryReencryptionError('unavailable');
  }
}
/** Cryptographic maintenance changes ciphertext/context only, without duplicating semantic versions. */
export async function rewriteTeamHistoryEntry(entry: TeamHistoryEntry, target: TeamRecord, uid: string, jobId: string,
  mnemonic: string[], guard: () => void, context: Pick<TeamHistoryDeps, 'firestore' | 'currentUid' | 'cryptoReady' | 'subscribeCrypto' | 'cacheGeneration' | 'now' | 'unlock' | 'changeClient'>, confirmed?: TeamHistoryChangeConfirmation) {
  guard(); requireActiveAdmin(target, uid);
  if (!uuidOk(jobId) || !idOk(entry.sessionId) || (entry.versionId !== undefined && !idOk(entry.versionId))) throw new TeamHistoryReencryptionError('invalid');
  return applyTeamHistoryEntry({ uid, teamId: target.id, sessionId: entry.sessionId, versionId: entry.versionId ?? null,
    jobId, targetEpoch: target.activeKeyEpoch, targetKeyId: target.activeKeyId, data: entry.data, mnemonic }, guard, confirmed, context.changeClient);
}
function defaults(): TeamHistoryDeps {
  const context = { firestore: db, currentUid: () => auth.currentUser?.uid ?? null, cryptoReady: isMemoryCryptoReady,
    subscribeCrypto: (changed: () => void) => { const uid = auth.currentUser?.uid; const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed(); });
      const stopVault = onMemoryCryptoChanged(changed); return () => { stopAuth(); stopVault(); }; },
    cacheGeneration: getTeamKeyCacheGeneration, now: Date.now, unlock: unlockTeamKey };
  return { ...context, storage: localStorage, loadTeam: loadTeamForRotationRecovery,
    loadSession: async sessionId => {
      const snapshot = await getDocFromServer(doc(db, 'sessions', sessionId));
      if (!snapshot.exists()) throw new TeamHistoryReencryptionError('conflict');
      return { sessionId, data: snapshot.data() };
    },
    encryptCheckpoint: encryptMemoryFields, decryptCheckpoint: decryptMemoryEnvelope,
    rewrite: (entry, team, uid, jobId, words, guard, confirmed) => rewriteTeamHistoryEntry(entry, team, uid, jobId, words, guard, context, confirmed),
    cancelEntry: cancelTeamHistoryChangeWithinJob,
    recoverEntry: recoverTeamHistoryChangeWithinJob,
    page: readTeamHistoryPage, exclusive: async (name, work) => {
      if (!navigator.locks) throw new TeamHistoryReencryptionError('unsupported');
      return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) throw new TeamHistoryReencryptionError('busy'); return work();
      });
    } };
}

/** Local cancellation remains available when maintenance is disabled or the target epoch became obsolete. */
export async function readTeamHistoryCheckpoint(uid: string, teamId: string, deps = defaults()) {
  const generation = deps.cacheGeneration(); let changed = false;
  const stop = deps.subscribeCrypto(() => { changed = true; });
  const guard = () => { if (changed || deps.currentUid() !== uid || !deps.cryptoReady() || deps.cacheGeneration() !== generation) throw new TeamHistoryReencryptionError('access-changed'); };
  try {
    guard(); let raw;
    try { raw = deps.storage.getItem(checkpointKey(uid, teamId)); } catch { throw new TeamHistoryReencryptionError('storage'); }
    if (raw === null) return null;
    let job;
    try { const envelope: unknown = JSON.parse(raw); if (!isEncryptedMemoryEnvelope(envelope)) throw new Error();
      job = validateCheckpoint(JSON.parse((await deps.decryptCheckpoint(envelope)).text), uid, teamId);
    } catch { throw new TeamHistoryReencryptionError('invalid'); } guard();
    if (deps.storage.getItem(checkpointKey(uid, teamId)) !== raw) throw new TeamHistoryReencryptionError('conflict');
    return job;
  } finally { stop(); }
}

export async function cancelTeamHistoryReencryption(uid: string, teamId: string, deps = defaults()) {
  const generation = deps.cacheGeneration(); let changed = false;
  const stop = deps.subscribeCrypto(() => { changed = true; });
  const guard = () => { if (changed || deps.currentUid() !== uid || !deps.cryptoReady() || deps.cacheGeneration() !== generation) throw new TeamHistoryReencryptionError('access-changed'); };
  try { return await deps.exclusive(`mnemosyne:team-history:${teamId}`, async () => {
    guard(); const key = checkpointKey(uid, teamId); let raw: string | null;
    try { raw = deps.storage.getItem(key); } catch { throw new TeamHistoryReencryptionError('storage'); }
    if (raw === null) return null;
    let job: TeamHistoryCheckpoint;
    try { const envelope: unknown = JSON.parse(raw); if (!isEncryptedMemoryEnvelope(envelope)) throw new Error();
      job = validateCheckpoint(JSON.parse((await deps.decryptCheckpoint(envelope)).text), uid, teamId);
    } catch { throw new TeamHistoryReencryptionError('invalid'); } guard();
    const current = () => { guard(); if (deps.storage.getItem(key) !== raw) throw new TeamHistoryReencryptionError('conflict'); };
    current();
    if (job.status === 'complete') throw new TeamHistoryReencryptionError('invalid');
    const confirm: TeamHistoryChangeConfirmation = async (request, result) => {
      current(); const next = confirmTeamHistoryCheckpoint(job, request.baseline, result.result!);
      raw = await saveTeamHistoryCheckpoint({ job: next, expected: raw, storage: deps.storage, guard, encrypt: deps.encryptCheckpoint, decrypt: deps.decryptCheckpoint });
      job = next;
    };
    if (deps.cancelEntry) await deps.cancelEntry(uid, teamId, job.jobId, current, confirm, deps.changeClient);
    current(); job.status = 'cancelled';
    try { raw = await saveTeamHistoryCheckpoint({ job, expected: raw, storage: deps.storage, guard, encrypt: deps.encryptCheckpoint, decrypt: deps.decryptCheckpoint }); }
    catch { guard(); throw new TeamHistoryReencryptionError('storage'); }
    return job;
  }); } finally { stop(); }
}

export async function runTeamHistoryReencryption(input: { uid: string; teamId: string; mnemonic: string[]; confirmed: true;
  newScan?: boolean; control?: () => TeamHistoryControl; onProgress?: (progress: TeamHistoryCheckpoint) => void }, deps = defaults()) {
  if (!TEAM_HISTORY_REENCRYPTION_ENABLED) throw new TeamHistoryReencryptionError('closed');
  if (input.confirmed !== true || !idOk(input.uid) || !idOk(input.teamId)) throw new TeamHistoryReencryptionError('invalid');
  const generation = deps.cacheGeneration(); const mnemonic = [...input.mnemonic]; let changed = false;
  const stop = deps.subscribeCrypto(() => { changed = true; });
  const guard = () => { if (changed || deps.currentUid() !== input.uid || !deps.cryptoReady() || deps.cacheGeneration() !== generation) throw new TeamHistoryReencryptionError('access-changed'); };
  const control = () => input.control?.() ?? 'run';
  try { return await deps.exclusive(`mnemosyne:team-history:${input.teamId}`, async () => {
    guard(); const storeKey = checkpointKey(input.uid, input.teamId);
    let job: TeamHistoryCheckpoint | null = null;
    let stored: string | null;
    try { stored = deps.storage.getItem(storeKey); } catch { throw new TeamHistoryReencryptionError('storage'); }
    const current = () => { guard(); if (deps.storage.getItem(storeKey) !== stored) throw new TeamHistoryReencryptionError('conflict'); };
    if (stored !== null) {
      try { const envelope: unknown = JSON.parse(stored); if (!isEncryptedMemoryEnvelope(envelope)) throw new Error();
        job = validateCheckpoint(JSON.parse((await deps.decryptCheckpoint(envelope)).text), input.uid, input.teamId);
      } catch { throw new TeamHistoryReencryptionError('invalid'); } current();
    }
    const team = await deps.loadTeam(input.teamId); current(); requireActiveAdmin(team, input.uid);
    if (job && input.newScan && !['complete', 'cancelled'].includes(job.status)) throw new TeamHistoryReencryptionError('invalid');
    if (!job || input.newScan) job = { version: 1, uid: input.uid, teamId: input.teamId, jobId: crypto.randomUUID(),
      targetEpoch: team.activeKeyEpoch, targetKeyId: team.activeKeyId, sessionCursor: null, currentSession: null, sessionDone: false,
      versionCursor: null, status: 'running', scanned: 0, rewritten: 0, alreadyTarget: 0 };
    const save = async (candidate = job!) => {
      validateCheckpoint(candidate, input.uid, input.teamId);
      try { stored = await saveTeamHistoryCheckpoint({ job: candidate, expected: stored, storage: deps.storage, guard,
        encrypt: deps.encryptCheckpoint, decrypt: deps.decryptCheckpoint }); }
      catch { guard(); throw new TeamHistoryReencryptionError('storage'); }
      job = candidate; current();
      input.onProgress?.({ ...job! });
    };
    const confirm: TeamHistoryChangeConfirmation = async (request, result) => {
      current(); const next = confirmTeamHistoryCheckpoint(job!, request.baseline, result.result!);
      if (next !== job) await save(next);
    };
    if (job.status === 'cancelled' || job.status === 'complete') { input.onProgress?.({ ...job }); return job; }
    if (job.targetEpoch !== team.activeKeyEpoch || job.targetKeyId !== team.activeKeyId) throw new TeamHistoryReencryptionError('obsolete');
    job.status = 'running'; await save(); // Durable preparation before the first write.
    const checkControl = async () => {
      current(); const state = control();
      if (state === 'run') return false;
      if (state === 'cancel' && deps.cancelEntry) await deps.cancelEntry(input.uid, input.teamId, job!.jobId, current, confirm, deps.changeClient);
      job!.status = state === 'cancel' ? 'cancelled' : 'paused'; await save(); return true;
    };
    const rewrite = async (entry: TeamHistoryEntry) => {
      const result = await deps.rewrite(entry, team, input.uid, job!.jobId, mnemonic, () => {
        current(); if (control() !== 'run') throw new TeamHistoryReencryptionError('interrupted');
      }, confirm);
      current(); const next = confirmTeamHistoryCheckpoint(job!, { teamId: input.teamId, sessionId: entry.sessionId, versionId: entry.versionId ?? null,
        jobId: job!.jobId, targetEpoch: job!.targetEpoch, targetKeyId: job!.targetKeyId }, result);
      if (next !== job) await save(next);
    };
    try {
      if (await checkControl()) return job;
      if (deps.recoverEntry) await deps.recoverEntry(input.uid, input.teamId, job.jobId, () => {
        current(); if (control() !== 'run') throw new TeamHistoryReencryptionError('interrupted');
      }, confirm, deps.changeClient);
      const sessionBuffer: TeamHistoryEntry[] = [];
      while (true) {
        if (await checkControl()) return job;
        if (!job.currentSession) {
          if (!sessionBuffer.length) sessionBuffer.push(...await deps.page(input.teamId, null, job.sessionCursor, 5)); guard();
          if (await checkControl()) return job;
          if (!sessionBuffer.length) {
            const current = await deps.loadTeam(input.teamId); guard(); requireActiveAdmin(current, input.uid);
            if (current.activeKeyEpoch !== job.targetEpoch || current.activeKeyId !== job.targetKeyId) throw new TeamHistoryReencryptionError('obsolete');
            job.status = 'complete'; await save(); return job;
          }
          // Consume the bounded page once; persist one session cursor at a time.
          job.currentSession = sessionBuffer.shift()!.sessionId; job.sessionDone = false; job.versionCursor = null; await save();
        }
        if (!job.sessionDone) {
          const entry = await deps.loadSession(job.currentSession); guard();
          if (await checkControl()) return job;
          await rewrite(entry);
        }
        const versions = await deps.page(input.teamId, job.currentSession, job.versionCursor, 10); guard();
        for (const entry of versions) {
          if (await checkControl()) return job;
          await rewrite(entry);
        }
        if (!versions.length) { job.sessionCursor = job.currentSession; job.currentSession = null; job.sessionDone = false; job.versionCursor = null; await save(); }
      }
    } catch (error) {
      current();
      if (error instanceof TeamHistoryReencryptionError && error.reason === 'interrupted') { await checkControl(); return job; }
      job.status = 'paused'; await save();
      throw error instanceof TeamHistoryReencryptionError ? error : new TeamHistoryReencryptionError('unavailable');
    }
  }); } finally { stop(); }
}
