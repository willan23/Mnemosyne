import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HybridSearchIndex } from './hybridSearchIndex';
import { HYBRID_SEARCH_LIMITS, type HybridPrepareRequest, type HybridPreparedResult, type HybridRankedResult } from './hybridSearchProtocol';
import { prepareSearchMemory, searchMemories, type SearchableMemory } from '../utils/searchMemories';
import { structuredMemorySearch } from './structuredMemorySearch';

const now = Date.parse('2026-10-23T12:00:00Z');
const filters = { dateRange: 'all', tags: [] as string[] };
const documents: SearchableMemory[] = [
  { id: 'a', title: 'Reunião Órbita', text: 'A revisão do projeto lunar começa amanhã.', tags: ['Trabalho', 'órbita'], category: 'note', timestamp: Date.parse('2026-10-01'), nodes: [{ id: 'x', type: 'city', label: 'São Paulo' }] },
  { id: 'b', title: 'Orbite', text: 'Le projet lunaire attend une décision.', tags: ['workshop'], celestialType: 'notebook', timestamp: now - 1000 },
  { id: 'c', title: 'Moon project', text: 'The project revision is due on Tuesday.', tags: ['work'], category: 'note', timestamp: Date.parse('2026-11-01') },
  { id: 'd', title: 'Orchard', text: 'Synthetic agriculture evidence.', category: 'task', timestamp: Date.parse('2026-09-01') },
  { id: 'e', text: 'or the', tags: ['home'] },
  { id: 'f', title: '中文', text: '北京 天气', tags: ['work'], category: 'note', timestamp: Date.parse('2026-10-01') },
  { id: 'g', title: 'Reunião Órbita', text: 'A revisão do projeto lunar começa amanhã.', tags: ['Trabalho', 'órbita'], category: 'note', timestamp: Date.parse('2026-10-01') },
];
const queries = ['Reunião Órbita', 'reuniao', 'revis', 'revision', 'lunar começa', 'where is the moon', 'the', '中文', '???', 'no-such-match',
  'tag:work', '#work lunar', 'tag:Trabalho', 'tag:órbita', 'cat:note', 'entity:"São Paulo"', 'entity:"Sao Paulo" lunar',
  'after:2026-10-01 before:2026-11-01', 'after:2026-11-01', 'before:2026-10-01', 'after:2026-02-30', 'entity:""', 'after:2026-11-01 before:2026-10-01', ''];
const summary = (hits: ReturnType<typeof searchMemories>) => hits.map(hit => ({ id: hit.memory.id, score: hit.score,
  semanticScore: hit.memory.semanticScore ?? 0, matchKind: hit.matchKind, snippet: hit.snippet, matchedTags: hit.matchedTags }));
const prepare = (query = 'lunar', overrides: Partial<HybridPrepareRequest> = {}): HybridPrepareRequest => ({
  v: 1, type: 'prepare', id: 1, changed: documents, removed: [], order: documents.map(row => row.id), query, filters, now, limit: 500, floor: .38, ...overrides,
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe('hybrid local index parity with the existing search contract', () => {
  it('orders incremental corpus candidates by descending timestamp and preserves the first-seen order for ties', () => {
    const index = new HybridSearchIndex(), a = { id: 'a', text: 'synthetic', timestamp: 1 }, b = { id: 'b', text: 'synthetic', timestamp: 2 };
    const first = index.handle(prepare('', { changed: [a, b], order: undefined, sortByTimestamp: true })) as HybridPreparedResult;
    expect(first.candidateIds).toEqual(['b', 'a']);
    const next = index.handle(prepare('', { id: 2, changed: [{ ...a, timestamp: 3 }], order: undefined, sortByTimestamp: true })) as HybridPreparedResult;
    expect(next.candidateIds).toEqual(['a', 'b']);
    const tied = index.handle(prepare('', { id: 3, changed: [{ ...b, timestamp: 3 }], order: undefined, sortByTimestamp: true })) as HybridPreparedResult;
    expect(tied.candidateIds).toEqual(['a', 'b']);
  });
  it.each(queries)('preserves raw and cached scoring for %s', query => {
    const cached = new Map(documents.map(row => [row.id, prepareSearchMemory(row)]));
    for (const scopedFilters of [filters, { ...filters, tags: ['work', 'Trabalho'] }, { ...filters, category: 'note' }, { ...filters, dateRange: 'month' }, { ...filters, dateRange: 'unknown' }]) {
      const index = new HybridSearchIndex();
      const request = prepare(query, { filters: scopedFilters });
      const candidates = structuredMemorySearch(documents, query, scopedFilters, now);
      const first = index.handle(request) as HybridPreparedResult;
      expect(first.candidateIds).toEqual(candidates.map(row => row.id));
      expect(first.hits).toEqual(summary(searchMemories(candidates, query, { semanticScores: new Map(), limit: 500 })));
      const scores = new Map(candidates.map((row, n) => [row.id, [.99, .38, .379, -.5][n % 4]]));
      const raw = searchMemories(candidates, query, { semanticScores: scores, limit: 500 });
      expect(searchMemories(candidates, query, { semanticScores: scores, limit: 500, prepared: cached })).toEqual(raw);
      expect((index.handle({ v: 1, type: 'rank', id: 2, revision: first.revision, scores: [...scores] }) as HybridRankedResult).hits).toEqual(summary(raw));
    }
  });
  it('handles a zero or negative semantic floor without dropping zero-score candidates', () => {
    for (const floor of [-1, 0, 1]) {
      const index = new HybridSearchIndex(), request = prepare('no-such-match', { floor });
      expect((index.handle(request) as HybridPreparedResult).hits).toEqual(summary(searchMemories(documents, request.query, { semanticScores: new Map(), semanticFloor: floor, limit: 500 })));
    }
  });
  it('normalizes only changed records, removes postings, preserves order and replaces temporal/entity keys', () => {
    const index = new HybridSearchIndex();
    const first = index.handle(prepare('reuniao')) as HybridPreparedResult;
    expect(first.stats).toEqual({ indexed: 7, changed: 7, removed: 0, normalized: 7 });
    const reused = index.handle(prepare('reuniao', { id: 2, changed: [], removed: [], order: undefined })) as HybridPreparedResult;
    expect(reused.stats.normalized).toBe(0);
    expect(reused.hits.map(row => row.id)).toEqual(['a', 'g']);
    const changed = { ...documents[0], title: 'Updated', text: 'Now elsewhere', tags: ['other'], nodes: [], timestamp: now };
    const updated = index.handle(prepare('entity:"São Paulo"', { id: 3, changed: [changed], removed: ['g'], order: documents.filter(row => row.id !== 'g').map(row => row.id) })) as HybridPreparedResult;
    expect(updated.stats).toEqual({ indexed: 6, changed: 1, removed: 1, normalized: 1 });
    expect(updated.candidateIds).toEqual([]);
    const after = index.handle(prepare('after:2026-10-23', { id: 4, changed: [], removed: [], order: undefined })) as HybridPreparedResult;
    // b was created one second before noon on the same UTC day and is included.
    expect(after.candidateIds).toEqual(['a', 'b', 'c']);
  });
  it('does not trust a preparation cache for another object with the same ID', () => {
    const original = { id: 'x', text: 'orchard' }, changed = { id: 'x', text: 'volcano' };
    expect(searchMemories([changed], 'orchard', { prepared: new Map([['x', prepareSearchMemory(original)]]) })).toEqual([]);
  });
  it('rejects stale revisions and foreign semantic IDs, clearing the corpus on protocol failure', () => {
    for (const mode of ['stale', 'foreign', 'nan', 'duplicate']) {
      const index = new HybridSearchIndex(), first = index.handle(prepare()) as HybridPreparedResult;
      expect(() => index.handle({ v: 1, type: 'rank', id: 2, revision: mode === 'stale' ? first.revision - 1 : first.revision,
        scores: mode === 'foreign' ? [['unknown', .9]] : mode === 'nan' ? [['a', NaN]] : mode === 'duplicate' ? [['a', .9], ['a', .9]] : [] })).toThrow('hybrid_index_unavailable');
      expect((index.handle(prepare('lunar', { changed: [], order: [] })) as HybridPreparedResult).stats.indexed).toBe(0);
    }
  });
  it('rejects over-limit, malformed or private fields and never returns the input in errors', () => {
    const bad = [prepare('q', { changed: [{ id: 'x', text: 'a'.repeat(HYBRID_SEARCH_LIMITS.fieldChars + 1) }] }),
      prepare('q', { query: 'a'.repeat(8193) }), prepare('q', { order: ['a', 'a'] }),
      prepare('q', { changed: [{ id: 'x', text: 'synthetic-private-marker', uid: 'private-owner' } as SearchableMemory] }),
      prepare('q', { changed: [{ id: 'x', nodes: [{ id: {}, type: '', label: 'Synthetic' }] } as unknown as SearchableMemory] }),
      prepare('q', { changed: Array(HYBRID_SEARCH_LIMITS.documents + 1).fill(documents[0]) })];
    for (const request of bad) expect(() => new HybridSearchIndex().handle(request)).toThrow(/^hybrid_index_unavailable$/);
  });
});
