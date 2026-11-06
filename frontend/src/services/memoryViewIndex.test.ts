import { describe, expect, it, vi } from 'vitest';
import { MemoryViewIndex } from './memoryViewIndex';
import type { MemoryViewOptions, MemoryViewRecord, MemoryViewRequest } from './memoryViewProtocol';
import { rankMemoriesForRender, getUniverseRenderBudget } from '../engines/celestialLayout';
import type { MemoryObject } from '../types/universe';

const row = (id: string, extra: Partial<MemoryViewRecord> = {}): MemoryViewRecord => ({ id, timestamp: 1, fields: [id], connections: [], importance: .5, updatedAt: 1, taxonomyLane: null, ...extra });
const list = { mode: 'list', query: '', locale: 'en', limit: 100 } as const;
const request = (rows: MemoryViewRecord[], options: MemoryViewOptions = list): MemoryViewRequest => ({ v: 1, id: 1, changed: rows, order: rows.map(row => row.id), options, now: 1_700_000_000_000 });
describe('Worker memory view selection', () => {
  it('preserves timestamp ties and exact page counts without returning content', () => {
    const index = new MemoryViewIndex(), rows = [row('b'), row('a'), row('new', { timestamp: 2 })];
    expect(index.handle(request(rows, { ...list, limit: 2 }))).toEqual({ count: 3, ids: ['new', 'b'] });
    expect(index.handle({ ...request([], list), order: undefined })).toEqual({ count: 3, ids: ['new', 'b', 'a'] });
  });
  it.each(['pt-PT', 'pt-BR', 'en', 'fr'] as const)('matches locale substring fields independently in %s', locale => {
    const index = new MemoryViewIndex(), rows = [row('a', { fields: ['ÁRVORE', 'plan'] }), row('b', { fields: ['arbre'] })];
    expect(index.handle(request(rows, { ...list, locale, query: ' árvore ' })).ids).toEqual(['a']);
    expect(index.handle({ ...request([], { ...list, locale, query: 'árvoreplan' }), order: undefined }).ids).toEqual([]);
  });
  it('invalidates normalized fields only for replaced documents and on locale change', () => {
    const index = new MemoryViewIndex(), normalize = vi.spyOn(String.prototype, 'toLocaleLowerCase');
    try {
      index.handle(request([row('a'), row('b')], { ...list, query: 'a' })); normalize.mockClear();
      index.handle({ ...request([], { ...list, query: 'b' }), order: undefined }); expect(normalize).toHaveBeenCalledTimes(1);
      normalize.mockClear(); index.handle({ ...request([row('a', { fields: ['changed'] })], { ...list, query: 'changed' }), order: ['a', 'b'] });
      expect(normalize).toHaveBeenCalledTimes(2);
      normalize.mockClear(); index.handle({ ...request([], { ...list, locale: 'fr', query: 'changed' }), order: undefined });
      expect(normalize).toHaveBeenCalledTimes(3);
    } finally { normalize.mockRestore(); }
  });
  it('removes deleted projections and updates the input order of tied results', () => {
    const index = new MemoryViewIndex(); index.handle(request([row('a'), row('b'), row('c')]));
    expect(index.handle({ ...request([]), order: ['c', 'a'] })).toEqual({ count: 2, ids: ['c', 'a'] });
    expect(() => index.handle({ ...request([]), order: ['b'] })).toThrow('memory_view_unavailable');
  });
  it('matches the existing scene ranking and budget across boundary sizes and active connections', () => {
    const now = 1_700_000_000_000, clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try { for (const count of [0, 140, 141, 320, 321, 420, 421, 10000]) {
      const rows = Array.from({ length: count }, (_, i) => row('m' + i, { importance: (i % 17) / 17,
        updatedAt: now - (i % 250) * 86_400_000, connections: i === 3 ? ['m777', 'm8'] : [], taxonomyLane: i % 2 ? 'work' : 'personal' }));
      const options = { mode: 'scene', activeId: 'm3', filteredIds: null, taxonomy: null } as const;
      const actual = new MemoryViewIndex().handle(request(rows, options));
      const expected = rankMemoriesForRender(rows as unknown as MemoryObject[], 'm3', getUniverseRenderBudget(count).maxObjects).map(row => row.id);
      expect(actual).toEqual({ count, ids: expected });
    } } finally { clock.mockRestore(); }
  });
  it('applies both scene filters before selecting the active memory and its connections', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row('m' + i, { taxonomyLane: i % 2 ? 'work' : 'personal' }));
    const index = new MemoryViewIndex(), ids = rows.slice(300, 600).map(row => row.id);
    const actual = index.handle(request(rows, { mode: 'scene', activeId: 'm0', filteredIds: ids, taxonomy: 'work' }));
    expect(actual).toEqual({ count: 150, ids: ids.filter((_, i) => i % 2 === 1) });
    expect(index.handle({ ...request([], { mode: 'scene', activeId: null, filteredIds: [], taxonomy: null }), order: undefined })).toEqual({ count: 0, ids: [] });
  });
  it('matches full stable sorting through deterministic randomized list edits and searches', () => {
    const index = new MemoryViewIndex(); let seed = 9123;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    let rows = Array.from({ length: 1000 }, (_, i) => row('m' + i, { timestamp: random() % 40, fields: ['word' + random() % 5] }));
    index.handle(request(rows));
    for (let step = 0; step < 100; step++) {
      const i = random() % rows.length, changed = row(rows[i].id, { timestamp: random() % 40, fields: ['word' + random() % 5] });
      rows = rows.map((item, position) => position === i ? changed : item);
      const query = 'word' + random() % 5, limit = 1 + random() % 150;
      const eligible = rows.filter(item => item.fields.some(value => value.includes(query)));
      expect(index.handle({ ...request([changed], { ...list, query, limit }), order: rows.map(row => row.id) }))
        .toEqual({ count: eligible.length, ids: eligible.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit).map(row => row.id) });
    }
  });
  it.each([
    { v: 2 }, { id: NaN }, { order: ['a', 'a'] }, { order: ['foreign'] },
    { options: { ...list, locale: new String('en') } }, { options: { ...list, limit: 0 } },
    { changed: [row('a', { timestamp: NaN })] }, { changed: [row('a'), row('a')] },
    { options: { mode: 'scene', activeId: null, taxonomy: null, filteredIds: 'a' } },
  ])('fails closed for invalid requests %# and requires a complete new baseline', patch => {
    const index = new MemoryViewIndex(); index.handle(request([row('a')]));
    expect(() => index.handle({ ...request([row('a')]), ...patch } as MemoryViewRequest)).toThrow('memory_view_unavailable');
    expect(() => index.handle({ ...request([]), order: undefined })).toThrow();
    expect(index.handle(request([row('b')]))).toEqual({ count: 1, ids: ['b'] });
  });
});
