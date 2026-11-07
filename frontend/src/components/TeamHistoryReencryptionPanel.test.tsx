import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TeamHistoryReencryptionPanel } from './TeamHistoryReencryptionPanel';
import type { TeamHistoryCheckpoint } from '../services/teamHistoryReencryption';
const state = vi.hoisted(() => ({ enabled: true, stored: false, job: null as TeamHistoryCheckpoint | null, run: vi.fn(), cancel: vi.fn() }));
vi.mock('../config/releaseGates', () => ({ get TEAM_HISTORY_REENCRYPTION_ENABLED() { return state.enabled; } }));
vi.mock('../services/teamHistoryReencryption', () => ({ hasTeamHistoryCheckpoint: () => state.stored,
  readTeamHistoryCheckpoint: async () => state.job, runTeamHistoryReencryption: (...args: unknown[]) => state.run(...args),
  cancelTeamHistoryReencryption: (...args: unknown[]) => state.cancel(...args) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('../utils/translations', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../firebase', () => ({default: {}, db: {}, auth: {currentUser: {uid: 'alice'}}}));
vi.mock('firebase/auth', () => ({onAuthStateChanged: () => () => {}}));
vi.mock('../services/memoryCrypto', () => ({isMemoryCryptoReady: () => true, onMemoryCryptoChanged: () => () => {}}));
vi.mock('../services/teamHistoryChangeRecovery', () => ({observeTeamHistoryChanges: () => () => {}}));
import toast from 'react-hot-toast';
const team = { id: 'crew', name: 'Synthetic', createdAt: 1, ownerUid: 'alice', memberUids: ['alice', 'bob'], roles: { alice: 'owner' as const, bob: 'member' as const }, wrappedKeys: {},
  activeKeyEpoch: 2, activeKeyId: '11111111-1111-4111-8111-111111111111', keyRotationStatus: 'active' as const, pendingRotationId: null };
const job: TeamHistoryCheckpoint = { version: 1, uid: 'alice', teamId: 'crew', jobId: '22222222-2222-4222-8222-222222222222', targetEpoch: 2, targetKeyId: team.activeKeyId,
  sessionCursor: null, currentSession: 'a', sessionDone: true, versionCursor: null, status: 'paused', scanned: 1, rewritten: 1, alreadyTarget: 0 };
const props = { uid: 'alice', team, mnemonic: Array.from({ length: 12 }, () => 'synthetic'), unlocked: true, askConfirm: vi.fn(async () => true) };
beforeEach(() => { vi.clearAllMocks(); state.enabled = true; state.stored = false; state.job = null; });
afterEach(cleanup);
it('requires explicit consent, an unlocked current admin and an open release gate', async () => {
  for (const mode of ['closed', 'locked', 'member', 'denied'] as const) {
    state.enabled = mode !== 'closed'; const confirm = vi.fn(async () => mode !== 'denied');
    render(<TeamHistoryReencryptionPanel {...props} uid={mode === 'member' ? 'bob' : 'alice'} unlocked={mode !== 'locked'} askConfirm={confirm} />);
    const button = screen.getByRole('button', { name: 'teamHistoryStart' }); fireEvent.click(button);
    await act(async () => undefined);
    expect(state.run).not.toHaveBeenCalled(); if (mode !== 'denied') expect(button).toBeDisabled();
    cleanup();
  }
});
it('provides pause and confirmed cancellation during a run and preserves cancellation when the view closes', async () => {
  let input!: { control: () => string; onProgress: (job: TeamHistoryCheckpoint) => void }; let finish!: (job: TeamHistoryCheckpoint) => void;
  state.run.mockImplementationOnce((value: typeof input) => { input = value; return new Promise(resolve => { finish = resolve; }); });
  const confirm = vi.fn(async () => true); const view = render(<TeamHistoryReencryptionPanel {...props} askConfirm={confirm} />);
  fireEvent.click(screen.getByRole('button', { name: 'teamHistoryStart' })); await waitFor(() => expect(state.run).toHaveBeenCalledOnce());
  act(() => input.onProgress({ ...job, status: 'running' })); fireEvent.click(screen.getByRole('button', { name: 'teamHistoryPause' }));
  expect(input.control()).toBe('pause');
  fireEvent.click(screen.getByRole('button', { name: 'teamHistoryCancel' })); await act(async () => undefined);
  expect(confirm).toHaveBeenCalledTimes(2); expect(input.control()).toBe('cancel');
  view.unmount(); expect(input.control()).toBe('cancel'); await act(async () => finish({ ...job, status: 'cancelled' }));
  expect(toast.error).not.toHaveBeenCalled();
});
it('pauses an abandoned running view and ignores its late progress', async () => {
  let input!: { control: () => string; onProgress: (job: TeamHistoryCheckpoint) => void }; let finish!: (job: TeamHistoryCheckpoint) => void;
  state.run.mockImplementationOnce((value: typeof input) => { input = value; return new Promise(resolve => { finish = resolve; }); });
  const view = render(<TeamHistoryReencryptionPanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'teamHistoryStart' })); await waitFor(() => expect(state.run).toHaveBeenCalledOnce());
  view.unmount(); expect(input.control()).toBe('pause');
  await act(async () => { input.onProgress({ ...job, status: 'complete' }); finish({ ...job, status: 'paused' }); });
  expect(toast.error).not.toHaveBeenCalled();
});
it('cancels an obsolete local checkpoint while the release gate is closed and reports only a fixed error', async () => {
  state.enabled = false; state.stored = true; state.job = job;
  state.cancel.mockRejectedValueOnce(new Error('Synthetic server diagnostic, never display'));
  render(<TeamHistoryReencryptionPanel {...props} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'teamHistoryResume' })).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'teamHistoryCancel' })); await waitFor(() => expect(state.cancel).toHaveBeenCalledOnce());
  expect(state.cancel).toHaveBeenCalledWith('alice', 'crew'); expect(toast.error).toHaveBeenCalledExactlyOnceWith('teamHistoryFailed');
});
