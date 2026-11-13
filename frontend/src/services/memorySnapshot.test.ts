import { expect, it, vi } from 'vitest';
import { produce } from 'immer';
import { IncrementalMemoryPublication, type MemoryPublicationPatch } from './incrementalMemoryPublication';
import { isMemorySnapshot, memoryConnectionReferences, memorySnapshotDelta } from './memorySnapshot';

type Row = { id: string; timestamp: number; deleted?: boolean; text?: string; connections?: string[] };
const reset = (rows: Row[]): MemoryPublicationPatch<Row> => ({ changed: rows.map(value => ({ id: value.id, value })), removed: [], order: { reset: rows.map(row => row.id), changes: [] } });
const change = (value: Row): MemoryPublicationPatch<Row> => ({ changed: [{ id: value.id, value }], removed: [], order: { changes: [] } });

it('updates outgoing-reference totals from the changed row without rereading historical rows', () => {
  let reads = 0;
  const make = (index: number, count: number): Row => ({ id: 'm' + index, timestamp: index,
    get connections() { reads++; return Array.from({ length: count }, () => 'outside'); },
    get text() { throw Error('Read plaintext for a counter'); } });
  const publisher = new IncrementalMemoryPublication<Row>('asc');
  publisher.apply('source', reset(Array.from({ length: 10000 }, (_, index) => make(index, 2))));
  const old = publisher.snapshot(); reads = 0;
  for (let render = 0; render < 1000; render++) expect(memoryConnectionReferences(old)).toBe(20000);
  expect(reads).toBe(0);
  publisher.apply('source', change(make(5000, 5)));
  expect(reads).toBe(2); // New DTO enters the order and ID trees. Path copies use cached weights.
  reads = 0;
  expect(memoryConnectionReferences(publisher.snapshot())).toBe(20003);
  expect(memoryConnectionReferences(old)).toBe(20000);
  expect(reads).toBe(0);
  publisher.clear();
  expect(() => memoryConnectionReferences(old)).toThrow('memory_snapshot_unavailable');
  expect(memoryConnectionReferences(publisher.snapshot())).toBe(0);
});

it('keeps view totals and source precedence through overlays, suppression and removal', () => {
  const publisher = new IncrementalMemoryPublication<Row>('asc', { views: { active: value => !value.deleted } });
  publisher.apply('base', reset([{ id: 'a', timestamp: 1, connections: ['b'] },
    { id: 'b', timestamp: 2, connections: ['a', 'outside'] },
    { id: 'c', timestamp: 3, deleted: true, connections: ['a', 'a', 'outside'] }]), 0);
  const original = publisher.snapshot(), active = original.view('active');
  expect(memoryConnectionReferences(original)).toBe(6); expect(memoryConnectionReferences(active)).toBe(3);
  publisher.apply('overlay', reset([{ id: 'a', timestamp: 1, connections: ['b', 'c', 'outside'] }]), 10);
  expect(memoryConnectionReferences(publisher.snapshot())).toBe(8);
  expect(memoryConnectionReferences(publisher.snapshot().view('active'))).toBe(5);
  publisher.removeSource('overlay');
  publisher.exclude('base', 'b', true);
  expect(memoryConnectionReferences(publisher.snapshot())).toBe(4);
  expect(memoryConnectionReferences(publisher.snapshot().view('active'))).toBe(1);
  publisher.apply('base', change({ id: 'c', timestamp: 0, connections: ['a', 'a', 'a', 'a', 'outside'] }));
  expect(memoryConnectionReferences(publisher.snapshot().view('active'))).toBe(6);
  expect(memoryConnectionReferences(original)).toBe(6); expect(memoryConnectionReferences(active)).toBe(3);
  publisher.exclude('base', 'b', false);
  publisher.apply('base', { changed: [], removed: ['a'], order: { changes: [{ type: 'removed', id: 'a', oldIndex: 0, newIndex: -1 }] } });
  expect(memoryConnectionReferences(publisher.snapshot())).toBe(7);
});

it('matches a materialized oracle across edits, reorders and view transitions', () => {
  const publisher = new IncrementalMemoryPublication<Row>('desc', { views: { active: value => !value.deleted, deleted: value => Boolean(value.deleted) } });
  const rows = Array.from({ length: 80 }, (_, index): Row => ({ id: 'm' + index, timestamp: index % 9, connections: [] }));
  publisher.apply('source', reset(rows)); let seed = 73421;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
  for (let step = 0; step < 250; step++) {
    const old = publisher.snapshot(), oldTotal = rows.reduce((sum, row) => sum + (row.connections?.length ?? 0), 0);
    const index = random() % rows.length;
    rows[index] = { ...rows[index], timestamp: random() % 9, deleted: Boolean(random() % 2), connections: Array.from({ length: random() % 11 }, () => 'outside') };
    publisher.apply('source', change(rows[index]));
    const next = publisher.snapshot();
    expect(memoryConnectionReferences(old)).toBe(oldTotal);
    for (const name of ['active', 'deleted'] as const) expect(memoryConnectionReferences(next.view(name)))
      .toBe(rows.filter(row => name === 'active' ? !row.deleted : row.deleted).reduce((sum, row) => sum + (row.connections?.length ?? 0), 0));
    expect(memoryConnectionReferences(next)).toBe(rows.reduce((sum, row) => sum + (row.connections?.length ?? 0), 0));
  }
  expect(memoryConnectionReferences([{ id: 'a', connections: ['missing', 'missing'] }, { id: 'b' }])).toBe(2);
});

it('publishes 10000 references without materialization and preserves prior values after a delta', async () => {
  let reads = 0;
  const row = (id: string, timestamp: number): Row => ({ id, get timestamp() { reads++; return timestamp; }, get text() { throw Error('Read memory content'); } });
  const publisher = new IncrementalMemoryPublication<Row>('asc'), rows = Array.from({ length: 10000 }, (_, index) => row('m' + index, index));
  publisher.apply('source', reset(rows)); reads = 0; const deliver = vi.fn();
  await publisher.publishSnapshot(() => true, deliver); const old = publisher.snapshot(); expect(deliver).toHaveBeenCalledWith(old); expect(reads).toBe(0); expect(old.length).toBe(10000); expect(old[5000]).toBe(rows[5000]);
  const updated = row('m5000', 5000); publisher.apply('source', change(updated)); expect(reads).toBeLessThan(512); const afterApply = reads;
  await publisher.publishSnapshot(() => true, deliver); const next = publisher.snapshot(); expect(reads).toBe(afterApply); expect(next[5000]).toBe(updated); expect(old[5000]).toBe(rows[5000]); expect(old.get('m5000')).toBe(rows[5000]);
  expect(next.get('m0')).toBe(old.get('m0')); expect(memorySnapshotDelta(old, next)).toEqual({ changed: [updated], removed: [], order: [{ type: 'removed', id: 'm5000', oldIndex: 5000, newIndex: -1 }, { type: 'added', id: 'm5000', oldIndex: -1, newIndex: 5000 }] });
});

it('keeps derived counts, windows and moves without filtering the whole collection', () => {
  const publisher = new IncrementalMemoryPublication<Row>('asc', { views: { active: row => !row.deleted } });
  publisher.apply('source', reset([{ id: 'a', timestamp: 1 }, { id: 'b', timestamp: 2, deleted: true }, { id: 'c', timestamp: 3 }]));
  const before = publisher.snapshot().view('active'); expect(before.length).toBe(2); expect(before.map(row => row.id)).toEqual(['a', 'c']); expect(before.get('b')).toBeUndefined();
  publisher.apply('source', change({ id: 'b', timestamp: 2 })); const next = publisher.snapshot().view('active');
  expect(next.slice(1, 2).map(row => row.id)).toEqual(['b']); expect(before.slice(1).map(row => row.id)).toEqual(['c']); expect(next.view('active')).toBe(next);
  expect(memorySnapshotDelta(before, next)).toEqual({ changed: [{ id: 'b', timestamp: 2 }], removed: [], order: [{ type: 'added', id: 'b', oldIndex: -1, newIndex: 1 }] });
});

it('provides read-only indexed access and serialization without claiming to be a native Array', () => {
  const publisher = new IncrementalMemoryPublication<Row>('asc'); const rows = [{ id: 'a', timestamp: 1 }, { id: 'b', timestamp: 2 }]; publisher.apply('source', reset(rows)); const view = publisher.snapshot();
  expect(Array.isArray(view)).toBe(false); expect(isMemorySnapshot(view)).toBe(true); expect(Object.isFrozen(view)).toBe(true);
  expect(view.at(-1)).toBe(rows[1]); expect(view.at(NaN)).toBe(rows[0]); expect(view.at(-.5)).toBe(rows[0]); expect(view[2]).toBeUndefined(); expect(0 in view).toBe(true); expect(2 in view).toBe(false);
  expect(view.filter(row => row.id === 'b')).toEqual([rows[1]]); expect(view.reduce((sum, row) => sum + row.timestamp, 0)).toBe(3); expect(view.flatMap(row => [row.id])).toEqual(['a', 'b']);
  expect([...view.keys()]).toEqual([0, 1]); expect([...view.entries()]).toEqual([[0, rows[0]], [1, rows[1]]]); expect(JSON.parse(JSON.stringify(view))).toEqual(rows);
  expect(() => Reflect.set(view, '0', rows[1])).toThrow('memory_snapshot_unavailable'); expect(() => Reflect.deleteProperty(view, '0')).toThrow(); expect(() => (view as unknown as Row[]).push(rows[0])).toThrow();
});

it('remains an atomic undrafted value when assigned through Immer', () => {
  let reads = 0; const row: Row = { id: 'a', timestamp: 1, get text() { reads++; return 'Synthetic'; } };
  const publisher = new IncrementalMemoryPublication<Row>('asc'); publisher.apply('source', reset([row])); const view = publisher.snapshot(); reads = 0;
  const state = produce({ memories: [] as readonly Row[], selected: null as string | null }, draft => { draft.memories = view as unknown as Row[]; });
  expect(state.memories).toBe(view); expect(reads).toBe(0); expect(state.memories[0]).toBe(row);
});

it('retires every old view and iterator on scope clear while permitting a new scope', () => {
  const publisher = new IncrementalMemoryPublication<Row>('asc'); publisher.apply('source', reset([{ id: 'a', timestamp: 1 }, { id: 'b', timestamp: 2 }]));
  const view = publisher.snapshot(), iterator = view.values(); expect(iterator.next().value?.id).toBe('a'); publisher.clear();
  expect(() => view.length).toThrow(); expect(() => view.get('a')).toThrow(); expect(() => iterator.next()).toThrow(); expect(() => JSON.stringify(view)).toThrow();
  expect(publisher.snapshot().length).toBe(0); publisher.apply('source', reset([{ id: 'other', timestamp: 1 }])); expect(publisher.snapshot()[0].id).toBe('other'); expect(() => view[0]).toThrow();
});

it('bounds history and requests a fresh transfer after an expired delta range', () => {
  const publisher = new IncrementalMemoryPublication<Row>('asc'); publisher.apply('source', reset([{ id: 'a', timestamp: 1 }])); const old = publisher.snapshot(); let recent = old;
  for (let i = 0; i < 70; i++) { recent = publisher.snapshot(); publisher.apply('source', change({ id: 'a', timestamp: i + 2 })); }
  expect(memorySnapshotDelta(old, publisher.snapshot())).toBeUndefined(); expect(memorySnapshotDelta(recent, publisher.snapshot())?.changed).toHaveLength(1); expect(old[0].timestamp).toBe(1);
});
