import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { auth } from '../firebase';
import { useUniverseStore } from '../store/universeStore';
import { AgentMutationsPanel } from './AgentMutationsPanel';
const mocks = vi.hoisted(() => ({ ready: true, enabled: true, vault: new Set<() => void>(), team: new Set<() => void>(),
  auth: new Set<(user: { uid: string } | null) => void>(), list: vi.fn(), preview: vi.fn(), approve: vi.fn(), reject: vi.fn() }));
vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'alice' } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => {
  mocks.auth.add(callback); callback(auth.currentUser); return () => { mocks.auth.delete(callback); };
} }));
vi.mock('../config/releaseGates', () => ({ get AGENT_MUTATION_WRITES_ENABLED() { return mocks.enabled; } }));
vi.mock('../services/memoryCrypto', () => ({ isMemoryCryptoReady: () => mocks.ready,
  onMemoryCryptoChanged: (callback: () => void) => { mocks.vault.add(callback); return () => { mocks.vault.delete(callback); }; } }));
vi.mock('../services/teamVault', () => ({ onTeamKeyChanged: (callback: () => void) => { mocks.team.add(callback); return () => { mocks.team.delete(callback); }; } }));
vi.mock('../services/agentMutations', () => ({ listAgentMutations: mocks.list, previewAgentMutation: mocks.preview, approveAgentMutation: mocks.approve, rejectAgentMutation: mocks.reject }));
const id = '32345678-1234-4234-8234-123456789012';
const receipt = { proposalId: id, uid: 'alice', clientId: 'synthetic-client', clientName: 'Synthetic app', vault: 'personal', digest: 'a'.repeat(64), sessionId: 'note', teamId: null, operation: 'edit', status: 'pending', createdAt: 1000, expiresAt: 901000, decidedAt: null, result: null };
const preview = { receipt, request: {}, digest: receipt.digest, before: { text: '<script>synthetic source</script>', title: 'Source title', metadata: { tags: ['old'] } }, after: { text: 'Synthetic proposed body', title: 'Proposed title', metadata: { tags: ['new'] } } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.ready = true; mocks.enabled = true; mocks.vault.clear(); mocks.team.clear(); mocks.auth.clear();
  Object.assign(auth, { currentUser: { uid: 'alice' } }); useUniverseStore.setState({ language: 'en' });
  mocks.list.mockResolvedValue({ receipts: [receipt], nextCursor: null }); mocks.preview.mockResolvedValue(preview);
  mocks.approve.mockResolvedValue({ ...receipt, status: 'applied' }); mocks.reject.mockResolvedValue({ ...receipt, status: 'rejected' });
});
const mount = () => render(<AgentMutationsPanel uid="alice" />);
it('loading and review never approve; the decrypted text stays inert and one explicit confirmation dispatches once', async () => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Review content' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm this change' });
  expect(screen.getByText('<script>synthetic source</script>')).toBeInTheDocument(); expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText('Synthetic proposed body')).toBeInTheDocument(); expect(mocks.approve).not.toHaveBeenCalled();
  let finish: (() => void) | undefined; mocks.approve.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ ...receipt, status: 'applied' }); }));
  fireEvent.click(confirm); fireEvent.click(confirm); expect(mocks.approve).toHaveBeenCalledTimes(1); expect(confirm).toBeDisabled();
  await act(async () => { finish!(); });
});
it('locked vaults can reject and refresh receipts without decrypting or approving', async () => {
  mocks.ready = false; mocks.enabled = false; mount();
  expect(await screen.findByRole('button', { name: 'Review content' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' })); await waitFor(() => expect(mocks.reject).toHaveBeenCalledTimes(1));
  expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.approve).not.toHaveBeenCalled();
});
it.each(['vault', 'team', 'account'] as const)('a %s ABA retires an open decrypted preview and cannot reuse its confirmation', async change => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Review content' })); await screen.findByRole('button', { name: 'Confirm this change' });
  act(() => {
    if (change === 'account') { Object.assign(auth, { currentUser: null }); mocks.auth.forEach(callback => callback(null)); Object.assign(auth, { currentUser: { uid: 'alice' } }); mocks.auth.forEach(callback => callback({ uid: 'alice' })); }
    else { mocks[change].forEach(callback => callback()); }
  });
  expect(screen.queryByRole('button', { name: 'Confirm this change' })).not.toBeInTheDocument(); expect(screen.queryByText('Synthetic proposed body')).not.toBeInTheDocument(); expect(mocks.approve).not.toHaveBeenCalled();
});
it('an uncertain approval removes the preview and refresh reads the receipt without automatically repeating it', async () => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Review content' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm this change' }); mocks.approve.mockRejectedValueOnce(Error('Synthetic lost acknowledgement'));
  fireEvent.click(confirm); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Confirm this change' })).not.toBeInTheDocument();
  mocks.list.mockResolvedValue({ receipts: [{ ...receipt, status: 'applied' }], nextCursor: null });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh receipts' })); await screen.findByText(/Applied/); expect(mocks.approve).toHaveBeenCalledTimes(1);
});
