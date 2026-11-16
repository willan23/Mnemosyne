import type { EncryptedMemoryEnvelope } from './memoryCrypto';
export interface StoredAttachmentUpload { envelope: EncryptedMemoryEnvelope; bytes: ArrayBuffer | null }
export interface AttachmentUploadJournalStore {
  get(uid: string, id: string): Promise<StoredAttachmentUpload | undefined>;
  put(uid: string, id: string, value: StoredAttachmentUpload): Promise<void>;
  remove(uid: string, id: string): Promise<void>;
  ids(uid: string, limit: number, afterId?: string): Promise<string[]>;
}
async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const opening = indexedDB.open('mnemosyne-attachment-upload-journal-v1', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('uploads');
    opening.onsuccess = () => { if (blocked) opening.result.close(); else resolve(opening.result); };
    opening.onerror = () => reject(new Error('Attachment checkpoint unavailable'));
    opening.onblocked = () => { blocked = true; reject(new Error('Attachment checkpoint unavailable')); };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('uploads', mode); const request = operation(transaction.objectStore('uploads'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('Attachment checkpoint unavailable'));
    });
  } finally { db.close(); }
}
export const attachmentUploadJournalStore: AttachmentUploadJournalStore = {
  get: (uid, id) => transact('readonly', store => store.get([uid, id])),
  put: async (uid, id, value) => { await transact('readwrite', store => store.put(value, [uid, id])); },
  remove: async (uid, id) => { await transact('readwrite', store => store.delete([uid, id])); },
  ids: async (uid, limit, afterId) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Attachment checkpoint unavailable');
    const keys = await transact('readonly', store => store.getAllKeys(IDBKeyRange.bound(afterId ? [uid, afterId] : [uid], [uid, []], Boolean(afterId), true), limit));
    return keys.map(key => { if (!Array.isArray(key) || key.length !== 2 || key[0] !== uid || typeof key[1] !== 'string') throw new Error('Attachment checkpoint unavailable'); return key[1]; });
  },
};

/** Account deletion clears only this UID's committed range, including unreadable encrypted checkpoints. */
export async function clearAttachmentUploadCheckpoints(uid: string): Promise<void> {
  if (!uid) throw new Error('Invalid attachment checkpoint scope');
  await transact('readwrite', store => store.delete(IDBKeyRange.bound([uid], [uid, []], false, true)));
}
