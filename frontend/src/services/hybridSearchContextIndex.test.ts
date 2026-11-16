import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HybridSearchIndex } from './hybridSearchIndex';
import { SEARCH_CONTEXT_POLICY, type HybridContextRequest, type HybridContextResult,
  type HybridPrepareRequest, type HybridPreparedResult, type HybridRankedResult,
  type HybridSearchDocument, type HybridSearchFilters } from './hybridSearchProtocol';
import * as searchUtils from '../utils/searchMemories';

const now = Date.parse('2026-10-26T12:00:00Z');
const node = (label: string) => ({ id: '', type: '', label });
const request = (changed: HybridSearchDocument[], overrides: Partial<HybridPrepareRequest> = {}): HybridPrepareRequest => ({
  v: 1, type: 'prepare', id: 1, changed, removed: [], query: 'signal',
  filters: { dateRange: 'all', tags: [] }, now, limit: 500, floor: .38, ...overrides,
});
const prepare = (index: HybridSearchIndex, changed: HybridSearchDocument[], overrides: Partial<HybridPrepareRequest> = {}) =>
  index.handle(request(changed, overrides)) as HybridPreparedResult;
const context = (index: HybridSearchIndex, revision: number, id = 2) =>
  index.handle({ v: 1, type: 'context', id, revision }) as HybridContextResult;
const ids = (result: HybridContextResult) => result.candidates.map(row => row.id);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('bounded authorized context from the hybrid index', () => {
  it.each([false, true])('recovers a surface term when its seed also has the same entity: %s', withEntity => {
    const index = new HybridSearchIndex();
    const first = prepare(index, [
      { id: 'seed', title: 'signal', text: 'Áurea', nodes: withEntity ? [node('Áurea')] : [] },
      { id: 'neighbor', title: 'elsewhere', text: 'aurea' },
      { id: 'unrelated', title: 'elsewhere', text: 'unconnected' },
    ]);
    expect(first.hits.map(row => row.id)).toEqual(['seed']);
    const result = context(index, first.revision);
    expect(ids(result)).toEqual(['seed', 'neighbor']);
    expect(result.candidates[1]).toEqual({ id: 'neighbor', kind: 'term-context', matchedKeys: 1, viaSeedId: 'seed' });
    expect(result.stats.expanded).toBe(1);
  });

  it('keeps kind and viaSeedId on the same strongest contribution', () => {
    const index = new HybridSearchIndex();
    const first = prepare(index, [
      { id: 'seed-entity', title: 'signal', nodes: [node('Aurora')] },
      { id: 'seed-term', title: 'signal', text: 'Boreal' },
      { id: 'neighbor', title: 'elsewhere', text: 'Boreal', nodes: [node('Aurora')] },
      { id: 'filler-a', title: 'elsewhere', nodes: [node('Aurora')] },
      { id: 'filler-b', title: 'elsewhere', nodes: [node('Aurora')] },
    ]);
    expect(context(index, first.revision).candidates.find(row => row.id === 'neighbor')).toEqual({
      id: 'neighbor', kind: 'term-context', matchedKeys: 2, viaSeedId: 'seed-term',
    });
  });

  it('prefers entity provenance when two contributions have equal weight', () => {
    const index = new HybridSearchIndex();
    const first = prepare(index, [
      { id: 'seed-term', title: 'signal', text: 'Boreal' },
      { id: 'seed-entity', title: 'signal', nodes: [node('Aurora')] },
      { id: 'neighbor', title: 'elsewhere', text: 'Boreal', nodes: [node('Aurora')] },
    ]);
    expect(context(index, first.revision).candidates.find(row => row.id === 'neighbor')).toEqual({
      id: 'neighbor', kind: 'entity-context', matchedKeys: 2, viaSeedId: 'seed-entity',
    });
  });

  const filterCases: Array<{ name: string; query?: string; filters?: HybridSearchFilters;
    exclude: (document: HybridSearchDocument) => HybridSearchDocument }> = [
    { name: 'UI tags', filters: { dateRange: 'all', tags: ['allowed'] }, exclude: document => ({ ...document, tags: ['denied'] }) },
    { name: 'UI category', filters: { dateRange: 'all', tags: [], category: 'note' }, exclude: document => ({ ...document, category: 'task' }) },
    { name: 'UI date', filters: { dateRange: 'week', tags: [] }, exclude: document => ({ ...document, timestamp: Date.parse('2026-10-01') }) },
    { name: 'query tag', query: 'signal tag:allowed', exclude: document => ({ ...document, tags: ['denied'] }) },
    { name: 'query category', query: 'signal cat:note', exclude: document => ({ ...document, category: 'task' }) },
    { name: 'query entity', query: 'signal entity:Scope', exclude: document => ({ ...document, nodes: [node('Bridge')] }) },
    { name: 'query after', query: 'signal after:2026-10-25', exclude: document => ({ ...document, timestamp: Date.parse('2026-10-20') }) },
    { name: 'query before', query: 'signal before:2026-10-27', exclude: document => ({ ...document, timestamp: Date.parse('2026-10-28') }) },
  ];
  it.each(filterCases)('intersects expanded IDs with eligibility for $name', ({ query = 'signal', filters = { dateRange: 'all', tags: [] }, exclude }) => {
    const index = new HybridSearchIndex();
    const seed: HybridSearchDocument = { id: 'seed', title: 'signal', tags: ['allowed'], category: 'note',
      timestamp: Date.parse('2026-10-26'), nodes: [node('Bridge'), node('Scope')] };
    const neighbor = { ...seed, id: 'neighbor', title: 'elsewhere' };
    const first = prepare(index, [seed, neighbor, exclude({ ...neighbor, id: 'excluded' })], { query, filters });
    expect(first.candidateIds).toEqual(['seed', 'neighbor']);
    const result = context(index, first.revision);
    expect(ids(result)).toEqual(['seed', 'neighbor']);
    expect(result.candidates.every(row => first.candidateIds.includes(row.id))).toBe(true);
  });

  it.each(['', 'after:2026-02-30', 'entity:""'])('does not create context for empty or invalid query %j', query => {
    const index = new HybridSearchIndex();
    const first = prepare(index, [{ id: 'seed', title: 'signal', nodes: [node('Bridge')] }], { query });
    expect(context(index, first.revision)).toEqual({ revision: first.revision, candidates: [],
      stats: { seeds: 0, anchors: 0, postingVisits: 0, skippedBroad: 0, expanded: 0 } });
  });

  it('retains filter-only hits without performing expansion', () => {
    const index = new HybridSearchIndex();
    const first = prepare(index, [
      { id: 'a', tags: ['allowed'], nodes: [node('Bridge')] },
      { id: 'b', tags: ['allowed'], nodes: [node('Bridge')] },
    ], { query: 'tag:allowed' });
    const result = context(index, first.revision);
    expect(ids(result)).toEqual(['a', 'b']);
    expect(result.stats).toEqual({ seeds: 2, anchors: 0, postingVisits: 0, skippedBroad: 0, expanded: 0 });
  });

  it.each(['entity', 'term'] as const)('accepts 256 entries and skips 257 in a %s posting', source => {
    for (const count of [256, 257]) {
      const index = new HybridSearchIndex();
      const fields = source === 'entity' ? { nodes: [node('Boreal')] } : { text: 'Boreal' };
      const documents = Array.from({ length: count }, (_, i) => ({ id: i ? `neighbor-${i}` : 'seed', title: i ? 'elsewhere' : 'signal', ...fields }));
      const first = prepare(index, documents);
      const result = context(index, first.revision);
      expect(result.stats.anchors).toBe(1);
      expect(result.stats.postingVisits).toBe(count === 256 ? 256 : 0);
      expect(result.stats.skippedBroad).toBe(count === 256 ? 0 : 1);
      expect(result.stats.expanded).toBe(count === 256 ? 15 : 0);
      expect(result.candidates).toHaveLength(count === 256 ? 16 : 1);
    }
  });

  it('can use a narrow term posting even when the same entity posting is too broad', () => {
    const index = new HybridSearchIndex();
    const first = prepare(index, [
      { id: 'seed', title: 'signal', text: 'Boreal', nodes: [node('Boreal')] },
      { id: 'term-neighbor', text: 'boreal' },
      ...Array.from({ length: 256 }, (_, i) => ({ id: `entity-${i}`, nodes: [node('Boreal')] })),
    ]);
    const result = context(index, first.revision);
    expect(ids(result)).toEqual(['seed', 'term-neighbor']);
    expect(result.candidates[1].kind).toBe('term-context');
    expect(result.stats).toEqual({ seeds: 1, anchors: 1, postingVisits: 2, skippedBroad: 1, expanded: 1 });
  });

  it('bounds all four seeds and both posting sources at 16384 visits and 16 results', () => {
    const documents: HybridSearchDocument[] = [];
    for (let seed = 0; seed < 4; seed++) {
      const labels = Array.from({ length: 8 }, (_, key) => `Key${seed}${key}`);
      documents.push({ id: `seed-${seed}`, title: 'signal', text: labels.join(' '), nodes: labels.map(node) });
      for (const [key, label] of labels.entries()) for (let i = 0; i < 255; i++) {
        documents.push({ id: `entity-${seed}-${key}-${i}`, nodes: [node(label)] });
        documents.push({ id: `term-${seed}-${key}-${i}`, text: label.toLowerCase() });
      }
    }
    const index = new HybridSearchIndex(), first = prepare(index, documents), result = context(index, first.revision);
    expect(result.stats).toEqual({ seeds: 4, anchors: 32, postingVisits: 16384, skippedBroad: 0, expanded: 12 });
    expect(result.stats.postingVisits).toBe(SEARCH_CONTEXT_POLICY.seeds * SEARCH_CONTEXT_POLICY.anchorsPerSeed *
      SEARCH_CONTEXT_POLICY.postingLimit * SEARCH_CONTEXT_POLICY.postingSources);
    expect(result.candidates).toHaveLength(16);
    expect(new Set(ids(result)).size).toBe(16);
    expect(ids(result).slice(0, 4)).toEqual(['seed-0', 'seed-1', 'seed-2', 'seed-3']);
  });

  it.each([128, 129])('accepts entity hints only up to 128 characters: %i', length => {
    const index = new HybridSearchIndex(), label = 'A'.repeat(length);
    const first = prepare(index, [{ id: 'seed', title: 'signal', nodes: [node(label)] },
      { id: 'neighbor', nodes: [node(label)] }]);
    expect(ids(context(index, first.revision))).toEqual(length === 128 ? ['seed', 'neighbor'] : ['seed']);
  });

  it('caches at most 64 surface hints while query hints do not consume the eight expansion slots', () => {
    const labels = Array.from({ length: 65 }, (_, i) => `Word${String(i).padStart(3, '0')}`);
    const index = new HybridSearchIndex();
    const first = prepare(index, [
      { id: 'seed', title: 'signal', text: labels.join(' ') },
      { id: 'cached', text: labels[63].toLowerCase() },
      { id: 'uncached', text: labels[64].toLowerCase() },
    ], { query: `signal ${labels.slice(0, 63).join(' ')}`, limit: 1 });
    expect(first.hits.map(row => row.id)).toEqual(['seed']);
    const result = context(index, first.revision);
    expect(ids(result)).toEqual(['seed', 'cached']);
    expect(result.stats.anchors).toBe(1);
  });

  it('preserves the top four and a score of exactly .9 before filling the 16 slots with context', () => {
    const documents: HybridSearchDocument[] = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `seed-${i}`, title: 'signal', nodes: [node('Bridge')] })),
      { id: 'strong', title: 'elsewhere' }, { id: 'below', title: 'elsewhere' },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `neighbor-${i}`, nodes: [node('Bridge')] })),
    ];
    const index = new HybridSearchIndex(), first = prepare(index, documents);
    const ranked = index.handle({ v: 1, type: 'rank', id: 2, revision: first.revision,
      scores: [['strong', .9 / .95], ['below', (.9 - .000001) / .95]] }) as HybridRankedResult;
    expect(ranked.hits.find(row => row.id === 'strong')?.score).toBe(.9);
    const result = context(index, first.revision, 3);
    expect(ids(result).slice(0, 5)).toEqual(['seed-0', 'seed-1', 'seed-2', 'seed-3', 'strong']);
    expect(result.candidates[4]).toEqual({ id: 'strong', kind: 'strong', matchedKeys: 0 });
    expect(ids(result)).not.toContain('below');
    expect(result.candidates).toHaveLength(16);
  });

  it('caps more than 16 strong sources without displacing the top four', () => {
    const index = new HybridSearchIndex();
    const first = prepare(index, Array.from({ length: 20 }, (_, i) => ({ id: `strong-${i}`, title: 'signal' })));
    const result = context(index, first.revision);
    expect(ids(result)).toEqual(first.hits.slice(0, 16).map(row => row.id));
    expect(result.candidates.slice(0, 4).every(row => row.kind === 'seed')).toBe(true);
    expect(result.candidates.slice(4).every(row => row.kind === 'strong')).toBe(true);
  });

  it('captures query fields, filters and hit identities before returning prepare results', () => {
    const index = new HybridSearchIndex();
    const input = request([
      { id: 'seed', title: 'signal', text: 'Aurora', tags: ['allowed'], category: 'note', timestamp: now - 1000 },
      { id: 'neighbor', text: 'Aurora', tags: ['allowed'], category: 'note', timestamp: now - 1000 },
      { id: 'excluded', title: 'signal', text: 'Aurora', tags: ['denied'], category: 'task' },
    ], { filters: { dateRange: 'week', tags: ['allowed'], category: 'note' } });
    const first = index.handle(input) as HybridPreparedResult;
    const expected = context(index, first.revision);
    first.hits[0].id = 'excluded'; first.hits[0].score = 0; first.hits.length = 0;
    first.candidateIds.push('excluded');
    input.query = 'replacement'; input.filters.tags.push('denied'); input.filters.category = 'task';
    input.filters.dateRange = 'today'; input.now = NaN; input.limit = 0; input.floor = NaN; input.sortByTimestamp = true;
    expect(context(index, first.revision, 3)).toEqual(expected);
    const ranked = index.handle({ v: 1, type: 'rank', id: 4, revision: first.revision, scores: [] }) as HybridRankedResult;
    expect(ranked.hits.map(row => row.id)).toEqual(['seed']);
  });

  it('captures rank hit identities and scores without retaining mutable returned objects', () => {
    const index = new HybridSearchIndex();
    const first = prepare(index, [{ id: 'seed', title: 'signal', text: 'Aurora' }, { id: 'neighbor', text: 'Aurora' }]);
    const scores: Array<[string, number]> = [['neighbor', .95]];
    const ranked = index.handle({ v: 1, type: 'rank', id: 2, revision: first.revision, scores }) as HybridRankedResult;
    const expected = context(index, first.revision, 3);
    ranked.hits[0].id = 'foreign'; ranked.hits[0].score = 0; ranked.hits.length = 0;
    scores[0][0] = 'foreign'; scores[0][1] = -1;
    expect(context(index, first.revision, 4)).toEqual(expected);
    expect(ids(expected)).toEqual(['seed', 'neighbor']);
  });

  it('replaces both text and entity hints on update and removes old postings', () => {
    const index = new HybridSearchIndex();
    let first = prepare(index, [
      { id: 'seed', title: 'signal', text: 'Aurora', nodes: [node('Bridge')] },
      { id: 'old-term', text: 'Aurora' }, { id: 'old-entity', nodes: [node('Bridge')] },
      { id: 'new-term', text: 'Boreal' }, { id: 'new-entity', nodes: [node('Harbor')] },
    ]);
    expect(ids(context(index, first.revision))).toEqual(['seed', 'old-term', 'old-entity']);
    first = prepare(index, [{ id: 'seed', title: 'signal', text: 'Boreal', nodes: [node('Harbor')] }], { id: 3 });
    expect(first.stats.normalized).toBe(1);
    expect(ids(context(index, first.revision, 4))).toEqual(['seed', 'new-term', 'new-entity']);
    first = prepare(index, [], { id: 5, removed: ['new-term', 'new-entity'] });
    expect(first.stats.normalized).toBe(0);
    expect(ids(context(index, first.revision, 6))).toEqual(['seed']);
    first = prepare(index, [], { id: 7, removed: ['seed'] });
    expect(context(index, first.revision, 8).candidates).toEqual([]);
  });

  it('does not normalize documents again when context is requested or an unchanged corpus is reused', () => {
    const normalization = vi.spyOn(searchUtils, 'prepareSearchMemory');
    const index = new HybridSearchIndex();
    let first = prepare(index, [{ id: 'seed', title: 'signal', text: 'Aurora' }, { id: 'neighbor', text: 'Aurora' }]);
    expect(normalization).toHaveBeenCalledTimes(2);
    normalization.mockClear();
    const expected = context(index, first.revision);
    expect(context(index, first.revision, 3)).toEqual(expected);
    first = prepare(index, [], { id: 4 });
    expect(first.stats.normalized).toBe(0);
    expect(ids(context(index, first.revision, 5))).toEqual(ids(expected));
    expect(normalization).not.toHaveBeenCalled();
  });

  it.each(['stale', 'extra-text', 'extra-vector', 'no-prepare'] as const)('fails closed for a %s context request', mode => {
    const index = new HybridSearchIndex();
    const first = mode === 'no-prepare' ? undefined : prepare(index, [{ id: 'seed', title: 'signal', text: 'SYNTHETIC_PRIVATE_TEXT' }]);
    const contextRequest = { v: 1, type: 'context', id: 2, revision: first?.revision ?? 1,
      ...(mode === 'extra-text' ? { text: 'SYNTHETIC_PRIVATE_TEXT' } : {}),
      ...(mode === 'extra-vector' ? { embedding: [1, 0] } : {}) } as HybridContextRequest;
    if (mode === 'stale') prepare(index, [], { id: 2 });
    expect(() => index.handle(contextRequest)).toThrow(/^hybrid_index_unavailable$/);
    expect(prepare(index, [], { id: 3, order: [] }).stats.indexed).toBe(0);
  });

  it('returns only bounded candidate metadata without source text, snippets or vectors', () => {
    const index = new HybridSearchIndex();
    const first = prepare(index, [
      { id: 'seed', title: 'signal', text: 'Aurora SYNTHETIC_PRIVATE_TEXT', nodes: [node('Bridge')] },
      { id: 'neighbor', title: 'SYNTHETIC_PRIVATE_TITLE', text: 'Aurora', nodes: [node('Bridge')] },
    ]);
    const result = context(index, first.revision);
    expect(ids(result)).toEqual(['seed', 'neighbor']);
    expect(Object.keys(result).sort()).toEqual(['candidates', 'revision', 'stats']);
    for (const candidate of result.candidates) {
      expect(Object.keys(candidate).every(key => ['id', 'kind', 'matchedKeys', 'viaSeedId'].includes(key))).toBe(true);
      expect(Number.isInteger(candidate.matchedKeys)).toBe(true);
      expect(candidate.matchedKeys).toBeLessThanOrEqual(32);
    }
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');
    expect(JSON.stringify(result)).not.toMatch(/"(?:embedding|snippet|matchedTags|nodes|title|text)":/);
  });
});
