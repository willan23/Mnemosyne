import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: { currentUser: null as { uid: string } | null }, next: undefined as ((user: { uid: string } | null) => void) | undefined,
  error: undefined as (() => void) | undefined, initialize: vi.fn(), stop: vi.fn() }));
vi.mock('../firebase', () => ({ auth: state.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_: unknown, next: typeof state.next, error: typeof state.error) => { state.next = next; state.error = error; return state.stop; } }));
vi.mock('../services/accountBootstrap', () => ({ initializeAccount: (...args: unknown[]) => state.initialize(...args) }));
import { useAccountSession } from './useAccountSession';
const deferred = () => { let resolve!: () => void, reject!: () => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function auth(uid: string | null) { act(() => { state.auth.currentUser = uid ? { uid } : null; state.next?.(state.auth.currentUser); }); }
beforeEach(() => { vi.clearAllMocks(); state.auth.currentUser = null; state.initialize.mockResolvedValue(undefined); });
afterEach(cleanup);
it('withholds the workspace until the server-owned account is ready', async () => {
  const pending = deferred(); state.initialize.mockReturnValue(pending.promise); const changed = vi.fn();
  const { result } = renderHook(() => useAccountSession(changed)); auth('alice');
  expect(result.current).toMatchObject({ user: null, ready: false, failed: false });
  await act(async () => pending.resolve());
  expect(result.current).toMatchObject({ user: { uid: 'alice' }, ready: true, failed: false }); expect(changed).toHaveBeenCalledTimes(1);
});
it('logout retires an in-flight initialization and never restores the previous user', async () => {
  const pending = deferred(); state.initialize.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useAccountSession(vi.fn())); auth('alice'); auth(null);
  await act(async () => pending.resolve()); expect(result.current).toMatchObject({ user: null, ready: true, failed: false });
});
it('account switches away and back latch out old results even when the UID matches again', async () => {
  const a = deferred(), b = deferred(), again = deferred(); state.initialize.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(again.promise);
  const { result } = renderHook(() => useAccountSession(vi.fn())); auth('alice'); auth('bob'); auth('alice');
  await act(async () => { a.resolve(); b.reject(); }); expect(result.current).toMatchObject({ user: null, ready: false, failed: false });
  await act(async () => again.resolve()); expect(result.current.user?.uid).toBe('alice'); expect(result.current.ready).toBe(true);
});
it('a failed bootstrap exposes retry without admitting the workspace', async () => {
  state.initialize.mockRejectedValueOnce(new Error('synthetic refusal'));
  const { result } = renderHook(() => useAccountSession(vi.fn())); auth('alice');
  await waitFor(() => expect(result.current.failed).toBe(true)); expect(result.current.user).toBeNull(); expect(result.current.ready).toBe(false);
  act(() => result.current.retry()); auth('alice');
  await waitFor(() => expect(result.current.ready).toBe(true)); expect(result.current.user?.uid).toBe('alice'); expect(result.current.failed).toBe(false);
});
it('an Auth error retires an earlier request', async () => {
  const pending = deferred(); state.initialize.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useAccountSession(vi.fn())); auth('alice'); act(() => state.error?.()); await act(async () => pending.resolve());
  expect(result.current).toMatchObject({ user: null, ready: false, failed: true });
});
it('unmount stops Auth observation and ignores queued callbacks', async () => {
  const changed = vi.fn(), pending = deferred(); state.initialize.mockReturnValue(pending.promise);
  const { unmount } = renderHook(() => useAccountSession(changed)); auth('alice'); unmount();
  await act(async () => { state.next?.({ uid: 'bob' }); state.error?.(); pending.resolve(); });
  expect(changed).toHaveBeenCalledTimes(1); expect(state.stop).toHaveBeenCalledOnce(); expect(state.initialize).toHaveBeenCalledOnce();
});
