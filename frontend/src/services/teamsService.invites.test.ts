import { beforeEach, expect, it, vi } from 'vitest';
import { watchPendingInvites } from './teamsService';
import { auth } from '../firebase';
type Row = { id: string; data: () => Record<string, unknown> };
const state = vi.hoisted(() => ({ snapshot: undefined as ((value: { docs: Row[] }) => void) | undefined,
  listeners: new Set<() => void>(), get: vi.fn(), stop: vi.fn(), queries: vi.fn() }));
vi.mock('../firebase', () => ({ default: {}, db: {}, auth: { currentUser: { uid: 'alice' } } }));
vi.mock('firebase/auth', async importOriginal => ({ ...await importOriginal<typeof import('firebase/auth')>(),
  onAuthStateChanged: (_auth: unknown, changed: () => void) => { void _auth; state.listeners.add(changed); return () => state.listeners.delete(changed); } }));
vi.mock('firebase/firestore', async importOriginal => ({ ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, name: string) => { void _db; return { name }; },
  doc: (_db: unknown, name: string, id: string) => { void _db; return { name, id }; },
  query: (...args: unknown[]) => { state.queries(...args); return args; }, where: (...args: unknown[]) => args,
  getDocFromServer: (ref: unknown) => state.get(ref),
  onSnapshot: (_query: unknown, changed: (value: { docs: Row[] }) => void) => { void _query; state.snapshot = changed; return state.stop; } }));
const pointer = (id = 'invite') => ({ id, data: () => ({ v: 1, uid: 'alice', teamId: 'crew', inviteId: id }) });
const invite = (id = 'invite', extra: Record<string, unknown> = {}) => ({ id, exists: () => true,
  data: () => ({ uid: 'alice', teamId: 'crew', status: 'pending', createdAt: 1, expiresAt: Date.now() + 60_000,
    wrappedKey: { v: 1, alg: 'RSA-OAEP', ct: 'synthetic' }, ...extra }) });
beforeEach(() => { vi.clearAllMocks(); state.listeners.clear(); state.snapshot = undefined;
  Object.assign(auth, { currentUser: { uid: 'alice' } }); state.get.mockResolvedValue(invite()); });
it('lists opaque recipient pointers and fetches the key only through a fresh individual server read', async () => {
  const changed = vi.fn(); const stop = watchPendingInvites('alice', changed);
  expect(state.queries).toHaveBeenCalledExactlyOnceWith({ name: 'teamInviteInbox' }, ['uid', '==', 'alice']);
  state.snapshot?.({ docs: [pointer()] });
  await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'invite', uid: 'alice', teamId: 'crew' })]));
  expect(state.get).toHaveBeenCalledExactlyOnceWith({ name: 'teamInvites', id: 'invite' }); stop(); expect(state.stop).toHaveBeenCalledOnce();
});
it('ignores unsafe pointers and unavailable, expired, foreign, accepted or team-swapped invitations', async () => {
  for (const mode of ['denied', 'expired', 'foreign', 'accepted', 'team'] as const) {
    const changed = vi.fn(); const stop = watchPendingInvites('alice', changed);
    if (mode === 'denied') state.get.mockRejectedValue(Error('synthetic denied'));
    else state.get.mockResolvedValue(invite('invite', mode === 'expired' ? { expiresAt: 1 } : mode === 'foreign' ? { uid: 'bob' } :
      mode === 'accepted' ? { status: 'accepted' } : { teamId: 'other' }));
    state.snapshot?.({ docs: [pointer(), { id: 'unsafe', data: () => ({ ...pointer().data(), inviteId: 'unsafe', wrappedKey: 'unsafe' }) }] });
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2)); expect(changed).toHaveBeenLastCalledWith([]); stop();
  }
  expect(state.get).toHaveBeenCalledTimes(5);
});
it('discards a late key read after a newer snapshot, unmount or account switch away and back', async () => {
  for (const mode of ['snapshot', 'unmount', 'account'] as const) {
    let resolve!: (value: ReturnType<typeof invite>) => void;
    state.get.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const changed = vi.fn(); const stop = watchPendingInvites('alice', changed); state.snapshot?.({ docs: [pointer()] });
    if (mode === 'snapshot') state.snapshot?.({ docs: [] });
    if (mode === 'unmount') stop();
    if (mode === 'account') {
      Object.assign(auth, { currentUser: { uid: 'bob' } }); state.listeners.forEach(callback => callback());
      Object.assign(auth, { currentUser: { uid: 'alice' } }); state.listeners.forEach(callback => callback());
    }
    resolve(invite()); await new Promise<void>(r => queueMicrotask(r)); await new Promise<void>(r => queueMicrotask(r));
    expect(changed.mock.calls.every(([items]) => items.length === 0)).toBe(true); if (mode !== 'unmount') stop();
  }
});
it('bounds server reads across snapshots and stops dispatching the superseded queue', async () => {
  const pending = new Map<string, (value: ReturnType<typeof invite>) => void>();
  let inFlight = 0; let peak = 0;
  state.get.mockImplementation((ref: { id: string }) => {
    inFlight++; peak = Math.max(peak, inFlight);
    return new Promise(resolve => pending.set(ref.id, value => { inFlight--; resolve(value); }));
  });
  const changed = vi.fn(); const stop = watchPendingInvites('alice', changed);
  state.snapshot?.({ docs: Array.from({ length: 8 }, (_, i) => pointer(`old-${i}`)) });
  expect(state.get).toHaveBeenCalledTimes(4);
  state.snapshot?.({ docs: Array.from({ length: 6 }, (_, i) => pointer(`new-${i}`)) });
  expect(state.get).toHaveBeenCalledTimes(4);
  for (let i = 0; i < 4; i++) pending.get(`old-${i}`)?.(invite(`old-${i}`));
  await vi.waitFor(() => expect(state.get).toHaveBeenCalledTimes(8));
  for (let i = 0; i < 4; i++) pending.get(`new-${i}`)?.(invite(`new-${i}`));
  await vi.waitFor(() => expect(state.get).toHaveBeenCalledTimes(10));
  pending.get('new-4')?.(invite('new-4')); pending.get('new-5')?.(invite('new-5'));
  await vi.waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toHaveLength(6));
  expect(peak).toBe(4); expect(state.get.mock.calls.some(([ref]) => ref.id === 'old-4')).toBe(false);
  expect(changed.mock.calls.at(-1)?.[0].every((value: { id: string }) => value.id.startsWith('new-'))).toBe(true); stop();
});
