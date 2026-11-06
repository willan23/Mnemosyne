import { afterEach, expect, it, vi } from 'vitest';
import { IncrementalSearchClient } from './incrementalSearchClient';
import { IncrementalSearchIndex } from './incrementalSearchIndex';
import { LEGACY_EMBEDDING_SPACE } from './embeddingModel';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  respond() {
    const request = this.postMessage.mock.calls.at(-1)![0];
    this.onmessage?.({ data: { id: request.id, ok: true, scores: [['a', 1]] } });
  }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances = []; });
const a = { id: 'a', embedding: [1, 0] };
const b = { id: 'b', embedding: [0, 1] };
const request = { candidates: [a, b], query: [1, 0], embeddingModel: LEGACY_EMBEDDING_SPACE, floor: 0.38 };

it('reuses unchanged vectors and sends removals and replacements before ranking', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new IncrementalSearchClient();
  const signal = new AbortController().signal;
  const first = client.rank(request, signal);
  const worker = FakeWorker.instances[0];
  worker.respond();
  await first;
  const second = client.rank({ ...request, candidates: [a], query: [0, 1] }, signal);
  expect(worker.postMessage.mock.calls[1][0]).toMatchObject({ changed: [], removed: ['b'] });
  worker.respond();
  await second;
  const third = client.rank({ ...request, candidates: [{ ...a, embedding: [0, 1] }] }, signal);
  expect(worker.postMessage.mock.calls[2][0].changed).toEqual([{ id: 'a', embedding: [0, 1] }]);
  worker.respond();
  await third;
  expect(FakeWorker.instances).toHaveLength(1);
  client.dispose();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('discards the entire index on abort, ignores late replies and rebuilds on retry', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new IncrementalSearchClient();
  const controller = new AbortController();
  const first = client.rank(request, controller.signal);
  const worker = FakeWorker.instances[0];
  const lateReply = worker.onmessage;
  const rejection = expect(first).rejects.toThrow();
  controller.abort();
  await rejection;
  lateReply?.({ data: { id: 1, ok: true, scores: [['old', 1]] } });
  const next = client.rank(request, new AbortController().signal);
  expect(FakeWorker.instances[1].postMessage.mock.calls[0][0].changed).toEqual([a, b]);
  FakeWorker.instances[1].respond();
  await next;
  client.dispose();
});

it('terminates an unresponsive index at the deadline', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  const client = new IncrementalSearchClient();
  const rejected = expect(client.rank(request, new AbortController().signal)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it('incremental index never returns a removed memory and replaces old vectors', () => {
  const index = new IncrementalSearchIndex();
  const query = { id: 1, changed: [a, b], removed: [], query: [1, 0], embeddingModel: LEGACY_EMBEDDING_SPACE, floor: 0.38 };
  expect(index.search(query)).toEqual([['a', 1]]);
  expect(index.search({ ...query, changed: [], removed: ['a'] })).toEqual([]);
  expect(index.search({ ...query, changed: [{ ...b, embedding: [1, 0] }], removed: [] })).toEqual([['b', 1]]);
});
