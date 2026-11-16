import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({uid: 'alice', enabled: true, pending: false, persist: vi.fn(), read: vi.fn(), clear: vi.fn(), queue: vi.fn(), navigate: vi.fn(), location: {pathname: '/', search: ''}}));
vi.mock('../config/releaseGates', () => ({get CLIP_CAPTURE_ENABLED() {return state.enabled;}}));
vi.mock('../firebase', () => ({auth: {get currentUser() {return {uid: state.uid};}}}));
vi.mock('react-router-dom', () => ({useLocation: () => state.location, useNavigate: () => state.navigate}));
vi.mock('../services/clipCaptureService', () => ({persistClippedMemory: (...args: unknown[]) => state.persist(...args), hasPendingClipCapture: () => state.pending, observeClipCaptures: () => vi.fn()}));
vi.mock('../utils/clipCapture', () => ({PENDING_CLIP_KEY: 'synthetic-clip', readPendingClip: () => state.read(), clearPendingClip: () => state.clear(),
  ingestClipFromLocation: () => null, clipIngressFailed: () => false, writePendingClip: (...args: unknown[]) => state.queue(...args)}));
vi.mock('react-hot-toast', () => ({default: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn()})}));
import toast from 'react-hot-toast';
import { useClipCapture } from './useClipCapture';
const clip = {text: 'Synthetic clip', title: 'Synthetic title', url: 'https://example.test/'};
const options = {uid: 'alice', isAuthenticated: true, mnemonicReady: true, subscriptionReady: true, canCreateMemory: true, onMemoryCreated: vi.fn()};
beforeEach(() => {vi.clearAllMocks(); sessionStorage.clear(); state.uid = 'alice'; state.pending = false; state.enabled = true; state.read.mockReturnValue(clip); state.queue.mockReturnValue(true);});
afterEach(cleanup);
it('binds the incoming queue first, clears only after verified checkpoint, and calls completion after acknowledgement', async () => {
  let finish!: (id: string) => void; state.persist.mockImplementationOnce((_uid, _clip, prepared) => {prepared(); return new Promise<string>(resolve => {finish = resolve;});});
  renderHook(() => useClipCapture(options)); expect(state.queue).toHaveBeenCalledExactlyOnceWith(clip, 'alice'); expect(state.clear).toHaveBeenCalledOnce();
  expect(options.onMemoryCreated).not.toHaveBeenCalled(); await act(async () => finish('synthetic-id')); expect(options.onMemoryCreated).toHaveBeenCalledExactlyOnceWith('synthetic-id');
});
it('never consumes or starts another clip while a checkpoint is pending, quota is exhausted or binding cannot be verified', () => {
  for (const mode of ['pending','quota','storage','closed']) {
    vi.clearAllMocks(); state.enabled = mode !== 'closed'; state.pending = mode === 'pending'; state.queue.mockReturnValue(mode !== 'storage');
    const view = renderHook(() => useClipCapture({...options, canCreateMemory: mode !== 'quota'})); expect(state.persist).not.toHaveBeenCalled(); expect(state.clear).not.toHaveBeenCalled(); view.unmount();
  }
});
it('conserves raw input on preparation failure and never requeues a failed outbound operation as a new capture', async () => {
  state.persist.mockRejectedValueOnce(new Error('Synthetic private transport diagnostic')); renderHook(() => useClipCapture(options));
  await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Não foi possível confirmar a captura. A operação cifrada ou o clip de entrada foram conservados para recuperação.', {id: 'clip-persist'}));
  expect(state.clear).not.toHaveBeenCalled(); expect(state.queue).toHaveBeenCalledTimes(1); expect(options.onMemoryCreated).not.toHaveBeenCalled();
});
it('preserves a newly queued clip if it replaced the incoming clip during encryption', async () => {
  state.persist.mockImplementationOnce((_uid, _clip, prepared) => {state.read.mockReturnValue({...clip, text: 'Other synthetic clip'}); prepared(); return Promise.resolve('synthetic-id');});
  renderHook(() => useClipCapture(options)); await waitFor(() => expect(options.onMemoryCreated).toHaveBeenCalled()); expect(state.clear).not.toHaveBeenCalled();
});
it('suppresses callbacks, feedback and extra queue writes after changing account or unmounting', async () => {
  for (const mode of ['account','unmount']) {
    vi.clearAllMocks(); state.uid = 'alice'; state.queue.mockReturnValue(true); state.read.mockReturnValue(clip);
    let reject!: (error: Error) => void; state.persist.mockImplementationOnce(() => new Promise<string>((_resolve, failure) => {reject = failure;}));
    const view = renderHook(() => useClipCapture(options)); if (mode === 'account') state.uid = 'bob'; else view.unmount();
    await act(async () => reject(new Error('Synthetic failure'))); expect(state.queue).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled(); expect(options.onMemoryCreated).not.toHaveBeenCalled(); cleanup();
  }
});
