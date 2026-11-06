import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { listAgentGrants, revokeAgentGrant } from '../services/agentAuthorization';
import { useUniverseStore } from '../store/universeStore';
import { AgentGrantsPanel } from './AgentGrantsPanel';
import { auth } from '../firebase';
const mocks = vi.hoisted(() => ({ listeners: new Set<(user: { uid: string } | null) => void>() }));
vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'alice' } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn((_auth, callback) => {
  mocks.listeners.add(callback); return () => mocks.listeners.delete(callback);
}) }));
vi.mock('../services/agentAuthorization', () => ({ listAgentGrants: vi.fn(), revokeAgentGrant: vi.fn() }));
const grant = { id: 'a'.repeat(64), clientId: 'synthetic', name: 'Synthetic integration', scopes: ['memories:read'], createdAt: 1 };
const signIn = (uid: string | null) => {
  const user = uid ? { uid } : null;
  Object.assign(auth, { currentUser: user }); mocks.listeners.forEach(callback => callback(user));
};
beforeEach(() => { vi.clearAllMocks(); mocks.listeners.clear(); Object.assign(auth, { currentUser: { uid: 'alice' } }); useUniverseStore.setState({ language: 'en' });
  vi.mocked(listAgentGrants).mockResolvedValue([grant]); vi.mocked(revokeAgentGrant).mockResolvedValue(undefined); });
it('removes consent only after server acknowledgement', async () => {
  let resolve!: () => void;
  vi.mocked(revokeAgentGrant).mockReturnValue(new Promise(r => { resolve = r; }));
  render(<AgentGrantsPanel uid="alice" />);
  const button = await screen.findByRole('button', { name: 'Revoke' });
  fireEvent.click(button); fireEvent.click(button);
  expect(screen.getByText('Synthetic integration')).toBeInTheDocument();
  resolve(); await screen.findByText('No authorized applications.');
  expect(revokeAgentGrant).toHaveBeenCalledExactlyOnceWith(grant.id, 'alice');
  expect(listAgentGrants).toHaveBeenCalledExactlyOnceWith('alice');
});

it('clears grants on account change and ignores a previous pending list', async () => {
  let resolve!: (value: typeof grant[]) => void;
  vi.mocked(listAgentGrants).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  vi.mocked(listAgentGrants).mockResolvedValueOnce([]);
  const view = render(<AgentGrantsPanel uid="alice" />);
  act(() => signIn('bob')); view.rerender(<AgentGrantsPanel uid="bob" />);
  await screen.findByText('No authorized applications.');
  await act(async () => resolve([grant]));
  expect(screen.queryByText('Synthetic integration')).not.toBeInTheDocument();
  expect(listAgentGrants).toHaveBeenLastCalledWith('bob');
});

it('retires pending revocation after a batched logout and return', async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(revokeAgentGrant).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  render(<AgentGrantsPanel uid="alice" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
  act(() => { signIn(null); signIn('alice'); });
  await screen.findByRole('button', { name: 'Revoke' });
  await act(async () => reject(new Error('private diagnostic')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button')).toBeEnabled();
  expect(listAgentGrants).toHaveBeenCalledTimes(2);
});
it('retains consent on failure and shows no server diagnostic', async () => {
  vi.mocked(revokeAgentGrant).mockRejectedValue(new Error('sensitive diagnostic'));
  render(<AgentGrantsPanel uid="alice" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByText('Synthetic integration')).toBeInTheDocument();
  expect(screen.queryByText('sensitive diagnostic')).not.toBeInTheDocument();
});

it('identifies the team vault when revoking one of the same application grants', async () => {
  vi.mocked(listAgentGrants).mockResolvedValueOnce([{ ...grant, vault: 'team:crew', vaultName: 'Synthetic crew' }]);
  render(<AgentGrantsPanel uid="alice" />);
  expect(await screen.findByText('Team: Synthetic crew')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Revoke' })).toHaveAccessibleDescription(/Team: Synthetic crew \(crew\)/);
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  await screen.findByText('No authorized applications.'); expect(revokeAgentGrant).toHaveBeenCalledExactlyOnceWith(grant.id, 'alice');
});
