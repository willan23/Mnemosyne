import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionData } from '../hooks/useSessions';
import * as reindex from './embeddingReindex';
import { embeddingProfileSpace } from './embeddingProfile';
import { writeEmbeddingSelection } from './embeddingSelection';
import { setMemoryCryptoKeyForTests } from './memoryCrypto';
import { PreparedEmbeddingSearchCache } from './preparedEmbeddingSearchCache';

const caches: PreparedEmbeddingSearchCache[] = [];
const memory = (id = 'a'): SessionData => ({ id, uid: 'alice', text: 'synthetic private text', timestamp: 1, updatedAt: 1 });
const signal = () => new AbortController().signal;
const saved = (item: SessionData, uid = 'alice') => ({ version: 1 as const, uid, memoryId: item.id,
  space: embeddingProfileSpace('multilingualCandidate'), sourceDigest: 'validated-by-reader', vector: Array(384).fill(.25) });
const cache = (limits?: { entries: number; vectorBytes: number }) => {
  const value = new PreparedEmbeddingSearchCache(limits); caches.push(value); return value;
};
let key: CryptoKey;
beforeEach(async () => {
  localStorage.clear();
  key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', false, ['encrypt', 'decrypt']);
  setMemoryCryptoKeyForTests(key);
});
afterEach(() => { for (const value of caches.splice(0)) value.dispose(); setMemoryCryptoKeyForTests(null); vi.restoreAllMocks(); });

it('reuses validated vectors only for the same immutable memory and revalidates an edited snapshot', async () => {
  const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockImplementation(async (_uid, _profile, current) => saved(current()!));
  const value = cache(), original = memory();
  const first = await value.read('alice', 'multilingualCandidate', original, signal());
  expect(await value.read('alice', 'multilingualCandidate', original, signal())).toBe(first);
  expect(read).toHaveBeenCalledTimes(1);
  const edited = { ...original, text: 'new synthetic text', updatedAt: 2 };
  await value.read('alice', 'multilingualCandidate', edited, signal());
  expect(read).toHaveBeenCalledTimes(2);
});

it('does not cache missing checkpoints or failed/corrupt reads', async () => {
  const item = memory(), value = cache();
  const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('Invalid reindex checkpoint')).mockResolvedValue(saved(item));
  expect(await value.read('alice', 'multilingualCandidate', item, signal())).toBeNull();
  await expect(value.read('alice', 'multilingualCandidate', item, signal())).rejects.toThrow('Invalid reindex checkpoint');
  expect(await value.read('alice', 'multilingualCandidate', item, signal())).toEqual(saved(item));
  await value.read('alice', 'multilingualCandidate', item, signal());
  expect(read).toHaveBeenCalledTimes(3);
});

it('invalidates immediately on local selection changes and cross-tab storage events, including clear', async () => {
  const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockImplementation(async (_uid, _profile, current) => saved(current()!));
  const item = memory(), value = cache();
  const retrieve = () => value.read('alice', 'multilingualCandidate', item, signal());
  await retrieve();
  writeEmbeddingSelection('bob', 'multilingualCandidate'); await retrieve(); expect(read).toHaveBeenCalledTimes(1);
  writeEmbeddingSelection('alice', 'multilingualCandidate'); await retrieve(); expect(read).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new StorageEvent('storage', { key: 'mnemosyne.embedding.selection.v1.alice' }));
  await retrieve(); expect(read).toHaveBeenCalledTimes(3);
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
  await retrieve(); expect(read).toHaveBeenCalledTimes(4);
});

it('invalidates on vault ABA even when the same CryptoKey is restored before another query', async () => {
  const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockImplementation(async (_uid, _profile, current) => saved(current()!));
  const item = memory(), value = cache();
  await value.read('alice', 'multilingualCandidate', item, signal());
  setMemoryCryptoKeyForTests(null);
  await expect(value.read('alice', 'multilingualCandidate', item, signal())).rejects.toThrow('cancelled');
  setMemoryCryptoKeyForTests(key);
  await value.read('alice', 'multilingualCandidate', item, signal());
  expect(read).toHaveBeenCalledTimes(2);
});

it('cannot repopulate after scope invalidation while a read is pending', async () => {
  let finish!: (value: reindex.PreparedEmbedding) => void;
  const item = memory(), value = cache();
  const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue(saved(item));
  const pending = value.read('alice', 'multilingualCandidate', item, signal());
  const refused = expect(pending).rejects.toThrow('cancelled');
  writeEmbeddingSelection('alice', null); finish(saved(item)); await refused;
  await value.read('alice', 'multilingualCandidate', item, signal());
  expect(read).toHaveBeenCalledTimes(2);
});

it('separates accounts and profiles and discards an old account read completing after ABA', async () => {
  const item = memory(), value = cache();
  let finish!: (value: reindex.PreparedEmbedding) => void;
  const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockImplementation(async (uid, _profile, current) => saved(current()!, uid));
  const pending = value.read('alice', 'multilingualCandidate', item, signal());
  const refused = expect(pending).rejects.toThrow('cancelled');
  await value.read('bob', 'multilingualCandidate', { ...item, uid: 'bob' }, signal());
  await value.read('alice', 'multilingualCandidate', item, signal());
  finish(saved(item)); await refused;
  await value.read('alice', 'englishPinned', item, signal());
  expect(read).toHaveBeenCalledTimes(4);
});

it('does not cache a cancelled read but preserves other valid cached entries', async () => {
  const a = memory(), b = memory('b'), value = cache(), controller = new AbortController();
  const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockResolvedValueOnce(saved(a))
    .mockImplementationOnce(async () => { controller.abort(); return saved(b); }).mockResolvedValue(saved(b));
  await value.read('alice', 'multilingualCandidate', a, signal());
  await expect(value.read('alice', 'multilingualCandidate', b, controller.signal)).rejects.toThrow('cancelled');
  await value.read('alice', 'multilingualCandidate', a, signal());
  await value.read('alice', 'multilingualCandidate', b, signal());
  expect(read).toHaveBeenCalledTimes(3);
});

it.each([{ entries: 1, vectorBytes: 32 * 1024 * 1024 }, { entries: 8_192, vectorBytes: 384 * 8 }])(
  'bounds cached entries and logical vector bytes and still returns complete search vectors: %j', async limits => {
    const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockImplementation(async (_uid, _profile, current) => saved(current()!));
    const a = memory(), b = memory('b'), value = cache(limits);
    for (const item of [a, b, b, a]) expect((await value.read('alice', 'multilingualCandidate', item, signal()))?.vector).toHaveLength(384);
    expect(read).toHaveBeenCalledTimes(3);
  });

it('does not retain a vector larger than its byte budget', async () => {
  const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockImplementation(async (_uid, _profile, current) => saved(current()!));
  const item = memory(), value = cache({ entries: 1, vectorBytes: 1 });
  await value.read('alice', 'multilingualCandidate', item, signal());
  await value.read('alice', 'multilingualCandidate', item, signal());
  expect(read).toHaveBeenCalledTimes(2);
});

it('owns no listeners until used and releases subscriptions and vectors on disposal', async () => {
  const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
  const read = vi.spyOn(reindex, 'readPreparedEmbedding').mockImplementation(async (_uid, _profile, current) => saved(current()!));
  const item = memory(), value = cache();
  expect(add).not.toHaveBeenCalled();
  await value.read('alice', 'multilingualCandidate', item, signal()); expect(add).toHaveBeenCalledTimes(3);
  value.dispose(); expect(remove).toHaveBeenCalledTimes(3);
  await value.read('alice', 'multilingualCandidate', item, signal()); expect(read).toHaveBeenCalledTimes(2);
});
