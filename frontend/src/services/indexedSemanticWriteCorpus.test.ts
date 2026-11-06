import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncrementalMemoryPublication, type MemoryPublicationPatch } from './incrementalMemoryPublication';
import { IndexedSemanticWriteCorpus } from './indexedSemanticWriteCorpus';
import { IndexedSemanticWriteIndex } from './indexedSemanticWriteIndex';
import type { IndexedSemanticWriteMessage } from './indexedSemanticWriteProtocol';
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
function fixture(teamIds = ['team-a']) {
  const publication = new IncrementalMemoryPublication<Row>('desc'), worker = new IndexWorker();
  const corpus = new IndexedSemanticWriteCorpus<Row>({ uid: 'alice', teamIds: new Set(teamIds) }, id => publication.get(id), () => worker as unknown as Worker); live.push(corpus);
  const apply = (source: string, patch: MemoryPublicationPatch<Row>) => { publication.apply(source, patch); corpus.apply(source, patch); };
  const snapshot = async () => {
    let result: Row[] = []; await publication.publish(() => true, values => { result = values; });
    // Selecting an indexed source must never enumerate it, even on its second use.
    const source = new Proxy(result, { get(target, key, receiver) { if (key === Symbol.iterator) throw Error('Enumerated published corpus'); return Reflect.get(target, key, receiver); } });
    corpus.associate(source); return source;
  };
  return { publication, worker, corpus, apply, snapshot };
}

describe('persistent semantic write corpus', () => {
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
