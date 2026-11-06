import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'alice' } as { uid: string } | null },
  listeners: new Set<(user: { uid: string } | null) => void>(), status: vi.fn(), resume: vi.fn(), signOut: vi.fn(), local: vi.fn(), recover: vi.fn(), recoverable: [] as string[] }));
vi.mock('../firebase', () => ({ auth: mocks.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, cb: (user: { uid: string } | null) => void) => { mocks.listeners.add(cb); return () => mocks.listeners.delete(cb); }, signOut: mocks.signOut }));
vi.mock('../services/accountDeletion', () => ({ completedLocalAccountDeletionUids: () => [], finishCompletedLocalAccountDeletion: mocks.local,
  recoverableLocalAccountDeletionUids: () => mocks.recoverable, recoverAccountDeletionWithoutAuth: mocks.recover,
  hasLocalAccountDeletion: () => false, inspectAccountDeletion: mocks.status, requestAccountDeletion: mocks.resume }));
import { AccountDeletionRecovery } from './AccountDeletionRecovery';
beforeEach(() => { vi.clearAllMocks(); mocks.listeners.clear(); mocks.auth.currentUser = { uid: 'alice' };
  mocks.recoverable = [];
  mocks.status.mockResolvedValue({ uid: 'alice', status: 'pending', retryAt: null }); });
it('shows a pending deletion and preserves authentication when resuming still needs cleanup', async () => {
  mocks.resume.mockResolvedValue({ uid: 'alice', status: 'pending', retryAt: Date.now() + 180000 });
  render(<AccountDeletionRecovery />); fireEvent.click(await screen.findByRole('button', { name: 'Retomar eliminação' }));
  await waitFor(() => expect(mocks.resume).toHaveBeenCalledWith('alice', 'resume'));
  expect(mocks.signOut).not.toHaveBeenCalled(); expect(screen.queryByText(/foram eliminados/)).not.toBeInTheDocument();
});
it('offers verification without Auth and announces success only when receipt recovery confirms cleanup', async () => {
  mocks.auth.currentUser = null; mocks.recoverable = ['alice']; mocks.recover.mockImplementation(async () => { mocks.recoverable = []; return { uid: 'alice', status: 'complete', retryAt: null }; });
  render(<AccountDeletionRecovery />); fireEvent.click(screen.getByRole('button', { name: 'Verificar conclusão do pedido' }));
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith('alice')); expect(screen.getByRole('status')).toHaveTextContent('dados ativos foram eliminados');
  expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
});
it('preserves a pending receipt and rejects a late anonymous completion after another account signs in', async () => {
  mocks.auth.currentUser = null; mocks.recoverable = ['alice']; mocks.recover.mockResolvedValueOnce({ uid: 'alice', status: 'pending', retryAt: 1000 });
  render(<AccountDeletionRecovery />); fireEvent.click(screen.getByRole('button', { name: 'Verificar conclusão do pedido' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ainda não confirmou')); expect(screen.queryByText(/foram eliminados/)).not.toBeInTheDocument();
  let resolve: (value: unknown) => void = () => {}; mocks.recover.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Verificar conclusão do pedido' }));
  await act(async () => { mocks.auth.currentUser = { uid: 'bob' }; for (const cb of mocks.listeners) cb(mocks.auth.currentUser); resolve({ uid: 'alice', status: 'complete', retryAt: null }); });
  expect(screen.queryByText(/foram eliminados/)).not.toBeInTheDocument(); expect(mocks.signOut).not.toHaveBeenCalled();
});
it('announces completion and signs out only after the service confirms both remote and local cleanup', async () => {
  mocks.resume.mockResolvedValue({ uid: 'alice', status: 'complete', retryAt: null });
  render(<AccountDeletionRecovery />); fireEvent.click(await screen.findByRole('button', { name: 'Retomar eliminação' }));
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth)); expect(screen.getByRole('status')).toHaveTextContent('dados ativos foram eliminados');
});
it('a late completion for a previous account cannot sign out or announce completion for the new account', async () => {
  let resolve: (value: unknown) => void = () => {}; mocks.resume.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<AccountDeletionRecovery />); fireEvent.click(await screen.findByRole('button', { name: 'Retomar eliminação' }));
  await act(async () => { mocks.auth.currentUser = { uid: 'bob' }; for (const cb of mocks.listeners) cb(mocks.auth.currentUser); resolve({ uid: 'alice', status: 'complete', retryAt: null }); });
  expect(mocks.signOut).not.toHaveBeenCalled(); expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('a late ACK after the recovery panel unmounts cannot sign out the active session', async () => {
  let resolve: (value: unknown) => void = () => {}; mocks.resume.mockImplementation(() => new Promise(done => { resolve = done; }));
  const panel = render(<AccountDeletionRecovery />); fireEvent.click(await screen.findByRole('button', { name: 'Retomar eliminação' }));
  panel.unmount(); await act(async () => resolve({ uid: 'alice', status: 'complete', retryAt: null })); expect(mocks.signOut).not.toHaveBeenCalled();
});
