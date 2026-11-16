import { afterEach, expect, it, vi } from 'vitest';
import { discardEmbeddingReindex, prepareEmbeddingReindex, readPreparedEmbedding } from './embeddingReindex';
import * as persistence from './embeddingReindexStore';
import type { SessionData } from '../hooks/useSessions';
import { setMemoryCryptoMnemonic, type EncryptedMemoryEnvelope } from './memoryCrypto';
import type { EmbeddingReindexStore } from './embeddingReindexStore';

const words = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];
const memory = (id: string): SessionData => ({ id, uid: 'alice', text: `private ${id}`, timestamp: 1, updatedAt: 1 });
function storage() {
  const data = new Map<string, EncryptedMemoryEnvelope>();
  const store: EmbeddingReindexStore = {
    get: async key => data.get(JSON.stringify(key)),
    put: async (key, value) => { data.set(JSON.stringify(key), value); },
    remove: async key => { data.delete(JSON.stringify(key)); },
  };
  return { data, store };
}
afterEach(() => { setMemoryCryptoMnemonic(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('serializes discard after cancelling and settling the active persistent job', async () => {
  setMemoryCryptoMnemonic(words);
  const { store } = storage();
  vi.spyOn(persistence.embeddingReindexStore, 'get').mockImplementation(store.get);
  vi.spyOn(persistence.embeddingReindexStore, 'put').mockImplementation(store.put);
  vi.spyOn(persistence.embeddingReindexStore, 'remove').mockImplementation(store.remove);
  const clear = vi.spyOn(persistence, 'clearEmbeddingReindexCheckpoints').mockResolvedValue();
  let queue: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, optionsOrCallback: unknown, callback?: () => Promise<unknown>) => {
    const run = callback ?? optionsOrCallback as () => Promise<unknown>;
    const next = queue.catch(() => undefined).then(run);
    queue = next;
    return next;
  });
  vi.stubGlobal('navigator', { locks: { request } });
  let finish!: (vector: number[]) => void;
  const embed = vi.fn(() => new Promise<number[]>(resolve => { finish = resolve; }));
  const job = prepareEmbeddingReindex('alice', 'multilingualCandidate', () => [memory('a')],
    { signal: new AbortController().signal, embed });
  const rejected = expect(job).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(embed).toHaveBeenCalled());
  const discarded = discardEmbeddingReindex('alice');
  expect(clear).not.toHaveBeenCalled();
  finish(Array(384).fill(0.25));
  await rejected;
  await discarded;
  expect(clear).toHaveBeenCalledWith('alice', undefined);
  expect(request.mock.calls.every(call => call[0] === 'mnemosyne-reindex:alice')).toBe(true);
});

it('resumes from encrypted checkpoints and regenerates only changed content', async () => {
  setMemoryCryptoMnemonic(words);
  const { data, store } = storage();
  let memories = [memory('a'), memory('b')];
  const embed = vi.fn().mockResolvedValue(Array(384).fill(0.25));
  const options = { signal: new AbortController().signal, store, embed };
  expect((await prepareEmbeddingReindex('alice', 'multilingualCandidate', () => memories, options)).prepared).toBe(2);
  expect(JSON.stringify([...data.values()])).not.toContain('private');
  expect((await prepareEmbeddingReindex('alice', 'multilingualCandidate', () => memories, options)).reused).toBe(2);
  expect(embed).toHaveBeenCalledTimes(2);
  memories = [{ ...memories[0], text: 'changed', updatedAt: 2 }, memories[1]];
  expect(await prepareEmbeddingReindex('alice', 'multilingualCandidate', () => memories, options))
    .toEqual({ prepared: 1, reused: 1, skipped: 0, total: 2 });
});

it('validates prepared vectors against current ownership, content and key state', async () => {
  setMemoryCryptoMnemonic(words);
  const { store } = storage();
  let current = memory('a');
  const original = current;
  const options = { signal: new AbortController().signal, store };
  await prepareEmbeddingReindex('alice', 'multilingualCandidate', () => [current],
    { ...options, embed: async () => Array(384).fill(0.25) });
  expect((await readPreparedEmbedding('alice', 'multilingualCandidate', () => current, options))?.memoryId).toBe('a');
  current = { ...original, text: 'changed' };
  expect(await readPreparedEmbedding('alice', 'multilingualCandidate', () => current, options)).toBeNull();
  current = { ...original, sharedWithIds: ['bob'] };
  expect(await readPreparedEmbedding('alice', 'multilingualCandidate', () => current, options)).toBeNull();
  current = { ...original, uid: 'bob' };
  expect(await readPreparedEmbedding('alice', 'multilingualCandidate', () => current, options)).toBeNull();
  current = original;
  const pending = readPreparedEmbedding('alice', 'multilingualCandidate', () => current, options);
  setMemoryCryptoMnemonic(null);
  await expect(pending).rejects.toThrow();
});

it('excludes team/shared/locked records and discards results whose source changed during inference', async () => {
  setMemoryCryptoMnemonic(words);
  const { data, store } = storage();
  let memories = [memory('a'), { ...memory('team'), teamId: 'crew' },
    { ...memory('shared'), sharedWithIds: ['bob'] }, { ...memory('locked'), encLocked: true }];
  const embed = vi.fn(async () => { memories = [{ ...memories[0], text: 'new' }, ...memories.slice(1)]; return Array(384).fill(0.25); });
  expect((await prepareEmbeddingReindex('alice', 'multilingualCandidate', () => memories,
    { signal: new AbortController().signal, store, embed })).skipped).toBe(4);
  expect(embed).toHaveBeenCalledOnce();
  expect(data.size).toBe(0);
});

it('keeps completed checkpoints after interruption and writes no vector after a vault lock', async () => {
  setMemoryCryptoMnemonic(words);
  const { data, store } = storage();
  const memories = [memory('a'), memory('b')];
  const embed = vi.fn().mockResolvedValueOnce(Array(384).fill(0.25)).mockImplementationOnce(async () => {
    setMemoryCryptoMnemonic(null);
    return Array(384).fill(0.25);
  });
  await expect(prepareEmbeddingReindex('alice', 'multilingualCandidate', () => memories,
    { signal: new AbortController().signal, store, embed })).rejects.toThrow('cancelled');
  expect(data.size).toBe(1);
  setMemoryCryptoMnemonic(words);
  expect(await prepareEmbeddingReindex('alice', 'multilingualCandidate', () => memories,
    { signal: new AbortController().signal, store, embed: async () => Array(384).fill(0.25) }))
    .toEqual({ prepared: 1, reused: 1, skipped: 0, total: 2 });
});
