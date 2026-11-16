import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { auth } from '../firebase';
import { useUniverseStore } from '../store/universeStore';
import { AgentMutationsPanel } from './AgentMutationsPanel';
const mocks = vi.hoisted(() => ({ ready: true, enabled: true, pending: false, vault: new Set<() => void>(), team: new Set<() => void>(), pendingListeners: new Set<() => void>(),
  auth: new Set<(user: { uid: string } | null) => void>(), list: vi.fn(), preview: vi.fn(), confirm: vi.fn(), recover: vi.fn(), cancel: vi.fn() }));
vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'alice' } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => { mocks.auth.add(callback); callback(auth.currentUser); return () => { mocks.auth.delete(callback); }; } }));
vi.mock('../config/releaseGates', () => ({ get AGENT_MUTATION_WRITES_ENABLED() { return false; }, get PERSONAL_REVISION_WRITES_ENABLED() { return mocks.enabled; }, get TEAM_WRITES_ENABLED() { return mocks.enabled; } }));
vi.mock('../services/memoryCrypto', () => ({ isMemoryCryptoReady: () => mocks.ready, onMemoryCryptoChanged: (callback: () => void) => { mocks.vault.add(callback); return () => { mocks.vault.delete(callback); }; } }));
vi.mock('../services/teamVault', () => ({ onTeamKeyChanged: (callback: () => void) => { mocks.team.add(callback); return () => { mocks.team.delete(callback); }; } }));
vi.mock('../services/agentMutations', () => ({ listAgentMutations: mocks.list, previewAgentMutation: vi.fn(), approveAgentMutation: vi.fn(), rejectAgentMutation: vi.fn() }));
vi.mock('../services/agentReversalRecovery', () => ({ hasPendingAgentReversal: () => mocks.pending,
  observeAgentReversals: (callback: () => void) => { mocks.pendingListeners.add(callback); return () => { mocks.pendingListeners.delete(callback); }; },
  previewAgentReversal: mocks.preview, confirmAgentReversal: mocks.confirm, recoverAgentReversal: mocks.recover, cancelAgentReversal: mocks.cancel }));
const id = '32345678-1234-4234-8234-123456789012';
const receipt = { proposalId: id, uid: 'alice', clientId: 'synthetic-client', clientName: 'Synthetic app', vault: 'personal', digest: 'a'.repeat(64), sessionId: 'note', teamId: null, operation: 'edit', status: 'applied', createdAt: 1000, expiresAt: 901000, decidedAt: 1002, result: {} };
const preview = { request: { baseline: { teamId: null, sessionId: 'note', proposalId: id } }, digest: 'b'.repeat(64), before: { text: 'Synthetic applied content', title: 'Applied title', metadata: { color: '#112233', learning: { revisedAt: 1002 } } },
  after: { text: '<script>synthetic archived content</script>', title: 'Archived title', metadata: { tags: ['original'] } }, deleted: false };
beforeEach(() => {
  vi.clearAllMocks(); mocks.ready = true; mocks.enabled = true; mocks.pending = false; mocks.vault.clear(); mocks.team.clear(); mocks.pendingListeners.clear(); mocks.auth.clear();
  Object.assign(auth, { currentUser: { uid: 'alice' } }); useUniverseStore.setState({ language: 'en' });
  mocks.list.mockImplementation(async (_uid, mode) => ({ receipts: mode === 'history' ? [receipt] : [], nextCursor: null })); mocks.preview.mockResolvedValue(preview);
  mocks.confirm.mockImplementation(async () => { mocks.pending = false; return { status: 'committed' }; });
  mocks.recover.mockResolvedValue({ state: 'review', preview }); mocks.cancel.mockImplementation(async () => { mocks.pending = false; return { status: 'cancelled' }; });
});
async function open() {
  render(<AgentMutationsPanel uid="alice" />); const history = await screen.findByRole('button', { name: 'History' }); await waitFor(() => expect(history).toBeEnabled()); fireEvent.click(history);
  fireEvent.click(await screen.findByRole('button', { name: 'Review reversal' })); return screen.findByRole('button', { name: 'Confirm reversal of this change' });
}
it('history review does not reverse; explicit confirmation dispatches once and restored content remains inert', async () => {
  const confirm = await open(); expect(screen.getByText('<script>synthetic archived content</script>')).toBeInTheDocument(); expect(document.querySelector('script')).toBeNull(); expect(mocks.confirm).not.toHaveBeenCalled();
  let finish: (() => void) | undefined; mocks.confirm.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ status: 'committed' }); }));
  fireEvent.click(confirm); fireEvent.click(confirm); expect(mocks.confirm).toHaveBeenCalledTimes(1); expect(confirm).toBeDisabled(); await act(async () => { finish!(); });
});
it('unknown checkpoint recovery requires a new explicit confirmation and never auto-applies', async () => {
  mocks.pending = true; render(<AgentMutationsPanel uid="alice" />); fireEvent.click(await screen.findByRole('button', { name: 'Recover reversal' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm reversal of this change' }); expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  fireEvent.click(confirm); await screen.findByText('Previous version restored and result confirmed.'); expect(mocks.confirm).toHaveBeenCalledTimes(1);
});
it('closed write admission keeps receipt recovery and cancellation available while confirmation stays disabled', async () => {
  mocks.pending = true; mocks.enabled = false; render(<AgentMutationsPanel uid="alice" />); fireEvent.click(await screen.findByRole('button', { name: 'Recover reversal' }));
  expect(await screen.findByRole('button', { name: 'Confirm reversal of this change' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel reversal request' })); await screen.findByText('Reversal request cancellation confirmed.'); expect(mocks.confirm).not.toHaveBeenCalled();
});
it.each(['vault', 'team', 'account'] as const)('a %s transition retires the decrypted reversal and cannot reuse confirmation', async change => {
  await open(); act(() => {
    if (change === 'account') { Object.assign(auth, { currentUser: null }); mocks.auth.forEach(callback => callback(null)); Object.assign(auth, { currentUser: { uid: 'alice' } }); mocks.auth.forEach(callback => callback({ uid: 'alice' })); }
    else mocks[change].forEach(callback => callback());
  });
  expect(screen.queryByRole('button', { name: 'Confirm reversal of this change' })).not.toBeInTheDocument(); expect(screen.queryByText('<script>synthetic archived content</script>')).not.toBeInTheDocument(); expect(mocks.confirm).not.toHaveBeenCalled();
});
it('an uncertain confirmation keeps a recovery action and terminal recovery does not dispatch a second write', async () => {
  const confirm = await open(); mocks.confirm.mockImplementationOnce(async () => { mocks.pending = true; throw Error('Synthetic lost acknowledgement'); });
  fireEvent.click(confirm); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Confirm reversal of this change' })).not.toBeInTheDocument();
  mocks.recover.mockImplementationOnce(async () => { mocks.pending = false; return { state: 'terminal', outcome: { status: 'committed' } }; });
  fireEvent.click(screen.getByRole('button', { name: 'Recover reversal' })); await screen.findByText('Previous version restored and result confirmed.'); expect(mocks.confirm).toHaveBeenCalledTimes(1);
});
it('a locked vault shows the pending checkpoint without attempting to decrypt or submit it', async () => {
  mocks.pending = true; mocks.ready = false; render(<AgentMutationsPanel uid="alice" />);
  expect(await screen.findByRole('button', { name: 'Recover reversal' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Cancel reversal request' })).toBeDisabled();
  expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});
it('a temporary limit has a fixed message and does not expose the remote diagnostic', async () => {
  mocks.preview.mockRejectedValueOnce({ code: 'functions/resource-exhausted', message: 'SYNTHETIC_PRIVATE_UPSTREAM' });
  render(<AgentMutationsPanel uid="alice" />); const history = await screen.findByRole('button', { name: 'History' }); await waitFor(() => expect(history).toBeEnabled()); fireEvent.click(history);
  fireEvent.click(await screen.findByRole('button', { name: 'Review reversal' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A temporary limit was reached.'); expect(screen.queryByText('SYNTHETIC_PRIVATE_UPSTREAM')).not.toBeInTheDocument(); expect(mocks.confirm).not.toHaveBeenCalled();
});
