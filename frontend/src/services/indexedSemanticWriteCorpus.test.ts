import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncrementalMemoryPublication, type MemoryPublicationPatch } from './incrementalMemoryPublication';
import { IndexedSemanticWriteCorpus } from './indexedSemanticWriteCorpus';
import { IndexedSemanticWriteIndex } from './indexedSemanticWriteIndex';
import { INDEXED_SEMANTIC_WRITE_LIMITS as capacity, type IndexedSemanticWriteMessage } from './indexedSemanticWriteProtocol';
import { semanticCandidateEligibility } from './semanticWriteScope';
import { selectSemanticWriteNeighbors } from './semanticWriteClient';
import { CURRENT_EMBEDDING_SPACE } from './embeddingModel';
import { cosineSimilarity } from './semanticConnectionBackfill';

type Row = { id: string; timestamp: number; uid: string; teamId?: string; teamScopeAmbiguous?: boolean; sharedWithIds?: unknown; encLocked?: boolean; deletedAt?: number; embeddingModel?: string; embedding?: number[] };
const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, timestamp: 1, uid: 'alice', embeddingModel: CURRENT_EMBEDDING_SPACE, embedding: [1, 0], ...extra });
const reset = (values: Row[]): MemoryPublicationPatch<Row> => ({ changed: values.map(value => ({ id: value.id, value })), removed: [], order: { reset: values.map(value => value.id), changes: [] } });
class IndexWorker extends EventTarget {
  index = new IndexedSemanticWriteIndex();
  terminate = vi.fn(() => this.index.clear());
  holdQuery = false;
  held: unknown[] = [];
  postMessage = vi.fn((message: IndexedSemanticWriteMessage) => {
    const data = { v: 1, seq: message.seq, ok: true, ...this.index.handle(structuredClone(message)) };
    if (this.holdQuery && message.type === 'query') this.held.push(data);
    else queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data })));
  });
}
const live: IndexedSemanticWriteCorpus<Row>[] = [];
afterEach(() => { for (const owner of live.splice(0)) owner.clear(); vi.useRealTimers(); });
function fixture(teamIds = ['team-a'], options: { direction?: 'asc' | 'desc'; sourceBase?: number; yieldTask?: () => Promise<void> } = {}) {
  const publication = new IncrementalMemoryPublication<Row>(options.direction ?? 'desc', { sourceBase: options.sourceBase }), worker = new IndexWorker(), workers = [worker]; let created = 0;
  const createWorker = () => { if (created++ === 0) return worker as unknown as Worker; const next = new IndexWorker(); workers.push(next); return next as unknown as Worker; };
  const corpus = new IndexedSemanticWriteCorpus<Row>({ uid: 'alice', teamIds: new Set(teamIds) }, id => publication.get(id), createWorker, options); live.push(corpus);
  const apply = (source: string, patch: MemoryPublicationPatch<Row>, priority?: number) => { publication.apply(source, patch, priority); corpus.apply(source, patch, priority); };
  const snapshot = async () => {
    let result: Row[] = []; await publication.publish(() => true, values => { result = values; });
    // Selecting an indexed source must never enumerate it, even on its second use.
    const source = new Proxy(result, { get(target, key, receiver) { if (key === Symbol.iterator) throw Error('Enumerated published corpus'); return Reflect.get(target, key, receiver); } });
    corpus.associate(source); return source;
  };
  return { publication, worker, workers, corpus, apply, snapshot };
}

describe('persistent semantic write corpus', () => {
  it('keeps an ascending merged view and the separate listener order and variant in one Worker', async () => {
    const publication = new IncrementalMemoryPublication<Row>('asc', { sourceBase: 2 }), worker = new IndexWorker();
    const corpus = new IndexedSemanticWriteCorpus<Row>({ uid: 'alice', teamIds: new Set(['team-a']) }, id => publication.get(id), () => worker as unknown as Worker, { direction: 'asc', sourceBase: 2 }); live.push(corpus);
    const apply = (key: string, values: Row[], priority?: number) => { publication.apply(key, reset(values), priority); corpus.apply(key, reset(values), priority); };
    const original = row('same', { timestamp: 3 }), teamWinner = row('same', { teamId: 'team-a', uid: 'bob', timestamp: 3 });
    apply('personal', [original, row('personal', { timestamp: 2 })], 1); apply('legacy', [row('legacy', { timestamp: 1 }), row('same', { timestamp: 3, embedding: [0, 1] })], 0); apply('team', [teamWinner]);
    const values: Row[] = []; await publication.publish(() => true, rows => values.push(...rows)); corpus.associate(values);
    const global = await selectSemanticWriteNeighbors([1, 0], values, { eligible: semanticCandidateEligibility('alice') }); expect(global.neighbors.map(row => row.candidate.id)).toEqual(['legacy', 'personal']);
    const source = corpus.sourceSelection('personal', publication.count, semanticCandidateEligibility('alice'));
    const local = await selectSemanticWriteNeighbors([1, 0], source, {}); expect(local.neighbors.map(row => row.candidate.id)).toEqual(['same', 'personal']); expect(local.neighbors[0].candidate).toBe(original);
    expect(worker.postMessage.mock.calls.filter(([message]) => message.type === 'init')).toHaveLength(1);
    await expect(selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice', 'team-a') })).rejects.toThrow();
  });
  it('coalesces 10000 tombstones, sends bounded exclusion batches and preserves suppression across source retry', async () => {
    const f = fixture(), values = Array.from({ length: 10000 }, (_, i) => row('hidden' + i));
    for (const value of values.slice(1)) Object.defineProperty(value, 'embedding', { get() { throw Error('Read a tombstoned vector'); } });
    for (const value of values) { f.publication.exclude('legacy', value.id, true); f.corpus.exclude('legacy', value.id, true); }
    f.apply('legacy', reset(values));
    const selected = await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') }); expect(selected.count).toBe(0);
    const messages = f.worker.postMessage.mock.calls.flatMap(([message]) => message.type === 'exclude' ? [message.changes.length] : []); expect(Math.max(...messages)).toBe(128); expect(messages.reduce((a, b) => a + b, 0)).toBe(10000);
    f.publication.removeSource('legacy'); f.corpus.removeSource('legacy'); f.apply('legacy', reset([values[0]]));
    expect((await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') })).count).toBe(0);
    f.publication.exclude('legacy', values[0].id, false); f.corpus.exclude('legacy', values[0].id, false);
    expect((await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') })).neighbors[0].candidate.id).toBe('hidden0');
  });
  it('reprojects existing affected team records on membership change, checking access before their vector', async () => {
    const f = fixture([]); let reads = 0;
    f.apply('team', reset([Object.defineProperty(row('t', { teamId: 'team-a' }), 'embedding', { get() { reads++; return [1, 0]; } })]));
    await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') }); expect(reads).toBe(0);
    f.corpus.setTeams(new Set(['team-a'])); const active = await f.snapshot();
    expect((await selectSemanticWriteNeighbors([1, 0], active, { eligible: semanticCandidateEligibility('alice', 'team-a') })).count).toBe(1); expect(reads).toBe(1);
    const marker = f.worker.postMessage.mock.calls.length; f.corpus.setTeams(new Set());
    await expect(selectSemanticWriteNeighbors([1, 0], active, { eligible: semanticCandidateEligibility('alice', 'team-a') })).rejects.toThrow();
    await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') }); expect(reads).toBe(1);
    expect(f.worker.postMessage.mock.calls.slice(marker).flatMap(([message]) => message.type === 'patch-chunk' ? message.changed.map(row => row.value?.scope) : [])).toEqual([null]);
  });
  it('retains source values on an order-only reset and keeps edit self-exclusion in listener order', async () => {
    const f = fixture(); f.apply('personal', reset([row('a'), row('b'), row('self')]));
    await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') });
    f.apply('personal', { changed: [], removed: [], order: { reset: ['self', 'b', 'a'], changes: [] } });
    const result = await selectSemanticWriteNeighbors([1, 0], f.corpus.sourceSelection('personal', f.publication.count, semanticCandidateEligibility('alice', undefined, 'self')), {});
    expect(result.count).toBe(2); expect(result.neighbors.map(row => row.candidate.id)).toEqual(['b', 'a']);
  });
  it('does not lose a new exclusion value while an earlier exclusion is awaiting acknowledgement', async () => {
    const f = fixture(); f.apply('legacy', reset([row('a')])); await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') });
    let held: unknown, hold = true;
    f.worker.postMessage.mockImplementation(message => {
      const data = { v: 1, seq: message.seq, ok: true, ...f.worker.index.handle(structuredClone(message)) };
      if (message.type === 'exclude' && hold) held = data; else queueMicrotask(() => f.worker.dispatchEvent(new MessageEvent('message', { data })));
    });
    f.publication.exclude('legacy', 'a', true); f.corpus.exclude('legacy', 'a', true); await vi.waitFor(() => expect(held).toBeDefined());
    f.publication.exclude('legacy', 'a', false); f.corpus.exclude('legacy', 'a', false); const source = await f.snapshot(); hold = false;
    f.worker.dispatchEvent(new MessageEvent('message', { data: held }));
    const result = await selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice') }); expect(result.count).toBe(1);
    expect(f.worker.postMessage.mock.calls.flatMap(([message]) => message.type === 'exclude' ? message.changes.map(row => row.slice(0, 2)) : [])).toEqual([['a', true], ['a', false]]);
  });
  it('matches full cosine sorting for 10000 records, bounds transfers and projects zero records on a repeated query', async () => {
    const f = fixture(); let reads = 0, seed = 173;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 * 2 - 1; };
    const originals = Array.from({ length: 10000 }, (_, i) => row('m' + i, { embedding: [random(), random()], timestamp: i % 7 }));
    const expected = [...originals].sort((a, b) => b.timestamp - a.timestamp).map((candidate, ordinal) => ({ id: candidate.id, score: cosineSimilarity([1, 0], candidate.embedding!), ordinal })).filter(value => value.score >= .55).sort((a, b) => b.score - a.score).slice(0, 7);
    const values = originals.map(value => { const embedding = value.embedding; return { ...value, get embedding() { reads++; return embedding; }, get text() { throw Error('Read original content'); } }; });
    f.apply('personal', reset(values)); const source = await f.snapshot(), eligible = semanticCandidateEligibility('alice');
    const first = await selectSemanticWriteNeighbors([1, 0], source, { eligible });
    expect(first.count).toBe(10000); expect(first.neighbors.map(value => ({ id: value.candidate.id, score: value.score, ordinal: value.ordinal }))).toEqual(expected);
    expect(reads).toBe(10000); const calls = f.worker.postMessage.mock.calls.length;
    const second = await selectSemanticWriteNeighbors([0, 1], source, { eligible }); expect(second.count).toBe(10000); expect(reads).toBe(10000);
    expect(f.worker.postMessage.mock.calls.slice(calls).map(([message]) => message.type)).toEqual(['query']);
    const chunks = f.worker.postMessage.mock.calls.flatMap(([message]) => message.type === 'patch-chunk' ? [message.changed.length] : []);
    expect(Math.max(...chunks)).toBe(128); expect(chunks.reduce((a, b) => a + b, 0)).toBe(10000); expect(f.worker.terminate).not.toHaveBeenCalled();
  });
  it('sends only one changed record and a query after an edit, and rejects an older published revision', async () => {
    const f = fixture(), a = row('a'), b = row('b'); f.apply('personal', reset([a, b])); const old = await f.snapshot();
    await selectSemanticWriteNeighbors([1, 0], old, { eligible: semanticCandidateEligibility('alice') }); const before = f.worker.postMessage.mock.calls.length;
    f.apply('personal', { changed: [{ id: 'a', value: row('a', { embedding: [0, 1] }) }], removed: [], order: { changes: [] } });
    await expect(selectSemanticWriteNeighbors([1, 0], old, { eligible: semanticCandidateEligibility('alice') })).rejects.toThrow('semantic_write_unavailable');
    const next = await f.snapshot(), result = await selectSemanticWriteNeighbors([1, 0], next, { eligible: semanticCandidateEligibility('alice') });
    expect(result.neighbors.map(value => value.candidate.id)).toEqual(['b']);
    const messages = f.worker.postMessage.mock.calls.slice(before).map(([message]) => message);
    expect(messages.flatMap(message => message.type === 'patch-chunk' ? message.changed.map(value => value.id) : [])).toEqual(['a']);
    expect(messages.filter(message => message.type === 'init')).toHaveLength(0);
  });
  it('keeps scopes separate, checks eligibility before vectors and preserves the winning ineligible duplicate', async () => {
    const f = fixture(); const forbidden = (id: string, extra: Partial<Row>) => Object.defineProperty(row(id, extra), 'embedding', { get() { throw Error('Read denied vector'); } });
    f.apply('personal', reset([row('a'), forbidden('foreign', { uid: 'bob' }), forbidden('shared', { sharedWithIds: ['bob'] }), row('legacy', { embeddingModel: undefined }), row('duplicate')]));
    f.apply('team', reset([row('t', { teamId: 'team-a', uid: 'bob' }), forbidden('removed-team', { teamId: 'team-b' }), forbidden('locked', { encLocked: true }), forbidden('duplicate', { encLocked: true })]));
    const source = await f.snapshot();
    const personal = await selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice') }); expect(personal.count).toBe(2); expect(personal.neighbors.map(value => value.candidate.id)).toEqual(['a']);
    const team = await selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice', 'team-a') }); expect(team.count).toBe(1); expect(team.neighbors.map(value => value.candidate.id)).toEqual(['t']);
    await expect(selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('bob') })).rejects.toThrow();
    await expect(selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice', 'team-b') })).rejects.toThrow();
    expect(JSON.stringify(f.worker.postMessage.mock.calls)).not.toMatch(/"uid"|"text"|"title"|"position"|"semanticClusterId"|alice|bob|team-a|team-b/);
  });
  it('preserves canonical ties after source moves and removes a denied source without visiting its records in the caller', async () => {
    const f = fixture(); f.apply('personal', reset([row('a'), row('b')])); f.apply('team', reset([row('c'), row('d')]));
    const first = await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') }); expect(first.neighbors.map(value => value.candidate.id)).toEqual(['a', 'b', 'c', 'd']);
    f.apply('personal', { changed: [], removed: [], order: { changes: [{ id: 'a', type: 'modified', oldIndex: 0, newIndex: 1 }] } });
    const moved = await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') }); expect(moved.neighbors.map(value => value.candidate.id)).toEqual(['b', 'a', 'c', 'd']);
    f.publication.removeSource('team'); f.corpus.removeSource('team');
    const removed = await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') }); expect(removed.count).toBe(2); expect(removed.neighbors.map(value => value.candidate.id)).toEqual(['b', 'a']);
  });
  it('serializes concurrent queries and allows another query after local cancellation without reindexing', async () => {
    const f = fixture(); f.apply('personal', reset([row('a'), row('b', { embedding: [0, 1] })])); const source = await f.snapshot(), eligible = semanticCandidateEligibility('alice');
    const result = await Promise.all([selectSemanticWriteNeighbors([1, 0], source, { eligible }), selectSemanticWriteNeighbors([0, 1], source, { eligible })]); expect(result.map(value => value.neighbors[0].candidate.id)).toEqual(['a', 'b']);
    f.worker.holdQuery = true; const controller = new AbortController(), pending = selectSemanticWriteNeighbors([1, 0], source, { eligible, signal: controller.signal });
    await vi.waitFor(() => expect(f.worker.held).toHaveLength(1)); controller.abort(); await expect(pending).rejects.toThrow();
    f.worker.holdQuery = false; f.worker.dispatchEvent(new MessageEvent('message', { data: f.worker.held[0] }));
    const resumed = await selectSemanticWriteNeighbors([0, 1], source, { eligible }); expect(resumed.neighbors[0].candidate.id).toBe('b'); expect(f.worker.postMessage.mock.calls.filter(([message]) => message.type === 'init')).toHaveLength(1);
  });
  it('terminates and refuses late results after retirement', async () => {
    const f = fixture(); f.apply('personal', reset([row('a')])); const source = await f.snapshot(); f.worker.holdQuery = true;
    const pending = selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice') });
    await vi.waitFor(() => expect(f.worker.held).toHaveLength(1)); const rejected = expect(pending).rejects.toThrow(); f.corpus.clear(); await rejected;
    f.worker.dispatchEvent(new MessageEvent('message', { data: f.worker.held[0] })); expect(f.worker.terminate).toHaveBeenCalledOnce();
    await expect(selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice') })).rejects.toThrow();
  });
  it.each([
    { indexed: 3 }, { count: 3 }, { count: -1 }, { neighbors: [['foreign', 1, 0]] },
    { neighbors: [['a', NaN, 0]] }, { neighbors: [['a', 1, 2]] },
    { neighbors: [['a', 1, 0], ['a', 1, 1]] }, { neighbors: [['b', 1, 1], ['a', 1, 0]] },
  ])('retires a malformed or mismatched Worker result %#', async patch => {
    const f = fixture(); f.apply('personal', reset([row('a'), row('b')]));
    f.worker.postMessage.mockImplementation(message => {
      const data = { v: 1, seq: message.seq, ok: true, ...f.worker.index.handle(structuredClone(message)), ...(message.type === 'query' ? patch : {}) };
      queueMicrotask(() => f.worker.dispatchEvent(new MessageEvent('message', { data })));
    });
    await expect(selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') })).rejects.toThrow('semantic_write_unavailable'); expect(f.worker.terminate).toHaveBeenCalledOnce();
  });
  it('times out a stalled Worker and rejects all later use of that corpus', async () => {
    const f = fixture(); f.apply('personal', reset([row('a')])); const source = await f.snapshot(), eligible = semanticCandidateEligibility('alice');
    await selectSemanticWriteNeighbors([1, 0], source, { eligible }); vi.useFakeTimers(); f.worker.holdQuery = true;
    const pending = expect(selectSemanticWriteNeighbors([1, 0], source, { eligible })).rejects.toThrow('semantic_write_unavailable');
    await vi.advanceTimersByTimeAsync(30_000); await pending; expect(f.worker.terminate).toHaveBeenCalledOnce();
    await expect(selectSemanticWriteNeighbors([1, 0], source, { eligible })).rejects.toThrow();
  });
});

it('ignores thousands of unchanged exclusion flags before and after indexing without retiring the source or reading its vector', async () => {
  const f = fixture(); let reads = 0;
  f.apply('legacy', reset([Object.defineProperty(row('a'), 'embedding', { get() { reads++; return [1, 0]; } })]));
  for (let i = 0; i < 5000; i++) f.corpus.exclude('legacy', 'a', false);
  const source = await f.snapshot(); await selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice') }); expect(reads).toBe(1);
  const marker = f.worker.postMessage.mock.calls.length;
  for (let i = 0; i < 5000; i++) f.corpus.exclude('legacy', 'a', false);
  expect((await selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice') })).count).toBe(1); expect(reads).toBe(1);
  expect(f.worker.postMessage.mock.calls.slice(marker).map(([message]) => message.type)).toEqual(['query']);
  f.publication.exclude('legacy', 'a', true); for (let i = 0; i < 5000; i++) f.corpus.exclude('legacy', 'a', true);
  expect((await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') })).count).toBe(0); expect(reads).toBe(1);
  expect(f.worker.postMessage.mock.calls.filter(([message]) => message.type === 'exclude')).toHaveLength(1);
});

it('compacts thousands of unqueried edits to the current reference without projecting historical vectors', async () => {
  const f = fixture(); let obsoleteReads = 0;
  f.apply('personal', reset([row('a')]));
  for (let index = 0; index < 3000; index++) {
    const value = Object.defineProperty(row('a'), 'embedding', { get() { obsoleteReads++; throw Error('Read obsolete vector'); } });
    f.apply('personal', { changed: [{ id: value.id, value }], removed: [], order: { changes: [] } });
  }
  const current = row('a', { embedding: [0, 1] }); f.apply('personal', { changed: [{ id: current.id, value: current }], removed: [], order: { changes: [] } });
  expect(f.worker.postMessage).not.toHaveBeenCalled();
  const source = await f.snapshot(), result = await selectSemanticWriteNeighbors([0, 1], source, { eligible: semanticCandidateEligibility('alice') });
  expect(result.neighbors[0].candidate).toBe(current); expect(obsoleteReads).toBe(0);
  expect(f.worker.postMessage.mock.calls.filter(([message]) => message.type === 'patch-start')).toHaveLength(1);
  expect(f.worker.postMessage.mock.calls.filter(([message]) => message.type === 'patch-chunk').flatMap(([message]) => message.type === 'patch-chunk' ? message.changed : [])).toHaveLength(1);
  await selectSemanticWriteNeighbors([0, 1], source, { eligible: semanticCandidateEligibility('alice') }); expect(f.workers).toHaveLength(1); expect(f.worker.terminate).not.toHaveBeenCalled();
});

it('counts reset IDs in the queue budget and streams the latest listener order, including null positions', async () => {
  const f = fixture(), size = 1024, rotations = Math.floor(capacity.pendingChanges / size) + 1;
  // Exceed the metadata-entry budget while staying below the separate batch-count cap.
  expect(rotations * size).toBeGreaterThan(capacity.pendingChanges);
  expect(rotations + 1).toBeLessThan(capacity.pendingBatches);
  const values = Array.from({ length: size }, (_, index) => row('m' + index)); f.apply('personal', reset(values));
  f.apply('personal', { changed: [{ id: 'm512', value: null }], removed: [], order: { changes: [] } });
  await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') });
  let held: unknown;
  f.worker.postMessage.mockImplementation(message => {
    const data = { v: 1, seq: message.seq, ok: true, ...f.worker.index.handle(structuredClone(message)) };
    if (message.type === 'patch-start') held = data; else queueMicrotask(() => f.worker.dispatchEvent(new MessageEvent('message', { data })));
  });
  f.corpus.apply('personal', { changed: [], removed: [], order: { reset: values.map(value => value.id), changes: [] } });
  await vi.waitFor(() => expect(held).toBeDefined());
  let ids = values.map(value => value.id);
  for (let index = 0; index < rotations; index++) { ids = [...ids.slice(1), ids[0]]; f.corpus.apply('personal', { changed: [], removed: [], order: { reset: ids, changes: [] } }); }
  // The reference view needs only the final order; this case exercises the replica's queued metadata budget.
  f.publication.apply('personal', { changed: [], removed: [], order: { reset: ids, changes: [] } });
  const source = f.corpus.sourceSelection('personal', f.publication.count, semanticCandidateEligibility('alice'));
  const result = await selectSemanticWriteNeighbors([1, 0], source, {});
  expect(result.count).toBe(size - 1); expect(result.neighbors.map(hit => hit.candidate.id)).toEqual(ids.filter(id => id !== 'm512').slice(0, 7));
  expect(f.workers).toHaveLength(2); expect(f.worker.terminate).toHaveBeenCalledOnce(); const active = f.workers[1];
  const starts = active.postMessage.mock.calls.flatMap(([message]) => message.type === 'patch-start' ? [message] : []);
  expect(starts).toHaveLength(1); expect(starts[0].orderedReset).toBe(true); expect(starts[0].order.reset).toEqual([]);
  const chunks = active.postMessage.mock.calls.flatMap(([message]) => message.type === 'patch-chunk' ? [message.changed] : []);
  expect(Math.max(...chunks.map(chunk => chunk.length))).toBe(128); expect(chunks.flat().map(value => value.id)).toEqual(ids);
});

it('recovers merged precedence, source priorities, memberships and tombstones after removed sources were compacted', async () => {
  const f = fixture([], { direction: 'asc', sourceBase: 2 });
  const personal = row('same', { timestamp: 2 }), team = row('same', { timestamp: 2, teamId: 'team-a', uid: 'bob' });
  f.apply('personal', reset([personal, row('p', { timestamp: 1 })]), 1);
  f.publication.exclude('legacy', 'hidden', true); f.corpus.exclude('legacy', 'hidden', true);
  const hidden = Object.defineProperty(row('hidden', { timestamp: 0 }), 'embedding', { get() { throw Error('Read tombstoned vector'); } });
  f.apply('legacy', reset([hidden, row('legacy', { timestamp: 1 }), row('same', { embedding: [0, 1], timestamp: 2 })]), 0);
  f.apply('team', reset([team]));
  for (let index = 0; index < 600; index++) { f.apply('retired-' + index, reset([row('retired-row')])); f.publication.removeSource('retired-' + index); f.corpus.removeSource('retired-' + index); }
  const global = await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') });
  expect(global.neighbors.map(hit => hit.candidate.id)).toEqual(['legacy', 'p']); expect(global.count).toBe(2);
  const local = await selectSemanticWriteNeighbors([1, 0], f.corpus.sourceSelection('personal', f.publication.count, semanticCandidateEligibility('alice')), {});
  expect(local.neighbors.map(hit => hit.candidate.id)).toEqual(['same', 'p']); expect(local.neighbors[0].candidate).toBe(personal);
  f.corpus.setTeams(new Set(['team-a'])); const allowed = await selectSemanticWriteNeighbors([1, 0], f.corpus.sourceSelection('team', f.publication.count, semanticCandidateEligibility('alice', 'team-a')), {});
  expect(allowed.neighbors[0].candidate).toBe(team);
  const projected = f.workers.flatMap(worker => worker.postMessage.mock.calls.flatMap(([message]) => message.type === 'patch-chunk' ? message.changed : []));
  expect(projected.some(value => value.id === 'retired-row')).toBe(false);
  expect(JSON.stringify(f.workers.flatMap(worker => worker.postMessage.mock.calls))).not.toMatch(/retired-|team-a|alice|bob/);
  f.publication.removeSource('legacy'); f.corpus.removeSource('legacy'); f.apply('legacy', reset([hidden]), 0);
  expect((await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') })).count).toBe(1);
});

it('streams a fixed recovery baseline while new versions arrive, then applies their deltas without restarting', async () => {
  let mutate = () => {}; const f = fixture([], { yieldTask: async () => { mutate(); } });
  let originalReads = 0; const values = Array.from({ length: 1000 }, (_, index) => row('m' + index));
  values[0] = Object.defineProperty(row('m0'), 'embedding', { get() { originalReads++; return [1, 0]; } });
  f.apply('personal', reset(values)); for (let index = 0; index < 300; index++) f.apply('personal', { changed: [{ id: 'm1', value: row('m1') }], removed: [], order: { changes: [] } });
  let replacement = row('m0', { embedding: [0, 1] }), mutations = 0;
  mutate = () => { replacement = row('m0', { embedding: [0, 1] }); f.apply('personal', { changed: [{ id: replacement.id, value: replacement }], removed: [], order: { changes: [] } }); if (++mutations === 7) mutate = () => {}; };
  await expect(selectSemanticWriteNeighbors([0, 1], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') })).rejects.toThrow();
  const result = await selectSemanticWriteNeighbors([0, 1], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') });
  expect(result.neighbors[0].candidate).toBe(replacement); expect(originalReads).toBe(1); expect(mutations).toBe(7); expect(f.workers).toHaveLength(1); expect(f.worker.terminate).not.toHaveBeenCalled();
  expect(f.worker.postMessage.mock.calls.filter(([message]) => message.type === 'patch-chunk').flatMap(([message]) => message.type === 'patch-chunk' ? message.changed : [])).toHaveLength(1007);
});

it('restarts a warm replica with a held old ACK, ignores its late reply and returns to unit deltas', async () => {
  const f = fixture(); f.apply('personal', reset([row('a'), row('b')])); await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') });
  let held: unknown;
  f.worker.postMessage.mockImplementation(message => {
    const data = { v: 1, seq: message.seq, ok: true, ...f.worker.index.handle(structuredClone(message)) };
    if (message.type === 'patch-start') held = data; else queueMicrotask(() => f.worker.dispatchEvent(new MessageEvent('message', { data })));
  });
  f.apply('personal', { changed: [{ id: 'a', value: row('a') }], removed: [], order: { changes: [] } }); await vi.waitFor(() => expect(held).toBeDefined());
  let current = row('a');
  for (let index = 0; index < 1000; index++) { current = row('a', { embedding: [0, 1] }); f.apply('personal', { changed: [{ id: 'a', value: current }], removed: [], order: { changes: [] } }); }
  const result = await selectSemanticWriteNeighbors([0, 1], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') });
  expect(result.neighbors[0].candidate).toBe(current); expect(f.workers).toHaveLength(2); expect(f.worker.terminate).toHaveBeenCalledOnce();
  f.worker.dispatchEvent(new MessageEvent('message', { data: held })); const active = f.workers[1], marker = active.postMessage.mock.calls.length;
  f.apply('personal', { changed: [{ id: 'b', value: row('b', { embedding: [0, 1] }) }], removed: [], order: { changes: [] } });
  await selectSemanticWriteNeighbors([0, 1], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') });
  expect(active.postMessage.mock.calls.slice(marker).flatMap(([message]) => message.type === 'patch-chunk' ? message.changed : [])).toHaveLength(1); expect(active.terminate).not.toHaveBeenCalled();
});

it('rejects a paused recovery immediately on key loss and never resumes projection after its late task', async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture([], { yieldTask: async () => { entered(); await gate; } });
  f.apply('personal', reset(Array.from({ length: 1000 }, (_, index) => row('m' + index))));
  for (let index = 0; index < 300; index++) f.apply('personal', { changed: [], removed: [], order: { changes: [] } });
  const source = await f.snapshot(), pending = selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice') }), rejected = expect(pending).rejects.toThrow();
  await started; const marker = f.worker.postMessage.mock.calls.length; f.corpus.clear(); await rejected; expect(f.worker.terminate).toHaveBeenCalledOnce();
  release(); await Promise.resolve(); expect(f.worker.postMessage).toHaveBeenCalledTimes(marker);
  await expect(selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice') })).rejects.toThrow();
});

it('keeps hundreds of active sources and cohorts warm instead of treating live mappings as garbage', async () => {
  const teams = Array.from({ length: 300 }, (_, index) => 'team-' + index), f = fixture(teams);
  for (let index = 0; index < teams.length; index++) f.apply(teams[index], reset([row('m' + index, { uid: 'bob', teamId: teams[index] })]));
  await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') }); const marker = f.worker.postMessage.mock.calls.length;
  const updated = row('m0', { uid: 'bob', teamId: teams[0], embedding: [0, 1] }); f.apply(teams[0], { changed: [{ id: updated.id, value: updated }], removed: [], order: { changes: [] } });
  const result = await selectSemanticWriteNeighbors([0, 1], f.corpus.sourceSelection(teams[0], f.publication.count, semanticCandidateEligibility('alice', teams[0])), {});
  expect(result.neighbors[0].candidate).toBe(updated); expect(f.workers).toHaveLength(1); expect(f.worker.terminate).not.toHaveBeenCalled();
  expect(f.worker.postMessage.mock.calls.slice(marker).flatMap(([message]) => message.type === 'patch-chunk' ? message.changed : [])).toHaveLength(1);
});

it('preserves a recovery baseline when the live listener moves and removes rows while its first chunk is awaiting ACK', async () => {
  const f = fixture(), values = Array.from({ length: 1000 }, (_, index) => row('m' + index)); f.apply('personal', reset(values));
  let held: unknown, holding = true;
  f.worker.postMessage.mockImplementation(message => {
    const data = { v: 1, seq: message.seq, ok: true, ...f.worker.index.handle(structuredClone(message)) };
    if (holding && message.type === 'patch-chunk') held = data; else queueMicrotask(() => f.worker.dispatchEvent(new MessageEvent('message', { data })));
  });
  const pending = selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') }), rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(held).toBeDefined());
  f.apply('personal', { changed: [], removed: ['m999'], order: { changes: [{ type: 'modified', id: 'm0', oldIndex: 0, newIndex: 999 }, { type: 'removed', id: 'm999', oldIndex: 998, newIndex: -1 }] } });
  holding = false; f.worker.dispatchEvent(new MessageEvent('message', { data: held })); await rejected;
  const result = await selectSemanticWriteNeighbors([1, 0], f.corpus.sourceSelection('personal', f.publication.count, semanticCandidateEligibility('alice')), {});
  expect(result.count).toBe(999); expect(result.neighbors.map(hit => hit.candidate.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
  expect(f.workers).toHaveLength(1); expect(f.worker.terminate).not.toHaveBeenCalled();
});

it('streams a large warm order-only reset and removals in bounded metadata chunks without reprojecting unchanged vectors', async () => {
  const f = fixture(), values = Array.from({ length: 2000 }, (_, index) => row('m' + index)); f.apply('personal', reset(values));
  await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') }); const marker = f.worker.postMessage.mock.calls.length;
  const ids = values.map(value => value.id).reverse(); f.apply('personal', { changed: [], removed: [], order: { reset: ids, changes: [] } });
  const moved = await selectSemanticWriteNeighbors([1, 0], f.corpus.sourceSelection('personal', f.publication.count, semanticCandidateEligibility('alice')), {});
  expect(moved.neighbors.map(hit => hit.candidate.id)).toEqual(ids.slice(0, 7));
  f.apply('personal', { changed: [], removed: ids.slice(0, 1000), order: { changes: ids.slice(0, 1000).map(id => ({ type: 'removed' as const, id, oldIndex: 0, newIndex: -1 })) } });
  expect((await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') })).count).toBe(1000);
  const messages = f.worker.postMessage.mock.calls.slice(marker).map(([message]) => message);
  expect(messages.filter(message => message.type === 'patch-chunk')).toHaveLength(0);
  const metadata = messages.flatMap(message => message.type === 'patch-metadata' ? [message] : []);
  expect(Math.max(...metadata.map(message => (message.removed?.length ?? 0) + (message.changes?.length ?? 0) + (message.resetIds?.length ?? 0)))).toBe(128);
  expect(metadata.reduce((sum, message) => sum + (message.resetIds?.length ?? 0), 0)).toBe(2000); expect(f.workers).toHaveLength(1);
});

it('checks current membership again for every recovery chunk and never reads another revoked team vector', async () => {
  const f = fixture(['team-a']); let reads = 0, held: unknown, holding = true;
  const values = Array.from({ length: 1000 }, (_, index) => Object.defineProperty(row('t' + index, { teamId: 'team-a', uid: 'bob' }), 'embedding', { get() { reads++; return [1, 0]; } }));
  f.apply('team', reset(values)); for (let index = 0; index < 300; index++) f.apply('team', { changed: [], removed: [], order: { changes: [] } });
  f.worker.postMessage.mockImplementation(message => {
    const data = { v: 1, seq: message.seq, ok: true, ...f.worker.index.handle(structuredClone(message)) };
    if (holding && message.type === 'patch-chunk') held = data; else queueMicrotask(() => f.worker.dispatchEvent(new MessageEvent('message', { data })));
  });
  const pending = selectSemanticWriteNeighbors([1, 0], f.corpus.sourceSelection('team', f.publication.count, semanticCandidateEligibility('alice', 'team-a')), {}), rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(held).toBeDefined()); expect(reads).toBe(128);
  f.corpus.setTeams(new Set()); holding = false; f.worker.dispatchEvent(new MessageEvent('message', { data: held })); await rejected;
  const result = await selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') });
  expect(result.count).toBe(0); expect(reads).toBe(128); expect(f.worker.terminate).not.toHaveBeenCalled();
});

it('matches independent full rankings and listener positions across repeated warm recovery cycles', async () => {
  const f = fixture(['team-a'], { direction: 'asc', sourceBase: 2 });
  const values: Record<string, Row[]> = { personal: Array.from({ length: 40 }, (_, index) => row('m' + index, { timestamp: index % 3 })), team: Array.from({ length: 40 }, (_, index) => row('m' + (index + 20), { timestamp: index % 3, uid: 'bob', teamId: 'team-a' })) };
  f.apply('personal', reset(values.personal), 1); f.apply('team', reset(values.team));
  const personal = semanticCandidateEligibility('alice'), team = semanticCandidateEligibility('alice', 'team-a'); let seed = 371;
  const random = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const expected = (rows: readonly Row[], eligible: typeof personal) => {
    const allowed = rows.filter(eligible); return { count: allowed.length, neighbors: allowed.map((candidate, ordinal) => ({ id: candidate.id, ordinal, score: cosineSimilarity([1, 0], candidate.embedding!) })).filter(hit => hit.score >= .55).sort((a, b) => b.score - a.score).slice(0, 7) };
  };
  const shape = (result: Awaited<ReturnType<typeof selectSemanticWriteNeighbors>>) => ({ count: result.count, neighbors: result.neighbors.map(hit => ({ id: hit.candidate.id, ordinal: hit.ordinal, score: hit.score })) });
  const verify = async () => {
    const source = await f.snapshot(); expect(shape(await selectSemanticWriteNeighbors([1, 0], source, { eligible: personal }))).toEqual(expected(f.publication.snapshot(), personal));
    for (const key of ['personal', 'team']) { const eligible = key === 'personal' ? personal : team;
      expect(shape(await selectSemanticWriteNeighbors([1, 0], f.corpus.sourceSelection(key, f.publication.count, eligible), {}))).toEqual(expected(values[key], eligible));
    }
  };
  await verify();
  for (let cycle = 0; cycle < 4; cycle++) {
    for (let step = 0; step < 400; step++) {
      const key = random() % 2 ? 'personal' : 'team', rows = values[key], oldIndex = random() % rows.length, newIndex = random() % rows.length, value = rows[oldIndex];
      if (random() % 3 === 0) {
        rows.splice(oldIndex, 1); rows.splice(newIndex, 0, value); f.apply(key, { changed: [], removed: [], order: { changes: [{ id: value.id, type: 'modified', oldIndex, newIndex }] } }, key === 'personal' ? 1 : undefined);
      } else {
        const angle = random() % 100 / 100 * Math.PI, updated = { ...value, timestamp: random() % 3, embedding: [Math.cos(angle), Math.sin(angle)] };
        rows[oldIndex] = updated; f.apply(key, { changed: [{ id: updated.id, value: updated }], removed: [], order: { changes: [] } }, key === 'personal' ? 1 : undefined);
      }
    }
    await verify();
  }
  expect(f.workers).toHaveLength(5); expect(f.workers.slice(0, -1).every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
  expect(f.workers.at(-1)!.terminate).not.toHaveBeenCalled();
});

it('keeps an explicit retained-state budget and rejects use after actual state capacity is exceeded', async () => {
  const f = fixture(); for (let index = 0; index <= 200_000; index++) f.corpus.exclude('legacy', 'hidden' + index, true);
  await expect(selectSemanticWriteNeighbors([1, 0], await f.snapshot(), { eligible: semanticCandidateEligibility('alice') })).rejects.toThrow('semantic_write_unavailable');
  expect(f.worker.postMessage).not.toHaveBeenCalled();
});
