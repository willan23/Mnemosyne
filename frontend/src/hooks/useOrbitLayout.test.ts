import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ uid: 'alice' as string | null, ready: true, auth: new Set<(user: { uid: string } | null) => void>(), personal: new Set<() => void>(), team: new Set<() => void>() }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return state.uid ? { uid: state.uid } : null; } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => { state.auth.add(callback); callback(state.uid ? { uid: state.uid } : null); return () => state.auth.delete(callback); } }));
vi.mock('../services/memoryCrypto', () => ({ isMemoryCryptoReady: () => state.ready, onMemoryCryptoChanged: (callback: () => void) => { state.personal.add(callback); return () => state.personal.delete(callback); } }));
vi.mock('../services/teamVault', () => ({ onTeamKeyChanged: (callback: () => void) => { state.team.add(callback); return () => state.team.delete(callback); } }));
import { useOrbitLayout } from './useOrbitLayout';
import { OrbitLayoutWorkerMock } from '../test/orbitLayoutWorkerMock';
import { IncrementalMemoryPublication } from '../services/incrementalMemoryPublication';
import type { MemoryObject } from '../types/universe';
const scope = { uid: 'alice', teamIds: new Set(['crew']) }, ids = Object.freeze(['a']);
const memory = (id: string): MemoryObject => ({ id, uid: scope.uid, text: 'Synthetic orbit metadata', timestamp: 1, updatedAt: 0, celestialType: 'planet', position: [0, 0, 0], connections: [], embedding: [], importance: 0.5 });
beforeEach(() => { state.uid = scope.uid; state.ready = true; OrbitLayoutWorkerMock.instances = []; vi.stubGlobal('Worker', OrbitLayoutWorkerMock); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('starts no inactive Worker and rebuilds frames on reactivation without reusing the previous ready state', async () => {
  const source = [memory('a')], { result, rerender } = renderHook(({ enabled }) => useOrbitLayout(source, ids, scope, enabled), { initialProps: { enabled: false } }); expect(OrbitLayoutWorkerMock.instances).toHaveLength(0);
  rerender({ enabled: true }); await waitFor(() => expect(result.current.ready).toBe(true)); expect(result.current.positionsRef.current.get('a')).toBeDefined(); const oldZero = result.current.zeroTime;
  rerender({ enabled: false }); expect(result.current.positionsRef.current.active()).toBe(false); expect(oldZero.get('a')).toBeUndefined(); expect(OrbitLayoutWorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
  rerender({ enabled: true }); expect(result.current.loading).toBe(true); await waitFor(() => expect(result.current.ready).toBe(true)); expect(OrbitLayoutWorkerMock.instances).toHaveLength(2);
});
it('coalesces RAF requests behind a held sample and keeps the prepared frame available meanwhile', async () => {
  const source = [memory('a')], { result } = renderHook(() => useOrbitLayout(source, ids, scope)); await waitFor(() => expect(result.current.ready).toBe(true)); const worker = OrbitLayoutWorkerMock.instances[0], post = worker.postMessage.getMockImplementation()!; let release: (() => void) | undefined;
  worker.postMessage.mockImplementation(message => { if (!release && message.type === 'sample') release = () => post(message); else post(message); }); const initial = result.current.zeroTime.get('a');
  act(() => result.current.requestFrame(1, 100)); await waitFor(() => expect(release).toBeTypeOf('function')); for (let time = 2; time <= 100; time++) act(() => result.current.requestFrame(time, 100)); expect(result.current.positionsRef.current.get('a')).toEqual(initial); act(() => release!());
  await waitFor(() => expect(worker.postMessage.mock.calls.filter(([message]) => message.type === 'sample').at(-1)?.[0]).toMatchObject({ time: 100 })); await waitFor(() => expect(result.current.positionsRef.current.get('a')).not.toEqual(initial));
  expect(worker.postMessage.mock.calls.filter(([message]) => message.type === 'sample').map(([message]) => message.type === 'sample' ? message.time : null)).toEqual([0, 1, 100]); expect(worker.postMessage.mock.calls.filter(([message]) => message.type === 'patch-start')).toHaveLength(1);
});
it('coalesces ordinary source updates behind initial indexing and applies a subsequent delta', async () => {
  let release: (() => void) | undefined; vi.stubGlobal('Worker', class extends OrbitLayoutWorkerMock { constructor() { super(); const normal = this.postMessage.getMockImplementation()!; this.postMessage.mockImplementation(message => { if (!release && message.type === 'patch-start') release = () => normal(message); else normal(message); }); } });
  const publisher = new IncrementalMemoryPublication<MemoryObject>('asc'), rows = Array.from({ length: 300 }, (_, at) => ({ ...memory('m' + at), timestamp: at })); publisher.apply('source', { changed: rows.map(value => ({ id: value.id, value })), removed: [], order: { reset: rows.map(row => row.id), changes: [] } }); const selected = Object.freeze(['m0']);
  const { result, rerender } = renderHook(({ source }) => useOrbitLayout(source, selected, scope), { initialProps: { source: publisher.snapshot() } }); await waitFor(() => expect(release).toBeTypeOf('function'));
  for (let at = 0; at < 10; at++) { const value = { ...rows[at], position: [100 + at, 0, 0] as [number, number, number] }; publisher.apply('source', { changed: [{ id: value.id, value }], removed: [], order: { changes: [] } }); rerender({ source: publisher.snapshot() }); }
  expect(OrbitLayoutWorkerMock.instances).toHaveLength(1); expect(OrbitLayoutWorkerMock.instances[0].terminate).not.toHaveBeenCalled(); act(() => release!()); await waitFor(() => expect(result.current.ready).toBe(true)); expect(result.current.positionsRef.current.get('m0')![0]).toBeGreaterThan(99);
  const messages = OrbitLayoutWorkerMock.instances[0].postMessage.mock.calls.map(([message]) => message); expect(messages.filter(message => message.type === 'patch-start').map(message => message.type === 'patch-start' ? message.reset : null)).toEqual([true, false]);
});
it.each(['personal', 'team', 'account'] as const)('withdraws all frames and stops sampling on %s retirement until a fresh source arrives', async kind => {
  const source = [memory('a')], { result, rerender } = renderHook(({ rows }) => useOrbitLayout(rows, ids, scope), { initialProps: { rows: source } }); await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.zeroTime, worker = OrbitLayoutWorkerMock.instances[0];
  act(() => { if (kind === 'account') { state.uid = 'other'; for (const callback of state.auth) callback({ uid: 'other' }); } else for (const callback of state[kind]) callback(); });
  expect(result.current.positionsRef.current.active()).toBe(false); expect(old.get('a')).toBeUndefined(); expect(worker.terminate).toHaveBeenCalledOnce(); act(() => result.current.requestFrame(9, 100)); expect(OrbitLayoutWorkerMock.instances).toHaveLength(1);
  act(() => { state.uid = scope.uid; }); rerender({ rows: [memory('a')] }); await waitFor(() => expect(result.current.ready).toBe(true)); expect(result.current.positionsRef.current.get('a')).toBeDefined();
});
it('stops an invalid frame instead of retrying on every RAF and allows an explicit retry', async () => {
  let corrupt = true; vi.stubGlobal('Worker', class extends OrbitLayoutWorkerMock { constructor() { super(); const normal = this.postMessage.getMockImplementation()!; this.postMessage.mockImplementation(message => { if (corrupt && message.type === 'sample') queueMicrotask(() => this.onmessage?.({ data: { v: 1, seq: message.seq, ok: false } })); else normal(message); }); } });
  const source = [memory('a')], { result } = renderHook(() => useOrbitLayout(source, ids, scope)); await waitFor(() => expect(result.current.error).toBe(true)); for (let at = 0; at < 10; at++) act(() => result.current.requestFrame(at, 100)); expect(OrbitLayoutWorkerMock.instances).toHaveLength(1);
  corrupt = false; act(() => result.current.retry()); await waitFor(() => expect(result.current.ready).toBe(true)); expect(OrbitLayoutWorkerMock.instances).toHaveLength(2);
});
it('removes observers and terminates an in-flight sample on unmount', async () => {
  const source = [memory('a')], { result, unmount } = renderHook(() => useOrbitLayout(source, ids, scope)); await waitFor(() => expect(result.current.ready).toBe(true)); const worker = OrbitLayoutWorkerMock.instances[0]; worker.postMessage.mockImplementation(() => {}); act(() => result.current.requestFrame(9, 100)); await waitFor(() => expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'sample', time: 9 })); unmount(); expect(worker.terminate).toHaveBeenCalledOnce(); expect(state.auth.size + state.personal.size + state.team.size).toBe(0);
});
it.each(['removed', 'permission-revoked', 'fence-retired'] as const)('terminates a held frame on %s and ignores its reply after the new baseline', async change => {
  const publisher = new IncrementalMemoryPublication<MemoryObject>('asc'), value = { ...memory('a'), uid: 'other', sharedWithIds: [scope.uid] }; publisher.apply('source', { changed: [{ id: value.id, value }], removed: [], order: { reset: [value.id], changes: [] } });
  const { result, rerender } = renderHook(({ source }) => useOrbitLayout(source, ids, scope), { initialProps: { source: publisher.snapshot() } }); await waitFor(() => expect(result.current.ready).toBe(true)); const worker = OrbitLayoutWorkerMock.instances[0], old = result.current.zeroTime; let release: (() => void) | undefined;
  worker.postMessage.mockImplementation(message => { const data = { v: 1, seq: message.seq, ok: true, ...worker.index.handle(structuredClone(message)) }; release = () => worker.onmessage?.({ data }); }); act(() => result.current.requestFrame(5, 100)); await waitFor(() => expect(release).toBeTypeOf('function'));
  if (change === 'removed') publisher.apply('source', { changed: [], removed: ['a'], order: { changes: [{ type: 'removed', id: 'a', oldIndex: 0, newIndex: -1 }] } });
  else if (change === 'permission-revoked') publisher.apply('source', { changed: [{ id: 'a', value: { ...value, sharedWithIds: [], get position(): [number, number, number] { throw Error('Read revoked coordinates'); } } }], removed: [], order: { changes: [] } });
  else { publisher.clear(); publisher.apply('source', { changed: [{ id: 'a', value: { ...memory('a'), position: [10, 0, 0] } }], removed: [], order: { reset: ['a'], changes: [] } }); }
  rerender({ source: publisher.snapshot() }); expect(worker.terminate).toHaveBeenCalledOnce(); expect(old.get('a')).toBeUndefined(); await waitFor(() => expect(result.current.ready).toBe(true)); const current = result.current.positionsRef.current.get('a'); expect(Boolean(current)).toBe(change === 'fence-retired'); act(() => release!()); expect(result.current.positionsRef.current.get('a')).toEqual(current); expect(OrbitLayoutWorkerMock.instances).toHaveLength(2);
});
it('withdraws team coordinates on membership change before reading the denied row again', async () => {
  const value = { ...memory('a'), uid: 'other', teamId: 'crew' }, source = [value], { result, rerender } = renderHook(({ readScope }) => useOrbitLayout(source, ids, readScope), { initialProps: { readScope: scope } }); await waitFor(() => expect(result.current.ready).toBe(true)); const old = result.current.zeroTime;
  Object.defineProperty(value, 'position', { get() { throw Error('Read team coordinates after membership removal'); } }); rerender({ readScope: { uid: scope.uid, teamIds: new Set<string>() } }); expect(old.get('a')).toBeUndefined(); expect(result.current.positionsRef.current.get('a')).toBeUndefined(); await waitFor(() => expect(result.current.ready).toBe(true)); expect(result.current.zeroTime.size).toBe(0);
});
