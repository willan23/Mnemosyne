import type {EncryptedMemoryEnvelope} from './memoryCrypto';

export interface StoredReviewInbox {v: 2; uid: string; revision: string; enc: EncryptedMemoryEnvelope}
export interface ReviewInboxStore {
  get(uid: string): Promise<StoredReviewInbox | undefined>;
  compareExchange(uid: string, expected: string | null, next: StoredReviewInbox, guard: () => void): Promise<void>;
  clear(uid: string, guard: () => void): Promise<void>;
}
const failure = () => Error('Não foi possível confirmar as revisões cifradas neste dispositivo.');
const uidValid = (uid: string) => typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !uid.includes('/');
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('mnemosyne-review-inbox-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('inboxes');
    request.onerror = () => reject(failure());
    request.onblocked = () => {blocked = true; reject(failure());};
    request.onsuccess = () => {if (blocked) request.result.close(); else resolve(request.result);};
  });
}
export const reviewInboxStore: ReviewInboxStore = {
  async get(uid) {
    if (!uidValid(uid)) throw failure();
    const db = await open();
    try {return await new Promise<StoredReviewInbox | undefined>((resolve, reject) => {
      const tx = db.transaction('inboxes', 'readonly'), request = tx.objectStore('inboxes').get(uid);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(failure());
    });} finally {db.close();}
  },
  async compareExchange(uid, expected, next, guard) {
    const captured = structuredClone(next);
    if (!uidValid(uid) || captured.v !== 2 || captured.uid !== uid || typeof captured.revision !== 'string') throw failure();
    guard(); const db = await open();
    try {await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('inboxes', 'readwrite'), store = tx.objectStore('inboxes'), request = store.get(uid);
      request.onsuccess = () => {
        try {guard(); if ((request.result ? JSON.stringify(request.result) : null) !== expected) throw failure(); store.put(captured, uid);}
        catch {tx.abort();}
      };
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(failure());
    });} finally {db.close();}
    guard();
  },
  async clear(uid, guard) {
    if (!uidValid(uid)) throw failure();
    guard(); const db = await open();
    try {await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('inboxes', 'readwrite');
      try {guard(); tx.objectStore('inboxes').delete(uid);} catch {tx.abort();}
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(failure());
    });} finally {db.close();}
    guard();
  },
};
