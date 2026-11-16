import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HybridSearchClient, type HybridSearchInput } from './hybridSearchClient';
import { HybridSearchCorpus } from './hybridSearchCorpus';
import { HybridSearchIndex } from './hybridSearchIndex';
import { SEARCH_CONTEXT_POLICY, type HybridContextResult,
  type HybridPreparedResult, type HybridSearchRequest, type HybridSearchSource } from './hybridSearchProtocol';

type ContextReply = HybridContextResult & { id: number; ok: true };
class FakeWorker {
  static instances: FakeWorker[] = [];
  index = new HybridSearchIndex();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(request: HybridSearchRequest) => void>();
  terminate = vi.fn(() => this.index.clear());
  constructor() { FakeWorker.instances.push(this); }
  answer() {
    const request = this.postMessage.mock.calls.at(-1)![0];
    return { id: request.id, ok: true, ...this.index.handle(structuredClone(request)) };
  }
  respond(transform?: (value: ContextReply) => unknown) {
    const answer = this.answer();
    this.onmessage?.({ data: transform ? transform(answer as ContextReply) : answer });
  }
}

const memories: HybridSearchSource[] = [
  { id: 'lead', title: 'Aurora launch', text: 'Marta coordinates the mission.', nodes: [{ id: 'marta', type: 'person', label: 'Marta' }] },
  { id: 'backup', title: 'Backup launch', text: 'Nuno prepares the schedule.', nodes: [{ id: 'nuno', type: 'person', label: 'Nuno' }] },
  { id: 'city', title: 'Office', text: 'Marta works in Coimbra.', nodes: [{ id: 'marta', type: 'person', label: 'Marta' }] },
  { id: 'harbor', title: 'Ferry', text: 'Nuno waits in Aveiro.', nodes: [{ id: 'nuno', type: 'person', label: 'Nuno' }] },
  { id: 'garden', title: 'Orchard', text: 'Peaches grow beside the fence.' },
  ...Array.from({ length: 20 }, (_, index) => ({ id: 'filler' + index, text: 'A synthetic unrelated passage.' })),
];
const input: HybridSearchInput = { memories, query: 'launch', filters: { dateRange: 'all', tags: [] }, limit: 2 };
const signal = () => new AbortController().signal;
const clients = new Set<HybridSearchClient>();
const makeClient = () => { const client = new HybridSearchClient(); clients.add(client); return client; };
async function prepare(client = makeClient(), request = input) {
  const pending = client.prepare(request, signal()), worker = FakeWorker.instances.at(-1)!;
  worker.respond();
  return { client, worker, lease: await pending };
}
beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
afterEach(() => {
  for (const client of clients) client.dispose();
  clients.clear(); FakeWorker.instances = []; vi.unstubAllGlobals(); vi.useRealTimers();
});

it('returns bounded context candidates without changing the prepared or subsequent displayed ranking', async () => {
  const { client, worker, lease } = await prepare(), before = structuredClone(lease.hits);
  expect(before.map(hit => hit.id)).toEqual(['lead', 'backup']);
  const pending = client.context(lease, signal()); worker.respond(); const context = await pending;
  expect(context.revision).toBe(lease.revision);
  expect(context.candidates).toEqual([
    { id: 'lead', kind: 'seed', matchedKeys: 0 },
    { id: 'backup', kind: 'seed', matchedKeys: 0 },
    { id: 'city', kind: 'entity-context', matchedKeys: 1, viaSeedId: 'lead' },
    { id: 'harbor', kind: 'entity-context', matchedKeys: 1, viaSeedId: 'backup' },
  ]);
  expect(context.stats).toMatchObject({ seeds: 2, expanded: 2 });
  expect(lease.hits).toEqual(before);
  const ranked = client.rank(lease, new Map(), signal()); worker.respond(); expect(await ranked).toEqual(before);
});

it('posts only protocol version, type, request id and revision for context', async () => {
  const { client, worker, lease } = await prepare(), pending = client.context(lease, signal());
  const payload = worker.postMessage.mock.calls.at(-1)![0];
  expect(Object.keys(payload).sort()).toEqual(['id', 'revision', 'type', 'v']);
  expect(payload).toEqual({ v: 1, type: 'context', id: expect.any(Number), revision: lease.revision });
  expect(JSON.stringify(payload)).not.toMatch(/Marta|launch|"candidateIds"|"seeds"|"scores"|"text"|"query"/);
  worker.respond(); await pending;
});

const malformedCandidates = ['foreign', 'duplicate', 'oversized', 'unknownkind', 'extra text', 'danglingvia',
  'wrongseed', 'missingseed', 'zero matchedKeys', 'oversized matchedKeys', 'false strong', 'false retained'] as const;
it.each(malformedCandidates)('rejects a malformed %s context response and discards its Worker', async kind => {
  const { client, worker, lease } = await prepare(), pending = client.context(lease, signal());
  const rejected = expect(pending).rejects.toThrow('hybrid_search_unavailable');
  worker.respond(value => {
    const candidates = value.candidates.map(row => ({ ...row }));
    const neighbor = candidates.findIndex(row => row.kind === 'entity-context');
    if (kind === 'foreign') candidates[neighbor].id = 'foreign';
    if (kind === 'duplicate') candidates[neighbor].id = candidates[0].id;
    if (kind === 'oversized') return { ...value, candidates: [
      ...candidates.slice(0, 2), ...Array.from({ length: SEARCH_CONTEXT_POLICY.candidates - 1 }, (_, index) =>
        ({ id: 'filler' + index, kind: 'term-context', matchedKeys: 1, viaSeedId: 'lead' })),
    ], stats: { ...value.stats, expanded: SEARCH_CONTEXT_POLICY.candidates - 1 } };
    if (kind === 'unknownkind') return { ...value, candidates: candidates.map((row, index) => index === neighbor ? { ...row, kind: 'unrecognized' } : row) };
    if (kind === 'extra text') return { ...value, candidates: candidates.map((row, index) => index === neighbor ? { ...row, text: 'UNEXPECTED-PASSAGE' } : row) };
    if (kind === 'danglingvia') candidates[neighbor].viaSeedId = 'garden';
    if (kind === 'wrongseed') [candidates[0], candidates[1]] = [candidates[1], candidates[0]];
    if (kind === 'missingseed') candidates.splice(1, 1);
    if (kind === 'zero matchedKeys') candidates[neighbor].matchedKeys = 0;
    if (kind === 'oversized matchedKeys') candidates[neighbor].matchedKeys = SEARCH_CONTEXT_POLICY.seeds * SEARCH_CONTEXT_POLICY.anchorsPerSeed + 1;
    if (kind === 'false strong' || kind === 'false retained') candidates[neighbor] = { id: 'city', kind: kind === 'false strong' ? 'strong' : 'retained', matchedKeys: 0 };
    return { ...value, candidates };
  });
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});

it('rejects a boxed String kind that would falsely label an eligible neighbor as strong', async () => {
  const { client, worker, lease } = await prepare(), pending = client.context(lease, signal());
  const rejected = expect(pending).rejects.toThrow('hybrid_search_unavailable');
  worker.respond(value => ({
    ...value,
    candidates: value.candidates.map(row => row.id === 'city'
      ? { id: row.id, kind: structuredClone(Object('strong')), matchedKeys: 0 } : row),
    stats: { ...value.stats, expanded: value.stats.expanded - 1 },
  }));
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});

it('rejects a boxed String matchKind in prepared hits instead of accepting its string conversion', async () => {
  const client = makeClient(), pending = client.prepare(input, signal()), worker = FakeWorker.instances.at(-1)!;
  const rejected = expect(pending).rejects.toThrow('hybrid_search_unavailable');
  worker.respond(value => {
    const prepared = value as unknown as HybridPreparedResult;
    return { ...value, hits: prepared.hits.map(hit => ({ ...hit, matchKind: structuredClone(Object(hit.matchKind)) })) };
  });
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});

it.each(['extra top-level text', 'revision', 'stats array', 'stats missing', 'stats extra', 'stats seeds',
  'stats anchors', 'stats postingVisits', 'stats skippedBroad', 'stats expanded', 'stats fractional', 'stats nonfinite',
  'stats negative', 'stats visits without anchors', 'stats visits beyond anchors', 'stats insufficient visits', 'stats matchedKeys beyond anchors'] as const)('rejects malformed %s metadata', async kind => {
  const { client, worker, lease } = await prepare(), pending = client.context(lease, signal());
  const rejected = expect(pending).rejects.toThrow('hybrid_search_unavailable');
  worker.respond(value => {
    if (kind === 'extra top-level text') return { ...value, text: 'UNEXPECTED-PASSAGE' };
    if (kind === 'revision') return { ...value, revision: value.revision + 1 };
    if (kind === 'stats array') return { ...value, stats: [] };
    if (kind === 'stats missing') { const stats: Partial<HybridContextResult['stats']> = { ...value.stats }; delete stats.anchors; return { ...value, stats }; }
    if (kind === 'stats extra') return { ...value, stats: { ...value.stats, text: 'UNEXPECTED-PASSAGE' } };
    const stats = { ...value.stats };
    if (kind === 'stats seeds') stats.seeds++;
    if (kind === 'stats anchors') stats.anchors = stats.seeds * SEARCH_CONTEXT_POLICY.anchorsPerSeed + 1;
    if (kind === 'stats postingVisits') stats.postingVisits = 8192 * 2 + 1;
    if (kind === 'stats skippedBroad') stats.skippedBroad = stats.anchors * SEARCH_CONTEXT_POLICY.postingSources + 1;
    if (kind === 'stats expanded') stats.expanded++;
    if (kind === 'stats fractional') stats.anchors = 1.5;
    if (kind === 'stats nonfinite') stats.postingVisits = NaN;
    if (kind === 'stats negative') stats.skippedBroad = -1;
    if (kind === 'stats visits without anchors') { stats.anchors = 0; stats.postingVisits = 1; stats.skippedBroad = 0; }
    if (kind === 'stats visits beyond anchors') { stats.anchors = 1; stats.postingVisits = SEARCH_CONTEXT_POLICY.postingLimit * SEARCH_CONTEXT_POLICY.postingSources + 1; stats.skippedBroad = 0; }
    if (kind === 'stats insufficient visits') stats.postingVisits = 1;
    if (kind === 'stats matchedKeys beyond anchors') return { ...value, candidates: value.candidates.map(row => row.kind === 'entity-context' ? { ...row, matchedKeys: 2 } : row), stats: { ...stats, anchors: 1, skippedBroad: 0 } };
    return { ...value, stats };
  });
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});

it('accepts the two posting sources budget of 8192 * 2 inclusively', async () => {
  expect(SEARCH_CONTEXT_POLICY.postingSources).toBe(2);
  expect(SEARCH_CONTEXT_POLICY.seeds * SEARCH_CONTEXT_POLICY.anchorsPerSeed * SEARCH_CONTEXT_POLICY.postingLimit * SEARCH_CONTEXT_POLICY.postingSources).toBe(8192 * 2);
  const budgetInput = { ...input, memories: [...memories, { id: 'third', title: 'Third launch' }, { id: 'fourth', title: 'Fourth launch' }], limit: 4 };
  const { client, worker, lease } = await prepare(makeClient(), budgetInput), pending = client.context(lease, signal());
  worker.respond(value => ({ ...value, stats: { ...value.stats, anchors: 32, postingVisits: 8192 * 2, skippedBroad: 0 } }));
  expect((await pending).stats).toMatchObject({ seeds: 4, anchors: 32, postingVisits: 16384, skippedBroad: 0 });
  expect(worker.terminate).not.toHaveBeenCalled();
  const overBudget = client.context(lease, signal()), rejected = expect(overBudget).rejects.toThrow('hybrid_search_unavailable');
  worker.respond(value => ({ ...value, stats: { ...value.stats, anchors: 32, postingVisits: 8192 * 2 + 1, skippedBroad: 0 } }));
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});

it('rejects impossible nonzero context statistics when there are no seeds', async () => {
  const { client, worker, lease } = await prepare(makeClient(), { ...input, query: 'unmatchedterm' });
  expect(lease.hits).toEqual([]);
  const pending = client.context(lease, signal()), rejected = expect(pending).rejects.toThrow('hybrid_search_unavailable');
  worker.respond(value => ({ ...value, stats: { ...value.stats, anchors: 1, postingVisits: 1 } }));
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});

it.each(['abort', 'dispose'] as const)('rejects context on %s and ignores a delayed response while a new query completes', async kind => {
  const { client, worker, lease } = await prepare(), controller = new AbortController();
  const pending = client.context(lease, controller.signal), late = worker.onmessage, answer = worker.answer();
  const rejected = expect(pending).rejects.toThrow('hybrid_search_unavailable');
  if (kind === 'abort') controller.abort(); else client.dispose();
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
  const next = client.prepare(input, signal()), fresh = FakeWorker.instances.at(-1)!;
  expect(fresh).not.toBe(worker); late?.({ data: answer });
  fresh.respond(); expect((await next).hits.map(hit => hit.id)).toEqual(['lead', 'backup']);
});

it('refuses an otherwise valid context response after corpus.update during the await', async () => {
  const corpus = new HybridSearchCorpus(); corpus.update(memories, []);
  const { client, worker, lease } = await prepare(makeClient(), { ...input, memories: undefined, corpus: corpus.capture() });
  const pending = client.context(lease, signal()), rejected = expect(pending).rejects.toThrow('hybrid_search_unavailable');
  corpus.update([], ['city']); worker.respond();
  await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
});

it('rejects an obsolete context lease without cancelling the new query or its Worker', async () => {
  const { client, worker, lease: old } = await prepare(), next = client.prepare({ ...input, query: 'orchard' }, signal());
  const callCount = worker.postMessage.mock.calls.length;
  await expect(client.context(old, signal())).rejects.toThrow('hybrid_search_unavailable');
  expect(worker.postMessage).toHaveBeenCalledTimes(callCount); expect(worker.terminate).not.toHaveBeenCalled();
  worker.respond(); const current = await next;
  expect(current.hits.map(hit => hit.id)).toEqual(['garden']);
  const pending = client.context(current, signal()); worker.respond();
  expect((await pending).candidates).toEqual([{ id: 'garden', kind: 'seed', matchedKeys: 0 }]);
});

it.each(['prepare', 'rank'] as const)('mutating hits returned by %s cannot change the internal context seeds', async stage => {
  const { client, worker, lease } = await prepare(); let hits = lease.hits;
  if (stage === 'rank') {
    const pending = client.rank(lease, new Map([['city', 1]]), signal()); worker.respond(); hits = await pending;
    expect(hits.map(hit => hit.id)).toEqual(['city', 'lead']);
  }
  const expectedSeeds = hits.slice(0, SEARCH_CONTEXT_POLICY.seeds).map(hit => hit.id);
  for (const hit of hits) { hit.id = 'foreign'; hit.score = 0; hit.matchedTags.push('UNEXPECTED-TAG'); }
  hits.reverse(); hits.push({ id: 'garden', score: 1, semanticScore: 1, matchKind: 'semantic', snippet: '', matchedTags: [] });
  const pending = client.context(lease, signal()); worker.respond(); const result = await pending;
  expect(result.candidates.slice(0, expectedSeeds.length)).toEqual(expectedSeeds.map(id => ({ id, kind: 'seed', matchedKeys: 0 })));
  expect(result.stats.seeds).toBe(expectedSeeds.length); expect(worker.terminate).not.toHaveBeenCalled();
});
