import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const observers = vi.hoisted(() => ({ personal: new Set<() => void>(), team: new Set<() => void>() }));
vi.mock('./memoryCrypto', () => ({ onMemoryCryptoChanged: (callback: () => void) => { observers.personal.add(callback); return () => observers.personal.delete(callback); } }));
vi.mock('./teamVault', () => ({ onTeamKeyChanged: (callback: () => void) => { observers.team.add(callback); return () => observers.team.delete(callback); } }));
import { withSemanticCandidates, withSemanticCandidateOperation } from './semanticCandidateOperations';
import { IndexedSemanticWriteCorpus } from './indexedSemanticWriteCorpus';
import { IndexedSemanticWriteIndex } from './indexedSemanticWriteIndex';
import { semanticCandidateEligibility } from './semanticWriteScope';
import { selectSemanticWriteNeighbors } from './semanticWriteClient';
import type { IndexedSemanticWriteMessage } from './indexedSemanticWriteProtocol';
import { CURRENT_EMBEDDING_SPACE } from './embeddingModel';

const row = (id: string, extra = {}) => ({ id, uid: 'alice', timestamp: 0, embedding: [1, 0], embeddingModel: CURRENT_EMBEDDING_SPACE, position: [1, 2, 3] as [number, number, number], ...extra });
const eligible = semanticCandidateEligibility('alice');
class IndexWorker extends EventTarget {
  index = new IndexedSemanticWriteIndex();
  terminate = vi.fn(() => this.index.clear());
  hold = false;
  postMessage = vi.fn((message: IndexedSemanticWriteMessage) => {
    const data = { v: 1, seq: message.seq, ok: true, ...this.index.handle(structuredClone(message)) };
    if (!this.hold || message.type !== 'query') queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data })));
  });
}
const owners: Array<{ clear(): void }> = [];
beforeEach(() => { expect(observers.personal.size).toBe(0); expect(observers.team.size).toBe(0); });
afterEach(() => { for (const owner of owners.splice(0)) owner.clear(); expect(observers.personal.size).toBe(0); expect(observers.team.size).toBe(0); });
const fixture = () => { const worker = new IndexWorker(); return { worker, createWorker: vi.fn(() => worker as unknown as Worker) }; };

it('borrows the published scope without enumerating or recapturing it, and leaves its shared binding intact', async () => {
  const f = fixture(), values = [row('a'), row('team', { uid: 'bob', teamId: 'crew' })];
  const owner = new IndexedSemanticWriteCorpus({ uid: 'alice', teamIds: new Set(['crew']) }, id => values.find(value => value.id === id), f.createWorker); owners.push(owner);
  owner.apply('source', { changed: values.map(value => ({ id: value.id, value })), removed: [], order: { reset: values.map(value => value.id), changes: [] } });
  const source = new Proxy(values, { get(target, key, receiver) { if (key === Symbol.iterator) throw Error('Enumerated original'); return Reflect.get(target, key, receiver); } }); owner.associate(source);
  for (let i = 0; i < 2; i++) await withSemanticCandidates(source, { eligible }, async (alias, guard) => {
    expect(alias).not.toBe(source); const result = await selectSemanticWriteNeighbors([1, 0], alias, { assertCurrent: guard }); expect(result.count).toBe(1); expect(result.neighbors[0].candidate.id).toBe('a');
  });
  expect(f.createWorker).toHaveBeenCalledOnce(); expect(f.worker.terminate).not.toHaveBeenCalled();
  const team = await selectSemanticWriteNeighbors([1, 0], source, { eligible: semanticCandidateEligibility('alice', 'crew') }); expect(team.neighbors[0].candidate.id).toBe('team');
  expect(f.worker.postMessage.mock.calls.filter(([message]) => message.type === 'patch-chunk')).toHaveLength(1);
});

it('rejects a retired borrowed source instead of falling back to a new full capture', async () => {
  const f = fixture(), values = [row('a')], owner = new IndexedSemanticWriteCorpus({ uid: 'alice', teamIds: new Set<string>() }, () => values[0], f.createWorker); owners.push(owner); owner.associate(values); owner.clear();
  await expect(withSemanticCandidates(values, { eligible }, (source, guard) => selectSemanticWriteNeighbors([1, 0], source, { assertCurrent: guard }))).rejects.toThrow('semantic_write_unavailable');
  expect(f.createWorker).not.toHaveBeenCalled();
});

it('keeps independent metadata capture for an unregistered source without reading content', async () => {
  const value = row('a'); for (const field of ['text', 'title', 'enc', 'attachments']) Object.defineProperty(value, field, { get() { throw Error('Read original content'); } });
  await withSemanticCandidates([value], { eligible }, async source => { const copy = [...source][0]; value.embedding[0] = 99; value.position[0] = 99; expect(copy.embedding).toEqual([1, 0]); expect(copy.position).toEqual([1, 2, 3]); });
});

it('captures 10000 rows once and reuses one Worker for 20 queries without projecting each prefix', async () => {
  const f = fixture(); let reads = 0, visits = 0;
  const values = Array.from({ length: 10000 }, (_, i) => { const value = row('m' + i); return { ...value, get embedding() { reads++; return value.embedding; }, get text() { throw Error('Read content'); } }; });
  const source = { *[Symbol.iterator]() { for (const value of values) { visits++; yield value; } } };
  await withSemanticCandidateOperation(source, { eligible, createWorker: f.createWorker, yieldTask: async () => {} }, async (operation, guard) => {
    const prefix = operation.prefix();
    for (let i = 0; i < 20; i++) { expect(operation.prefix()).toBe(prefix); const result = await selectSemanticWriteNeighbors([1, 0], prefix, { assertCurrent: guard }); expect(result.count).toBe(10000); expect(result.neighbors.map(value => value.candidate.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6']); }
    expect(reads).toBe(10000); expect(visits).toBe(10000);
  });
  expect(f.createWorker).toHaveBeenCalledOnce(); expect(f.worker.terminate).toHaveBeenCalledOnce();
  const messages = f.worker.postMessage.mock.calls.map(([message]) => message);
  expect(messages.filter(message => message.type === 'query')).toHaveLength(20);
  expect(messages.flatMap(message => message.type === 'patch-chunk' ? message.changed : [])).toHaveLength(10000);
  expect(Math.max(...messages.flatMap(message => message.type === 'patch-chunk' ? [message.changed.length] : []))).toBe(128);
  expect(JSON.stringify(messages)).not.toMatch(/"uid"|"position"|"text"|"enc"|alice/);
});

it('keeps a frozen batch baseline and sends one addition after a capsule item, preserving old fixed prefixes', async () => {
  const f = fixture(), value = row('a', { celestialType: 'sun' });
  await withSemanticCandidateOperation([value], { eligible, createWorker: f.createWorker }, async (operation, guard) => {
    const before = operation.prefix(); value.embedding[0] = -1; value.position[0] = 100;
    const first = await selectSemanticWriteNeighbors([1, 0], before, { assertCurrent: guard }); expect(first.neighbors[0].candidate.embedding).toEqual([1, 0]);
    const positions = operation.sunPositions(); positions[0][0] = 77; expect(operation.sunPositions()).toEqual([[1, 2, 3]]);
    const marker = f.worker.postMessage.mock.calls.length; await operation.append(row('added', { celestialType: 'sun' }));
    expect([...before].map(value => value.id)).toEqual(['a']); const after = operation.prefix(); expect([...after].map(value => value.id)).toEqual(['a', 'added']);
    await expect(selectSemanticWriteNeighbors([1, 0], before, { assertCurrent: guard })).rejects.toThrow();
    const next = await selectSemanticWriteNeighbors([1, 0], after, { assertCurrent: guard }); expect(next.count).toBe(2); expect(next.neighbors.map(value => value.candidate.id)).toEqual(['a', 'added']);
    expect(f.worker.postMessage.mock.calls.slice(marker).flatMap(([message]) => message.type === 'patch-chunk' ? message.changed.map(value => value.id) : [])).toEqual(['added']);
    expect(operation.sunPositions()).toEqual([[1, 2, 3], [1, 2, 3]]);
  });
});

it('refuses concurrent duplicate additions after capture and unauthorized additions without changing the prefix', async () => {
  await withSemanticCandidateOperation([], { eligible }, async operation => {
    const settled = await Promise.allSettled([operation.append(row('same')), operation.append(row('same'))]);
    expect(settled.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect(settled.filter(value => value.status === 'rejected')).toHaveLength(1);
    await expect(operation.append(row('foreign', { uid: 'bob' }))).rejects.toThrow(); expect([...operation.prefix()].map(value => value.id)).toEqual(['same']);
  });
});

it('checks exact team membership before any denied vector is read', async () => {
  const f = fixture(), denied = Object.defineProperty(row('denied'), 'embedding', { get() { throw Error('Read denied vector'); } });
  await withSemanticCandidateOperation([denied, row('allowed', { uid: 'bob', teamId: 'crew' })], { eligible: semanticCandidateEligibility('alice', 'crew'), createWorker: f.createWorker }, async (operation, guard) => {
    const selected = await selectSemanticWriteNeighbors([1, 0], operation.prefix(), { assertCurrent: guard }); expect(selected.neighbors[0].candidate.id).toBe('allowed'); expect(selected.count).toBe(1);
  });
});

it.each(['personal', 'team'] as const)('retires the operation on a %s key event before a query starts', async kind => {
  const f = fixture(); await expect(withSemanticCandidateOperation([row('a')], { eligible, createWorker: f.createWorker }, async operation => {
    for (const observer of observers[kind]) observer(); expect(() => operation.prefix()).toThrow('semantic_write_unavailable');
  })).rejects.toThrow(); expect(f.createWorker).not.toHaveBeenCalled();
});

it('terminates an in-flight query on retirement and removes every observer', async () => {
  const f = fixture(); f.worker.hold = true;
  await expect(withSemanticCandidateOperation([row('a')], { eligible, createWorker: f.createWorker }, async (operation, guard) => {
    const pending = selectSemanticWriteNeighbors([1, 0], operation.prefix(), { assertCurrent: guard });
    await vi.waitFor(() => expect(f.worker.postMessage.mock.calls.some(([message]) => message.type === 'query')).toBe(true));
    for (const observer of observers.personal) observer(); await pending;
  })).rejects.toThrow(); expect(f.worker.terminate).toHaveBeenCalledOnce();
});

it('disposes after work failure and rejects later queries against its saved prefix', async () => {
  const f = fixture(); let saved: Iterable<ReturnType<typeof row>> = [];
  await expect(withSemanticCandidateOperation([row('a')], { eligible, createWorker: f.createWorker }, async operation => { saved = operation.prefix() as typeof saved; await selectSemanticWriteNeighbors([1, 0], saved, {}); throw Error('Synthetic extraction failed'); })).rejects.toThrow('Synthetic extraction failed');
  expect(f.worker.terminate).toHaveBeenCalledOnce(); await expect(selectSemanticWriteNeighbors([1, 0], saved, {})).rejects.toThrow();
});
