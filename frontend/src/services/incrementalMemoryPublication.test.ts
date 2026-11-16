import { expect, it, vi } from 'vitest';
import { IncrementalMemoryPublication, type MemoryPublicationDelta, type MemoryPublicationPatch } from './incrementalMemoryPublication';
import { memorySnapshotDelta } from './memorySnapshot';

type Value = { id: string; timestamp: number; text: string };
const value = (id: string, timestamp = 1, text = id): Value => ({ id, timestamp, text });
const reset = (rows: Value[]): MemoryPublicationPatch<Value> => ({
  changed: rows.map(row => ({ id: row.id, value: row })), removed: [], order: { reset: rows.map(row => row.id), changes: [] },
});
const empty = (): MemoryPublicationPatch<Value> => ({ changed: [], removed: [], order: { changes: [] } });
const modified = (row: Value, oldIndex: number, newIndex: number): MemoryPublicationPatch<Value> => ({
  changed: [{ id: row.id, value: row }], removed: [], order: { changes: [{ id: row.id, type: 'modified', oldIndex, newIndex }] },
});
async function published(publisher: IncrementalMemoryPublication<Value>): Promise<Value[]> {
  let result: Value[] | undefined;
  expect(await publisher.publish(() => true, rows => { result = rows; })).toBe(true);
  expect(result).toBeDefined(); return result!;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(finish => { resolve = finish; });
  return { promise, resolve };
}

/** Deliberately uses complete arrays, Map merge and stable sort instead of trees. */
class FullMergeReference {
  sources = new Map<string, { priority: number; ordinal: number; ids: string[]; values: Map<string, Value | null> }>();
  excluded = new Map<string, Set<string>>();
  ordinal = 0;
  constructor(private direction: 'asc' | 'desc', private base = 0) {}
  apply(key: string, patch: MemoryPublicationPatch<Value>, priority?: number) {
    let source = this.sources.get(key);
    if (!source) {
      const ordinal = this.ordinal++;
      source = { priority: priority ?? this.base + ordinal, ordinal, ids: [], values: new Map() }; this.sources.set(key, source);
    }
    if (patch.order.reset) source.ids = [...patch.order.reset];
    for (const move of patch.order.changes) {
      if (move.type !== 'added') expect(source.ids.splice(move.oldIndex, 1)).toEqual([move.id]);
      if (move.type !== 'removed') source.ids.splice(move.newIndex, 0, move.id);
    }
    const present = new Set(source.ids);
    for (const id of source.values.keys()) if (!present.has(id)) source.values.delete(id);
    for (const row of patch.changed) source.values.set(row.id, row.value);
  }
  exclude(key: string, id: string, excluded: boolean) {
    let ids = this.excluded.get(key);
    if (!ids) { ids = new Set(); this.excluded.set(key, ids); }
    if (excluded) ids.add(id); else ids.delete(id);
  }
  removeSource(key: string) { this.sources.delete(key); }
  clear() { this.sources.clear(); this.excluded.clear(); this.ordinal = 0; }
  rows() {
    const merged = new Map<string, Value>();
    const sources = [...this.sources].sort(([, a], [, b]) => a.priority - b.priority || a.ordinal - b.ordinal);
    for (const [key, source] of sources) for (const id of source.ids) {
      const row = source.values.get(id); if (row && !this.excluded.get(key)?.has(id)) merged.set(id, row);
    }
    return [...merged.values()].sort((a, b) => this.direction === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
  }
}
function assertDelta(delta: MemoryPublicationDelta<Value>, before: Value[], after: Value[]) {
  const old = new Map(before.map(row => [row.id, row])), next = new Map(after.map(row => [row.id, row]));
  const changed = after.filter(row => old.get(row.id) !== row), removed = before.filter(row => !next.has(row.id)).map(row => row.id);
  expect(delta.changed.map(row => row.id).sort()).toEqual(changed.map(row => row.id).sort());
  expect([...delta.removed].sort()).toEqual(removed.sort());
  for (const row of delta.changed) expect(row).toBe(next.get(row.id));
}

it.each(['asc', 'desc'] as const)('matches full Map merge and stable sort through randomized %s source deltas', async direction => {
  const publisher = new IncrementalMemoryPublication<Value>(direction, { sourceBase: 7 }), reference = new FullMergeReference(direction, 7);
  let seed = 0x4d4e454d;
  const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  const allIds = Array.from({ length: 24 }, (_, index) => 'id-' + index), keys = ['personal', 'team-a', 'team-b', 'legacy'];
  for (let step = 0; step < 500; step++) {
    const key = keys[random(keys.length)], source = reference.sources.get(key), before = reference.rows(), previousSnapshot = publisher.snapshot();
    let delta: MemoryPublicationDelta<Value>;
    const operation = random(10);
    if (operation === 8) {
      const id = allIds[random(allIds.length)], excluded = Boolean(random(2));
      delta = publisher.exclude(key, id, excluded); reference.exclude(key, id, excluded);
    } else if (operation === 9) {
      delta = publisher.removeSource(key); reference.removeSource(key);
    } else {
      let patch: MemoryPublicationPatch<Value>;
      if (!source || operation === 0) {
        const ids = allIds.filter(() => random(4) === 0);
        for (let at = ids.length - 1; at > 0; at--) { const other = random(at + 1); [ids[at], ids[other]] = [ids[other], ids[at]]; }
        patch = { changed: ids.map(id => ({ id, value: random(5) === 0 ? null : value(id, random(5), key + '-' + step) })), removed: [], order: { reset: ids, changes: [] } };
      } else if (operation === 1 || !source.ids.length) {
        const absent = allIds.filter(id => !source.ids.includes(id));
        if (!absent.length) patch = empty();
        else {
          const id = absent[random(absent.length)];
          patch = { changed: [{ id, value: value(id, random(5), key + '-' + step) }], removed: [], order: { changes: [{ id, type: 'added', oldIndex: -1, newIndex: random(source.ids.length + 1) }] } };
        }
      } else {
        const oldIndex = random(source.ids.length), id = source.ids[oldIndex];
        if (operation === 2) patch = { changed: [], removed: [id], order: { changes: [{ id, type: 'removed', oldIndex, newIndex: -1 }] } };
        else if (operation === 3) patch = { changed: [], removed: [], order: { changes: [{ id, type: 'modified', oldIndex, newIndex: random(source.ids.length) }] } };
        else if (operation === 4) patch = { changed: [{ id, value: null }], removed: [], order: { changes: [] } };
        else if (operation === 5) patch = empty();
        else patch = modified(value(id, random(5), key + '-' + step), oldIndex, random(source.ids.length));
      }
      delta = publisher.apply(key, patch); reference.apply(key, patch);
    }
    const expected = reference.rows(), actual = await published(publisher);
    expect(actual, 'step ' + step).toEqual(expected); expect(publisher.count).toBe(expected.length);
    actual.forEach((row, index) => expect(row).toBe(expected[index])); assertDelta(delta, before, expected);
    const snapshot = publisher.snapshot(), snapshotDelta = memorySnapshotDelta(previousSnapshot, snapshot)!;
    expect([...snapshot]).toEqual(expected); const order = before.map(value => value.id);
    for (const move of snapshotDelta.order) { if (move.type === 'removed') expect(order.splice(move.oldIndex, 1)).toEqual([move.id]); else order.splice(move.newIndex, 0, move.id); }
    expect(order).toEqual(expected.map(value => value.id)); expect([...previousSnapshot]).toEqual(before);
    for (const value of expected) expect(snapshot.get(value.id)).toBe(value);
    for (const sourceKey of keys) {
      const source = reference.sources.get(sourceKey);
      const expectedSource = (source?.ids ?? []).filter(id => source?.values.get(id) && !reference.excluded.get(sourceKey)?.has(id)).map(id => source!.values.get(id));
      expect([...publisher.orderedSourceValues(sourceKey)], 'source order at ' + step).toEqual(expectedSource);
    }
  }
});

it('uses the last prioritized source value but preserves the first visible source insertion order for ties', async () => {
  const publisher = new IncrementalMemoryPublication<Value>('desc'), original = value('a', 1, 'first'), winner = value('a', 1, 'winner');
  publisher.apply('first', reset([original, value('b')]), 10);
  publisher.apply('last', reset([value('c'), winner]), 20);
  publisher.apply('middle', reset([value('d'), value('a', 1, 'middle')]), 10);
  const rows = await published(publisher); expect(rows.map(row => row.id)).toEqual(['a', 'b', 'd', 'c']); expect(rows[0]).toBe(winner);
  const reordered = publisher.apply('first', { changed: [], removed: [], order: { changes: [{ id: 'a', type: 'modified', oldIndex: 0, newIndex: 1 }] } });
  expect(reordered).toEqual({ changed: [], removed: [] }); expect((await published(publisher)).map(row => row.id)).toEqual(['b', 'a', 'd', 'c']);
});

it('treats null and excluded variants as absent while another visible source may win', async () => {
  const publisher = new IncrementalMemoryPublication<Value>('asc'), visible = value('a');
  publisher.apply('first', { changed: [{ id: 'a', value: null }, { id: 'b', value: value('b') }], removed: [], order: { reset: ['a', 'b'], changes: [] } });
  publisher.apply('second', reset([value('c'), visible]));
  publisher.apply('third', { changed: [{ id: 'a', value: null }], removed: [], order: { reset: ['a'], changes: [] } });
  expect((await published(publisher)).map(row => row.id)).toEqual(['b', 'c', 'a']);
  expect(publisher.exclude('second', 'a', true)).toEqual({ changed: [], removed: ['a'] });
  expect((await published(publisher)).map(row => row.id)).toEqual(['b', 'c']);
  expect(publisher.exclude('second', 'a', false).changed).toEqual([visible]);
});

it('preserves legacy suppression through source removal and retry until explicit restoration or scope clear', async () => {
  const publisher = new IncrementalMemoryPublication<Value>('desc'), a = value('a'), b = value('b');
  publisher.apply('legacy', reset([a, b])); publisher.exclude('legacy', 'a', true);
  publisher.removeSource('legacy'); publisher.apply('legacy', reset([a, b]));
  expect((await published(publisher)).map(row => row.id)).toEqual(['b']);
  publisher.exclude('legacy', 'a', false); expect((await published(publisher)).map(row => row.id)).toEqual(['a', 'b']);
  publisher.exclude('legacy', 'a', true); publisher.clear(); publisher.apply('legacy', reset([a, b]));
  expect((await published(publisher)).map(row => row.id)).toEqual(['a', 'b']);
});

it('recreates a source with a new insertion ordinal and restores shadow values when a winner disappears', async () => {
  const publisher = new IncrementalMemoryPublication<Value>('asc'), a = value('a', 1, 'first'), shadow = value('a', 1, 'second');
  publisher.apply('first', reset([a, value('b')]), 5); publisher.apply('second', reset([value('c'), shadow]), 5);
  expect((await published(publisher)).map(row => row.id)).toEqual(['a', 'b', 'c']);
  expect(publisher.removeSource('second')).toEqual({ changed: [a], removed: ['c'] });
  publisher.apply('third', reset([value('d')]), 5); publisher.removeSource('first'); publisher.apply('first', reset([a, value('b')]), 5);
  expect((await published(publisher)).map(row => row.id)).toEqual(['d', 'a', 'b']);
});

it('applies an initial reset plus accumulated removal and insertion movements from an uncommitted snapshot', async () => {
  const publisher = new IncrementalMemoryPublication<Value>('desc'), b = value('b'), c = value('c');
  publisher.apply('listener', { changed: [{ id: 'b', value: b }, { id: 'c', value: c }], removed: ['a'], order: {
    reset: ['a', 'b'], changes: [{ id: 'a', type: 'removed', oldIndex: 0, newIndex: -1 }, { id: 'c', type: 'added', oldIndex: -1, newIndex: 1 }],
  } });
  expect(await published(publisher)).toEqual([b, c]);
});

it('reuses cached arrays on empty patches, absent-source removals and unchanged exclusions', async () => {
  const publisher = new IncrementalMemoryPublication<Value>('desc'); publisher.apply('source', reset([value('a'), value('b')]));
  const first = await published(publisher);
  expect(publisher.apply('source', empty())).toEqual({ changed: [], removed: [] });
  expect(publisher.removeSource('missing')).toEqual({ changed: [], removed: [] });
  expect(publisher.exclude('source', 'a', false)).toEqual({ changed: [], removed: [] });
  expect(await published(publisher)).toBe(first);
});

it('publishes up to 256 values synchronously and yields for the 257th before first delivery', async () => {
  const gate = deferred(), yieldTask = vi.fn(() => gate.promise), deliver = vi.fn();
  const small = new IncrementalMemoryPublication<Value>('asc', { yieldTask }); small.apply('source', reset(Array.from({ length: 256 }, (_, index) => value('n' + index, index))));
  const first = small.publish(() => true, deliver); expect(deliver).toHaveBeenCalledOnce(); expect(yieldTask).not.toHaveBeenCalled(); expect(await first).toBe(true);
  const large = new IncrementalMemoryPublication<Value>('asc', { yieldTask }); large.apply('source', reset(Array.from({ length: 257 }, (_, index) => value('n' + index, index))));
  deliver.mockClear(); const pending = large.publish(() => true, deliver);
  expect(yieldTask).toHaveBeenCalledOnce(); expect(deliver).not.toHaveBeenCalled(); gate.resolve(); expect(await pending).toBe(true); expect(deliver).toHaveBeenCalledOnce();
  const previous = deliver.mock.calls[0][0]; deliver.mockClear();
  const cached = large.publish(() => true, deliver); expect(deliver).toHaveBeenCalledWith(previous); expect(await cached).toBe(true); expect(yieldTask).toHaveBeenCalledOnce();
});

it('materializes large views in the configured bounded task batches', async () => {
  const yieldTask = vi.fn(async () => undefined), publisher = new IncrementalMemoryPublication<Value>('asc', { batchSize: 2, yieldTask });
  publisher.apply('source', reset(Array.from({ length: 7 }, (_, index) => value('n' + index, index))));
  expect((await published(publisher)).map(row => row.timestamp)).toEqual([0, 1, 2, 3, 4, 5, 6]); expect(yieldTask).toHaveBeenCalledTimes(3);
});

it('a one-document delta reads a sublinear number of timestamps while publication still batches the full array', async () => {
  let reads = 0;
  const tracked = (id: string, timestamp: number): Value => ({ id, get timestamp() { reads++; return timestamp; }, text: id });
  const count = 4096, yieldTask = vi.fn(async () => undefined);
  const publisher = new IncrementalMemoryPublication<Value>('asc', { batchSize: 128, yieldTask });
  const rows = Array.from({ length: count }, (_, index) => tracked('n' + index, index));
  publisher.apply('source', reset(rows)); await published(publisher); reads = 0; yieldTask.mockClear();
  const edited = tracked('n2048', 2048), delta = publisher.apply('source', modified(edited, 2048, 2048));
  expect(delta.changed).toEqual([edited]); expect(reads).toBeGreaterThan(0);
  // Deliberately loose: tests incremental work, without prescribing treap rotations.
  expect(reads).toBeLessThan(count / 8);
  const afterApply = reads, result = await published(publisher);
  expect(result).toHaveLength(count); expect(result[2048]).toBe(edited); expect(reads).toBe(afterApply);
  expect(yieldTask).toHaveBeenCalledTimes(Math.floor((count - 1) / 128));
});

it.each(['apply', 'removeSource', 'exclude', 'clear', 'guard'] as const)('never delivers a retired materialization after %s during a task yield', async action => {
  const gate = deferred(), yieldTask = vi.fn<() => Promise<void>>().mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);
  const publisher = new IncrementalMemoryPublication<Value>('asc', { batchSize: 2, yieldTask }), deliver = vi.fn();
  publisher.apply('source', reset(Array.from({ length: 5 }, (_, index) => value('n' + index, index))));
  let current = true; const pending = publisher.publish(() => current, deliver); expect(yieldTask).toHaveBeenCalledOnce();
  if (action === 'apply') publisher.apply('source', modified(value('n0', 10), 0, 4));
  if (action === 'removeSource') publisher.removeSource('source');
  if (action === 'exclude') publisher.exclude('source', 'n0', true);
  if (action === 'clear') publisher.clear();
  if (action === 'guard') current = false;
  gate.resolve(); expect(await pending).toBe(false); expect(deliver).not.toHaveBeenCalled();
  current = true; expect(await publisher.publish(() => current, deliver)).toBe(true); expect(deliver).toHaveBeenCalledOnce();
});

it('checks an already retired guard before reading or delivering a cached array', async () => {
  const publisher = new IncrementalMemoryPublication<Value>('asc'), deliver = vi.fn(); publisher.apply('source', reset([value('a')]));
  await published(publisher); expect(await publisher.publish(() => false, deliver)).toBe(false); expect(deliver).not.toHaveBeenCalled();
});

const invalidPatches: Array<[string, unknown]> = [
  ['mismatched document ID', { changed: [{ id: 'a', value: value('other') }], removed: [], order: { changes: [] } }],
  ['nonfinite timestamp', modified(value('a', Infinity), 0, 0)],
  ['invalid timestamp type', { changed: [{ id: 'a', value: { id: 'a', timestamp: '1' } }], removed: [], order: { changes: [] } }],
  ['false value', { changed: [{ id: 'a', value: false }], removed: [], order: { changes: [] } }],
  ['undefined value', { changed: [{ id: 'a' }], removed: [], order: { changes: [] } }],
  ['empty ID', { changed: [{ id: '', value: value('') }], removed: [], order: { reset: [''], changes: [] } }],
  ['duplicate changed ID', { changed: [{ id: 'a', value: value('a') }, { id: 'a', value: value('a') }], removed: [], order: { changes: [] } }],
  ['duplicate reset ID', { changed: [{ id: 'a', value: value('a') }], removed: [], order: { reset: ['a', 'a'], changes: [] } }],
  ['unknown source-order value', { changed: [], removed: [], order: { reset: ['missing'], changes: [] } }],
  ['changed ID outside order', { changed: [{ id: 'missing', value: value('missing') }], removed: [], order: { changes: [] } }],
  ['removed ID still ordered', { changed: [], removed: ['a'], order: { changes: [] } }],
  ['wrong added sentinel', { changed: [{ id: 'b', value: value('b') }], removed: [], order: { changes: [{ id: 'b', type: 'added', oldIndex: 0, newIndex: 1 }] } }],
  ['wrong removed sentinel', { changed: [], removed: ['a'], order: { changes: [{ id: 'a', type: 'removed', oldIndex: 0, newIndex: 0 }] } }],
  ['fractional index', { changed: [], removed: [], order: { changes: [{ id: 'a', type: 'modified', oldIndex: .5, newIndex: 0 }] } }],
  ['unknown movement kind', { changed: [], removed: [], order: { changes: [{ id: 'a', type: 'unknown', oldIndex: 0, newIndex: 0 }] } }],
  ['missing movement index', { changed: [], removed: [], order: { changes: [{ id: 'a', type: 'modified', oldIndex: 0 }] } }],
  ['null patch', null], ['invalid changed array', { changed: {}, removed: [], order: { changes: [] } }],
];
it.each(invalidPatches)('fails closed and clears its scope on an invalid patch: %s', async (_name, patch) => {
  const publisher = new IncrementalMemoryPublication<Value>('desc'); publisher.apply('source', reset([value('a')]));
  expect(() => publisher.apply('source', patch as MemoryPublicationPatch<Value>)).toThrow('memory_publication_unavailable');
  expect(publisher.count).toBe(0); expect(await published(publisher)).toEqual([]);
  publisher.apply('fresh', reset([value('recovered')])); expect((await published(publisher)).map(row => row.id)).toEqual(['recovered']);
});

it('fails closed if an existing source priority changes or a source key is empty', async () => {
  const publisher = new IncrementalMemoryPublication<Value>('desc'); publisher.apply('source', reset([value('a')]), 2);
  expect(() => publisher.apply('source', empty(), 3)).toThrow('memory_publication_unavailable'); expect(publisher.count).toBe(0);
  expect(() => publisher.apply('', empty())).toThrow('memory_publication_unavailable'); expect(await published(publisher)).toEqual([]);
});

it('captures canonical raw source versions without following later value or order mutations', () => {
  const publisher = new IncrementalMemoryPublication<Value>('asc', { captureSources: true });
  const a = value('a'), b = value('b'); publisher.apply('source', reset([a, b]), 7);
  publisher.apply('source', { changed: [{ id: 'c', value: null }], removed: [], order: { changes: [{ id: 'c', type: 'added', oldIndex: -1, newIndex: 2 }] } });
  const first = publisher.captureSource('source')!;
  publisher.apply('source', modified(value('b', 2, 'revised'), 1, 0));
  const second = publisher.captureSource('source')!;
  expect(first.count).toBe(3); expect(first.priority).toBe(7); expect(first.ordinal).toBe(0);
  expect([...first.orderedRows()]).toEqual([{ id: 'a', value: a }, { id: 'b', value: b }, { id: 'c', value: null }]);
  expect([...second.orderedRows()].map(row => row.id)).toEqual(['b', 'a', 'c']); expect(second.get('b')?.text).toBe('revised'); expect(first.get('b')).toBe(b);
  publisher.removeSource('source'); expect([...first.orderedRows()]).toHaveLength(3); expect(publisher.captureSource('source')).toBeUndefined(); publisher.clear();
});

it('preserves source ordinal gaps and retains only the canonical IDs after a reset', () => {
  const publisher = new IncrementalMemoryPublication<Value>('asc', { sourceBase: 2, captureSources: true });
  publisher.apply('removed', reset([value('x')])); publisher.removeSource('removed'); publisher.apply('current', reset([value('a'), value('b')]));
  const before = publisher.captureSource('current')!; publisher.apply('current', reset([value('fresh')]));
  const after = publisher.captureSource('current')!; expect(after.ordinal).toBe(1); expect(after.priority).toBe(3); expect(after.count).toBe(1); expect(after.get('a')).toBeUndefined();
  expect([...after.orderedRows()].map(row => row.id)).toEqual(['fresh']); expect([...before.orderedRows()].map(row => row.id)).toEqual(['a', 'b']); publisher.clear();
});

it('retires held raw source lookups and iterators with the publication scope', () => {
  const publisher = new IncrementalMemoryPublication<Value>('asc', { captureSources: true }); publisher.apply('source', reset([value('a'), value('b')]));
  const captured = publisher.captureSource('source')!, iterator = captured.orderedRows(); expect(iterator.next().value?.id).toBe('a'); publisher.clear();
  expect(captured.active()).toBe(false); expect(() => captured.get('b')).toThrow('memory_publication_unavailable'); expect(() => iterator.next()).toThrow('memory_publication_unavailable');
  publisher.apply('fresh', reset([value('fresh')])); expect(captured.active()).toBe(false); expect(publisher.captureSource('fresh')?.get('fresh')?.id).toBe('fresh'); publisher.clear();
});

it('publishes a prepared source atomically and rebases other sources, exclusions and local overrides', async () => {
  const gate = deferred(), pause = vi.fn(() => gate.promise), publisher = new IncrementalMemoryPublication<Value>('asc', { captureSources: true, yieldTask: pause }), reference = new FullMergeReference('asc');
  const legacy = reset([value('legacy'), value('shared')]); publisher.apply('legacy', legacy, 0); reference.apply('legacy', legacy, 0);
  const old = publisher.snapshot(), rows = Array.from({ length: 300 }, (_, at) => value('n' + at)), patch = reset(rows), beforeCommit = vi.fn(() => true), afterCommit = vi.fn();
  const pending = publisher.applyControlled('personal', patch, { isCurrent: () => true, priority: 1, beforeCommit, afterCommit });
  await vi.waitFor(() => expect(pause).toHaveBeenCalled()); expect([...publisher.snapshot()]).toEqual(reference.rows()); expect(publisher.captureSource('personal')).toBeUndefined(); expect(beforeCommit).not.toHaveBeenCalled();
  const other = reset([value('other')]), local = reset([value('n6', 1, 'local winner')]);
  publisher.apply('team', other, 2); publisher.apply('local', local, 100); publisher.exclude('personal', 'n5', true); publisher.exclude('legacy', 'shared', true);
  const liveBefore = [...publisher.snapshot()], previous = publisher.snapshot(); gate.resolve(); const delta = await pending;
  reference.apply('personal', patch, 1); reference.apply('team', other, 2); reference.apply('local', local, 100); reference.exclude('personal', 'n5', true); reference.exclude('legacy', 'shared', true);
  expect([...publisher.snapshot()]).toEqual(reference.rows()); assertDelta(delta, liveBefore, reference.rows()); expect([...old].map(row => row.id)).toEqual(['legacy', 'shared']);
  expect(memorySnapshotDelta(previous, publisher.snapshot())).toBeUndefined(); expect(beforeCommit).toHaveBeenCalledOnce(); expect(afterCommit).toHaveBeenCalledOnce(); publisher.clear();
});

it('cancels held preparation on scope retirement without waiting for the underlying scheduler', async () => {
  const gate = deferred(), pause = vi.fn(() => gate.promise), publisher = new IncrementalMemoryPublication<Value>('asc', { captureSources: true, yieldTask: pause });
  publisher.apply('old', reset([value('old')])); const raw = publisher.captureSource('old')!, previous = publisher.snapshot();
  const pending = publisher.applyControlled('new', reset(Array.from({ length: 300 }, (_, at) => value('n' + at))), { isCurrent: () => true }), rejected = expect(pending).rejects.toThrow('memory_publication_unavailable');
  await vi.waitFor(() => expect(pause).toHaveBeenCalled()); publisher.clear(); await rejected;
  expect(raw.active()).toBe(false); expect(() => previous.get('old')).toThrow(); publisher.apply('fresh', reset([value('fresh')])); gate.resolve(); await Promise.resolve();
  expect([...publisher.snapshot()].map(row => row.id)).toEqual(['fresh']); publisher.clear();
});

it('keeps a later synchronous write to the prepared source when the old transaction is cancelled', async () => {
  const gate = deferred(), pause = vi.fn(() => gate.promise), publisher = new IncrementalMemoryPublication<Value>('asc', { captureSources: true, yieldTask: pause });
  publisher.apply('source', reset([value('a'), value('b')]));
  const pending = publisher.applyControlled('source', reset(Array.from({ length: 300 }, (_, at) => value('n' + at))), { isCurrent: () => true }), rejected = expect(pending).rejects.toThrow('memory_publication_unavailable');
  await vi.waitFor(() => expect(pause).toHaveBeenCalled()); const latest = value('a', 1, 'latest'); publisher.apply('source', modified(latest, 0, 0)); await rejected;
  gate.resolve(); await Promise.resolve(); expect([...publisher.snapshot()]).toEqual([latest, value('b')]); publisher.clear();
});

it('does not lose a mutation performed by a commit callback and does not expose malformed private state', async () => {
  const publisher = new IncrementalMemoryPublication<Value>('asc', { captureSources: true, yieldTask: async () => {} }); publisher.apply('live', reset([value('live')]));
  await expect(publisher.applyControlled('new', reset(Array.from({ length: 300 }, (_, at) => value('n' + at))), { isCurrent: () => true, beforeCommit: () => { publisher.apply('other', reset([value('other')])); return true; } })).rejects.toThrow();
  expect([...publisher.snapshot()].map(row => row.id)).toEqual(['live', 'other']);
  const invalid = reset(Array.from({ length: 300 }, (_, at) => value('n' + at))); invalid.order.reset = [...invalid.order.reset!, 'n0'];
  await expect(publisher.applyControlled('bad', invalid, { isCurrent: () => true })).rejects.toThrow(); expect([...publisher.snapshot()].map(row => row.id)).toEqual(['live', 'other']); publisher.clear();
});

it('retains reserved source precedence when a newer guarded request replaces initial preparation', async () => {
  const gate = deferred(), pause = vi.fn(() => gate.promise), publisher = new IncrementalMemoryPublication<Value>('asc', { captureSources: true, yieldTask: pause }); let active = true;
  const pending = publisher.applyControlled('first', reset(Array.from({ length: 300 }, (_, at) => value('n' + at))), { isCurrent: () => active }), rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(pause).toHaveBeenCalled()); publisher.apply('second', reset([value('second')])); active = false; gate.resolve(); await rejected;
  await publisher.applyControlled('first', reset(Array.from({ length: 300 }, (_, at) => value('n' + at))), { isCurrent: () => true });
  expect(publisher.captureSource('first')?.priority).toBe(0); expect(publisher.captureSource('first')?.ordinal).toBe(0); expect(publisher.captureSource('second')?.ordinal).toBe(1);
  expect([...publisher.snapshot()].at(-1)?.id).toBe('second'); publisher.clear();
});

it.each(['asc', 'desc'] as const)('matches the full merge oracle across large controlled %s resets and synchronous mutations', async direction => {
  const publisher = new IncrementalMemoryPublication<Value>(direction, { sourceBase: 2, captureSources: true, yieldTask: async () => {} }), reference = new FullMergeReference(direction, 2);
  let seed = 731; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const keys = ['first', 'second', 'third'];
  for (let step = 0; step < 40; step++) {
    const key = keys[random() % keys.length], ids = Array.from({ length: 120 }, (_, at) => 'n' + ((at + step * 17) % 200));
    for (let at = ids.length - 1; at > 0; at--) { const to = random() % (at + 1); [ids[at], ids[to]] = [ids[to], ids[at]]; }
    const patch: MemoryPublicationPatch<Value> = { changed: ids.map(id => ({ id, value: random() % 7 === 0 ? null : value(id, random() % 4, key + ':' + step) })), removed: [], order: { reset: ids, changes: [] } };
    const before = reference.rows(), delta = await publisher.applyControlled(key, patch, { isCurrent: () => true }); reference.apply(key, patch);
    expect([...publisher.snapshot()]).toEqual(reference.rows()); assertDelta(delta, before, reference.rows());
    const id = ids[random() % ids.length], excluded = step % 3 !== 0; publisher.exclude(key, id, excluded); reference.exclude(key, id, excluded);
    if (step % 9 === 8) { const removed = keys[(keys.indexOf(key) + 1) % keys.length]; publisher.removeSource(removed); reference.removeSource(removed); }
    expect([...publisher.snapshot()]).toEqual(reference.rows());
  }
  publisher.clear();
});

it('bounds replay backlog and preserves the visible state when excess concurrent mutations cancel preparation', async () => {
  const gate = deferred(), pause = vi.fn(() => gate.promise), publisher = new IncrementalMemoryPublication<Value>('asc', { captureSources: true, yieldTask: pause }); publisher.apply('live', reset([value('live')]));
  const pending = publisher.applyControlled('new', reset(Array.from({ length: 300 }, (_, at) => value('n' + at))), { isCurrent: () => true }), rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(pause).toHaveBeenCalled());
  for (let at = 0; at < 20_100; at++) publisher.exclude('new', 'n0', at % 2 === 0);
  await rejected; expect([...publisher.snapshot()].map(row => row.id)).toEqual(['live']); gate.resolve(); publisher.clear();
});
