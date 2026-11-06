import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const observers = vi.hoisted(() => ({ personal: new Set<() => void>(), team: new Set<() => void>() }));
vi.mock('../services/memoryCrypto', () => ({ onMemoryCryptoChanged: (callback: () => void) => { observers.personal.add(callback); return () => observers.personal.delete(callback); } }));
vi.mock('../services/teamVault', () => ({ onTeamKeyChanged: (callback: () => void) => { observers.team.add(callback); return () => observers.team.delete(callback); } }));
import { useMemoryView } from './useMemoryView';
import { MemoryViewWorkerMock } from '../test/memoryViewWorkerMock';
import type { MemoryObject } from '../types/universe';

const memory = (id: string): MemoryObject => ({ id, uid: 'synthetic', text: id, timestamp: 1, updatedAt: 1, importance: .5,
  celestialType: 'planet', position: [0, 0, 0], embedding: [], connections: [] });
const options = { mode: 'list', query: '', locale: 'en', limit: 100 } as const;
beforeEach(() => { MemoryViewWorkerMock.instances = []; vi.stubGlobal('Worker', MemoryViewWorkerMock); });
afterEach(() => vi.unstubAllGlobals());
describe('memory view lifecycle', () => {
  it('hides the old result immediately on source change and publishes only current object references', async () => {
    const a = memory('a'), b = memory('b');
    const { result, rerender } = renderHook(({ rows }) => useMemoryView(rows, options), { initialProps: { rows: [a] } });
    await waitFor(() => expect(result.current.memories).toEqual([a]));
    rerender({ rows: [b] }); expect(result.current.memories).toEqual([]); expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.memories[0]).toBe(b));
    expect(result.current.lookup.has('a')).toBe(false);
  });
  it.each(['personal', 'team'] as const)('terminates plaintext state synchronously on %s key retirement and cannot retry the retired source', async kind => {
    const a = memory('a'), { result, rerender } = renderHook(({ rows }) => useMemoryView(rows, options), { initialProps: { rows: [a] } });
    await waitFor(() => expect(result.current.memories).toHaveLength(1));
    const worker = MemoryViewWorkerMock.instances[0];
    act(() => { for (const callback of observers[kind]) callback(); });
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(result.current.memories).toEqual([]);
    act(() => result.current.retry()); expect(MemoryViewWorkerMock.instances).toHaveLength(1);
    rerender({ rows: [memory('current-key')] });
    await waitFor(() => expect(result.current.memories.map(row => row.id)).toEqual(['current-key']));
    expect(MemoryViewWorkerMock.instances).toHaveLength(2);
  });
  it('aborts pending work on unmount and detaches key observers', async () => {
    const worker = new MemoryViewWorkerMock(); worker.postMessage.mockImplementation(() => undefined);
    vi.stubGlobal('Worker', class { constructor() { return worker; } });
    const { unmount } = renderHook(() => useMemoryView([memory('pending')], options));
    expect(worker.postMessage).toHaveBeenCalledOnce(); unmount();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(observers.personal.size).toBe(0); expect(observers.team.size).toBe(0);
    await act(async () => worker.onmessage?.({ data: { v: 1, id: 1, ok: true, count: 1, ids: ['pending'] } }));
  });
  it('does not accept a delayed old query after a newer query is requested', async () => {
    const workers: MemoryViewWorkerMock[] = [];
    vi.stubGlobal('Worker', class { constructor() { const worker = new MemoryViewWorkerMock(); worker.postMessage.mockImplementation(() => undefined); workers.push(worker); return worker; } });
    const rows = [memory('a')], { result, rerender } = renderHook(({ query }) => useMemoryView(rows, query), { initialProps: { query: { ...options, query: 'old' } } });
    rerender({ query: { ...options, query: 'new' } }); expect(workers[0].terminate).toHaveBeenCalledOnce();
    await act(async () => workers[0].onmessage?.({ data: { v: 1, id: 1, ok: true, count: 1, ids: ['a'] } }));
    expect(result.current.memories).toEqual([]);
    const request = workers[1].postMessage.mock.calls[0][0];
    await act(async () => workers[1].onmessage?.({ data: { v: 1, id: request.id, ok: true, count: 0, ids: [] } }));
    expect(result.current.loading).toBe(false); expect(result.current.error).toBe(false); expect(result.current.count).toBe(0);
  });
});
