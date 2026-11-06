/**
 * Admin-SDK memory access for the public API. Bypasses client rules;
 * still never stores or returns plaintext content fields.
 */

import * as admin from 'firebase-admin';
import { recordMemoryRetrieval } from './memoryLedger';
import { isLiveAccount, withLiveAccount } from './accountAccess';
import {
  clampLimit,
  CreateMemoryInput,
  filterMemoriesByTagsIds,
  isPersonalOwnedLiveSession,
  ListMemoriesOpts,
  ListMemoriesResult,
  MemoryApi,
  PublicMemory,
  rankByCosine,
  SEARCH_TRADEOFF,
  SearchMemoriesOpts,
  SearchMemoriesResult,
  toPublicMemory,
} from './memoryPublic';

const SESSIONS = 'sessions';
const LIST_MAX = 100;
const SEARCH_SCAN = 500;
const SEARCH_LIMIT = 20;
const RAW_SCAN_LIMIT = 2_000;
const RAW_PAGE_SIZE = 100;

const getDb = (): FirebaseFirestore.Firestore => {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
};

function sessionData(docSnap: FirebaseFirestore.DocumentSnapshot): Record<string, unknown> {
  return (docSnap.data() || {}) as Record<string, unknown>;
}

function ownedLiveDoc(
  docSnap: FirebaseFirestore.DocumentSnapshot,
  uid: string,
): Record<string, unknown> | null {
  if (!docSnap.exists) return null;
  const data = sessionData(docSnap);
  if (!isPersonalOwnedLiveSession(data, uid)) return null;
  return data;
}

async function scanPersonalDocs(
  db: FirebaseFirestore.Firestore,
  uid: string,
  wanted: number,
  startAfter?: string,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const base = db.collection(SESSIONS).where('uid', '==', uid).where('teamId', '==', null).orderBy('timestamp', 'desc');
  let cursor: FirebaseFirestore.DocumentSnapshot | undefined;
  if (startAfter) {
    const candidate = await db.collection(SESSIONS).doc(startAfter).get();
    if (ownedLiveDoc(candidate, uid)) cursor = candidate;
  }

  const personal: Array<{ id: string; data: Record<string, unknown> }> = [];
  let scanned = 0;
  while (personal.length < wanted && scanned < RAW_SCAN_LIMIT) {
    const pageSize = Math.min(RAW_PAGE_SIZE, RAW_SCAN_LIMIT - scanned);
    const pageQuery = cursor ? base.startAfter(cursor) : base;
    const page = await pageQuery.limit(pageSize).get();
    if (page.empty) return personal;

    for (const docSnap of page.docs) {
      scanned += 1;
      const data = ownedLiveDoc(docSnap, uid);
      if (data) personal.push({ id: docSnap.id, data });
      if (personal.length >= wanted) return personal;
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < pageSize) return personal;
  }
  if (scanned >= RAW_SCAN_LIMIT) {
    throw new Error('Personal memory scan limit exceeded; a separate personal index is required.');
  }
  return personal;
}

export function createFirestoreMemoryApi(db: FirebaseFirestore.Firestore = getDb()): MemoryApi {
  const api: MemoryApi = {
    async list(uid: string, opts: ListMemoriesOpts): Promise<ListMemoriesResult> {
      const limit = clampLimit(opts.limit, 50, LIST_MAX);
      const rows = await scanPersonalDocs(db, uid, limit + 1, opts.startAfter);
      const memories: PublicMemory[] = rows.map((row) => toPublicMemory(row.id, row.data));

      const hasMore = memories.length > limit;
      if (hasMore) memories.pop();
      const lastIncluded = memories[memories.length - 1];
      await recordMemoryRetrieval(db, uid, 'list', memories.length);
      return {
        memories,
        nextStartAfter: hasMore && lastIncluded ? lastIncluded.id : null,
      };
    },

    async get(uid: string, id: string): Promise<PublicMemory | null> {
      const snap = await db.collection(SESSIONS).doc(id).get();
      const data = ownedLiveDoc(snap, uid);
      await recordMemoryRetrieval(db, uid, 'get', data ? 1 : 0);
      if (!data) return null;
      return toPublicMemory(snap.id, data, { includeEmbedding: true });
    },

    async create(_uid: string, _input: CreateMemoryInput): Promise<PublicMemory> {
      throw new Error('Direct memory writes are retired; use a reviewed proposal.');
    },

    async search(uid: string, opts: SearchMemoriesOpts): Promise<SearchMemoriesResult> {
      const limit = clampLimit(opts.limit, SEARCH_LIMIT, SEARCH_LIMIT);
      const live = await scanPersonalDocs(db, uid, SEARCH_SCAN);
      const filtered = filterMemoriesByTagsIds(live, {
        q: opts.q,
        tags: opts.tags,
        ids: opts.ids,
      });

      const queryEmbedding = opts.embedding && opts.embedding.length ? opts.embedding : [];
      if (queryEmbedding.length) {
        const ranked = rankByCosine(filtered, queryEmbedding, limit, opts.embeddingModel);
        await recordMemoryRetrieval(db, uid, 'search', ranked.length);
        return {
          results: ranked.map((item) => toPublicMemory(item.id, item.data, {
            includeEmbedding: true,
            score: item.score,
          })),
          mode: 'cosine',
          tradeoff: SEARCH_TRADEOFF,
        };
      }

      const results = filtered.slice(0, limit).map((item) => toPublicMemory(item.id, item.data, { includeEmbedding: true }));
      await recordMemoryRetrieval(db, uid, 'search', results.length);
      return {
        results,
        mode: 'tags_ids',
        tradeoff: SEARCH_TRADEOFF,
      };
    },
  };
  const check = (uid: string) => isLiveAccount(uid, db);
  return {
    list: (uid, opts) => withLiveAccount(uid, () => api.list(uid, opts), check),
    get: (uid, id) => withLiveAccount(uid, () => api.get(uid, id), check),
    search: (uid, opts) => withLiveAccount(uid, () => api.search(uid, opts), check),
    create: (uid, input) => withLiveAccount(uid, () => api.create(uid, input), check),
  };
}
