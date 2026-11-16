import { beforeEach, expect, it, vi } from 'vitest';
import { auth } from '../firebase';
import { discoverTeamDeletions, localTeamDeletion, requestTeamDeletion, type TeamDeletionClientDeps } from './teamDeletion';
vi.mock('../firebase', () => ({ default: {}, auth: { currentUser: { uid: 'alice' } } }));
vi.mock('firebase/auth', async importOriginal => ({ ...await importOriginal<typeof import('firebase/auth')>(), onAuthStateChanged: vi.fn(() => vi.fn()) }));
const checkpointKey = 'mnemosyne:team-deletion:v1:alice';
function fixture() {
  let uid: string | null = 'alice'; let listener: (() => void) | undefined; let current = true;
  const stop = vi.fn(); const cleanup = vi.fn();
  const call = vi.fn<(name: string, input: unknown) => Promise<unknown>>(async () => ({ uid: 'alice', teamId: 'crew', status: 'pending', retryAt: 1000 }));
  const deps: TeamDeletionClientDeps = { currentUid: () => uid, observeAuth: callback => { listener = callback; return stop; },
    storage: localStorage, call, cleanup, isCurrent: () => current };
  return { deps, call, cleanup, stop, change: (next: string | null) => { uid = next; listener?.(); }, leave: () => { current = false; } };
}
beforeEach(() => { localStorage.clear(); Object.assign(auth, { currentUser: { uid: 'alice' } }); });
it('keeps the closed default gate from saving or sending a new deletion', async () => {
  await expect(requestTeamDeletion('alice', 'crew', 'start')).rejects.toThrow(/em validação/);
  expect(localStorage.getItem(checkpointKey)).toBeNull();
});
it('persists the exact confirmed account and team before dispatch; pending preserves local keys and drafts', async () => {
  const f = fixture(); f.call.mockImplementation(async (name, input) => {
    expect(name).toBe('deleteTeam'); expect(input).toEqual({ teamId: 'crew', expectedUid: 'alice' });
    expect(JSON.parse(localStorage.getItem(checkpointKey)!)).toEqual({ v: 1, uid: 'alice', teamId: 'crew', phase: 'pending' });
    return { uid: 'alice', teamId: 'crew', status: 'pending', retryAt: 1000 };
  });
  expect((await requestTeamDeletion('alice', 'crew', 'start', f.deps)).status).toBe('pending');
  expect(f.cleanup).not.toHaveBeenCalled(); expect(localTeamDeletion('alice')).toEqual({ teamId: 'crew' }); expect(f.stop).toHaveBeenCalledOnce();
});
it('retains recovery after lost, malformed, mismatched or premature acknowledgements', async () => {
  for (const reply of [null, { uid: 'bob', teamId: 'crew', status: 'complete', retryAt: null },
    { uid: 'alice', teamId: 'other', status: 'complete', retryAt: null },
    { uid: 'alice', teamId: 'crew', status: 'unknown', retryAt: null },
    { uid: 'alice', teamId: 'crew', status: 'complete', retryAt: 1 },
    { uid: 'alice', teamId: 'crew', status: 'pending', retryAt: -1 },
    { uid: 'alice', teamId: 'crew', status: 'complete', retryAt: null, diagnostic: 'synthetic' }]) {
    localStorage.clear(); const f = fixture(); f.call.mockResolvedValue(reply);
    await expect(requestTeamDeletion('alice', 'crew', 'start', f.deps)).rejects.toThrow();
    expect(f.cleanup).not.toHaveBeenCalled(); expect(localStorage.getItem(checkpointKey)).toContain('pending');
  }
  localStorage.clear(); const f = fixture(); f.call.mockRejectedValue(Error('synthetic lost ACK'));
  await expect(requestTeamDeletion('alice', 'crew', 'start', f.deps)).rejects.toThrow();
  expect(localTeamDeletion('alice')).toEqual({ teamId: 'crew' }); expect(f.cleanup).not.toHaveBeenCalled();
});
it('checks status first on restart and preserves remote completion across a failed local cleanup', async () => {
  const f = fixture(); await requestTeamDeletion('alice', 'crew', 'start', f.deps); f.call.mockClear();
  f.call.mockResolvedValue({ uid: 'alice', teamId: 'crew', status: 'complete', retryAt: null });
  f.cleanup.mockImplementationOnce(() => { throw Error('synthetic local failure'); });
  await expect(requestTeamDeletion('alice', 'crew', 'resume', f.deps)).rejects.toThrow();
  expect(f.call).toHaveBeenCalledExactlyOnceWith('getTeamDeletionStatus', { teamId: 'crew', expectedUid: 'alice' });
  expect(JSON.parse(localStorage.getItem(checkpointKey)!).phase).toBe('remote-complete'); f.call.mockClear();
  expect((await requestTeamDeletion('alice', 'crew', 'resume', f.deps)).status).toBe('complete');
  expect(f.call).not.toHaveBeenCalled(); expect(localStorage.getItem(checkpointKey)).toBeNull();
});
it('can recover an acknowledged server request without local preparation and refuses unknown unconfirmed requests', async () => {
  const f = fixture(); f.call.mockResolvedValue({ uid: 'alice', teamId: 'crew', status: 'unknown', retryAt: null });
  await expect(requestTeamDeletion('alice', 'crew', 'resume', f.deps)).rejects.toThrow();
  expect(f.call).toHaveBeenCalledOnce(); expect(localStorage.getItem(checkpointKey)).toBeNull();
  f.call.mockClear(); f.call.mockResolvedValue({ uid: 'alice', teamId: 'crew', status: 'complete', retryAt: null });
  expect((await requestTeamDeletion('alice', 'crew', 'resume', f.deps)).status).toBe('complete');
  expect(f.cleanup).toHaveBeenCalledExactlyOnceWith('alice', 'crew'); expect(f.call).toHaveBeenCalledOnce();
});
it('rejects account changes away and back, Auth loss and stale contexts while a response is in flight', async () => {
  for (const change of ['account', 'auth', 'view', 'caller'] as const) {
    localStorage.clear(); const f = fixture(); let active = true;
    f.call.mockImplementation(async () => {
      if (change === 'account') { f.change('bob'); f.change('alice'); }
      if (change === 'auth') f.change(null); if (change === 'view') f.leave(); if (change === 'caller') active = false;
      return { uid: 'alice', teamId: 'crew', status: 'complete', retryAt: null };
    });
    await expect(requestTeamDeletion('alice', 'crew', 'start', f.deps, () => active)).rejects.toThrow();
    expect(f.cleanup).not.toHaveBeenCalled(); expect(localStorage.getItem(checkpointKey)).toContain('pending'); expect(f.stop).toHaveBeenCalledOnce();
  }
});
it('preserves another team request and corrupt or swapped-account journals without dispatch', async () => {
  for (const raw of ['{broken', JSON.stringify({ v: 1, uid: 'bob', teamId: 'crew', phase: 'pending' }),
    JSON.stringify({ v: 1, uid: 'alice', teamId: 'other', phase: 'pending' }),
    JSON.stringify({ v: 1, uid: 'alice', teamId: 'crew', phase: 'complete' })]) {
    const f = fixture(); localStorage.setItem(checkpointKey, raw);
    await expect(requestTeamDeletion('alice', 'crew', 'start', f.deps)).rejects.toThrow();
    expect(localStorage.getItem(checkpointKey)).toBe(raw); expect(f.call).not.toHaveBeenCalled(); expect(f.cleanup).not.toHaveBeenCalled();
  }
});
it('refuses a non-durable journal before sending and validates IDs and mode before observing Auth', async () => {
  const f = fixture(); f.deps.storage = { ...localStorage, getItem: () => null, setItem: vi.fn() } as Storage;
  await expect(requestTeamDeletion('alice', 'crew', 'start', f.deps)).rejects.toThrow(); expect(f.call).not.toHaveBeenCalled();
  for (const [uid, teamId, mode] of [['alice/other', 'crew', 'start'], ['alice', '../crew', 'start'], ['alice', 'crew', 'invalid']]) {
    const next = fixture(); next.deps.observeAuth = vi.fn(next.deps.observeAuth);
    await expect(requestTeamDeletion(uid, teamId, mode as 'start', next.deps)).rejects.toThrow(); expect(next.deps.observeAuth).not.toHaveBeenCalled();
  }
});
it('discovers only the current owner requests without writing a checkpoint or starting deletion', async () => {
  const f = fixture(); const requests = Array.from({ length: 25 }, (_, index) => ({ uid: 'alice', teamId: `team-${index}`, status: 'pending', retryAt: 1000 }));
  f.call.mockResolvedValue({ uid: 'alice', requests, nextAfterTeamId: 'team-24' });
  expect(await discoverTeamDeletions('alice', null, f.deps)).toEqual({ uid: 'alice', requests, nextAfterTeamId: 'team-24' });
  expect(f.call).toHaveBeenCalledExactlyOnceWith('getPendingTeamDeletions', { expectedUid: 'alice', afterTeamId: null });
  expect(localStorage.length).toBe(0); expect(f.cleanup).not.toHaveBeenCalled(); f.call.mockClear();
  f.call.mockResolvedValue({ uid: 'alice', requests: [], nextAfterTeamId: null });
  await discoverTeamDeletions('alice', 'team-24', f.deps);
  expect(f.call).toHaveBeenCalledExactlyOnceWith('getPendingTeamDeletions', { expectedUid: 'alice', afterTeamId: 'team-24' });
});
it('rejects foreign, duplicate, completed, excessive or malformed discovery results and stale Auth', async () => {
  const request = { uid: 'alice', teamId: 'crew', status: 'pending', retryAt: 1000 };
  for (const value of [null, { uid: 'bob', requests: [], nextAfterTeamId: null },
    { uid: 'alice', requests: [request, request], nextAfterTeamId: null },
    { uid: 'alice', requests: [{ ...request, uid: 'bob' }], nextAfterTeamId: null },
    { uid: 'alice', requests: [{ ...request, status: 'complete', retryAt: null }], nextAfterTeamId: null },
    { uid: 'alice', requests: [request], nextAfterTeamId: 'crew' },
    { uid: 'alice', requests: Array.from({ length: 26 }, (_, index) => ({ ...request, teamId: `team-${index}` })), nextAfterTeamId: null }]) {
    const f = fixture(); f.call.mockResolvedValue(value); await expect(discoverTeamDeletions('alice', null, f.deps)).rejects.toThrow();
    expect(localStorage.length).toBe(0); expect(f.cleanup).not.toHaveBeenCalled();
  }
  const f = fixture(); f.call.mockImplementation(async () => { f.change('bob'); f.change('alice'); return { uid: 'alice', requests: [request], nextAfterTeamId: null }; });
  await expect(discoverTeamDeletions('alice', null, f.deps)).rejects.toThrow(); expect(f.stop).toHaveBeenCalledOnce();
});
