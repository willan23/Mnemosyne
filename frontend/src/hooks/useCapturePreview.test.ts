import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const observers = vi.hoisted(() => ({ personal: new Set<() => void>(), team: new Set<() => void>() }));
vi.mock('../services/memoryCrypto', () => ({ onMemoryCryptoChanged: (callback: () => void) => { observers.personal.add(callback); return () => observers.personal.delete(callback); } }));
vi.mock('../services/teamVault', () => ({ onTeamKeyChanged: (callback: () => void) => { observers.team.add(callback); return () => observers.team.delete(callback); } }));
import { useCapturePreview } from './useCapturePreview';
import { CapturePreviewWorkerMock } from '../test/capturePreviewWorkerMock';
import type { SessionData } from './useSessions';
import type { CapturePreviewScope } from '../services/capturePreviewClient';
const row = (id: string): SessionData => ({ id, uid: 'alice', text: 'Synthetic astronomical observation', timestamp: 1, updatedAt: 1 });
const scope = { key: 'alice', uid: 'alice' }, query = 'astronomical observation';
beforeEach(() => { CapturePreviewWorkerMock.instances = []; vi.stubGlobal('Worker', CapturePreviewWorkerMock); });
afterEach(() => vi.unstubAllGlobals());
it('hides results immediately when the query/source/scope changes and only returns original current objects', async () => {
  const a = row('a'), rows = [a];
  const { result, rerender } = renderHook(({ source, text, selected }) => useCapturePreview(source, text, selected), { initialProps: { source: rows, text: query, selected: scope as CapturePreviewScope | null } });
  await waitFor(() => expect(result.current[0]?.memory).toBe(a)); const worker = CapturePreviewWorkerMock.instances[0];
  rerender({ source: rows, text: query + ' revised', selected: scope }); expect(result.current).toEqual([]);
  await waitFor(() => expect(result.current[0]?.memory).toBe(a)); expect(CapturePreviewWorkerMock.instances).toHaveLength(1);
  expect(worker.postMessage.mock.calls[1][0].changed).toEqual([]);
  const b = row('b'); rerender({ source: [b], text: query, selected: scope }); expect(result.current).toEqual([]);
  await waitFor(() => expect(result.current[0]?.memory).toBe(b));
  rerender({ source: [b], text: query, selected: { key: 'bob', uid: 'bob' } }); expect(result.current).toEqual([]);
  await waitFor(() => expect(worker.terminate).toHaveBeenCalled()); await act(async () => {}); expect(result.current).toEqual([]);
});
it.each(['personal', 'team'] as const)('retires plaintext on %s key events and refuses the old source until replaced', async kind => {
  const rows = [row('a')], { result, rerender } = renderHook(({ source, text }) => useCapturePreview(source, text, scope), { initialProps: { source: rows, text: query } });
  await waitFor(() => expect(result.current).toHaveLength(1)); const worker = CapturePreviewWorkerMock.instances[0];
  act(() => { for (const callback of observers[kind]) callback(); }); expect(result.current).toEqual([]); expect(worker.terminate).toHaveBeenCalledOnce();
  rerender({ source: rows, text: query + ' revised' }); await act(async () => {}); expect(CapturePreviewWorkerMock.instances).toHaveLength(1);
  rerender({ source: [row('new-key')], text: query }); await waitFor(() => expect(result.current[0]?.memory.id).toBe('new-key'));
});
it('aborts pending work on scope loss and unmount and detaches observers', async () => {
  const worker = new CapturePreviewWorkerMock(); worker.postMessage.mockImplementation(() => {}); vi.stubGlobal('Worker', class { constructor() { return worker; } });
  const rows = [row('a')], { result, rerender, unmount } = renderHook(({ selected }) => useCapturePreview(rows, query, selected), { initialProps: { selected: scope as CapturePreviewScope | null } });
  expect(worker.postMessage).toHaveBeenCalledOnce(); rerender({ selected: null }); expect(result.current).toEqual([]); expect(worker.terminate).toHaveBeenCalledOnce();
  unmount(); expect(observers.personal.size).toBe(0); expect(observers.team.size).toBe(0);
});
it('does not create a Worker for short drafts or unavailable scopes', async () => {
  const rows = [row('a')], { result } = renderHook(() => useCapturePreview(rows, 'short', scope));
  await act(async () => {}); expect(result.current).toEqual([]); expect(CapturePreviewWorkerMock.instances).toHaveLength(0);
});
it('discards an old pending query even when its message callback is invoked after cancellation', async () => {
  const workers: CapturePreviewWorkerMock[] = [];
  vi.stubGlobal('Worker', class { constructor() { const worker = new CapturePreviewWorkerMock(); worker.postMessage.mockImplementation(() => {}); workers.push(worker); return worker; } });
  const rows = [row('a')], { result, rerender } = renderHook(({ text }) => useCapturePreview(rows, text, scope), { initialProps: { text: query } });
  const late = workers[0].onmessage;
  rerender({ text: query + ' current' }); expect(workers[0].terminate).toHaveBeenCalledOnce();
  await act(async () => late?.({ data: { v: 1, id: 1, ok: true, hits: [{ id: 'a', score: .9 }] } }));
  expect(result.current).toEqual([]);
  const request = workers[1].postMessage.mock.calls[0][0];
  await act(async () => workers[1].onmessage?.({ data: { v: 1, id: request.id, ok: true, hits: [] } })); expect(result.current).toEqual([]);
});
