import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const state = vi.hoisted(() => ({uid: 'alice', ready: true, auth: new Set<(user: {uid: string}) => void>(), vault: new Set<() => void>(), changes: new Set<() => void>(), teams: [] as string[], fail: false, recover: vi.fn(), cancel: vi.fn()}));
vi.mock('../firebase', () => ({auth: {get currentUser() {return {uid: state.uid};}}}));
vi.mock('firebase/auth', () => ({onAuthStateChanged: (_auth: unknown, cb: (user: {uid: string}) => void) => {state.auth.add(cb); return () => state.auth.delete(cb);}}));
vi.mock('../services/memoryCrypto', () => ({isMemoryCryptoReady: () => state.ready, onMemoryCryptoChanged: (cb: () => void) => {state.vault.add(cb); return () => state.vault.delete(cb);}}));
vi.mock('../services/teamHistoryChangeRecovery', () => ({
  pendingTeamHistoryChangeTeams: async (uid: string, after?: string) => {if (state.fail) throw Error('Storage failed'); return uid === 'alice' ? state.teams.filter(id => !after || id > after).slice(0, 20) : [];},
  observeTeamHistoryChanges: (cb: () => void) => {state.changes.add(cb); return () => state.changes.delete(cb);},
  recoverTeamHistoryChange: (...args: unknown[]) => state.recover(...args), cancelTeamHistoryChange: (...args: unknown[]) => state.cancel(...args),
}));
import {TeamHistoryChangeRecoveryPanel} from './TeamHistoryChangeRecoveryPanel';
beforeEach(() => {state.uid = 'alice'; state.ready = true; state.fail = false; state.teams = ['crew']; vi.clearAllMocks();});
afterEach(() => {cleanup(); expect(state.auth.size).toBe(0); expect(state.vault.size).toBe(0); expect(state.changes.size).toBe(0); vi.restoreAllMocks();});
it('offers bounded pages for every pending team and confirms an owned receipt with a context guard', async () => {
  state.teams = Array.from({length: 23}, (_, index) => 'crew' + String(index).padStart(2, '0')); state.recover.mockResolvedValue({status: 'committed'});
  render(<TeamHistoryChangeRecoveryPanel/>); await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(20));
  fireEvent.click(screen.getByRole('button', {name: 'Página seguinte'})); await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
  fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', {name: 'Recuperar recifra'}));
  await screen.findByRole('status'); expect(state.recover).toHaveBeenCalledWith('alice', 'crew20', expect.any(Function)); expect(state.recover.mock.calls[0][2]()).toBeUndefined();
  fireEvent.click(screen.getByRole('button', {name: 'Página anterior'})); await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(20));
});
it('requires an unlocked vault and confirmation before cancellation; an RPC failure keeps a fixed recoverable message', async () => {
  state.ready = false; render(<TeamHistoryChangeRecoveryPanel/>); const button = await screen.findByRole('button', {name: 'Cancelar recifra pendente'});
  expect(button).toBeDisabled(); act(() => {state.ready = true; state.vault.forEach(cb => cb());});
  const unlocked = await screen.findByRole('button', {name: 'Cancelar recifra pendente'}); await waitFor(() => expect(unlocked).toBeEnabled());
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); fireEvent.click(unlocked); expect(state.cancel).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); state.cancel.mockRejectedValue(Error('Synthetic private diagnostic')); fireEvent.click(unlocked);
  expect(await screen.findByRole('status')).toHaveTextContent('O pedido cifrado foi conservado.'); expect(screen.queryByText(/private diagnostic/)).toBeNull();
});
it.each(['account', 'vault'])('a late %s ABA cannot publish completion and permanently retires the old operation guard', async kind => {
  let finish!: (value: unknown) => void; state.recover.mockImplementation(() => new Promise(resolve => {finish = resolve;})); render(<TeamHistoryChangeRecoveryPanel/>);
  fireEvent.click(await screen.findByRole('button', {name: 'Recuperar recifra'})); await waitFor(() => expect(state.recover).toHaveBeenCalledOnce());
  const guard = state.recover.mock.calls[0][2];
  act(() => {if (kind === 'account') {state.uid = 'bob'; state.auth.forEach(cb => cb({uid: 'bob'})); state.uid = 'alice'; state.auth.forEach(cb => cb({uid: 'alice'}));} else state.vault.forEach(cb => cb());});
  expect(guard).toThrow(); await act(async () => finish({status: 'committed'})); expect(screen.queryByRole('status')).toBeNull();
});
it('shows a storage failure and retries discovery without discarding pending requests', async () => {
  state.fail = true; render(<TeamHistoryChangeRecoveryPanel/>); await screen.findByRole('alert'); state.fail = false;
  fireEvent.click(screen.getByRole('button', {name: 'Tentar novamente'})); await screen.findByRole('button', {name: 'Recuperar recifra'}); expect(screen.queryByRole('alert')).toBeNull();
});
