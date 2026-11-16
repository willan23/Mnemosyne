import { afterEach, expect, it } from 'vitest';
import { promotePreparedEmbeddings, rollbackEmbeddingSelection } from './embeddingPromotion';
import { readEmbeddingSelection } from './embeddingSelection';
import { prepareEmbeddingReindex } from './embeddingReindex';
import { setMemoryCryptoMnemonic, type EncryptedMemoryEnvelope } from './memoryCrypto';
import type { EmbeddingReindexStore } from './embeddingReindexStore';
import type { SessionData } from '../hooks/useSessions';
const words = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];
const memory: SessionData = { id: 'a', uid: 'alice', text: 'private', timestamp: 1, updatedAt: 1 };
function options() {
  const values = new Map<string, EncryptedMemoryEnvelope>();
  const store: EmbeddingReindexStore = {
    get: async key => values.get(JSON.stringify(key)),
    put: async (key, value) => { values.set(JSON.stringify(key), value); },
    remove: async key => { values.delete(JSON.stringify(key)); },
  };
  return { signal: new AbortController().signal, store, embed: async () => Array(384).fill(0.25) };
}
afterEach(() => { setMemoryCryptoMnemonic(null); localStorage.clear(); });

it('requires complete current checkpoints and permits rollback without changing original vectors', async () => {
  setMemoryCryptoMnemonic(words);
  const opts = options();
  const memories = [memory];
  await expect(promotePreparedEmbeddings('alice', 'multilingualCandidate', () => memories, opts)).rejects.toThrow();
  expect(readEmbeddingSelection('alice')).toBeNull();
  await prepareEmbeddingReindex('alice', 'multilingualCandidate', () => memories, opts);
  expect(await promotePreparedEmbeddings('alice', 'multilingualCandidate', () => memories, opts))
    .toEqual({ selected: 'multilingualCandidate', verified: 1 });
  expect(readEmbeddingSelection('alice')).toBe('multilingualCandidate');
  expect(readEmbeddingSelection('bob')).toBeNull();
  expect(memory.embedding).toBeUndefined();
  rollbackEmbeddingSelection('alice');
  expect(readEmbeddingSelection('alice')).toBeNull();
});

it('cannot commit after rollback or source replacement during checkpoint validation', async () => {
  setMemoryCryptoMnemonic(words);
  const opts = options();
  let memories = [memory];
  await prepareEmbeddingReindex('alice', 'multilingualCandidate', () => memories, opts);
  const get = opts.store.get;
  opts.store.get = async key => { rollbackEmbeddingSelection('alice'); return get(key); };
  await expect(promotePreparedEmbeddings('alice', 'multilingualCandidate', () => memories, opts)).rejects.toThrow();
  expect(readEmbeddingSelection('alice')).toBeNull();
  opts.store.get = async key => { memories = [{ ...memory, text: 'changed' }]; return get(key); };
  await expect(promotePreparedEmbeddings('alice', 'multilingualCandidate', () => memories, opts)).rejects.toThrow();
  expect(readEmbeddingSelection('alice')).toBeNull();
});
