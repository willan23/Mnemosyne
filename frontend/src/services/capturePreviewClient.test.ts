import { afterEach, expect, it, vi } from 'vitest';
import { CapturePreviewClient } from './capturePreviewClient';
import { CapturePreviewWorkerMock } from '../test/capturePreviewWorkerMock';
import type { SessionData } from '../hooks/useSessions';
const row = (id: string, more: Partial<SessionData> = {}): SessionData => ({ id, uid: 'alice', text: 'Synthetic astronomical observation', timestamp: 1, updatedAt: 1, ...more });
const scope = { key: 'alice-personal', uid: 'alice' }, signal = () => new AbortController().signal;
const setup = () => { const worker = new CapturePreviewWorkerMock(); return { worker, client: new CapturePreviewClient(scope, { createWorker: () => worker, yieldTask: async () => {} }) }; };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('checks ACL before projecting plaintext, excludes shared/team/locked/deleted/foreign records and sends no vectors', async () => {
  const { worker, client } = setup();
  const excluded = [{ uid: 'bob' }, { teamId: 'team' }, { teamScopeAmbiguous: true }, { sharedWithIds: ['other'] }, { encLocked: true }, { deletedAt: 1 }].map((fields, i) => {
    const value = row('denied' + i, fields); Object.defineProperty(value, 'text', { get() { throw Error('Denied plaintext read'); } }); return value;
  });
  const allowed = row('a', { embedding: [1, 2, 3] });
  expect((await client.select([...excluded, allowed], 'astronomical observation', signal()))[0].memory).toBe(allowed);
  const message = worker.postMessage.mock.calls[0][0];
  expect(message.order).toEqual(['a']); expect(message.changed.map(row => row.id)).toEqual(['a']);
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
it('terminates a pending request on abort and never resolves its late reply', async () => {
  const { client, worker } = setup(), controller = new AbortController(); worker.postMessage.mockImplementation(() => {});
  const pending = client.select([row('a')], 'astronomical observation', controller.signal); controller.abort();
  await expect(pending).rejects.toThrow(); expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull();
});
it('fails and terminates after the bounded timeout', async () => {
  vi.useFakeTimers(); const { client, worker } = setup(); worker.postMessage.mockImplementation(() => {});
  const pending = client.select([row('a')], 'astronomical observation', signal()); const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30_000); await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});
