import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HybridSearchClient } from './hybridSearchClient';
import { HybridSearchIndex } from './hybridSearchIndex';
import type { HybridSearchRequest, HybridSearchSource } from './hybridSearchProtocol';
import { HybridSearchCorpus, HYBRID_CORPUS_JOURNAL_LIMITS } from './hybridSearchCorpus';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static throwPost = false;
  index = new HybridSearchIndex();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(request: HybridSearchRequest) => void>(() => { if (FakeWorker.throwPost) throw Error('synthetic clone failure'); });
  terminate = vi.fn(() => this.index.clear());
  constructor() { FakeWorker.instances.push(this); }
  respond(transform?: (value: Record<string, unknown>) => unknown) {
    const request = this.postMessage.mock.calls.at(-1)![0];
    const result = { id: request.id, ok: true, ...this.index.handle(structuredClone(request)) };
    this.onmessage?.({ data: transform ? transform(result) : result });
  }
}
const a = { id: 'a', title: 'Orbit', text: 'Synthetic moon project' }, b = { id: 'b', title: 'Orchard', text: 'Synthetic fruit project' };
const request = { memories: [a, b], query: 'project', filters: { dateRange: 'all', tags: [] }, limit: 1 };
const signal = () => new AbortController().signal;
beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances = []; FakeWorker.throwPost = false; });

it('prepares Firestore corpus deltas without reading unchanged source records or resending the order', async () => {
  let reads = 0;
  const unchanged = new Proxy({ ...b, timestamp: 2 }, { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); } });
  const corpus = new HybridSearchCorpus(), client = new HybridSearchClient(); corpus.update([{ ...a, timestamp: 1 }, unchanged], []);
  const input = { query: 'project', filters: request.filters, corpus: corpus.capture() };
  const first = client.prepare(input, signal()), worker = FakeWorker.instances[0]; worker.respond(); await first; reads = 0;
  const edited = { ...a, timestamp: 3, text: 'Synthetic edited project', uid: 'OWNER-SENTINEL' };
  corpus.update([edited], []);
  const pending = client.prepare({ ...input, corpus: corpus.capture() }, signal());
  const sent = worker.postMessage.mock.calls.at(-1)![0];
  expect(sent).toMatchObject({ changed: [{ id: 'a', text: edited.text }], removed: [], sortByTimestamp: true });
  expect(sent).not.toHaveProperty('order', expect.any(Array)); expect(JSON.stringify(sent)).not.toContain('SENTINEL'); expect(reads).toBe(0);
  worker.respond(); const latest = await pending; expect(latest.candidateIds).toEqual(['a', 'b']);
  corpus.update([], ['b']);
  await expect(client.rank(latest, new Map(), signal())).rejects.toThrow();
  const removed = client.prepare({ ...input, corpus: corpus.capture() }, signal()); worker.respond();
  expect((await removed).candidateIds).toEqual(['a']); client.dispose();
});

it('rebuilds a new Worker after journal eviction so removed records cannot survive', async () => {
  const corpus = new HybridSearchCorpus(), client = new HybridSearchClient(); corpus.update([a, b], []);
  const input = { query: 'project', filters: request.filters, corpus: corpus.capture() };
  const first = client.prepare(input, signal()), old = FakeWorker.instances[0]; old.respond(); await first;
  corpus.update([], ['b']);
  for (let n = 0; n < HYBRID_CORPUS_JOURNAL_LIMITS.batches; n++) corpus.update([{ ...a, text: 'project ' + n }], []);
  const pending = client.prepare({ ...input, corpus: corpus.capture() }, signal()), fresh = FakeWorker.instances[1];
  expect(old.terminate).toHaveBeenCalledOnce(); fresh.respond();
  expect((await pending).candidateIds).toEqual(['a']); client.dispose();
});

it('refuses a response when its corpus changes while the Worker is computing', async () => {
  const corpus = new HybridSearchCorpus(), client = new HybridSearchClient(); corpus.update([a], []);
  const pending = client.prepare({ query: 'project', filters: request.filters, corpus: corpus.capture() }, signal());
  corpus.update([], ['a']); FakeWorker.instances[0].respond(); await expect(pending).rejects.toThrow();
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it('reuses prepared text, sends one-document deltas and strips all non-search fields before posting', async () => {
  const client = new HybridSearchClient(), locked = { id: 'locked', encLocked: true, text: 'LOCKED-SENTINEL' }, deleted = { id: 'deleted', deletedAt: 1, text: 'DELETED-SENTINEL' };
  const owner = { ...a, uid: 'OWNER-SENTINEL', teamId: 'TEAM-SENTINEL', enc: { ct: 'CIPHER-SENTINEL' }, embedding: [1, 0], nodes: [{ id: 'NODE-SENTINEL', type: 'TYPE-SENTINEL', label: 'Moon' }] };
  const memories: HybridSearchSource[] = [owner, b, locked, deleted];
  const first = client.prepare({ ...request, memories }, signal()), worker = FakeWorker.instances[0];
  const payload = worker.postMessage.mock.calls[0][0];
  expect(JSON.stringify(payload)).not.toMatch(/SENTINEL|embedding|encLocked|deletedAt/);
  expect(payload).toMatchObject({ changed: [{ id: 'a', nodes: [{ id: '', type: '', label: 'Moon' }] }, { id: 'b' }], order: ['a', 'b'] });
  worker.respond(); const lease = await first;
  expect(lease.stats.normalized).toBe(2);
  const next = client.prepare({ ...request, memories, query: 'moon' }, signal());
  expect(worker.postMessage.mock.calls[1][0]).toMatchObject({ changed: [], removed: [] });
  expect(worker.postMessage.mock.calls[1][0]).not.toHaveProperty('order', expect.any(Array));
  worker.respond(); await next;
  const update = client.prepare({ ...request, memories: [{ ...owner, text: 'New text' }], query: 'new' }, signal());
  expect(worker.postMessage.mock.calls[2][0]).toMatchObject({ changed: [{ id: 'a', text: 'New text' }], removed: ['b'], order: ['a'] });
  worker.respond(); const updated = await update;
  expect(updated.hits.map(row => row.id)).toEqual(['a']);
  const ranked = client.rank(updated, new Map([['a', .9]]), signal()); worker.respond();
  expect((await ranked)[0].semanticScore).toBe(.9);
  client.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
});

it('rejects an obsolete lease without interrupting the active query', async () => {
  const client = new HybridSearchClient(), first = client.prepare(request, signal()), worker = FakeWorker.instances[0];
  worker.respond(); const old = await first;
  const next = client.prepare({ ...request, query: 'orchard' }, signal());
  await expect(client.rank(old, new Map(), signal())).rejects.toThrow('hybrid_search_unavailable');
  expect(worker.terminate).not.toHaveBeenCalled(); worker.respond(); const current = await next;
  const rank = client.rank(current, new Map(), signal()); worker.respond();
  expect((await rank).map(row => row.id)).toEqual(['b']); client.dispose();
});

it('cancels pending work, ignores a delayed reply and rebuilds after an abort', async () => {
  const client = new HybridSearchClient(), controller = new AbortController(), first = client.prepare(request, controller.signal), worker = FakeWorker.instances[0];
  const late = worker.onmessage, rejected = expect(first).rejects.toThrow('hybrid_search_unavailable');
  controller.abort(); await rejected;
  const next = client.prepare(request, signal()), fresh = FakeWorker.instances[1];
  late?.({ data: { id: 1, ok: true, candidateIds: ['forbidden'] } });
  expect(fresh.postMessage.mock.calls[0][0]).toMatchObject({ changed: [a, b] });
  fresh.respond(); expect((await next).stats.normalized).toBe(2); client.dispose();
});

it.each(['error', 'messageerror', 'deadline', 'clone'] as const)('discards the entire corpus on %s', async kind => {
  vi.useFakeTimers(); const client = new HybridSearchClient();
  FakeWorker.throwPost = kind === 'clone';
  const promise = client.prepare(request, signal()), worker = FakeWorker.instances[0];
  const rejected = expect(promise).rejects.toThrow('hybrid_search_unavailable');
  if (kind === 'error') worker.onerror?.();
  if (kind === 'messageerror') worker.onmessageerror?.();
  if (kind === 'deadline') await vi.advanceTimersByTimeAsync(30_000);
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});

it.each(['foreign', 'duplicate', 'nan', 'stats', 'oversized', 'revision'] as const)('fails closed on a malformed %s response', async kind => {
  const client = new HybridSearchClient(), promise = client.prepare(request, signal()), worker = FakeWorker.instances[0];
  worker.respond(value => kind === 'foreign' ? { ...value, candidateIds: ['foreign'] } :
    kind === 'duplicate' ? { ...value, candidateIds: ['a', 'a'] } :
    kind === 'stats' ? { ...value, stats: {} } : kind === 'revision' ? { ...value, revision: NaN } :
    { ...value, hits: [{ id: 'a', score: kind === 'nan' ? NaN : 1, semanticScore: .9,
      matchKind: 'text', matchedTags: [], snippet: kind === 'oversized' ? 'a'.repeat(123) : '' }] });
  await expect(promise).rejects.toThrow('hybrid_search_unavailable'); expect(worker.terminate).toHaveBeenCalledOnce();
});
