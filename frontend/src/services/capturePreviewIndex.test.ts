import { afterEach, expect, it, vi } from 'vitest';
import { CapturePreviewIndex } from './capturePreviewIndex';
import * as search from '../utils/searchMemories';
const row = (id: string, timestamp = 1) => ({ id, text: 'A synthetic astronomical observation', title: 'Astronomical notes', timestamp });
afterEach(() => vi.restoreAllMocks());
it('matches the existing textual ranking/timestamps for 10,000 documents and returns only four IDs/scores', () => {
  const rows = Array.from({ length: 10000 }, (_, i) => row('m' + i, i));
  const result = new CapturePreviewIndex().handle({ v: 1, id: 1, changed: rows, order: rows.map(row => row.id), query: 'astronomical observation' });
  expect(result).toEqual(search.searchMemories(rows, 'astronomical observation', { limit: 4, semanticFloor: .4 }).map(hit => ({ id: hit.memory.id, score: hit.score })));
  expect(result.every(hit => Object.keys(hit).sort().join(',') === 'id,score')).toBe(true);
});
it('normalizes only changed documents, retains source order for ties and removes retired documents', () => {
  const prepare = vi.spyOn(search, 'prepareSearchMemory'), index = new CapturePreviewIndex();
  index.handle({ v: 1, id: 1, changed: [row('b'), row('a')], order: ['b', 'a'], query: 'astronomical observation' });
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(index.handle({ v: 1, id: 2, changed: [], query: 'astronomical observation revised' }).map(hit => hit.id)).toEqual(['b', 'a']);
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(index.handle({ v: 1, id: 3, changed: [{ ...row('a'), title: 'Astronomical observation revised' }], order: ['a'], query: 'astronomical observation revised' }).map(hit => hit.id)).toEqual(['a']);
  expect(prepare).toHaveBeenCalledTimes(3);
});
it('preserves the lexical fallback for fragments below the primary scorer threshold', () => {
  const fallback = [{ id: 'function-words', text: 'where' }];
  expect(search.searchMemories(fallback, 'where when what')).toEqual([]);
  expect(new CapturePreviewIndex().handle({ v: 1, id: 1, changed: fallback, order: ['function-words'], query: 'where when what' })).toEqual([{ id: 'function-words', score: 1 / 3 }]);
  const rows = [{ id: 'suffix', text: 'microastronomical microastronomical' }];
  // A repeated substring is not evidence in the fallback either.
  expect(new CapturePreviewIndex().handle({ v: 1, id: 1, changed: rows, order: ['suffix'], query: 'astronomical observations' })).toEqual([]);
});
it.each(['after:2040-01-01 astronomical observation', 'before:invalid astronomical observation', 'entity:other astronomical observation', 'tag:other astronomical observation'])('does not bypass explicit operators in the fallback: %s', query => {
  expect(new CapturePreviewIndex().handle({ v: 1, id: 1, changed: [row('a')], order: ['a'], query })).toEqual([]);
});
it('clears the index after invalid protocol and cannot reuse retired plaintext', () => {
  const index = new CapturePreviewIndex(); index.handle({ v: 1, id: 1, changed: [row('a')], order: ['a'], query: '' });
  expect(() => index.handle({ v: 1, id: 2, changed: [row('b'), row('b')], query: '' })).toThrow('capture_preview_unavailable');
  expect(index.handle({ v: 1, id: 3, changed: [], query: 'astronomical observation' })).toEqual([]);
});
it('replays anonymous positions and preserves the relative order of authorized ties', () => {
  const index = new CapturePreviewIndex();
  index.handle({ v: 1, id: 1, changed: [row('b'), row('a')], order: [null, 'b', null, 'a'], query: '' });
  expect(index.handle({ v: 1, id: 2, changed: [], moves: [{ type: 'removed', index: 3 }, { type: 'added', index: 0, id: 'a' }], query: 'astronomical observation' }).map(hit => hit.id)).toEqual(['a', 'b']);
  expect(index.handle({ v: 1, id: 3, changed: [], removed: ['a'], moves: [{ type: 'removed', index: 0 }, { type: 'added', index: 0, id: null }], query: 'astronomical observation' }).map(hit => hit.id)).toEqual(['b']);
});
it.each([
  { moves: [{ type: 'removed', index: 10 }] }, { moves: [{ type: 'added', index: 2, id: null }] },
  { moves: [{ type: 'added', index: 0, id: 'a' }] }, { moves: [{ type: 'added', index: 0, id: 'missing' }] },
  { moves: [{ type: 'removed', index: .5 }] }, { moves: [{ type: 'removed', index: 0, id: 'a' }] },
  { order: ['a', 'a'] }, { order: [false] }, { order: [], moves: [] }, { removed: ['a'] },
])('retires the whole index when order/patch validation fails: %j', invalid => {
  const index = new CapturePreviewIndex(); index.handle({ v: 1, id: 1, changed: [row('a')], order: ['a'], query: '' });
  expect(() => index.handle({ v: 1, id: 2, changed: [], query: '', ...invalid } as unknown as Parameters<CapturePreviewIndex['handle']>[0])).toThrow('capture_preview_unavailable');
  expect(index.handle({ v: 1, id: 3, changed: [], query: 'astronomical observation' })).toEqual([]);
});
