import { afterEach, describe, expect, it, vi } from 'vitest';
const observers = vi.hoisted(() => ({ personal: new Set<() => void>(), team: new Set<() => void>() }));
vi.mock('./memoryCrypto', () => ({ onMemoryCryptoChanged: (callback: () => void) => { observers.personal.add(callback); return () => observers.personal.delete(callback); } }));
vi.mock('./teamVault', () => ({ onTeamKeyChanged: (callback: () => void) => { observers.team.add(callback); return () => observers.team.delete(callback); } }));
import { selectSemanticWriteNeighbors, withSemanticWriteScope } from './semanticWriteClient';
import { SemanticWriteWorkerMock } from '../test/semanticWriteWorkerMock';
import { CURRENT_EMBEDDING_SPACE } from './embeddingModel';
import { isPersonalSemanticCandidate } from './personalSemanticScope';
import type { SemanticWriteCandidate } from './semanticWriteProtocol';

const candidate = (id: string, extra: Partial<SemanticWriteCandidate> = {}): SemanticWriteCandidate => ({ id, uid: 'alice', embedding: [1, 0], embeddingModel: CURRENT_EMBEDDING_SPACE, position: [1, 2, 3], semanticClusterId: 'PRIVATE-CLUSTER', ...extra });
const fixture = () => { const worker = new SemanticWriteWorkerMock(); return { worker, createWorker: () => worker as unknown as Worker, yieldTask: vi.fn(async () => undefined) }; };
afterEach(() => vi.useRealTimers());
describe('bounded semantic write jobs', () => {
  it('isolates concurrent jobs in separate Workers and destroys both after completion', async () => {
    const first = fixture(), second = fixture();
    const [a, b] = await Promise.all([
      selectSemanticWriteNeighbors([1, 0], [candidate('a')], first),
      selectSemanticWriteNeighbors([0, 1], [candidate('b', { embedding: [0, 1] })], second),
    ]);
    expect(a.neighbors.map(row => row.candidate.id)).toEqual(['a']);
    expect(b.neighbors.map(row => row.candidate.id)).toEqual(['b']);
    expect(first.worker.terminate).toHaveBeenCalledOnce(); expect(second.worker.terminate).toHaveBeenCalledOnce();
  });
  it('applies eligibility before reading or projecting a vector and sends no identity, position or cluster', async () => {
    const setup = fixture(), denied = candidate('denied', { uid: 'bob' });
    Object.defineProperty(denied, 'embedding', { get: () => { throw Error('Denied vector read'); } });
    const result = await selectSemanticWriteNeighbors([1, 0], [denied, candidate('allowed'), candidate('legacy', { embeddingModel: undefined })],
      { ...setup, eligible: row => isPersonalSemanticCandidate(row, 'alice') });
    expect(result.count).toBe(2); expect(result.neighbors.map(row => row.candidate.id)).toEqual(['allowed']);
    const chunk = setup.worker.postMessage.mock.calls[1][0];
    expect(JSON.stringify(chunk)).not.toMatch(/alice|bob|PRIVATE|position|uid|legacy|denied/);
    expect(setup.worker.terminate).toHaveBeenCalledOnce();
  });
  it('bounds every candidate batch and yields even when a complete batch is excluded', async () => {
    const setup = fixture(), rows = Array.from({ length: 400 }, (_, i) => candidate('m' + i, { uid: i < 128 ? 'bob' : 'alice' }));
    const result = await selectSemanticWriteNeighbors([1, 0], rows, { ...setup, eligible: row => row.uid === 'alice' });
    expect(setup.yieldTask).toHaveBeenCalledTimes(3); expect(result.count).toBe(272);
    expect(result.neighbors.map(row => row.candidate.id)).toEqual(Array.from({ length: 7 }, (_, i) => 'm' + (128 + i)));
    const sizes = setup.worker.postMessage.mock.calls.flatMap(([message]) => message.type === 'chunk' ? [message.candidates.length] : []);
    expect(sizes).toEqual([128, 128, 16]);
  });
  it('stops on a changed capture guard before projecting the next batch', async () => {
    const setup = fixture(); let valid = true;
    await expect(selectSemanticWriteNeighbors([1, 0], Array.from({ length: 300 }, (_, i) => candidate('m' + i)), {
      ...setup, assertCurrent: () => { if (!valid) throw Error('Synthetic scope retired'); }, yieldTask: async () => { valid = false; },
    })).rejects.toThrow('Synthetic scope retired');
    expect(setup.worker.postMessage).toHaveBeenCalledTimes(2); expect(setup.worker.terminate).toHaveBeenCalledOnce();
  });
  it.each(['personal', 'team'] as const)('retires inference already in progress on a %s key event', async kind => {
    let finish!: () => void;
    const pending = withSemanticWriteScope({}, async scope => { await new Promise<void>(resolve => { finish = resolve; }); scope.assertCurrent(); return 'forbidden'; });
    const rejected = expect(pending).rejects.toThrow('semantic_write_unavailable');
    for (const callback of observers[kind]) callback(); finish(); await rejected;
    expect(observers.personal.size).toBe(0); expect(observers.team.size).toBe(0);
  });
  it('terminates a pending Worker on scope abort without accepting a late acknowledgement', async () => {
    const setup = fixture(); setup.worker.postMessage.mockImplementation(() => undefined);
    const controller = new AbortController();
    const rejected = expect(selectSemanticWriteNeighbors([1, 0], [candidate('a')], { ...setup, signal: controller.signal })).rejects.toThrow();
    controller.abort(); setup.worker.onmessage?.({ data: { v: 1, seq: 0, ok: true, scores: [] } }); await rejected;
    expect(setup.worker.terminate).toHaveBeenCalledOnce();
  });
  it.each([
    { scores: [['foreign', 1]] }, { scores: [['a', NaN]] }, { scores: [['a', 2]] }, { scores: [['a', .1]] },
    { scores: [['a', 1], ['a', 1]] }, { seq: 999 }, { ok: false }, { scores: [[new String('a'), 1]] },
  ])('rejects invalid or unknown Worker scores %#', async patch => {
    const setup = fixture(); setup.worker.postMessage.mockImplementation(message => queueMicrotask(() => setup.worker.onmessage?.({ data:
      message.type === 'begin' ? { v: 1, seq: 0, ok: true, scores: [] } : { v: 1, seq: message.seq, ok: true, scores: [['a', 1]], ...patch } })));
    await expect(selectSemanticWriteNeighbors([1, 0], [candidate('a')], setup)).rejects.toThrow('semantic_write_unavailable');
    expect(setup.worker.terminate).toHaveBeenCalledOnce();
  });
  it('times out a stalled batch and terminates its Worker', async () => {
    vi.useFakeTimers(); const setup = fixture(); setup.worker.postMessage.mockImplementation(() => undefined);
    const rejected = expect(selectSemanticWriteNeighbors([1, 0], [candidate('a')], setup)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30_000); await rejected; expect(setup.worker.terminate).toHaveBeenCalledOnce();
  });
});
