import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ read: vi.fn(), legacy: vi.fn(), pinned: vi.fn() }));
vi.mock('./embeddingReindex', () => ({ readPreparedEmbedding: state.read }));
vi.mock('./embeddingService', () => ({ legacyEmbeddingService: { getEmbedding: state.legacy },
  embeddingServiceForProfile: (profile: string) => ({ getEmbedding: (text: string) => state.pinned(text, profile) }) }));
import { searchSelectedEmbeddingProfile } from './selectedEmbeddingSearch';
import { embeddingProfileSpace } from './embeddingProfile';
import { LEGACY_EMBEDDING_SPACE } from './embeddingModel';
import type { SessionData } from '../hooks/useSessions';
import { PreparedEmbeddingSearchCache } from './preparedEmbeddingSearchCache';
import { setMemoryCryptoKeyForTests } from './memoryCrypto';
import { rankSearchVectors } from './searchVectorRanking';
const a: SessionData = { id: 'a', uid: 'alice', text: 'one', timestamp: 1, updatedAt: 1, embedding: [1, 0] };
const pinnedVector = () => { const vector = new Array(384).fill(0); vector[1] = 1; return vector; };
beforeEach(() => { state.read.mockReset(); state.legacy.mockReset().mockResolvedValue([1, 0]); state.pinned.mockReset().mockResolvedValue(pinnedVector()); });

it('queries persisted pinned spaces even when their local preparation checkpoint is absent', async () => {
  state.read.mockResolvedValue(null);
  const vector = new Array(384).fill(0); vector[1] = 1;
  state.pinned.mockResolvedValue(vector);
  const multilingual = embeddingProfileSpace('multilingualCandidate'), english = embeddingProfileSpace('englishPinned');
  const candidates = [a, { ...a, id: 'multilingual', embedding: vector, embeddingModel: multilingual },
    { ...a, id: 'english-pinned', embedding: vector, embeddingModel: english },
    { ...a, id: 'unknown', embedding: vector, embeddingModel: 'unsupported@future' }];
  const rank = vi.fn(async request => new Map(rankSearchVectors(request)));
  const result = await searchSelectedEmbeddingProfile('alice', 'multilingualCandidate', candidates,
    'query', new AbortController().signal, rank);
  expect([...result.keys()].sort()).toEqual(['a', 'english-pinned', 'multilingual']);
  expect(rank.mock.calls.map(([request]) => request.embeddingModel).sort()).toEqual([LEGACY_EMBEDDING_SPACE, english, multilingual].sort());
  for (const [request] of rank.mock.calls) expect(request.candidates.every((candidate: { embeddingModel?: string }) =>
    (candidate.embeddingModel ?? LEGACY_EMBEDDING_SPACE) === request.embeddingModel)).toBe(true);
});

it('compares each group only to its own model and falls back for missing checkpoints', async () => {
  const space = embeddingProfileSpace('multilingualCandidate');
  state.read.mockImplementation(async (_uid, _profile, read) => read().id === 'a' ? { vector: pinnedVector(), space } : null);
  const rank = vi.fn(async request => new Map<string, number>(request.candidates.map((item: { id: string }) => [item.id, 0.8])));
  const result = await searchSelectedEmbeddingProfile('alice', 'multilingualCandidate', [a, { ...a, id: 'b' }, { ...a, id: 'locked', encLocked: true }],
    'query', new AbortController().signal, rank);
  expect(rank.mock.calls[0][0]).toMatchObject({ query: pinnedVector(), embeddingModel: space,
    candidates: [{ id: 'a', embeddingModel: space, embedding: pinnedVector() }] });
  expect(rank.mock.calls[1][0]).toMatchObject({ query: [1, 0], embeddingModel: LEGACY_EMBEDDING_SPACE,
    candidates: [{ id: 'b', embedding: [1, 0] }] });
  expect([...result.keys()]).toEqual(['a', 'b']);
  expect(state.read).toHaveBeenCalledTimes(2);
});

it('does not infer or rank after cancellation during checkpoint retrieval', async () => {
  const controller = new AbortController();
  state.read.mockImplementation(async () => { controller.abort(); return null; });
  const rank = vi.fn();
  await expect(searchSelectedEmbeddingProfile('alice', 'multilingualCandidate', [a], 'query', controller.signal, rank)).rejects.toThrow();
  expect(state.legacy).not.toHaveBeenCalled();
  expect(state.pinned).not.toHaveBeenCalled();
  expect(rank).not.toHaveBeenCalled();
});

it('reuses prepared vectors across completed queries while generating and ranking each new query', async () => {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', false, ['encrypt', 'decrypt']);
  setMemoryCryptoKeyForTests(key);
  const cache = new PreparedEmbeddingSearchCache();
  const space = embeddingProfileSpace('multilingualCandidate');
  state.read.mockResolvedValue({ version: 1, uid: 'alice', memoryId: 'a', space, vector: pinnedVector() });
  const rank = vi.fn(async () => new Map([['a', .8]]));
  try {
    for (const text of ['first query', 'second query']) {
      expect(await searchSelectedEmbeddingProfile('alice', 'multilingualCandidate', [a], text,
        new AbortController().signal, rank, cache)).toEqual(new Map([['a', .8]]));
    }
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(state.pinned.mock.calls.map(([text]) => text)).toEqual(['first query', 'second query']);
    expect(rank).toHaveBeenCalledTimes(2);
  } finally { cache.dispose(); setMemoryCryptoKeyForTests(null); }
});

it('routes persisted profiles without a local selection and merges their prepared overlay into one query', async () => {
  const space = embeddingProfileSpace('multilingualCandidate'), rank = vi.fn(async request => new Map(rankSearchVectors(request)));
  const stored = { ...a, id: 'stored', embedding: pinnedVector(), embeddingModel: space };
  expect(await searchSelectedEmbeddingProfile('alice', null, [stored], 'query', new AbortController().signal, rank)).toEqual(new Map([['stored', 1]]));
  expect(state.read).not.toHaveBeenCalled(); expect(state.legacy).not.toHaveBeenCalled();
  expect(state.pinned).toHaveBeenCalledWith('query', 'multilingualCandidate');
  state.pinned.mockClear(); rank.mockClear();
  state.read.mockImplementation(async (_uid, _profile, read) => read().id === 'a' ? { space, vector: pinnedVector() } : null);
  expect(await searchSelectedEmbeddingProfile('alice', 'multilingualCandidate', [a, stored], 'next', new AbortController().signal, rank)).toEqual(new Map([['a', 1], ['stored', 1]]));
  expect(state.pinned).toHaveBeenCalledTimes(1); expect(rank).toHaveBeenCalledTimes(1);
});

it('does not infer unknown, incomplete, invalid-dimension, locked, deleted or ambiguous stored spaces', async () => {
  const space = embeddingProfileSpace('multilingualCandidate');
  const memories = [{ ...a, embeddingModel: space }, { ...a, id: 'unknown', embeddingModel: 'unknown@1' },
    { ...a, id: 'raw-id', embeddingModel: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', embedding: pinnedVector() },
    { ...a, id: 'locked', encLocked: true }, { ...a, id: 'deleted', deletedAt: 1 },
    { ...a, id: 'ambiguous', teamScopeAmbiguous: true }];
  const rank = vi.fn();
  expect(await searchSelectedEmbeddingProfile('alice', null, memories, 'query', new AbortController().signal, rank)).toEqual(new Map());
  expect(state.legacy).not.toHaveBeenCalled(); expect(state.pinned).not.toHaveBeenCalled(); expect(rank).not.toHaveBeenCalled();
});

it('rejects a mismatched checkpoint, duplicate IDs and cancellation before starting another model', async () => {
  const controller = new AbortController(), rank = vi.fn();
  state.read.mockResolvedValue({ vector: pinnedVector(), space: embeddingProfileSpace('englishPinned') });
  await expect(searchSelectedEmbeddingProfile('alice', 'multilingualCandidate', [a], 'query', controller.signal, rank)).rejects.toThrow('profile mismatch');
  await expect(searchSelectedEmbeddingProfile('alice', null, [a, a], 'query', controller.signal, rank)).rejects.toThrow('Duplicate');
  state.legacy.mockImplementation(async () => { controller.abort(); return [1, 0]; });
  await expect(searchSelectedEmbeddingProfile('alice', null, [a, { ...a, id: 'pinned', embedding: pinnedVector(), embeddingModel: embeddingProfileSpace('multilingualCandidate') }], 'query', controller.signal, rank)).rejects.toThrow('cancelled');
  expect(state.pinned).not.toHaveBeenCalled(); expect(rank).not.toHaveBeenCalled();
});
