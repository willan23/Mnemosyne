import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const state = vi.hoisted(() => ({uid: 'alice' as string | null, ready: true, pending: true,
  vaultListeners: new Set<() => void>(), authListener: (user: {uid: string} | null) => {void user;}, recover: vi.fn(), cancel: vi.fn()}));
vi.mock('../firebase', () => ({auth: {get currentUser() {return state.uid ? {uid: state.uid} : null;}}}));
vi.mock('firebase/auth', () => ({onAuthStateChanged: (_auth: unknown, callback: typeof state.authListener) => {state.authListener = callback; callback(state.uid ? {uid: state.uid} : null); return vi.fn();}}));
vi.mock('../services/memoryCrypto', () => ({isMemoryCryptoReady: () => state.ready, onMemoryCryptoChanged: (callback: () => void) => {state.vaultListeners.add(callback); return () => state.vaultListeners.delete(callback);}}));
vi.mock('../services/clipCaptureService', () => ({hasPendingClipCapture: () => state.pending, observeClipCaptures: () => vi.fn(),
  recoverPendingClipCapture: (...args: unknown[]) => state.recover(...args), cancelPendingClipCapture: (...args: unknown[]) => state.cancel(...args)}));
vi.mock('react-hot-toast', () => ({default: {success: vi.fn(), error: vi.fn()}}));
import toast from 'react-hot-toast';
import {ClipCaptureRecoveryPanel} from './ClipCaptureRecoveryPanel';
beforeEach(() => {vi.clearAllMocks(); state.uid = 'alice'; state.ready = true; state.pending = true; state.vaultListeners.clear();});
afterEach(() => {cleanup(); vi.restoreAllMocks();});
it('disables actions while awaiting confirmation and closes only after acknowledged recovery', async () => {
  let finish!: (result: unknown) => void; state.recover.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;})); const created = vi.fn();
  render(<ClipCaptureRecoveryPanel onMemoryCreated={created} />); fireEvent.click(screen.getByRole('button', {name: 'Recuperar clip'}));
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled(); expect(created).not.toHaveBeenCalled();
  state.pending = false; await act(async () => finish({status: 'committed', sessionId: 'synthetic'}));
  expect(created).toHaveBeenCalledExactlyOnceWith('synthetic'); expect(screen.queryByRole('region', {name: 'Recuperar clip'})).toBeNull();
});
it('requires explicit cancellation and confirms a concurrent commit instead of reporting cancellation', async () => {
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true); state.cancel.mockResolvedValueOnce({status: 'committed', sessionId: 'synthetic'}); const created = vi.fn();
  render(<ClipCaptureRecoveryPanel onMemoryCreated={created} />); const cancel = screen.getByRole('button', {name: 'Cancelar clip pendente'});
  fireEvent.click(cancel); expect(state.cancel).not.toHaveBeenCalled(); fireEvent.click(cancel);
  await waitFor(() => expect(created).toHaveBeenCalledExactlyOnceWith('synthetic')); expect(toast.success).toHaveBeenCalledExactlyOnceWith('Captura do clip confirmada.');
});
it('keeps recovery available after failure and exposes only fixed feedback', async () => {
  state.recover.mockRejectedValueOnce(new Error('Synthetic transport diagnostic')); render(<ClipCaptureRecoveryPanel />); fireEvent.click(screen.getByRole('button', {name: 'Recuperar clip'}));
  await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Não foi possível confirmar a captura. A operação pendente foi conservada.'));
  expect(screen.getByRole('button', {name: 'Recuperar clip'})).toBeEnabled(); expect(toast.success).not.toHaveBeenCalled();
});
it('suppresses late feedback after account, vault or view loss and restores availability after the old operation settles', async () => {
  for (const mode of ['account','vault','unmount']) {
    vi.clearAllMocks(); state.uid = 'alice'; state.ready = true; state.pending = true; let finish!: (result: unknown) => void;
    state.recover.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;})); const created = vi.fn(); const view = render(<ClipCaptureRecoveryPanel onMemoryCreated={created} />);
    fireEvent.click(screen.getByRole('button', {name: 'Recuperar clip'}));
    await act(async () => {
      if (mode === 'account') {state.uid = 'bob'; state.authListener({uid: 'bob'});} if (mode === 'vault') {state.ready = false; state.vaultListeners.forEach(listener => listener());}
      if (mode === 'unmount') view.unmount(); finish({status: 'committed', sessionId: 'synthetic'});
    });
    expect(created).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
    if (mode === 'account') expect(screen.getByRole('button', {name: 'Recuperar clip'})).toBeEnabled(); cleanup();
  }
});
