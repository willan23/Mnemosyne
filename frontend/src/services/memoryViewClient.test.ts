import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryViewClient } from './memoryViewClient';
import { MemoryViewWorkerMock } from '../test/memoryViewWorkerMock';
import type { MemoryObject } from '../types/universe';
import type { MemoryViewOptions } from './memoryViewProtocol';

const memory = (id: string, extra: Partial<MemoryObject> = {}): MemoryObject => ({ id, uid: 'synthetic-user', text: 'visible text', title: id,
  timestamp: 1, updatedAt: 1, importance: .5, celestialType: 'planet', position: [0, 0, 0], embedding: [123, 456], connections: [], ...extra });
const list = { mode: 'list', query: '', locale: 'en', limit: 100 } as const;
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());
const fixture = (mode: MemoryViewOptions['mode'] = 'list') => {
  const workers: MemoryViewWorkerMock[] = [], yieldTask = vi.fn(async () => undefined);
  const client = new MemoryViewClient(mode, { yieldTask, createWorker: () => { const worker = new MemoryViewWorkerMock(); workers.push(worker); return worker as unknown as Worker; } });
  return { client, workers, yieldTask };
};
describe('memory view client', () => {
  it('sends only changed projections and reuses the corpus for a new query/page', async () => {
    const { client, workers } = fixture(), a = memory('a', { updatedAt: 999999, importance: 987654 }), b = memory('b'), rows = [a, b];
    try {
      const first = await client.select(rows, list, signal()); expect(first.memories).toEqual(rows);
      const initial = workers[0].postMessage.mock.calls[0][0];
      expect(Object.keys(initial.changed[0]).sort()).toEqual(['connections', 'fields', 'id', 'importance', 'taxonomyLane', 'timestamp', 'updatedAt']);
      expect(JSON.stringify(initial)).not.toMatch(/synthetic-user|embedding|position|123|456|999999|987654/);
      await client.select(rows, { ...list, limit: 1 }, signal());
      expect(workers[0].postMessage.mock.calls[1][0]).toMatchObject({ changed: [] });
      expect(workers[0].postMessage.mock.calls[1][0]).not.toHaveProperty('order');
      const edited = memory('b', { text: 'edited' });
      const result = await client.select([a, edited], list, signal());
      expect(result.memories[0]).toBe(a); expect(result.memories[1]).toBe(edited);
      expect(workers[0].postMessage.mock.calls[2][0].changed.map(row => row.id)).toEqual(['b']);
    } finally { client.dispose(); }
  });
  it('does not send locked text and sends no search text to the scene Worker', async () => {
    const rows = [memory('locked', { text: 'SECRET-LOCKED', encLocked: true })];
    const text = fixture(), scene = fixture('scene');
    try {
      expect((await text.client.select(rows, { ...list, query: 'SECRET-LOCKED' }, signal())).count).toBe(0);
      expect(JSON.stringify(text.workers[0].postMessage.mock.calls[0][0].changed)).not.toContain('SECRET-LOCKED');
      await scene.client.select([memory('a', { text: 'SECRET-TEXT', title: 'SECRET-TITLE' })],
        { mode: 'scene', activeId: null, filteredIds: null, taxonomy: null }, signal());
      expect(JSON.stringify(scene.workers[0].postMessage.mock.calls[0][0])).not.toMatch(/SECRET-|visible text/);
    } finally { text.client.dispose(); scene.client.dispose(); }
  });
  it('prepares large arrays in bounded tasks while projecting only changed objects', async () => {
    const { client, workers, yieldTask } = fixture(), rows = Array.from({ length: 10000 }, (_, i) => memory('m' + i));
    try {
      await client.select(rows, list, signal()); expect(yieldTask).toHaveBeenCalledTimes(39);
      yieldTask.mockClear(); await client.select([...rows.slice(0, -1), memory('m9999', { timestamp: 2 })], list, signal());
      expect(yieldTask).toHaveBeenCalledTimes(39);
      expect(workers[0].postMessage.mock.calls[1][0].changed).toHaveLength(1);
    } finally { client.dispose(); }
  });
  it('cancels during projection without creating or sending to a Worker', async () => {
    const controller = new AbortController(), createWorker = vi.fn();
    const client = new MemoryViewClient('list', { createWorker, yieldTask: async () => { controller.abort(); } });
    await expect(client.select(Array.from({ length: 300 }, (_, i) => memory('m' + i)), list, controller.signal)).rejects.toThrow('memory_view_unavailable');
    expect(createWorker).not.toHaveBeenCalled();
  });
  it('terminates and clears cached references on an empty scope, then rebuilds', async () => {
    const { client, workers } = fixture();
    try {
      const first = await client.select([memory('a')], list, signal());
      expect((await client.select([], list, signal())).memories).toEqual([]);
      expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(first.lookup.size).toBe(0);
      await client.select([memory('b')], list, signal()); expect(workers).toHaveLength(2);
      expect(workers[1].postMessage.mock.calls[0][0].order).toEqual(['b']);
    } finally { client.dispose(); }
  });
  it('retires a pending request and ignores a late reply after abort', async () => {
    const worker = new MemoryViewWorkerMock(); worker.postMessage.mockImplementation(() => undefined);
    const client = new MemoryViewClient('list', { createWorker: () => worker as unknown as Worker });
    const controller = new AbortController(), job = client.select([memory('a')], list, controller.signal);
    const rejection = expect(job).rejects.toThrow('memory_view_unavailable');
    controller.abort(); worker.onmessage?.({ data: { v: 1, id: 1, ok: true, count: 1, ids: ['a'] } });
    await rejection; expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each([
    { ids: ['foreign'] }, { ids: [new String('a')] }, { ids: ['a', 'a'], count: 2 },
    { count: -1 }, { v: 2 }, { ok: false }, { ids: [] }, { id: 999 },
  ])('rejects malformed or out-of-scope responses %#', async patch => {
    const worker = new MemoryViewWorkerMock();
    worker.postMessage.mockImplementation(request => queueMicrotask(() => worker.onmessage?.({ data: { v: 1, id: request.id, ok: true, count: 1, ids: ['a'], ...patch } })));
    const client = new MemoryViewClient('list', { createWorker: () => worker as unknown as Worker });
    await expect(client.select([memory('a')], list, signal())).rejects.toThrow('memory_view_unavailable');
    expect(worker.terminate).toHaveBeenCalled();
  });
  it('rejects scene IDs outside the current filters even if present in the local corpus', async () => {
    const worker = new MemoryViewWorkerMock();
    worker.postMessage.mockImplementation(request => queueMicrotask(() => worker.onmessage?.({ data: { v: 1, id: request.id, ok: true, count: 1, ids: ['a'] } })));
    const client = new MemoryViewClient('scene', { createWorker: () => worker as unknown as Worker });
    await expect(client.select([memory('a'), memory('b')], { mode: 'scene', activeId: null, filteredIds: ['b'], taxonomy: null }, signal())).rejects.toThrow();
    expect(worker.terminate).toHaveBeenCalled();
  });
  it('fails closed when the Worker does not reply within the deadline', async () => {
    vi.useFakeTimers(); const worker = new MemoryViewWorkerMock(); worker.postMessage.mockImplementation(() => undefined);
    const client = new MemoryViewClient('list', { createWorker: () => worker as unknown as Worker });
    const rejection = expect(client.select([memory('a')], list, signal())).rejects.toThrow('memory_view_unavailable');
    await vi.advanceTimersByTimeAsync(30_000); await rejection; expect(worker.terminate).toHaveBeenCalled();
  });
});
