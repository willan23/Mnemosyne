import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AttachedMemoryRecoveryPanel } from './AttachedMemoryRecoveryPanel';
const state = vi.hoisted(() => ({ uid: 'alice' as string | null, ready: true, pending: true, listeners: new Set<() => void>(), recover: vi.fn(), cancel: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return state.uid ? { uid: state.uid } : null; } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => { callback(state.uid ? { uid: state.uid } : null); return () => undefined; } }));
vi.mock('../services/memoryCrypto', () => ({ isMemoryCryptoReady: () => state.ready, onMemoryCryptoChanged: (callback: () => void) => { state.listeners.add(callback); return () => state.listeners.delete(callback); } }));
vi.mock('../services/teamVault', () => ({ onTeamKeyChanged: () => () => undefined }));
vi.mock('../services/attachedMemoryRecovery', () => ({ hasPendingAttachedMemoryCreation: () => state.pending, observeAttachedMemoryCreations: () => () => undefined,
  recoverAttachedMemoryCreation: (...args: unknown[]) => state.recover(...args), cancelPendingAttachedMemoryCreation: (...args: unknown[]) => state.cancel(...args) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign((...args:unknown[])=>state.success(...args),{ success: (...args: unknown[]) => state.success(...args), error: (...args: unknown[]) => state.error(...args) }) }));
beforeEach(() => { state.uid = 'alice'; state.ready = true; state.pending = true; state.listeners.clear(); [state.recover, state.cancel, state.success, state.error].forEach(mock => mock.mockReset()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('revocation reports preserved files and never selects or announces a created memory',async()=>{
  state.recover.mockImplementation(async()=>{state.pending=false;return{status:'revoked',createdAt:null};});const created=vi.fn();render(<AttachedMemoryRecoveryPanel onMemoryCreated={created}/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar criação de memória'}));await waitFor(()=>expect(state.success).toHaveBeenCalledWith(expect.stringContaining('ficheiros e rascunhos foram conservados')));expect(created).not.toHaveBeenCalled();expect(state.success).not.toHaveBeenCalledWith('Criação da memória confirmada.');
});
it('keeps recovery visible while writes are closed and removes the panel only after confirmed creation', async () => {
  const created = vi.fn(); state.recover.mockImplementation(async () => { state.pending = false; return { status: 'committed', sessionId: 'synthetic' }; });
  render(<AttachedMemoryRecoveryPanel onMemoryCreated={created} />); fireEvent.click(screen.getByRole('button', { name: 'Recuperar criação de memória' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith('synthetic')); expect(state.success).toHaveBeenCalledWith('Criação da memória confirmada.');
  expect(screen.queryByRole('region', { name: 'Recuperar criação de memória' })).toBeNull();
});
it('requires cancellation confirmation and truthfully confirms a concurrent commit', async () => {
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true); const created = vi.fn();
  state.cancel.mockResolvedValue({ status: 'committed', sessionId: 'synthetic' }); render(<AttachedMemoryRecoveryPanel onMemoryCreated={created} />);
  const cancel = screen.getByRole('button', { name: 'Cancelar criação pendente' }); fireEvent.click(cancel); expect(state.cancel).not.toHaveBeenCalled();
  fireEvent.click(cancel); await waitFor(() => expect(created).toHaveBeenCalledWith('synthetic')); expect(state.success).not.toHaveBeenCalledWith('Criação cancelada. Os ficheiros enviados foram conservados.');
});
it('a locked vault disables recovery and a late confirmation after context loss is suppressed', async () => {
  let resolve!: (value: unknown) => void; state.recover.mockReturnValue(new Promise(yes => { resolve = yes; })); const created = vi.fn();
  render(<AttachedMemoryRecoveryPanel onMemoryCreated={created} />); fireEvent.click(screen.getByRole('button', { name: 'Recuperar criação de memória' }));
  await act(async () => { state.ready = false; state.listeners.forEach(callback => callback()); resolve({ status: 'committed', sessionId: 'synthetic' }); });
  expect(created).not.toHaveBeenCalled(); expect(state.success).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Recuperar criação de memória' })).toBeDisabled();
});
