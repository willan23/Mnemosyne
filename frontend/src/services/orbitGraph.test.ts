import { expect, it } from 'vitest';
import golden from '../test/fixtures/orbit-golden.json';
import { OrbitGraph } from './orbitGraph';
import { ORBIT_LAYOUT_LIMITS as limits, type OrbitRecord } from './orbitLayoutProtocol';
const record = (id: string, extra: Partial<OrbitRecord> = {}): OrbitRecord => ({ id, celestialType: 'planet', position: [0, 0, 0], connections: [], parentId: null, orbitRadius: null, orbitSpeed: null, importance: 0.5, updatedAt: 0, ...extra });
const project = (row: typeof golden.cases[number]['rows'][number]): OrbitRecord => record(row.id, { celestialType: row.celestialType as OrbitRecord['celestialType'], position: row.position as [number, number, number], connections: row.connections, parentId: 'parentId' in row ? row.parentId ?? null : null, orbitRadius: 'orbitRadius' in row ? row.orbitRadius ?? null : null, orbitSpeed: 'orbitSpeed' in row ? row.orbitSpeed ?? null : null, importance: row.importance, updatedAt: row.updatedAt });
it.each(golden.cases)('preserves the frozen legacy coordinates: $name', fixture => {
  const graph = new OrbitGraph(fixture.rows.map(project)); expect(graph.cyclesBroken).toBe(0);
  for (const sample of fixture.samples) expect(graph.sample(fixture.rows.map(row => row.id), sample.time, golden.now).positions.map(([id, ...position]) => [id, position])).toEqual(sample.positions);
});
it('cuts self and multi-node cycles once at the first published node and keeps downstream nodes finite', () => {
  const rows = [record('b', { parentId: 'a' }), record('a', { parentId: 'b' }), record('tail', { parentId: 'a' }), record('self', { parentId: 'self' })], graph = new OrbitGraph(rows);
  expect(graph.cyclesBroken).toBe(2); expect(graph.parentOf('b')).toBeNull(); expect(graph.parentOf('a')).toBe('b'); expect(graph.parentOf('tail')).toBe('a'); expect(graph.parentOf('self')).toBeNull();
  expect(graph.sample(rows.map(row => row.id), 12, golden.now).positions.every(([, ...point]) => point.every(Number.isFinite))).toBe(true);
  const reversed = new OrbitGraph([rows[1], rows[0], rows[2], rows[3]]); expect(reversed.parentOf('a')).toBeNull(); expect(reversed.parentOf('b')).toBe('a');
});
it('walks an entire 100000-node parent chain iteratively without a stack overflow', () => {
  const graph = new OrbitGraph(Array.from({ length: limits.documents }, (_, at) => record('n' + at, { parentId: at ? 'n' + (at - 1) : null })));
  const result = graph.sample(['n99999', 'n50000', 'n0'], 2, golden.now); expect(graph.size).toBe(100000); expect(graph.cyclesBroken).toBe(0); expect(result.positions.every(([, ...point]) => point.every(Number.isFinite))).toBe(true);
  expect(result.positions[1]).toEqual(graph.sample(['n50000'], 2, golden.now).positions[0]);
});
it('captures immutable metadata, accepts missing references and preserves request order', () => {
  const position: [number, number, number] = [1, 2, 3], links = ['missing'], source = [record('a', { position, connections: links, parentId: 'missing' }), record('b')], graph = new OrbitGraph(source), before = graph.sample(['b', 'a'], 8, golden.now);
  position[0] = 999; links.push('b'); source.reverse(); expect(graph.sample(['b', 'a'], 8, golden.now)).toEqual(before); expect(graph.parentOf('a')).toBeNull();
});
it('refuses unknown or duplicate IDs, oversized requests and non-finite outputs', () => {
  const graph = new OrbitGraph([record('a')]); expect(() => graph.sample(['missing'], 0, 0)).toThrow('orbit_layout_unavailable'); expect(() => graph.sample(['a', 'a'], 0, 0)).toThrow(); expect(() => graph.sample(Array(limits.sampleIds + 1).fill('a'), 0, 0)).toThrow(); expect(() => graph.sample(['a'], Infinity, 0)).toThrow();
  const extreme = new OrbitGraph([record('root'), record('child', { parentId: 'root', orbitSpeed: Number.MAX_VALUE })]); expect(() => extreme.sample(['child'], Number.MAX_VALUE, 0)).toThrow('orbit_layout_unavailable');
});
it('refuses content or malformed fields in the metadata protocol without reading their values', () => {
  let reads = 0; const contaminated = Object.defineProperty(record('a'), 'text', { enumerable: true, get() { reads++; throw Error('Read plaintext'); } }); expect(() => new OrbitGraph([contaminated])).toThrow('orbit_layout_unavailable'); expect(reads).toBe(0);
  expect(() => new OrbitGraph([record('a', { position: [0, NaN, 1] })])).toThrow(); expect(() => new OrbitGraph([record('a'), record('a')])).toThrow(); expect(() => new OrbitGraph([record('a', { connections: Array(limits.recordConnections + 1).fill('b') })])).toThrow();
});
