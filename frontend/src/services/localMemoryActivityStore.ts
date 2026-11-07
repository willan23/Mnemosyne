import type { EncryptedMemoryEnvelope } from './memoryCrypto';

export interface StoredMemoryActivity { v: 1; uid: string; revision: string; reset: string; enc: EncryptedMemoryEnvelope }
export interface MemoryActivityStore {
  get(uid: string): Promise<StoredMemoryActivity | undefined>;
  compareExchange(uid: string, expected: string | null, next: StoredMemoryActivity, guard: () => void): Promise<boolean>;
  remove(uid: string, guard: () => void): Promise<void>;
}
const fail = () => new Error('local_activity_storage_unavailable');
const validUid = (uid: string) => typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !uid.includes('/');
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('mnemosyne-memory-activity-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('activity');
    request.onerror = () => reject(fail());
    request.onblocked = () => { blocked = true; reject(fail()); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
  });
}
export const localMemoryActivityStore: MemoryActivityStore = {
  async get(uid) {
    if (!validUid(uid)) throw fail();
    const db = await open();
    try { return await new Promise<StoredMemoryActivity | undefined>((resolve, reject) => {
      const tx = db.transaction('activity', 'readonly'), request = tx.objectStore('activity').get(uid);
      tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(fail());
    }); } finally { db.close(); }
  },
  async compareExchange(uid, expected, next, guard) {
    const captured = structuredClone(next);
    if (!validUid(uid) || captured.v !== 1 || captured.uid !== uid) throw fail();
    guard(); const db = await open(); let matched = false;
    try { return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction('activity', 'readwrite'), store = tx.objectStore('activity'), request = store.get(uid);
      request.onsuccess = () => {
        try {
          guard(); matched = (request.result ? JSON.stringify(request.result) : null) === expected;
          if (matched) store.put(captured, uid);
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve(matched); tx.onerror = tx.onabort = () => reject(fail());
    }); } finally { db.close(); }
  },
  async remove(uid, guard) {
    if (!validUid(uid)) throw fail();
    guard(); const db = await open();
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('activity', 'readwrite');
      try { guard(); tx.objectStore('activity').delete(uid); } catch { tx.abort(); }
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(fail());
    }); } finally { db.close(); }
    guard();
  },
};
