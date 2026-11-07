import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({uid: 'alice', write: vi.fn()}));
vi.mock('../firebase', () => ({auth: {get currentUser() { return {uid: state.uid}; }}}));
vi.mock('../services/syncConflictResolution', () => ({resolvePersonalSyncConflict: (...args: unknown[]) => state.write(...args),syncConflictWritesEnabled:()=>true}));
vi.mock('../hooks/useSyncFeedback',()=>({useSyncFeedback:()=>({epoch:0,capture:(uid:string)=>()=>state.uid===uid})}));
vi.mock('react-hot-toast', () => ({default: {success: vi.fn(), error: vi.fn()}}));
import toast from 'react-hot-toast';
import { SyncConflictPanel } from './SyncConflictPanel';
import type { SessionData } from '../hooks/useSessions';
const original: SessionData = {id: 'o', uid: 'alice', text: 'Synthetic original', timestamp: 1, updatedAt: 10,syncConflictDigest:'a'.repeat(64)};
const conflict: SessionData = {...original, id: 'c', text: 'Synthetic received', updatedAt: 20, originalMemoryId: 'o', tags: ['sync-conflict'],syncConflictDigest:'b'.repeat(64)};
beforeEach(() => { vi.clearAllMocks(); state.uid = 'alice'; });
afterEach(cleanup);
it('passes the two displayed document digests, disables actions while pending, and reports success after acknowledgement', async () => {
  let finish!: () => void; state.write.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  render(<SyncConflictPanel sessions={[original, conflict]} />); fireEvent.click(screen.getByRole('button', {name: 'Aplicar'}));
  expect(state.write).toHaveBeenCalledExactlyOnceWith({uid: 'alice', conflictId: 'c', action: 'apply', conflictViewDigest: 'b'.repeat(64), originalId: 'o', originalViewDigest: 'a'.repeat(64)},expect.any(Function));
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled(); expect(toast.success).not.toHaveBeenCalled();
  await act(async () => finish()); expect(toast.success).toHaveBeenCalledExactlyOnceWith('Conflito resolvido.');
});
it('keeps content visible on failure and never displays transport diagnostics', async () => {
  state.write.mockRejectedValueOnce(new Error('Synthetic secret diagnostic')); render(<SyncConflictPanel sessions={[original, conflict]} />);
  fireEvent.click(screen.getByRole('button', {name: 'Descartar'}));
  await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Não foi possível confirmar a resolução. O pedido pendente pode ser recuperado.'));
  expect(toast.success).not.toHaveBeenCalled(); expect(screen.getAllByText('Synthetic received')).toHaveLength(2);
});
it('hides unsafe conflicts and disables applying to an unavailable or unsafe original', () => {
  for (const patch of [{uid: 'bob'}, {teamId: 'crew'}, {teamScopeAmbiguous: true}, {encLocked: true}, {sharedWithIds: ['bob']}, {deletedAt: 30}]) {
    const view = render(<SyncConflictPanel sessions={[{...conflict, ...patch}]} />); expect(screen.queryByRole('button')).toBeNull(); view.unmount();
  }
  render(<SyncConflictPanel sessions={[{...original, teamId: 'crew'}, conflict]} />); expect(screen.getByRole('button', {name: 'Aplicar'})).toBeDisabled();
});
it('suppresses late feedback after an account switch or unmount', async () => {
  for (const mode of ['account','unmount'] as const) {
    state.uid = 'alice'; let finish!: () => void; state.write.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
    const view = render(<SyncConflictPanel sessions={[original, conflict]} />); fireEvent.click(screen.getByRole('button', {name: 'Ambos'}));
    if (mode === 'account') state.uid = 'bob'; else view.unmount(); await act(async () => finish());
    expect(toast.success).not.toHaveBeenCalled(); cleanup();
  }
});
