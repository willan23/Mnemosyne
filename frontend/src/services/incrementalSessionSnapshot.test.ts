import { expect, it, vi } from 'vitest';
import { IncrementalSessionSnapshot, INCREMENTAL_SESSION_SNAPSHOT_LIMITS,
  type SessionSnapshotChange, type SessionSnapshotInput, type SessionSnapshotLease } from './incrementalSessionSnapshot';
import { SNAPSHOT_MAPPING_LIMITS } from './snapshotMappingQueue';

it('preserves unchanged decrypted objects and vectors and remaps changed documents only', async () => {
  const cache = new IncrementalSessionSnapshot<{ id: string; embedding: number[] }>();
  const mapper = vi.fn(async (doc: { id: string }) => ({ id: doc.id, embedding: [1, 0] }));
  const docs = [{ id: 'a' }, { id: 'b' }];
  const first = await cache.map(docs, new Set(['a', 'b']), mapper);
  const second = await cache.map(docs, new Set(['b']), mapper);
  expect(mapper).toHaveBeenCalledTimes(3);
  expect(second[0]).toBe(first[0]);
  expect(second[0].embedding).toBe(first[0].embedding);
  expect(second[1]).not.toBe(first[1]);
  await cache.map([docs[1]], new Set(), mapper);
  const restored = await cache.map(docs, new Set(), mapper);
  expect(restored[0]).not.toBe(first[0]);
});

it('retains outstanding unchanged decryptions across snapshots without restoring deleted documents', async () => {
  const cache = new IncrementalSessionSnapshot<string>();
  let resolve!: (value: string) => void;
  const mapper = vi.fn(() => new Promise<string>(finish => { resolve = finish; }));
  const first = cache.map([{ id: 'a' }], new Set(['a']), mapper);
  const second = cache.map([{ id: 'a' }], new Set(), mapper);
  expect(mapper).toHaveBeenCalledOnce();
  expect(await cache.map([], new Set(['a']), mapper)).toEqual([]);
  resolve('old');
  expect(await first).toEqual(['old']);
  expect(await second).toEqual(['old']);
  expect(await cache.map([], new Set(), mapper)).toEqual([]);
  // Callers still apply their snapshot generation guard before publishing.
});

it('retries failures and does not reuse a cache across different listener instances', async () => {
  const cache = new IncrementalSessionSnapshot<string>();
  const mapper = vi.fn().mockRejectedValueOnce(new Error('failure')).mockResolvedValue('ok');
  await expect(cache.map([{ id: 'a' }], new Set(), mapper)).rejects.toThrow();
  expect(await cache.map([{ id: 'a' }], new Set(), mapper)).toEqual(['ok']);
  await new IncrementalSessionSnapshot<string>().map([{ id: 'a' }], new Set(), mapper);
  expect(mapper).toHaveBeenCalledTimes(3);
});

type Doc = { id: string; text?: string };
const document = (id: string, text = id): Doc => ({ id, text });
const snapshot = (docs: Doc[], changes: SessionSnapshotChange<Doc>[] = []) => ({ docs, docChanges: vi.fn(() => changes) });
const change = (type: SessionSnapshotChange<Doc>['type'], id: string, oldIndex: number, newIndex: number, text = id): SessionSnapshotChange<Doc> =>
  ({ type, doc: document(id, text), oldIndex, newIndex });
function delta(changes: SessionSnapshotChange<Doc>[]) {
  return { get docs(): Doc[] { throw new Error('delta must not enumerate docs'); }, docChanges: vi.fn(() => changes) };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const mapText = async (doc: Doc) => doc.text!;
function applyOrder(order: SessionSnapshotLease<unknown>['order'], previous: string[] = []) {
  const ids = [...(order.reset ?? previous)];
  for (const movement of order.changes) {
    if (movement.type !== 'added') expect(ids.splice(movement.oldIndex, 1)).toEqual([movement.id]);
    if (movement.type !== 'removed') ids.splice(movement.newIndex, 0, movement.id);
  }
  return ids;
}

it('prepares the first snapshot once and acknowledges its complete reset only on commit', async () => {
  const cache = new IncrementalSessionSnapshot<{ text: string; embedding: number[] }>();
  const mapper = vi.fn(async (doc: Doc) => ({ text: doc.text!, embedding: [1, 0] }));
  const firstSnapshot = snapshot([document('a'), document('b')]);
  const first = await cache.prepare(firstSnapshot, mapper);
  expect(firstSnapshot.docChanges).not.toHaveBeenCalled();
  expect(first.changed.map(row => row.id)).toEqual(['a', 'b']);
  expect(first.order).toEqual({ reset: ['a', 'b'], changes: [] });
  expect(Object.isFrozen(first.order.reset)).toBe(true);
  expect(first.isCurrent()).toBe(true); expect(first.commit()).toBe(true); expect(first.commit()).toBe(false);
  const next = await cache.prepare(delta([change('modified', 'b', 1, 1, 'edited')]), mapper);
  expect(mapper).toHaveBeenCalledTimes(3);
  expect(next.changed).toEqual([{ id: 'b', value: { text: 'edited', embedding: [1, 0] } }]);
  expect(next.order).toEqual({ changes: [{ id: 'b', type: 'modified', oldIndex: 1, newIndex: 1 }] });
  expect(first.isCurrent()).toBe(false);
});

it('handles added, moved, modified and removed documents using only docChanges', async () => {
  const cache = new IncrementalSessionSnapshot<string>();
  const first = await cache.prepare(snapshot(['a', 'b', 'c'].map(id => document(id))), mapText); first.commit();
  const changes = [change('modified', 'b', 1, 0, 'new-b'), change('removed', 'c', 2, -1), change('added', 'd', -1, 1)];
  const current = await cache.prepare(delta(changes), mapText);
  expect(current.changed).toEqual([{ id: 'b', value: 'new-b' }, { id: 'd', value: 'd' }]);
  expect(current.removed).toEqual(['c']); expect(applyOrder(current.order, ['a', 'b', 'c'])).toEqual(['b', 'd', 'a']);
  expect(current.commit()).toBe(true);
  const unchanged = await cache.prepare(delta([]), mapText);
  expect(unchanged.changed).toEqual([]); expect(unchanged.removed).toEqual([]); expect(unchanged.order).toEqual({ changes: [] });
});

it('retains resolved dirty values, removals and reset plus movements until explicit publication', async () => {
  const cache = new IncrementalSessionSnapshot<string>();
  const first = await cache.prepare(snapshot([document('a'), document('b')]), mapText);
  const moved = await cache.prepare(delta([change('modified', 'a', 0, 0, 'new-a'), change('removed', 'b', 1, -1), change('added', 'c', -1, 1)]), mapText);
  expect(first.commit()).toBe(false);
  const latest = await cache.prepare(delta([]), mapText);
  expect(latest.changed).toEqual([{ id: 'a', value: 'new-a' }, { id: 'c', value: 'c' }]);
  expect(latest.removed).toEqual(['b']); expect(latest.order).toEqual(moved.order);
  expect(applyOrder(latest.order)).toEqual(['a', 'c']); expect(moved.commit()).toBe(false); expect(latest.commit()).toBe(true);
  const clean = await cache.prepare(delta([]), mapText);
  expect(clean.changed).toEqual([]); expect(clean.removed).toEqual([]); expect(clean.order).toEqual({ changes: [] });
});

it('the newest snapshot waits for all still-present dirty mappings from concurrent snapshots', async () => {
  const cache = new IncrementalSessionSnapshot<string>(), a = deferred<string>();
  const mapper = vi.fn((doc: Doc) => doc.id === 'a' ? a.promise : Promise.resolve(doc.text!));
  const first = cache.prepare(snapshot([document('a'), document('b')]), mapper);
  const next = cache.prepare(delta([change('modified', 'b', 1, 1, 'new-b')]), mapper);
  const settled = vi.fn(); void next.then(settled);
  await Promise.resolve(); expect(settled).not.toHaveBeenCalled(); expect(mapper).toHaveBeenCalledTimes(3);
  a.resolve('resolved-a'); const latest = await next, old = await first;
  expect(latest.changed).toEqual([{ id: 'a', value: 'resolved-a' }, { id: 'b', value: 'new-b' }]);
  expect(old.isCurrent()).toBe(false); expect(old.commit()).toBe(false); expect(latest.commit()).toBe(true);
});

it('removing a pending entry lets the current lease finish without waiting or resurrecting it', async () => {
  const cache = new IncrementalSessionSnapshot<string>(), a = deferred<string>();
  const mapper = (doc: Doc) => doc.id === 'a' ? a.promise : Promise.resolve(doc.text!);
  const first = cache.prepare(snapshot([document('a'), document('b')]), mapper);
  const current = await cache.prepare(delta([change('removed', 'a', 0, -1)]), mapper);
  expect(current.changed).toEqual([{ id: 'b', value: 'b' }]); expect(current.removed).toEqual(['a']); expect(applyOrder(current.order)).toEqual(['b']);
  expect(current.commit()).toBe(true); a.resolve('old-a'); expect((await first).commit()).toBe(false);
  expect((await cache.prepare(delta([]), mapper)).changed).toEqual([]);
});

it('retains an uncommitted removal even after its lease promise has resolved', async () => {
  const cache = new IncrementalSessionSnapshot<string>(); (await cache.prepare(snapshot([document('a')]), mapText)).commit();
  const removed = await cache.prepare(delta([change('removed', 'a', 0, -1)]), mapText);
  const next = await cache.prepare(delta([]), mapText);
  expect(next.removed).toEqual(['a']); expect(next.order).toEqual(removed.order); expect(removed.commit()).toBe(false); expect(next.commit()).toBe(true);
});

it('a replacement survives rejection of the old mapping and remains eligible to commit', async () => {
  const cache = new IncrementalSessionSnapshot<string>(), old = deferred<string>();
  const mapper = (doc: Doc) => doc.text === 'old' ? old.promise : Promise.resolve(doc.text!);
  const initial = cache.prepare(snapshot([document('a', 'old')]), mapper), rejected = expect(initial).rejects.toThrow('old failed');
  const replacement = await cache.prepare(delta([change('modified', 'a', 0, 0, 'new')]), mapper);
  old.reject(new Error('old failed')); await rejected;
  expect(replacement.isCurrent()).toBe(true); expect(replacement.changed).toEqual([{ id: 'a', value: 'new' }]); expect(replacement.commit()).toBe(true);
  expect((await cache.prepare(delta([]), mapper)).changed).toEqual([]);
});

it('rejection of removed work cannot invalidate a newer removal lease', async () => {
  const cache = new IncrementalSessionSnapshot<string>(), old = deferred<string>();
  const initial = cache.prepare(snapshot([document('a')]), () => old.promise), rejected = expect(initial).rejects.toThrow('removed failed');
  const removal = await cache.prepare(delta([change('removed', 'a', 0, -1)]), mapText);
  old.reject(new Error('removed failed')); await rejected;
  expect(removal.isCurrent()).toBe(true); expect(removal.commit()).toBe(true);
});

it('a current mapping failure invalidates the cache and rebuilds the next snapshot even with no changes', async () => {
  const cache = new IncrementalSessionSnapshot<string>();
  const first = await cache.prepare(snapshot([document('a'), document('b')]), mapText); first.commit();
  const failure = cache.prepare(delta([change('modified', 'a', 0, 0)]), async () => { throw new Error('current failed'); });
  await expect(failure).rejects.toThrow('current failed'); expect(first.isCurrent()).toBe(false);
  const recoverySnapshot = snapshot([document('a', 'recovered')]), recovered = await cache.prepare(recoverySnapshot, mapText);
  expect(recoverySnapshot.docChanges).not.toHaveBeenCalled();
  expect(recovered.changed).toEqual([{ id: 'a', value: 'recovered' }]); expect(recovered.removed).toEqual(['b']);
  expect(recovered.order).toEqual({ reset: ['a'], changes: [] }); expect(recovered.commit()).toBe(true);
});

it('a still-current pending failure also rejects newer snapshots that retained the dirty entry', async () => {
  const cache = new IncrementalSessionSnapshot<string>(), pending = deferred<string>();
  const first = cache.prepare(snapshot([document('a')]), () => pending.promise), firstRejected = expect(first).rejects.toThrow('shared failed');
  const next = cache.prepare(delta([]), mapText), nextRejected = expect(next).rejects.toThrow('shared failed');
  pending.reject(new Error('shared failed')); await Promise.all([firstRejected, nextRejected]);
  const recovered = await cache.prepare(snapshot([document('b')]), mapText);
  expect(recovered.order.reset).toEqual(['b']); expect(recovered.removed).toEqual(['a']);
});

it('recovery preserves an earlier uncommitted removal when another current mapping fails', async () => {
  const cache = new IncrementalSessionSnapshot<string>(); (await cache.prepare(snapshot([document('a'), document('b')]), mapText)).commit();
  await cache.prepare(delta([change('removed', 'b', 1, -1)]), mapText);
  await expect(cache.prepare(delta([change('modified', 'a', 0, 0)]), async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  const recovered = await cache.prepare(snapshot([document('a', 'recovered')]), mapText);
  expect(recovered.removed).toEqual(['b']); expect(recovered.changed).toEqual([{ id: 'a', value: 'recovered' }]);
});

it('remove then re-add cancels a dirty tombstone while preserving cumulative order movements', async () => {
  const cache = new IncrementalSessionSnapshot<string>(); (await cache.prepare(snapshot([document('a'), document('b')]), mapText)).commit();
  await cache.prepare(delta([change('removed', 'a', 0, -1)]), mapText);
  const latest = await cache.prepare(delta([change('added', 'a', -1, 1, 'new-a')]), mapText);
  expect(latest.removed).toEqual([]); expect(latest.changed).toEqual([{ id: 'a', value: 'new-a' }]);
  expect(applyOrder(latest.order, ['a', 'b'])).toEqual(['b', 'a']); expect(latest.commit()).toBe(true);
});

it('synchronous mapper exceptions are retryable through full-snapshot recovery', async () => {
  const cache = new IncrementalSessionSnapshot<string>();
  await expect(cache.prepare(snapshot([document('a')]), () => { throw new Error('sync failed'); })).rejects.toThrow('sync failed');
  expect((await cache.prepare(snapshot([document('a')]), mapText)).changed).toEqual([{ id: 'a', value: 'a' }]);
});

it('reset invalidates revisions and generations and drops legacy and prepared cached values', async () => {
  const cache = new IncrementalSessionSnapshot<{ text: string }>(), mapper = vi.fn(async (doc: Doc) => ({ text: doc.text! }));
  const legacy = await cache.map([document('a')], new Set(), mapper);
  const prepared = await cache.prepare(snapshot([document('a')]), mapper);
  cache.reset(); expect(prepared.isCurrent()).toBe(false); expect(prepared.commit()).toBe(false);
  const legacyAfter = await cache.map([document('a')], new Set(), mapper);
  const preparedAfter = await cache.prepare(snapshot([document('a')]), mapper);
  expect(legacyAfter[0]).not.toBe(legacy[0]); expect(preparedAfter.changed[0].value).not.toBe(prepared.changed[0].value);
  expect(preparedAfter.order.reset).toEqual(['a']); expect(preparedAfter.commit()).toBe(true);
});

it('late work from a retired generation cannot invalidate or restore a new scope', async () => {
  const cache = new IncrementalSessionSnapshot<string>(), old = deferred<string>();
  const first = cache.prepare(snapshot([document('a')]), () => old.promise), rejected = expect(first).rejects.toThrow('retired failed');
  cache.reset(); const fresh = await cache.prepare(snapshot([document('b')]), mapText);
  old.reject(new Error('retired failed')); await rejected;
  expect(fresh.isCurrent()).toBe(true); expect(fresh.changed).toEqual([{ id: 'b', value: 'b' }]); expect(fresh.commit()).toBe(true);
  expect((await cache.prepare(delta([]), mapText)).changed).toEqual([]);
});

it('late successful mapping from before reset returns only an obsolete lease', async () => {
  const cache = new IncrementalSessionSnapshot<string>(), old = deferred<string>();
  const initial = cache.prepare(snapshot([document('a')]), () => old.promise);
  cache.reset(); const fresh = await cache.prepare(snapshot([document('b')]), mapText);
  old.resolve('retired-a'); const retired = await initial;
  expect(retired.isCurrent()).toBe(false); expect(retired.commit()).toBe(false); expect(fresh.isCurrent()).toBe(true); expect(fresh.commit()).toBe(true);
});

it('lease metadata is detached from the internal dirty and movement buffers', async () => {
  const cache = new IncrementalSessionSnapshot<string>(); (await cache.prepare(snapshot([document('a')]), mapText)).commit();
  const lease = await cache.prepare(delta([change('modified', 'a', 0, 0, 'new')]), mapText);
  lease.changed.length = 0; lease.removed.push('foreign'); lease.order.changes[0].id = 'foreign';
  const next = await cache.prepare(delta([]), mapText);
  expect(next.changed).toEqual([{ id: 'a', value: 'new' }]); expect(next.removed).toEqual([]); expect(next.order.changes[0].id).toBe('a');
});

it.each([
  change('added', 'a', -1, 0), change('added', 'b', 0, 0), change('added', 'b', -1, 2),
  change('modified', 'a', 1, 0), change('modified', 'a', 0, 1), change('removed', 'b', 0, -1),
  change('removed', 'a', 0, 0), change('modified', 'a', .5, 0), change('modified', 'a', 0, NaN),
])('fails closed on invalid order indices or IDs: %j', async invalid => {
  const cache = new IncrementalSessionSnapshot<string>(); (await cache.prepare(snapshot([document('a')]), mapText)).commit();
  await expect(cache.prepare(delta([invalid]), mapText)).rejects.toThrow('incremental_snapshot_unavailable');
  expect((await cache.prepare(snapshot([document('a')]), mapText)).order.reset).toEqual(['a']);
});

it('requires index metadata on prepare deltas instead of silently losing equal-timestamp order', async () => {
  const cache = new IncrementalSessionSnapshot<string>(); (await cache.prepare(snapshot([document('a')]), mapText)).commit();
  const missing = { docs: [], docChanges: () => [{ type: 'modified', doc: document('a') }] } as unknown as SessionSnapshotInput<Doc>;
  await expect(cache.prepare(missing, mapText)).rejects.toThrow('incremental_snapshot_unavailable');
});

it('bounds uncommitted movements, fails closed on overflow and recovers with a full reset', async () => {
  const cache = new IncrementalSessionSnapshot<string>(); (await cache.prepare(snapshot([document('a')]), mapText)).commit();
  const maximum = INCREMENTAL_SESSION_SNAPSHOT_LIMITS.pendingOrderChanges;
  const atLimit = await cache.prepare(delta(Array.from({ length: maximum }, () => change('modified', 'a', 0, 0))), mapText);
  expect(atLimit.order.changes).toHaveLength(maximum);
  await expect(cache.prepare(delta([change('modified', 'a', 0, 0)]), mapText)).rejects.toThrow('incremental_snapshot_unavailable');
  expect(atLimit.isCurrent()).toBe(false); expect(atLimit.commit()).toBe(false);
  const recovered = await cache.prepare(snapshot([document('a')]), mapText);
  expect(recovered.order).toEqual({ reset: ['a'], changes: [] }); expect(recovered.commit()).toBe(true);
});

it('a full reset of 100000 documents does not consume the incremental movement budget', async () => {
  const cache = new IncrementalSessionSnapshot<string>(), docs = Array.from({ length: 100_000 }, (_, index) => document('n' + index));
  const firstSnapshot = snapshot(docs), mapper = vi.fn(mapText), first = await cache.prepare(firstSnapshot, mapper);
  expect(first.changed).toHaveLength(100_000); expect(first.order.reset).toHaveLength(100_000); expect(first.order.changes).toEqual([]);
  expect(mapper).toHaveBeenCalledTimes(100_000); expect(firstSnapshot.docChanges).not.toHaveBeenCalled(); expect(first.commit()).toBe(true);
  const next = await cache.prepare(delta([change('modified', 'n99999', 99_999, 99_999, 'edited')]), mapper);
  expect(next.changed).toEqual([{ id: 'n99999', value: 'edited' }]); expect(next.order.changes).toHaveLength(1);
});

it('bounds mapper concurrency and yields tasks while collecting a complete initial lease in source order', async () => {
  let running = 0, peak = 0, started = 0, yields = 0;
  const cache = new IncrementalSessionSnapshot<string>({ yieldTask: async () => { yields++; } });
  const docs = Array.from({ length: 1000 }, (_, at) => document('m' + at));
  const pending = cache.prepare(snapshot(docs), async doc => {
    started++; running++; peak = Math.max(peak, running); await Promise.resolve(); running--; return doc.id;
  });
  expect(started).toBe(SNAPSHOT_MAPPING_LIMITS.concurrency);
  const lease = await pending;
  expect(peak).toBe(SNAPSHOT_MAPPING_LIMITS.concurrency); expect(started).toBe(1000); expect(yields).toBeGreaterThan(0);
  expect(lease.changed.map(row => row.value)).toEqual(docs.map(row => row.id)); expect(lease.commit()).toBe(true); cache.reset();
});

it('does not read removed or replaced queued documents and rejects their obsolete large lease', async () => {
  const cache = new IncrementalSessionSnapshot<string>({ yieldTask: async () => {} }), hold = deferred<void>(); let obsoleteReads = 0;
  const docs = Array.from({ length: 10 }, (_, at) => document('m' + at));
  for (const doc of docs.slice(8)) Object.defineProperty(doc, 'text', { get() { obsoleteReads++; throw Error('Read obsolete queued document'); } });
  const mapper = async (doc: Doc) => { await hold.promise; return doc.text!; };
  const initial = cache.prepare(snapshot(docs), mapper), rejected = expect(initial).rejects.toThrow('incremental_snapshot_unavailable');
  const next = cache.prepare(delta([change('removed', 'm9', 9, -1), change('modified', 'm8', 8, 8, 'new-m8')]), mapper);
  hold.resolve(); const lease = await next; await rejected;
  expect(obsoleteReads).toBe(0); expect(lease.changed.map(row => row.value)).toEqual([...docs.slice(0, 8).map(row => row.id), 'new-m8']);
  expect(lease.removed).toEqual(['m9']); expect(applyOrder(lease.order)).toEqual(docs.slice(0, 9).map(row => row.id)); expect(lease.commit()).toBe(true); cache.reset();
});

it('retires queued reads on reset and allows a new generation while old native mappings are still pending', async () => {
  const cache = new IncrementalSessionSnapshot<string>(), hold = deferred<void>(); let reads = 0;
  const initial = cache.prepare(snapshot(Array.from({ length: 1000 }, (_, at) => document('old' + at))), async doc => { reads++; await hold.promise; return doc.id; });
  const rejected = expect(initial).rejects.toThrow('incremental_snapshot_unavailable');
  expect(reads).toBe(8); cache.reset(); const fresh = await cache.prepare(snapshot([document('fresh')]), mapText); await rejected;
  expect(fresh.changed).toEqual([{ id: 'fresh', value: 'fresh' }]); expect(fresh.commit()).toBe(true); hold.resolve();
  await Promise.resolve(); await Promise.resolve(); expect(reads).toBe(8); expect((await cache.prepare(delta([]), mapText)).changed).toEqual([]); cache.reset();
});

it('one current mapper failure cancels all queued reads and rebuilds the next complete snapshot', async () => {
  const cache = new IncrementalSessionSnapshot<string>(); let reads = 0;
  const failed = cache.prepare(snapshot(Array.from({ length: 1000 }, (_, at) => document('m' + at))), async doc => { reads++; if (doc.id === 'm0') throw Error('failed mapping'); return doc.id; });
  await expect(failed).rejects.toThrow('failed mapping'); expect(reads).toBe(8);
  const recovered = await cache.prepare(snapshot([document('m500', 'recovered')]), mapText);
  expect(recovered.changed).toEqual([{ id: 'm500', value: 'recovered' }]); expect(recovered.removed).toHaveLength(999); expect(recovered.commit()).toBe(true); cache.reset();
});

it('coalesces snapshots during queued initial mapping without losing a later edit, removal or insertion', async () => {
  const cache = new IncrementalSessionSnapshot<string>({ yieldTask: async () => {} }), hold = deferred<void>(), counts = new Map<string, number>();
  const mapper = async (doc: Doc) => { const key = doc.text!; counts.set(key, (counts.get(key) ?? 0) + 1); await hold.promise; return key; };
  const docs = Array.from({ length: 1000 }, (_, at) => document('m' + at));
  const initial = cache.prepare(snapshot(docs), mapper), firstRejected = expect(initial).rejects.toThrow('incremental_snapshot_unavailable');
  const edited = cache.prepare(delta([change('modified', 'm500', 500, 500, 'edited')]), mapper), editedRejected = expect(edited).rejects.toThrow('incremental_snapshot_unavailable');
  const latest = cache.prepare(delta([change('removed', 'm600', 600, -1), change('added', 'new', -1, 999, 'new')]), mapper);
  hold.resolve(); const lease = await latest; await Promise.all([firstRejected, editedRejected]);
  const expected = docs.filter(row => row.id !== 'm600').map(row => row.id === 'm500' ? 'edited' : row.id).concat('new');
  expect(lease.changed.map(row => row.value)).toEqual(expected); expect(applyOrder(lease.order)).toEqual(docs.filter(row => row.id !== 'm600').map(row => row.id).concat('new'));
  expect(counts.has('m500') || counts.has('m600')).toBe(false); expect(counts.get('edited')).toBe(1); expect(counts.get('new')).toBe(1); expect(lease.removed).toEqual(['m600']); expect(lease.commit()).toBe(true); cache.reset();
});

it('does not insert an old entry when a mapper synchronously retires its generation', async () => {
  const cache = new IncrementalSessionSnapshot<string>();
  await expect(cache.prepare(snapshot([document('old')]), async () => { cache.reset(); return 'old'; })).rejects.toThrow('incremental_snapshot_unavailable');
  const fresh = await cache.prepare(snapshot([document('fresh')]), mapText);
  expect(fresh.changed).toEqual([{ id: 'fresh', value: 'fresh' }]); expect(fresh.order.reset).toEqual(['fresh']); expect(fresh.commit()).toBe(true); cache.reset();
});

it('returns control after one metadata batch before reading the remaining initial IDs', async () => {
  const gate = deferred<void>(), seen = new Set<string>(); let first = true, docsReads = 0, mapped = 0;
  const cache = new IncrementalSessionSnapshot<string>({ yieldTask: () => { if (first) { first = false; return gate.promise; } return Promise.resolve(); } });
  const docs = Array.from({ length: 1000 }, (_, at) => ({ get id() { seen.add('m' + at); return 'm' + at; } }));
  const pending = cache.prepare({ get docs() { docsReads++; return docs; }, docChanges() { throw Error('initial changes'); } }, async doc => { mapped++; return doc.id; });
  expect(seen.size).toBe(SNAPSHOT_MAPPING_LIMITS.batch); expect(mapped).toBe(8); expect(docsReads).toBe(1);
  await Promise.resolve(); await Promise.resolve(); expect(mapped).toBe(8);
  gate.resolve(); const lease = await pending; expect(lease.changed.map(row => row.value)).toEqual(Array.from({ length: 1000 }, (_, at) => 'm' + at));
  expect(lease.commit()).toBe(true); cache.reset();
});

it('queues delta metadata while initial IDs are being captured and skips superseded queued document bodies', async () => {
  const gate = deferred<void>(), counts = new Map<string, number>(); let first = true;
  const cache = new IncrementalSessionSnapshot<string>({ yieldTask: () => { if (first) { first = false; return gate.promise; } return Promise.resolve(); } });
  const mapper = async (doc: Doc) => { counts.set(doc.text!, (counts.get(doc.text!) ?? 0) + 1); return doc.text!; };
  const initial = cache.prepare(snapshot(Array.from({ length: 1000 }, (_, at) => document('m' + at))), mapper), rejected = expect(initial).rejects.toThrow('incremental_snapshot_unavailable');
  const updated = delta([change('modified', 'm500', 500, 500, 'new-m500'), change('removed', 'm600', 600, -1)]);
  const latest = cache.prepare(updated, mapper); expect(updated.docChanges).not.toHaveBeenCalled();
  gate.resolve(); const lease = await latest; await rejected;
  expect(counts.has('m500') || counts.has('m600')).toBe(false); expect(counts.get('new-m500')).toBe(1);
  expect(lease.changed).toHaveLength(999); expect(lease.removed).toEqual(['m600']); expect(lease.commit()).toBe(true); cache.reset();
});

it('reset rejects paused and queued preparation without waiting for an external scheduler to resume', async () => {
  const gate = deferred<void>(); let reads = 0;
  const cache = new IncrementalSessionSnapshot<string>({ yieldTask: () => gate.promise });
  const initial = cache.prepare(snapshot(Array.from({ length: 1000 }, (_, at) => document('old' + at))), async doc => { reads++; return doc.id; });
  const firstRejected = expect(initial).rejects.toThrow('incremental_snapshot_unavailable'), queued = delta([]);
  const next = cache.prepare(queued, mapText), nextRejected = expect(next).rejects.toThrow('incremental_snapshot_unavailable');
  cache.reset(); await Promise.all([firstRejected, nextRejected]); expect(queued.docChanges).not.toHaveBeenCalled();
  const fresh = await cache.prepare(snapshot([document('fresh')]), mapText); expect(fresh.changed).toEqual([{ id: 'fresh', value: 'fresh' }]); expect(fresh.commit()).toBe(true);
  gate.resolve(); await Promise.resolve(); await Promise.resolve(); expect(reads).toBe(8); expect((await cache.prepare(delta([]), mapText)).changed).toEqual([]); cache.reset();
});

it('abandons an overtaken metadata copy while retaining the complete source for the next delta', async () => {
  const gate = deferred<void>(), entered = deferred<void>(), seen = new Set<string>(), counts = new Map<string, number>(); let held = false, docsReads = 0;
  const cache = new IncrementalSessionSnapshot<string>({ yieldTask: () => {
    if (seen.size === 1000 && !held) { held = true; entered.resolve(); return gate.promise; } return Promise.resolve();
  } });
  const docs = Array.from({ length: 1000 }, (_, at) => ({ get id() { seen.add('m' + at); return 'm' + at; }, text: 'm' + at }));
  const mapper = async (doc: Doc) => { counts.set(doc.text!, (counts.get(doc.text!) ?? 0) + 1); return doc.text!; };
  const initial = cache.prepare({ get docs() { docsReads++; return docs; }, docChanges: () => [] }, mapper), rejected = expect(initial).rejects.toThrow('incremental_snapshot_unavailable');
  await entered.promise;
  const latest = cache.prepare(delta([change('modified', 'm500', 500, 500, 'edited')]), mapper); gate.resolve();
  const lease = await latest; await rejected; expect(docsReads).toBe(1); expect(lease.changed).toHaveLength(1000); expect(lease.order.reset).toHaveLength(1000);
  expect(lease.changed.find(row => row.id === 'm500')?.value).toBe('edited'); expect(counts.has('m500')).toBe(false); expect(lease.commit()).toBe(true); cache.reset();
});

it('bounds queued snapshots and retires their unread input on overflow before recovering', async () => {
  const gate = deferred<void>(), cache = new IncrementalSessionSnapshot<string>({ yieldTask: () => gate.promise }), inputs: ReturnType<typeof delta>[] = [];
  const pending = [cache.prepare(snapshot(Array.from({ length: 1000 }, (_, at) => document('old' + at))), mapText).then(() => false, () => true)];
  for (let at = 1; at < INCREMENTAL_SESSION_SNAPSHOT_LIMITS.pendingSnapshots; at++) {
    const input = delta([]); inputs.push(input); pending.push(cache.prepare(input, mapText).then(() => false, () => true));
  }
  await expect(cache.prepare(delta([]), mapText)).rejects.toThrow('incremental_snapshot_unavailable');
  expect((await Promise.all(pending)).every(Boolean)).toBe(true); for (const input of inputs) expect(input.docChanges).not.toHaveBeenCalled();
  cache.reset(); const fresh = await cache.prepare(snapshot([document('fresh')]), mapText); expect(fresh.changed).toEqual([{ id: 'fresh', value: 'fresh' }]); expect(fresh.commit()).toBe(true);
  gate.resolve(); await Promise.resolve(); cache.reset();
});

it('a queued correction replaces a failed initial mapper before stable metadata is admitted', async () => {
  const gate = deferred<void>(); let first = true;
  const cache = new IncrementalSessionSnapshot<string>({ yieldTask: () => { if (first) { first = false; return gate.promise; } return Promise.resolve(); } });
  const mapper = async (doc: Doc) => { if (doc.text === 'm0') throw Error('superseded failure'); return doc.text!; };
  const initial = cache.prepare(snapshot(Array.from({ length: 1000 }, (_, at) => document('m' + at))), mapper), rejected = expect(initial).rejects.toThrow('incremental_snapshot_unavailable');
  const latest = cache.prepare(delta([change('modified', 'm0', 0, 0, 'corrected')]), mapper); gate.resolve();
  const lease = await latest; await rejected; expect(lease.changed[0]).toEqual({ id: 'm0', value: 'corrected' }); expect(lease.changed).toHaveLength(1000); expect(lease.commit()).toBe(true); cache.reset();
});

it('an invalid movement after a task boundary retires the old lease and recovers from the full SDK view', async () => {
  const cache = new IncrementalSessionSnapshot<string>({ yieldTask: async () => {} }); const previous = await cache.prepare(snapshot([document('a'), document('b')]), mapText); previous.commit();
  const changes = Array.from({ length: 300 }, () => change('modified', 'a', 0, 0, 'pending')); changes[299] = change('modified', 'b', 0, 0);
  await expect(cache.prepare(delta(changes), mapText)).rejects.toThrow('incremental_snapshot_unavailable'); expect(previous.isCurrent()).toBe(false);
  const fresh = await cache.prepare(snapshot([document('b', 'recovered')]), mapText); expect(fresh.changed).toEqual([{ id: 'b', value: 'recovered' }]); expect(fresh.removed).toEqual(['a']); expect(fresh.commit()).toBe(true); cache.reset();
});

it('a document ID getter cannot insert an old row into a synchronously replaced generation', async () => {
  const cache = new IncrementalSessionSnapshot<string>(); let first = true;
  const doc = { get id() { if (first) { first = false; cache.reset(); } return 'old'; }, text: 'old' };
  await expect(cache.prepare(snapshot([doc]), mapText)).rejects.toThrow('incremental_snapshot_unavailable');
  const fresh = await cache.prepare(snapshot([document('fresh')]), mapText); expect(fresh.changed).toEqual([{ id: 'fresh', value: 'fresh' }]); expect(fresh.order.reset).toEqual(['fresh']); expect(fresh.commit()).toBe(true); cache.reset();
});
