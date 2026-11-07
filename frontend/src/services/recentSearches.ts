import {
  decryptMemoryEnvelope,
  encryptMemoryFields,
  isEncryptedMemoryEnvelope,
  onMemoryCryptoChanged,
} from './memoryCrypto';

const MAX_RECENT = 8;
const MAX_QUERY_LENGTH = 300;
const storageKey = (uid: string) => `mnemosyne.search.recent.v2.${uid}`;
const revisions = new Map<string, number>();
const pendingWrites = new Map<string, Promise<unknown>>();

async function withActiveVault<T>(operation: (assertActive: () => void) => Promise<T>): Promise<T> {
  let changed = false;
  const stop = onMemoryCryptoChanged(() => { changed = true; });
  const assertActive = () => {
    if (changed) throw new Error('O cofre mudou durante a pesquisa.');
  };
  try { return await operation(assertActive); } finally { stop(); }
}

/** Search terms can contain vault content; local persistence requires an unlocked vault. */
export async function readRecentSearches(uid: string): Promise<string[]> {
  if (!uid) return [];
  const raw = localStorage.getItem(storageKey(uid));
  if (!raw) return [];
  const envelope: unknown = JSON.parse(raw);
  if (!isEncryptedMemoryEnvelope(envelope)) throw new Error('Histórico de pesquisa inválido.');
  const revision = revisions.get(uid) || 0;
  return withActiveVault(async (assertActive) => {
    const decrypted = await decryptMemoryEnvelope(envelope);
    assertActive();
    if (revision !== (revisions.get(uid) || 0)) throw new Error('Pesquisa cancelada.');
    const payload = JSON.parse(decrypted.text) as { uid?: unknown; queries?: unknown } | null;
    const parsed = payload?.queries;
    if (payload?.uid !== uid || !Array.isArray(parsed) || parsed.length > MAX_RECENT ||
        !parsed.every((item) => typeof item === 'string' && item.trim().length >= 2 &&
          item.length <= MAX_QUERY_LENGTH)) {
      throw new Error('Histórico de pesquisa inválido.');
    }
    return parsed;
  });
}

export async function pushRecentSearch(uid: string, query: string): Promise<string[]> {
  const q = query.trim();
  if (!uid || q.length < 2 || q.length > MAX_QUERY_LENGTH) return [];
  const revision = revisions.get(uid) || 0;
  let changed = false;
  const stop = onMemoryCryptoChanged(() => { changed = true; });
  const operation = (pendingWrites.get(uid) || Promise.resolve()).catch(() => undefined)
    .then(() => withActiveVault(async (assertActive) => {
      const check = () => {
        assertActive();
        if (changed || revision !== (revisions.get(uid) || 0)) throw new Error('Pesquisa cancelada.');
      };
      check();
      const previous = await readRecentSearches(uid);
      check();
      const next = [q, ...previous.filter((item) => item.toLowerCase() !== q.toLowerCase())]
        .slice(0, MAX_RECENT);
      const envelope = await encryptMemoryFields({ text: JSON.stringify({ uid, queries: next }) });
      check();
      localStorage.setItem(storageKey(uid), JSON.stringify(envelope));
      return next;
    }));
  pendingWrites.set(uid, operation);
  try { return await operation; } finally {
    stop();
    if (pendingWrites.get(uid) === operation) pendingWrites.delete(uid);
  }
}

export function clearRecentSearches(uid: string): void {
  if (uid) {
    revisions.set(uid, (revisions.get(uid) || 0) + 1);
    localStorage.removeItem(storageKey(uid));
  }
}
