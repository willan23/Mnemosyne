import type { EncryptedMemoryEnvelope } from './memoryCrypto';

export type ReindexKey = [string, string, string]; // UID, pinned space, memory ID (metadata only).
export interface EmbeddingReindexStore {
  get(key: ReindexKey): Promise<EncryptedMemoryEnvelope | undefined>;
  put(key: ReindexKey, value: EncryptedMemoryEnvelope): Promise<void>;
  remove(key: ReindexKey): Promise<void>;
}

async function transact<T>(mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open('mnemosyne-embedding-reindex-v1', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('checkpoints');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(new Error('Reindex storage unavailable'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('checkpoints', mode);
      const request = operation(transaction.objectStore('checkpoints'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('Reindex checkpoint failed'));
    });
  } finally { db.close(); }
}

export const embeddingReindexStore: EmbeddingReindexStore = {
  get: key => transact('readonly', store => store.get(key)),
  put: async (key, value) => { await transact('readwrite', store => store.put(value, key)); },
  remove: async key => { await transact('readwrite', store => store.delete(key)); },
};

/** Deletes only the selected account/profile range in one committed transaction. */
export async function clearEmbeddingReindexCheckpoints(uid: string, space?: string): Promise<void> {
  if (!uid || space === '') throw new Error('Invalid reindex scope');
  const prefix = space === undefined ? [uid] : [uid, space];
  // All remaining key components are strings, which sort before an array key.
  const range = IDBKeyRange.bound(prefix, [...prefix, []], false, true);
  await transact('readwrite', store => store.delete(range));
}
