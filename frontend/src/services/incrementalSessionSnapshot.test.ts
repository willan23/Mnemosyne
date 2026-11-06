import { expect, it, vi } from 'vitest';
import { IncrementalSessionSnapshot, INCREMENTAL_SESSION_SNAPSHOT_LIMITS,
  type SessionSnapshotChange, type SessionSnapshotInput, type SessionSnapshotLease } from './incrementalSessionSnapshot';

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
