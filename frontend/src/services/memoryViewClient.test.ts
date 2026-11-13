import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryViewClient } from './memoryViewClient';
import { MemoryViewWorkerMock } from '../test/memoryViewWorkerMock';
import type { MemoryObject } from '../types/universe';
import type { MemoryViewOptions } from './memoryViewProtocol';
import { IncrementalMemoryPublication } from './incrementalMemoryPublication';

const memory = (id: string, extra: Partial<MemoryObject> = {}): MemoryObject => ({ id, uid: 'synthetic-user', text: 'visible text', title: id,
  timestamp: 1, updatedAt: 1, importance: .5, celestialType: 'planet', position: [0, 0, 0], embedding: [123, 456], connections: [], ...extra });
const list = { mode: 'list', query: '', locale: 'en', limit: 100 } as const;
const signal = () => new AbortController().signal;
const messages = (worker: MemoryViewWorkerMock) => worker.postMessage.mock.calls.map(([message]) => message);
const documents = (worker: MemoryViewWorkerMock) => messages(worker).flatMap(message => message.type === 'patch-chunk' ? message.frame.changed ?? [] : []);
function corruptQuery(worker: MemoryViewWorkerMock, patch: Record<string, unknown>) {
  const normal = worker.postMessage.getMockImplementation()!;
  worker.postMessage.mockImplementation(request => {
    if (request.type !== 'query-end') { normal(request); return; }
    queueMicrotask(() => worker.onmessage?.({ data: { v: 2, id: request.id, ok: true, count: 1, ids: ['a'], ...patch } }));
  });
}
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
      const initial = documents(workers[0]);
      expect(Object.keys(initial[0]).sort()).toEqual(['connections', 'fields', 'id', 'importance', 'taxonomyLane', 'timestamp', 'updatedAt']);
      expect(JSON.stringify(initial)).not.toMatch(/synthetic-user|embedding|position|123|456|999999|987654/);
      workers[0].postMessage.mockClear();
      await client.select(rows, { ...list, limit: 1 }, signal());
      expect(messages(workers[0]).map(message => message.type)).toEqual(['query-start', 'query-end']);
      workers[0].postMessage.mockClear();
      const edited = memory('b', { text: 'edited' });
      const result = await client.select([a, edited], list, signal());
      expect(result.memories[0]).toBe(a); expect(result.memories[1]).toBe(edited);
      expect(documents(workers[0]).map(row => row.id)).toEqual(['b']);
    } finally { client.dispose(); }
  });
  it('does not send locked text and sends no search text to the scene Worker', async () => {
    const rows = [memory('locked', { text: 'SECRET-LOCKED', encLocked: true })];
    const text = fixture(), scene = fixture('scene');
    try {
      expect((await text.client.select(rows, { ...list, query: 'SECRET-LOCKED' }, signal())).count).toBe(0);
      expect(JSON.stringify(documents(text.workers[0]))).not.toContain('SECRET-LOCKED');
      await scene.client.select([memory('a', { text: 'SECRET-TEXT', title: 'SECRET-TITLE' })],
        { mode: 'scene', activeId: null, filteredIds: null, taxonomy: null }, signal());
      expect(JSON.stringify(messages(scene.workers[0]))).not.toMatch(/SECRET-|visible text/);
    } finally { text.client.dispose(); scene.client.dispose(); }
  });
  it('prepares large arrays in bounded tasks while projecting only changed objects', async () => {
    const { client, workers, yieldTask } = fixture(), rows = Array.from({ length: 10000 }, (_, i) => memory('m' + i));
    try {
      await client.select(rows, list, signal()); expect(yieldTask.mock.calls.length).toBeGreaterThan(39);
      expect(documents(workers[0])).toHaveLength(10000);
      const frames = messages(workers[0]).flatMap(message => message.type === 'patch-chunk' ? Object.values(message.frame).map(rows => rows!.length) : []);
      expect(Math.max(...frames)).toBe(128);
      yieldTask.mockClear(); workers[0].postMessage.mockClear(); await client.select([...rows.slice(0, -1), memory('m9999', { timestamp: 2 })], list, signal());
      expect(yieldTask).toHaveBeenCalled();
      expect(documents(workers[0])).toHaveLength(1);
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
      expect(documents(workers[1]).map(row => row.id)).toEqual(['b']);
    } finally { client.dispose(); }
  });
  it('retires a pending request and ignores a late reply after abort', async () => {
    const worker = new MemoryViewWorkerMock(); worker.postMessage.mockImplementation(() => undefined);
    const client = new MemoryViewClient('list', { createWorker: () => worker as unknown as Worker });
    const controller = new AbortController(), job = client.select([memory('a')], list, controller.signal);
    const rejection = expect(job).rejects.toThrow('memory_view_unavailable');
    controller.abort(); worker.onmessage?.({ data: { v: 2, id: 1, ok: true, ack: true } });
    await rejection; expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each([
    { ids: ['foreign'] }, { ids: [new String('a')] }, { ids: ['a', 'a'], count: 2 },
    { count: -1 }, { v: 3 }, { ok: false }, { ids: [] }, { id: 999 },
  ])('rejects malformed or out-of-scope responses %#', async patch => {
    const worker = new MemoryViewWorkerMock();
    corruptQuery(worker, patch);
    const client = new MemoryViewClient('list', { createWorker: () => worker as unknown as Worker });
    await expect(client.select([memory('a')], list, signal())).rejects.toThrow('memory_view_unavailable');
    expect(worker.terminate).toHaveBeenCalled();
  });
  it('rejects scene IDs outside the current filters even if present in the local corpus', async () => {
    const worker = new MemoryViewWorkerMock();
    corruptQuery(worker, {});
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
  it('applies one published snapshot delta without enumerating the vault or reading unchanged text', async () => {
    const f = fixture(), publisher = new IncrementalMemoryPublication<MemoryObject>('asc'); let forbidden = false, reads = 0;
    const rows = Array.from({ length: 10000 }, (_, index) => Object.defineProperty(memory('m' + index), 'text', { get() { reads++; if (forbidden) throw Error('Historical text read'); return 'Synthetic'; } }));
    publisher.apply('personal', { changed: rows.map(value => ({ id: value.id, value })), removed: [], order: { reset: rows.map(row => row.id), changes: [] } });
    try {
      const before = publisher.snapshot(), initial = await f.client.select(before, list, signal()); expect(initial.count).toBe(10000); expect(reads).toBe(10000);
      forbidden = true; const edited = memory('m0', { text: 'Changed', timestamp: 2 }); publisher.apply('personal', { changed: [{ id: edited.id, value: edited }], removed: [], order: { changes: [] } });
      const iteration = vi.spyOn(Object.getPrototypeOf(before), Symbol.iterator).mockImplementation(() => { throw Error('Enumerated published vault'); });
      try {
        f.workers[0].postMessage.mockClear(); const result = await f.client.select(publisher.snapshot(), list, signal());
        expect(result.count).toBe(10000); expect(result.memories[0]).toBe(edited); expect(result.lookup.get('m9999')).toBe(rows[9999]);
        expect(documents(f.workers[0]).map(row => row.id)).toEqual(['m0']); expect(iteration).not.toHaveBeenCalled(); expect(reads).toBe(10000);
        expect(messages(f.workers[0])[0]).toMatchObject({ type: 'patch-start', reset: false, counts: { changed: 1, order: 0, moves: 2 } });
      } finally { iteration.mockRestore(); }
    } finally { f.client.dispose(); publisher.clear(); }
  }, 15000);
  it('streams filter IDs once and reuses their membership set across published changes', async () => {
    const f = fixture('scene'), rows = Array.from({ length: 1000 }, (_, index) => memory('m' + index)), filteredIds = rows.slice(500).map(row => row.id);
    const options = { mode: 'scene', activeId: null, taxonomy: null, filteredIds } as const;
    try {
      expect((await f.client.select(rows, options, signal())).count).toBe(500);
      const chunks = messages(f.workers[0]).filter(message => message.type === 'filter-chunk'); expect(chunks).toHaveLength(4);
      expect(messages(f.workers[0]).find(message => message.type === 'query-start')).toMatchObject({ options: { filteredIds: null }, filteredCount: 500 });
      f.workers[0].postMessage.mockClear(); expect((await f.client.select(rows, options, signal())).count).toBe(500);
      expect(messages(f.workers[0]).map(message => message.type)).toEqual(['query-start', 'query-end']);
      expect(messages(f.workers[0])[0]).toMatchObject({ reuseFilter: true });
    } finally { f.client.dispose(); }
  });
  it('withdraws keyed lookup and suspended iteration on retirement and never reads locked title/text', async () => {
    const f = fixture(), locked = Object.defineProperties(memory('locked', { encLocked: true }), { title: { get() { throw Error('Locked title'); } }, text: { get() { throw Error('Locked text'); } } });
    const result = await f.client.select([memory('a'), locked], list, signal()), iterator = result.lookup.entries(); expect(iterator.next().done).toBe(false);
    f.client.dispose(); expect(result.lookup.size).toBe(0); expect(result.lookup.get('locked')).toBeUndefined(); expect(iterator.next().done).toBe(true);
  });
  it('withdraws the previous lookup synchronously when a new source is pending', async () => {
    const f = fixture();
    try {
      const old = await f.client.select([memory('old')], list, signal());
      const next = f.client.select([memory('new')], list, signal());
      expect(old.lookup.size).toBe(0); expect(old.lookup.get('old')).toBeUndefined();
      expect((await next).lookup.get('new')?.id).toBe('new');
    } finally { f.client.dispose(); }
  });
  it('rebuilds from current roots after journal eviction instead of replaying unavailable history', async () => {
    const f = fixture(), publisher = new IncrementalMemoryPublication<MemoryObject>('asc'), value = memory('one');
    publisher.apply('personal', { changed: [{ id: value.id, value }], removed: [], order: { reset: [value.id], changes: [] } });
    try {
      await f.client.select(publisher.snapshot(), list, signal());
      for (let revision = 0; revision < 70; revision++) publisher.apply('personal', { changed: [{ id: value.id, value: memory(value.id, { text: 'Revision ' + revision }) }], removed: [], order: { changes: [] } });
      f.workers[0].postMessage.mockClear(); const selected = await f.client.select(publisher.snapshot(), { ...list, query: 'Revision 69' }, signal());
      expect(selected.count).toBe(1); expect(selected.memories[0].text).toBe('Revision 69');
      expect(messages(f.workers[0])[0]).toMatchObject({ type: 'patch-start', reset: true, preserve: false });
      expect(documents(f.workers[0])).toHaveLength(1);
    } finally { f.client.dispose(); publisher.clear(); }
  });
  it('holds at one outstanding frame and ignores its late ACK after a replacement Worker has completed', async () => {
    const controller = new AbortController();
    const oldWorker = new MemoryViewWorkerMock(), normal = oldWorker.postMessage.getMockImplementation()!; let held: { id: number } | undefined;
    oldWorker.postMessage.mockImplementation(message => { if (message.type === 'patch-chunk') { oldWorker.index.handle(structuredClone(message)); held = message; } else normal(message); });
    const freshWorker = new MemoryViewWorkerMock(); let created = 0;
    const client = new MemoryViewClient('list', { createWorker: () => (created++ ? freshWorker : oldWorker) as unknown as Worker, yieldTask: async () => undefined });
    try {
      const pending = client.select(Array.from({ length: 1000 }, (_, i) => memory('old' + i)), list, controller.signal), rejected = expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(held).toBeDefined()); expect(oldWorker.postMessage).toHaveBeenCalledTimes(2);
      controller.abort(); await rejected;
      const current = await client.select([memory('current')], list, signal());
      oldWorker.onmessage?.({ data: { v: 2, id: held!.id, ok: true, ack: true } });
      expect(current.memories[0].id).toBe('current'); expect(freshWorker.terminate).not.toHaveBeenCalled();
    } finally { client.dispose(); }
  });
  it('preserves long searchable fields while isolating large records into separate transfer frames', async () => {
    const f = fixture(), long = 'x'.repeat(80000) + ' searchable-tail';
    try {
      const rows = [memory('large-a', { text: long }), memory('large-b', { text: long }), memory('small')];
      expect((await f.client.select(rows, { ...list, query: 'searchable-tail' }, signal())).count).toBe(2);
      const chunks = messages(f.workers[0]).flatMap(message => message.type === 'patch-chunk' && message.frame.changed ? [message.frame.changed] : []);
      expect(chunks.map(chunk => chunk.length)).toEqual([1, 1, 1]);
      expect(documents(f.workers[0])[0].fields).toContain(long);
    } finally { f.client.dispose(); }
  });
  it('matches full stable list sorting through randomized published additions, edits, removals and source moves', async () => {
    const f = fixture(), publisher = new IncrementalMemoryPublication<MemoryObject>('asc'), rows = new Map<string, MemoryObject>(); let seed = 1481, serial = 100;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % max; }, operations = new Set<number>();
    const order = Array.from({ length: 100 }, (_, i) => { const row = memory('r' + i, { text: 'word' + i % 3, timestamp: i % 5 }); rows.set(row.id, row); return row.id; });
    publisher.apply('personal', { changed: [...rows.values()].map(value => ({ id: value.id, value })), removed: [], order: { reset: order, changes: [] } });
    try {
      await f.client.select(publisher.snapshot(), list, signal());
      for (let step = 0; step < 120; step++) {
        const at = random(order.length), id = order[at], operation = random(4);
        operations.add(operation);
        if (operation === 0) {
          const value = memory('r' + serial++, { text: 'word' + random(3), timestamp: random(5) }), target = random(order.length + 1); rows.set(value.id, value); order.splice(target, 0, value.id);
          publisher.apply('personal', { changed: [{ id: value.id, value }], removed: [], order: { changes: [{ id: value.id, type: 'added', oldIndex: -1, newIndex: target }] } });
        } else if (operation === 1 && order.length > 5) {
          order.splice(at, 1); rows.delete(id); publisher.apply('personal', { changed: [], removed: [id], order: { changes: [{ id, type: 'removed', oldIndex: at, newIndex: -1 }] } });
        } else if (operation === 2) {
          const target = random(order.length); order.splice(at, 1); order.splice(target, 0, id);
          publisher.apply('personal', { changed: [], removed: [], order: { changes: [{ id, type: 'modified', oldIndex: at, newIndex: target }] } });
        } else {
          const value = memory(id, { text: 'word' + random(3), timestamp: random(5) }); rows.set(id, value);
          publisher.apply('personal', { changed: [{ id, value }], removed: [], order: { changes: [] } });
        }
        const query = 'word' + random(3), limit = 1 + random(20), expected = order.map(id => rows.get(id)!).filter(row => row.text.includes(query)).sort((a, b) => b.timestamp - a.timestamp);
        const actual = await f.client.select(publisher.snapshot(), { ...list, query, limit }, signal());
        expect(actual.count).toBe(expected.length); expect(actual.memories.map(row => row.id)).toEqual(expected.slice(0, limit).map(row => row.id));
      }
      expect(operations.size).toBe(4);
    } finally { f.client.dispose(); publisher.clear(); }
  });
});
