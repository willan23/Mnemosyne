import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ uid: 'alice', ready: true, vault: null as (() => void) | null,
  authChanged: null as ((user: { uid: string }) => void) | null, load: vi.fn(), clear: vi.fn(), export: vi.fn() }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return { uid: state.uid }; } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: typeof state.authChanged) => { state.authChanged = callback; return () => { state.authChanged = null; }; } }));
vi.mock('../services/memoryCrypto', () => ({ isMemoryCryptoReady: () => state.ready,
  onMemoryCryptoChanged: (callback: () => void) => { state.vault = callback; return () => { state.vault = null; }; } }));
vi.mock('../services/localMemoryActivity', () => ({ loadLocalMemoryActivity: state.load, clearLocalMemoryActivity: state.clear, exportLocalMemoryActivity: state.export }));
import { LocalMemoryActivityPanel } from './LocalMemoryActivityPanel';
beforeEach(() => {
  state.uid = 'alice'; state.ready = true;
  state.load.mockReset().mockResolvedValue([{ id: 'synthetic', kind: 'retrieve', operation: 'search', at: 1000, resultCount: 7 }]);
  state.clear.mockReset().mockResolvedValue([]); state.export.mockReset().mockResolvedValue('{"events":[]}');
});
const loadButton = () => screen.getByRole('button', { name: /Ver atividade|View activity|Voir l’activité/i });
describe('local activity privacy controls', () => {
  it('loads explicitly and clears the current account without displaying queries or memory IDs', async () => {
    render(<LocalMemoryActivityPanel uid="alice" />);
    expect(state.load).not.toHaveBeenCalled(); fireEvent.click(loadButton());
    await waitFor(() => expect(screen.getByText(/7 resultado|7 result/)).toBeInTheDocument());
    expect(screen.queryByText('synthetic')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Limpar reg|Clear records|Effacer/ }));
    await waitFor(() => expect(state.clear).toHaveBeenCalledWith('alice'));
    expect(screen.queryByText(/7 resultado|7 result/)).not.toBeInTheDocument();
  });
  it('discards an old account response and allows loading the new account', async () => {
    let finish!: (value: unknown[]) => void;
    state.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<LocalMemoryActivityPanel uid="alice" />); fireEvent.click(loadButton());
    state.uid = 'bob'; rerender(<LocalMemoryActivityPanel uid="bob" />);
    await act(async () => finish([{ id: 'old', kind: 'retrieve', at: 1000, resultCount: 99 }]));
    expect(screen.queryByText(/99 resultado|99 result/)).not.toBeInTheDocument();
    expect(loadButton()).toBeEnabled(); fireEvent.click(loadButton());
    await waitFor(() => expect(state.load).toHaveBeenLastCalledWith('bob'));
  });
  it('vault lock hides records and prevents a late export download', async () => {
    let finish!: (value: string) => void;
    state.export.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<LocalMemoryActivityPanel uid="alice" />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar|Export records|Exporter/ }));
    state.ready = false; act(() => state.vault?.());
    await act(async () => finish('{"events":[]}'));
    expect(loadButton()).toBeDisabled();
    expect(state.load).not.toHaveBeenCalled();
  });
  it('reports a storage failure and never presents it as an empty history', async () => {
    state.load.mockRejectedValueOnce(Error('SYNTHETIC-PRIVATE-ERROR'));
    render(<LocalMemoryActivityPanel uid="alice" />); fireEvent.click(loadButton());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/confirmar|confirmed|confirmer/));
    expect(screen.queryByText(/SYNTHETIC/)).not.toBeInTheDocument();
  });
});
