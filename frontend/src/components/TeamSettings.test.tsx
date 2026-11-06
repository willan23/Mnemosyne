import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import { useUniverseStore } from '../store/universeStore';
import { completeTeamRotationWithRecovery, discardTeamRotationCheckpoint, TeamRotationRecoveryError } from '../services/teamRotationRecovery';
import { TeamSettings } from './TeamSettings';
import { cancelPendingTeamCreation, createTeamWithActiveEpoch, TeamCreationError } from '../services/teamCreation';
import { discoverTeamDeletions, requestTeamDeletion } from '../services/teamDeletion';
const state = vi.hoisted(() => ({ status: 'rotation_pending' as 'rotation_pending' | 'active', owner: true, writes: false, creation: false,
  deletion: false, teamListener: undefined as ((teams: unknown[]) => void) | undefined, authListeners: new Set<() => void>() }));
vi.mock('firebase/auth', async importOriginal => ({ ...await importOriginal<typeof import('firebase/auth')>(),
  onAuthStateChanged: (_auth: unknown, callback: () => void) => { void _auth; state.authListeners.add(callback); return () => state.authListeners.delete(callback); } }));
vi.mock('../config/releaseGates', async importOriginal => ({ ...await importOriginal<typeof import('../config/releaseGates')>(),
  get TEAM_WRITES_ENABLED() { return state.writes; }, get TEAM_DELETION_ENABLED() { return state.deletion; } }));
vi.mock('../services/teamDeletion', async importOriginal => ({ ...await importOriginal<typeof import('../services/teamDeletion')>(), requestTeamDeletion: vi.fn(), discoverTeamDeletions: vi.fn() }));
vi.mock('../services/teamCreation', async importOriginal => ({ ...await importOriginal<typeof import('../services/teamCreation')>(),
  createTeamWithActiveEpoch: vi.fn(), hasTeamCreationCheckpoint: () => state.creation,
  cancelPendingTeamCreation: vi.fn(),
  observeTeamCreationCheckpoint: () => () => undefined }));
vi.mock('../firebase', () => ({ default: {}, db: {}, auth: { currentUser: { uid: 'alice' } } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../services/teamRotationRecovery', async importOriginal => ({ ...await importOriginal<typeof import('../services/teamRotationRecovery')>(),
  completeTeamRotationWithRecovery: vi.fn(), discardTeamRotationCheckpoint: vi.fn(),
  hasTeamRotationCheckpoint: () => true, observeTeamRotationCheckpoint: () => () => undefined }));
vi.mock('../services/teamsService', async importOriginal => ({ ...await importOriginal<typeof import('../services/teamsService')>(),
  watchMyTeams: (_uid: string, callback: (teams: unknown[]) => void) => {
    state.teamListener = callback;
    callback([{ id: 'crew', name: 'Synthetic team', ownerUid: state.owner ? 'alice' : 'bob', createdAt: 1,
      memberUids: ['alice', 'bob'], wrappedKeys: {}, roles: state.owner ? { alice: 'owner', bob: 'member' } : { alice: 'member', bob: 'owner' },
      activeKeyEpoch: 1, activeKeyId: 'old-key-id', keyRotationStatus: state.status, pendingRotationId: state.status === 'active' ? null : 'rotation-1' }]);
    return () => undefined;
  }, watchPendingInvites: (_uid: string, callback: (items: unknown[]) => void) => { callback([]); return () => undefined; },
  watchTeamInvites: (_teamId: string, callback: (items: unknown[]) => void) => { callback([]); return () => undefined; } }));
const words = Array.from({ length: 12 }, () => 'synthetic');
beforeEach(() => { vi.clearAllMocks(); state.owner = true; state.status = 'rotation_pending'; state.writes = false; state.creation = false;
  state.deletion = false; localStorage.clear();
  vi.mocked(discoverTeamDeletions).mockResolvedValue({ uid: 'alice', requests: [], nextAfterTeamId: null });
  Object.assign(auth, { currentUser: { uid: 'alice' } }); useUniverseStore.setState({ language: 'en' });
  vi.mocked(completeTeamRotationWithRecovery).mockResolvedValue({ newEpoch: 2, alreadyCommitted: false });
  vi.mocked(discardTeamRotationCheckpoint).mockResolvedValue(undefined); });
it('keeps new team deletion disabled until its release criteria pass', async () => {
  render(<TeamSettings mnemonic={words} askConfirm={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Delete' })).toBeDisabled(); expect(requestTeamDeletion).not.toHaveBeenCalled();
});
it('binds deletion to the confirmed team and refuses an account change during confirmation', async () => {
  state.deletion = true; let resolve!: (yes: boolean) => void;
  const confirm = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
  render(<TeamSettings mnemonic={words} askConfirm={confirm} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  Object.assign(auth, { currentUser: { uid: 'bob' } }); await act(async () => resolve(true));
  expect(requestTeamDeletion).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
});
it('never reports a pending team deletion as completed', async () => {
  state.deletion = true; vi.mocked(requestTeamDeletion).mockResolvedValue({ uid: 'alice', teamId: 'crew', status: 'pending', retryAt: 1000 });
  render(<TeamSettings mnemonic={words} askConfirm={vi.fn().mockResolvedValue(true)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(requestTeamDeletion).toHaveBeenCalledExactlyOnceWith('alice', 'crew', 'start', undefined, expect.any(Function)));
  expect(toast.success).not.toHaveBeenCalled();
});
it('invalidates a confirmation when Auth switches away and back before the dialog returns', async () => {
  state.deletion = true; let resolve!: (yes: boolean) => void;
  const confirm = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
  render(<TeamSettings mnemonic={words} askConfirm={confirm} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  Object.assign(auth, { currentUser: { uid: 'bob' } }); state.authListeners.forEach(callback => callback());
  Object.assign(auth, { currentUser: { uid: 'alice' } }); state.authListeners.forEach(callback => callback());
  await act(async () => resolve(true)); expect(requestTeamDeletion).not.toHaveBeenCalled();
});
it('offers recovery for the original team after it disappears from the membership list, even with the gate closed', async () => {
  localStorage.setItem('mnemosyne:team-deletion:v1:alice', JSON.stringify({ v: 1, uid: 'alice', teamId: 'original-team', phase: 'pending' }));
  vi.mocked(requestTeamDeletion).mockResolvedValue({ uid: 'alice', teamId: 'original-team', status: 'complete', retryAt: null });
  render(<TeamSettings mnemonic={words} askConfirm={vi.fn()} />);
  await act(async () => state.teamListener?.([]));
  fireEvent.click(await screen.findByRole('button', { name: 'Verify and resume deletion' }));
  await waitFor(() => expect(requestTeamDeletion).toHaveBeenCalledExactlyOnceWith('alice', 'original-team', 'resume', undefined, expect.any(Function)));
  expect(toast.success).toHaveBeenCalled();
});
it('suppresses a late deletion success when the settings view unmounts', async () => {
  state.deletion = true; let resolve!: (value: Awaited<ReturnType<typeof requestTeamDeletion>>) => void;
  vi.mocked(requestTeamDeletion).mockImplementation(() => new Promise(r => { resolve = r; }));
  const view = render(<TeamSettings mnemonic={words} askConfirm={vi.fn().mockResolvedValue(true)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(requestTeamDeletion).toHaveBeenCalledOnce()); view.unmount();
  await act(async () => resolve({ uid: 'alice', teamId: 'crew', status: 'complete', retryAt: null }));
  expect(toast.success).not.toHaveBeenCalled();
});
it('discovers remote pending deletion without a local journal or membership, then resumes the original request', async () => {
  vi.mocked(discoverTeamDeletions).mockResolvedValue({ uid: 'alice', requests: [{ uid: 'alice', teamId: 'remote-team', status: 'pending', retryAt: 1000 }], nextAfterTeamId: null });
  vi.mocked(requestTeamDeletion).mockResolvedValue({ uid: 'alice', teamId: 'remote-team', status: 'complete', retryAt: null });
  render(<TeamSettings mnemonic={words} askConfirm={vi.fn()} />); await act(async () => state.teamListener?.([]));
  fireEvent.click(await screen.findByRole('button', { name: 'Find pending deletions' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Verify and resume deletion' }));
  await waitFor(() => expect(requestTeamDeletion).toHaveBeenCalledExactlyOnceWith('alice', 'remote-team', 'resume', undefined, expect.any(Function)));
  expect(discoverTeamDeletions).toHaveBeenCalledExactlyOnceWith('alice', null, undefined, expect.any(Function));
  await waitFor(() => expect(screen.queryByText('remote-team')).not.toBeInTheDocument());
});
it('cancels pending creation only after confirmation and refuses an account change while confirming', async () => {
  state.creation = true; const confirm = vi.fn().mockResolvedValue(false);
  render(<TeamSettings mnemonic={words} askConfirm={confirm} />);
  const cancel = await screen.findByRole('button', { name: 'Cancel pending request' });
  fireEvent.click(cancel); await waitFor(() => expect(confirm).toHaveBeenCalledOnce()); expect(cancelPendingTeamCreation).not.toHaveBeenCalled();
  confirm.mockResolvedValue(true); fireEvent.click(cancel);
  await waitFor(() => expect(cancelPendingTeamCreation).toHaveBeenCalledExactlyOnceWith(auth.currentUser));
  let resolve!: (yes: boolean) => void; confirm.mockImplementation(() => new Promise(r => { resolve = r; }));
  fireEvent.click(cancel); Object.assign(auth, { currentUser: { uid: 'bob' } }); await act(async () => resolve(true));
  expect(cancelPendingTeamCreation).toHaveBeenCalledOnce();
});
it('offers explicit pending creation recovery instead of a second new creation', async () => {
  state.writes = true; state.creation = true;
  vi.mocked(createTeamWithActiveEpoch).mockResolvedValue({ teamId: 'created', name: 'Recovered', activeKeyEpoch: 1,
    activeKeyId: '12345678-1234-4234-8234-123456789abc', alreadyCreated: true });
  render(<TeamSettings mnemonic={words} askConfirm={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume creation' }));
  await waitFor(() => expect(createTeamWithActiveEpoch).toHaveBeenCalledExactlyOnceWith(auth.currentUser, words, null));
  expect(screen.queryByRole('textbox', { name: 'Team name' })).not.toBeInTheDocument();
  expect(toast.success).toHaveBeenCalled();
});
it('keeps pending creation recovery closed while the release gate is closed', async () => {
  state.creation = true; render(<TeamSettings mnemonic={words} askConfirm={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Resume creation' })).toBeDisabled();
  expect(createTeamWithActiveEpoch).not.toHaveBeenCalled();
});
it('reports unsupported creation recovery without exposing server diagnostics', async () => {
  state.writes = true; state.creation = true;
  vi.mocked(createTeamWithActiveEpoch).mockRejectedValue(new TeamCreationError('unsupported'));
  render(<TeamSettings mnemonic={words} askConfirm={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume creation' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('This browser does not support protected creation recovery. Use the web version in a compatible browser.'));
  expect(toast.success).not.toHaveBeenCalled();
});
it('routes completion through durable recovery and reports a fixed error without server details', async () => {
  vi.mocked(completeTeamRotationWithRecovery).mockRejectedValue(Error('sensitive server diagnostic'));
  render(<TeamSettings mnemonic={words} askConfirm={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Complete rotation' }));
  await waitFor(() => expect(completeTeamRotationWithRecovery).toHaveBeenCalledExactlyOnceWith('alice', 'crew', words));
  expect(toast.error).toHaveBeenCalledExactlyOnceWith('Could not complete rotation.');
  expect(toast.success).not.toHaveBeenCalled();
});
it('offers verification of a lost response after the team becomes active', async () => {
  state.status = 'active'; render(<TeamSettings mnemonic={words} askConfirm={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Verify completed rotation' }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Key rotated. Active members can unlock the new epoch.'));
  expect(completeTeamRotationWithRecovery).toHaveBeenCalledOnce();
});
it('explains unsupported protected recovery and never reports success', async () => {
  vi.mocked(completeTeamRotationWithRecovery).mockRejectedValue(new TeamRotationRecoveryError('unsupported'));
  render(<TeamSettings mnemonic={words} askConfirm={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Complete rotation' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This browser does not support protected rotation recovery. Use the web version in a compatible browser.'));
  expect(toast.success).not.toHaveBeenCalled();
});
it('does not discard a checkpoint when confirmation is denied or account changes while confirming', async () => {
  const confirm = vi.fn().mockResolvedValue(false);
  render(<TeamSettings mnemonic={words} askConfirm={confirm} />);
  const discard = await screen.findByRole('button', { name: 'Discard local checkpoint' });
  fireEvent.click(discard); await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(discardTeamRotationCheckpoint).not.toHaveBeenCalled();
  let resolve!: (yes: boolean) => void;
  confirm.mockImplementation(() => new Promise(r => { resolve = r; })); fireEvent.click(discard);
  Object.assign(auth, { currentUser: { uid: 'different-account' } });
  await act(async () => resolve(true));
  expect(discardTeamRotationCheckpoint).not.toHaveBeenCalled();
});
it('discards only the confirmed local checkpoint, and hides admin controls from members', async () => {
  const view = render(<TeamSettings mnemonic={words} askConfirm={vi.fn().mockResolvedValue(true)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Discard local checkpoint' }));
  await waitFor(() => expect(discardTeamRotationCheckpoint).toHaveBeenCalledExactlyOnceWith('alice', 'crew'));
  expect(completeTeamRotationWithRecovery).not.toHaveBeenCalled();
  view.unmount(); state.owner = false;
  render(<TeamSettings mnemonic={words} askConfirm={vi.fn().mockResolvedValue(true)} />);
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: 'Discard local checkpoint' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Complete rotation' })).not.toBeInTheDocument();
});
