import { afterEach, expect, it, vi } from 'vitest';
import { CapturePreviewClient } from './capturePreviewClient';
import { CapturePreviewWorkerMock } from '../test/capturePreviewWorkerMock';
import type { SessionData } from '../hooks/useSessions';
import { IncrementalMemoryPublication } from './incrementalMemoryPublication';
import { capturePreviewEligible } from './capturePreviewClient';
import { searchMemories } from '../utils/searchMemories';
const row = (id: string, more: Partial<SessionData> = {}): SessionData => ({ id, uid: 'alice', text: 'Synthetic astronomical observation', timestamp: 1, updatedAt: 1, ...more });
const scope = { key: 'alice-personal', uid: 'alice' }, signal = () => new AbortController().signal;
const setup = () => { const worker = new CapturePreviewWorkerMock(); return { worker, client: new CapturePreviewClient(scope, { createWorker: () => worker, yieldTask: async () => {} }) }; };
const reset = (rows: readonly SessionData[]) => ({ changed: rows.map(value => ({ id: value.id, value })), removed: [], order: { reset: rows.map(value => value.id), changes: [] } });
const change = (value: SessionData) => ({ changed: [{ id: value.id, value }], removed: [], order: { changes: [] } });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('checks ACL before projecting plaintext, excludes shared/team/locked/deleted/foreign records and sends no vectors', async () => {
  const { worker, client } = setup();
  const excluded = [{ uid: 'bob' }, { teamId: 'team' }, { teamScopeAmbiguous: true }, { sharedWithIds: ['other'] }, { encLocked: true }, { deletedAt: 1 }].map((fields, i) => {
    const value = row('denied' + i, fields); Object.defineProperty(value, 'text', { get() { throw Error('Denied plaintext read'); } }); return value;
  });
  const allowed = row('a', { embedding: [1, 2, 3] });
  expect((await client.select([...excluded, allowed], 'astronomical observation', signal()))[0].memory).toBe(allowed);
  const message = worker.postMessage.mock.calls[0][0];
  expect(message.order).toEqual([...excluded.map(() => null), 'a']); expect(message.changed.map(row => row.id)).toEqual(['a']);
  expect(JSON.stringify(message)).not.toContain('denied');
  expect(JSON.stringify(message)).not.toContain('embedding'); client.dispose();
});
it('does no document projection for a new query on the same immutable source, and projects only an edited object', async () => {
  const { client, worker } = setup(), a = row('a'), b = row('b'), rows = [a, b];
  await client.select(rows, 'astronomical observation', signal());
  await client.select(rows, 'astronomical observation updated', signal());
  expect(worker.postMessage.mock.calls[1][0].changed).toEqual([]); expect(worker.postMessage.mock.calls[1][0].order).toBeUndefined();
  await client.select([a, { ...b, title: 'Updated' }], 'astronomical observation', signal());
  expect(worker.postMessage.mock.calls[2][0].changed.map(row => row.id)).toEqual(['b']); client.dispose();
});
it('yields every 256 raw candidates even when all are denied and cancels before creating a Worker', async () => {
  const controller = new AbortController(), createWorker = vi.fn(), yieldTask = vi.fn(async () => { controller.abort(); });
  const client = new CapturePreviewClient(scope, { createWorker, yieldTask });
  await expect(client.select(Array.from({ length: 1000 }, (_, i) => row('d' + i, { uid: 'bob' })), 'astronomical observation', controller.signal)).rejects.toThrow();
  expect(yieldTask).toHaveBeenCalledOnce(); expect(createWorker).not.toHaveBeenCalled();
});
it('uses exactly the selected team and excludes ambiguous and locked team candidates', async () => {
  const worker = new CapturePreviewWorkerMock(), client = new CapturePreviewClient({ key: 'team', uid: 'alice', teamId: 'team' }, { createWorker: () => worker });
  const allowed = row('team', { teamId: 'team', uid: 'bob' });
  const hits = await client.select([row('personal'), row('other', { teamId: 'other' }), row('locked', { teamId: 'team', encLocked: true }), row('ambiguous', { teamId: 'team', teamScopeAmbiguous: true }), allowed], 'astronomical observation', signal());
  expect(hits.map(hit => hit.memory)).toEqual([allowed]); client.dispose();
});
it.each([
  { hits: [{ id: 'unknown', score: .9 }] }, { hits: [{ id: 'a', score: NaN }] },
  { hits: [{ id: 'a', score: .9 }, { id: 'a', score: .8 }] }, { hits: [{ id: new String('a'), score: .8 }] },
  { hits: [{ id: 'a', score: .1 }] }, { id: 0, hits: [] }, { ok: false, hits: [] },
])('rejects invalid or out-of-corpus replies and destroys the Worker: %j', async invalid => {
  const { client, worker } = setup(); worker.postMessage.mockImplementation(message => {
    queueMicrotask(() => worker.onmessage?.({ data: { v: 1, id: message.id, ok: true, ...invalid } }));
  });
  await expect(client.select([row('a')], 'astronomical observation', signal())).rejects.toThrow(); expect(worker.terminate).toHaveBeenCalledOnce();
});
it('terminates a pending request immediately on key/scope disposal and never resolves its late reply', async () => {
  const { client, worker } = setup(), controller = new AbortController(); worker.postMessage.mockImplementation(() => {});
  const pending = client.select([row('a')], 'astronomical observation', controller.signal); controller.abort(); client.dispose();
  await expect(pending).rejects.toThrow(); expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull();
});
it('commits a superseded transfer, skips cancelled queued drafts, and reuses the index for the current draft', async () => {
  const { client, worker } = setup(), first = new AbortController(), skipped = new AbortController(), rows = [row('a')];
  const realPost = worker.postMessage.getMockImplementation()!; let release: (() => void) | undefined;
  worker.postMessage.mockImplementationOnce(request => { release = () => realPost(request); });
  const pending = client.select(rows, 'astronomical observation', first.signal), rejected = expect(pending).rejects.toThrow();
  first.abort();
  const queued = client.select(rows, 'astronomical observation skipped', skipped.signal), queuedRejected = expect(queued).rejects.toThrow(); skipped.abort();
  const current = client.select(rows, 'astronomical observation current', signal());
  expect(worker.postMessage).toHaveBeenCalledOnce(); expect(worker.terminate).not.toHaveBeenCalled();
  release!(); await rejected; await queuedRejected; expect((await current)[0].memory).toBe(rows[0]);
  expect(worker.postMessage).toHaveBeenCalledTimes(2); expect(worker.postMessage.mock.calls[1][0].changed).toEqual([]);
  expect(worker.postMessage.mock.calls[1][0].order).toBeUndefined(); client.dispose();
});
it('retains the scope index between short drafts and applies deletions even when no suggestions are requested', async () => {
  const { client, worker } = setup(), rows = [row('a')];
  await client.select(rows, 'astronomical observation', signal());
  expect(await client.select(rows, '', signal())).toEqual([]);
  expect(await client.select([], 'short', signal())).toEqual([]);
  await client.select(rows, 'astronomical observation', signal());
  expect(worker.postMessage.mock.calls[2][0].order).toEqual([]);
  expect(worker.postMessage.mock.calls[3][0].changed.map(value => value.id)).toEqual(['a']);
  expect(worker.terminate).not.toHaveBeenCalled(); client.dispose();
});
it('applies a single edit in a 10,000-row snapshot without walking the source, and never sends excluded IDs', async () => {
  const { client, worker } = setup(), publisher = new IncrementalMemoryPublication<SessionData>('desc');
  let authorizationReads = 0, plaintextReads = 0;
  const rows = Array.from({ length: 10_000 }, (_, index) => {
    const value = row('large-' + index, { timestamp: index });
    Object.defineProperty(value, 'uid', { get() { authorizationReads++; return index % 2 ? 'bob' : 'alice'; } });
    Object.defineProperty(value, 'text', { get() { plaintextReads++; if (index % 2) throw Error('Denied plaintext'); return 'Synthetic astronomical observation'; } });
    return value;
  });
  publisher.apply('personal', reset(rows)); await client.select(publisher.snapshot(), 'astronomical observation', signal());
  authorizationReads = plaintextReads = 0;
  const edit = row('large-5000', { timestamp: 20_000 }); publisher.apply('personal', change(edit));
  const hits = await client.select(publisher.snapshot(), 'astronomical observation', signal());
  const request = worker.postMessage.mock.calls[1][0];
  expect(request.order).toBeUndefined(); expect(request.changed.map(value => value.id)).toEqual([edit.id]);
  expect(request.moves).toHaveLength(2); expect(authorizationReads).toBeLessThan(20); expect(plaintextReads).toBe(0);
  expect(hits[0].memory).toBe(edit);
  const denied = row('large-5000', { uid: 'bob', timestamp: 30_000 }); Object.defineProperty(denied, 'text', { get() { throw Error('Denied changed plaintext'); } });
  publisher.apply('personal', change(denied));
  await client.select(publisher.snapshot(), 'astronomical observation', signal());
  const revoked = worker.postMessage.mock.calls[2][0]; expect(revoked.changed).toEqual([]); expect(revoked.removed).toEqual([edit.id]);
  expect(revoked.moves?.filter(move => move.type === 'added')).toEqual([{ type: 'added', index: 0, id: null }]); client.dispose();
});
it('matches full authorized ranking across coalesced edits, moves, tombstones and an expired journal', async () => {
  const { client } = setup(), publisher = new IncrementalMemoryPublication<SessionData>('desc');
  let values = Array.from({ length: 35 }, (_, index) => row('fuzz-' + index, { timestamp: index, uid: index % 4 ? 'alice' : 'bob' }));
  publisher.apply('personal', reset(values)); let seed = 12345;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const verify = async () => {
    const snapshot = publisher.snapshot(), expected = searchMemories(Array.from(snapshot).filter(value => capturePreviewEligible(value, scope)), 'astronomical observation', { limit: 4, semanticFloor: .4 });
    const actual = await client.select(snapshot, 'astronomical observation', signal());
    expect(actual.map(hit => ({ id: hit.memory.id, score: hit.score }))).toEqual(expected.map(hit => ({ id: hit.memory.id, score: hit.score })));
    for (const hit of actual) expect(hit.memory).toBe(snapshot.get(hit.memory.id));
  };
  await verify();
  for (let step = 0; step < 100; step++) {
    for (let edit = 0; edit < 1 + random() % 5; edit++) {
      const index = random() % values.length, value = row(values[index].id, { timestamp: random() % 100, uid: random() % 3 ? 'alice' : 'bob', deletedAt: random() % 5 === 0 ? 1 : undefined });
      values = values.map((previous, at) => at === index ? value : previous); publisher.apply('personal', change(value));
    }
    await verify();
  }
  for (let index = 0; index < 70; index++) { values = [row('fresh-' + index, { timestamp: index }), ...values]; publisher.apply('personal', reset(values)); }
  await verify(); client.dispose();
});
it('rejects a cancelled malformed reply and retires a source fence while the Worker is pending', async () => {
  const { client, worker } = setup(), controller = new AbortController(); worker.postMessage.mockImplementation(() => {});
  const pending = client.select([row('a')], 'astronomical observation', controller.signal), rejected = expect(pending).rejects.toThrow();
  controller.abort(); worker.onmessage?.({ data: { v: 1, id: 1, ok: true, hits: [{ id: 'missing', score: .9 }] } });
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
  const publisher = new IncrementalMemoryPublication<SessionData>('desc'); publisher.apply('personal', reset([row('a')]));
  const retired = client.select(publisher.snapshot(), 'astronomical observation', signal()), retiredRejected = expect(retired).rejects.toThrow();
  publisher.clear(); worker.onmessage?.({ data: { v: 1, id: 2, ok: true, hits: [{ id: 'a', score: .9 }] } });
  await retiredRejected; expect(worker.terminate).toHaveBeenCalledTimes(2);
});
it('fails and terminates after the bounded timeout', async () => {
  vi.useFakeTimers(); const { client, worker } = setup(); worker.postMessage.mockImplementation(() => {});
  const pending = client.select([row('a')], 'astronomical observation', signal()); const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30_000); await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});
