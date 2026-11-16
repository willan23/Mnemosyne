import { expect, it } from 'vitest';
import { OrbitLayoutIndex } from './orbitLayoutIndex';
import { OrbitGraph } from './orbitGraph';
import type { OrbitLayoutCommand, OrbitRecord } from './orbitLayoutProtocol';
const row = (id: string, extra: Partial<OrbitRecord> = {}): OrbitRecord => ({ id, celestialType: 'planet', position: [0, 0, 0], connections: [], parentId: null, orbitRadius: null, orbitSpeed: null, importance: 0.5, updatedAt: 0, ...extra });
function fixture() { const index = new OrbitLayoutIndex(); let seq = 0; const send = (command: OrbitLayoutCommand) => index.handle({ ...command, v: 1, seq: ++seq }); const load = (rows: OrbitRecord[]) => { send({ type: 'patch-start', reset: true, preserve: false, counts: { size: rows.length, changed: rows.length, removed: 0, moves: 0, order: rows.length } }); for (let at = 0; at < rows.length; at += 128) { const chunk = rows.slice(at, at + 128); send({ type: 'patch-chunk', frame: { order: chunk.map(row => row.id), changed: chunk } }); } send({ type: 'patch-end' }); }; return { index, send, load }; }
const sample = (ids: string[], time = 4): OrbitLayoutCommand => ({ type: 'sample', ids, time, now: 1234 });
it('streams a canonical baseline and uses one parent plan for repeated frame times', () => {
  const f = fixture(), rows = [row('second', { celestialType: 'sun' }), row('first', { celestialType: 'nebula' }), row('child', { connections: ['first', 'second'] })]; f.load(rows);
  const graph = new OrbitGraph(rows); for (const time of [0, 1, 4, 100]) expect(f.send(sample(['child'], time))).toEqual({ frame: graph.sample(['child'], time, 1234) });
});
it('rebuilds parent choices on an order-only delta without transferring unchanged metadata', () => {
  const f = fixture(), a = row('a', { celestialType: 'sun' }), b = row('b', { celestialType: 'sun' }), c = row('c', { connections: ['a', 'b'] }); f.load([a, b, c]); f.send(sample(['c']));
  f.send({ type: 'patch-start', reset: false, preserve: true, counts: { size: 3, changed: 0, removed: 0, moves: 2, order: 0 } }); f.send({ type: 'patch-chunk', frame: { moves: [{ type: 'removed', id: 'b', oldIndex: 1, newIndex: -1 }, { type: 'added', id: 'b', oldIndex: -1, newIndex: 0 }] } }); f.send({ type: 'patch-end' }); expect(f.send(sample(['c']))).toEqual({ frame: new OrbitGraph([b, a, c]).sample(['c'], 4, 1234) });
});
it('applies changed and removed metadata before sampling the new graph', () => {
  const f = fixture(), root = row('r', { celestialType: 'sun' }), child = row('c', { parentId: 'r' }); f.load([root, child]); f.send(sample(['c'])); const changed = { ...child, position: [3, 4, 5] as const };
  f.send({ type: 'patch-start', reset: false, preserve: true, counts: { size: 1, changed: 1, removed: 1, moves: 1, order: 0 } }); f.send({ type: 'patch-chunk', frame: { moves: [{ type: 'removed', id: 'r', oldIndex: 0, newIndex: -1 }] } }); f.send({ type: 'patch-chunk', frame: { removed: ['r'] } }); f.send({ type: 'patch-chunk', frame: { changed: [changed] } }); f.send({ type: 'patch-end' }); expect(f.send(sample(['c']))).toEqual({ frame: new OrbitGraph([changed]).sample(['c'], 4, 1234) });
});
it('keeps samples finite for cycles received through the actual protocol', () => { const f = fixture(), rows = [row('a', { parentId: 'b' }), row('b', { parentId: 'a' })]; f.load(rows); expect(f.send(sample(['a', 'b']))).toEqual({ frame: new OrbitGraph(rows).sample(['a', 'b'], 4, 1234) }); });
it('rejects partial transactions, wrong phase, frame overflow and count mismatches', () => {
  for (const invalid of ['partial', 'phase', 'overflow', 'counts'] as const) {
    const f = fixture(), size = invalid === 'overflow' ? 129 : 1; f.send({ type: 'patch-start', reset: true, preserve: false, counts: { size, changed: size, removed: 0, moves: 0, order: size } });
    expect(() => { if (invalid === 'partial') f.send(sample(['a'])); else if (invalid === 'phase') f.send({ type: 'patch-chunk', frame: { changed: [row('a')] } }); else if (invalid === 'overflow') f.send({ type: 'patch-chunk', frame: { order: Array.from({ length: 129 }, (_, at) => 'a' + at), changed: Array.from({ length: 129 }, (_, at) => row('a' + at)) } }); else f.send({ type: 'patch-end' }); }).toThrow('orbit_layout_unavailable');
    expect(() => f.send(sample(['a']))).toThrow(); f.load([row('fresh')]); expect(f.send(sample(['fresh']))).toHaveProperty('frame');
  }
});
it('requires each fresh metadata row to match its paired canonical ID', () => {
  const f = fixture(); f.send({ type: 'patch-start', reset: true, preserve: false, counts: { size: 1, changed: 1, removed: 0, moves: 0, order: 1 } }); expect(() => f.send({ type: 'patch-chunk', frame: { order: ['different'], changed: [row('a')] } })).toThrow('orbit_layout_unavailable'); expect(() => f.send(sample(['a']))).toThrow();
});
it('retires all metadata on a stale sequence or invalid sample and admits only a fresh baseline afterwards', () => {
  const f = fixture(); f.load([row('old')]); expect(() => f.index.handle({ ...sample(['old']), v: 1, seq: 1 })).toThrow('orbit_layout_unavailable'); expect(() => f.send(sample(['old']))).toThrow(); f.load([row('new')]); expect(() => f.send(sample(['old']))).toThrow(); expect(() => f.send(sample(['new']))).toThrow();
});
