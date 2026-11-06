import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useUniverseStore } from '../store/universeStore';
import { observeAgentAccess, setAgentAccess } from '../services/agentAccess';
import { AgentAccessPanel } from './AgentAccessPanel';
import { auth } from '../firebase';
import type { AgentAccessState } from '../services/agentAccess';

const mocks = vi.hoisted(() => ({ listeners: new Set<(user: { uid: string } | null) => void>() }));
vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'alice' } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn((_auth, callback) => {
  mocks.listeners.add(callback); return () => mocks.listeners.delete(callback);
}) }));
vi.mock('../services/agentAccess', () => ({ observeAgentAccess: vi.fn(), setAgentAccess: vi.fn() }));
let receive: (state: AgentAccessState | null) => void;
const stop = vi.fn();
const signIn = (uid: string | null) => {
  const user = uid ? { uid } : null;
  Object.assign(auth, { currentUser: user }); mocks.listeners.forEach(callback => callback(user));
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear(); Object.assign(auth, { currentUser: { uid: 'alice' } });
  useUniverseStore.setState({ language: 'en' });
  vi.mocked(observeAgentAccess).mockImplementation((_uid, callback) => { receive = callback; return stop; });
  vi.mocked(setAgentAccess).mockResolvedValue(undefined);
});

it('requires server state and follows stop/resume acknowledgements', async () => {
  const view = render(<AgentAccessPanel uid="alice" />);
  expect(screen.getByRole('button')).toBeDisabled();
  act(() => receive({ disabled: false, epoch: 4 }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop access' }));
  await waitFor(() => expect(setAgentAccess).toHaveBeenCalledWith('alice', { disabled: false, epoch: 4 }, true));
  // Calling the function does not optimistically claim that access stopped.
  expect(screen.getByRole('status')).toHaveTextContent('Access allowed');
  act(() => receive({ disabled: true, epoch: 5 }));
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Resume access' }));
  await waitFor(() => expect(setAgentAccess).toHaveBeenCalledWith('alice', { disabled: true, epoch: 5 }, false));
  act(() => receive(null));
  expect(screen.getByRole('button')).toBeDisabled();
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
});

it('shows fixed failure text without exposing server error contents', async () => {
  vi.mocked(setAgentAccess).mockRejectedValue(new Error('private diagnostic'));
  render(<AgentAccessPanel uid="alice" />);
  act(() => receive({ disabled: false, epoch: 0 }));
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm the change');
  expect(screen.queryByText('private diagnostic')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Access allowed');
});

it('retires old state and errors after a batched account round trip', async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(setAgentAccess).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  render(<AgentAccessPanel uid="alice" />);
  const oldReceive = receive;
  act(() => receive({ disabled: true, epoch: 1 }));
  const button = screen.getByRole('button'); fireEvent.click(button); fireEvent.click(button);
  expect(setAgentAccess).toHaveBeenCalledTimes(1);
  act(() => { signIn('bob'); signIn('alice'); });
  expect(screen.getByRole('button')).toBeDisabled();
  act(() => oldReceive({ disabled: false, epoch: 0 }));
  expect(screen.getByRole('button')).toBeDisabled();
  await act(async () => reject(new Error('private diagnostic')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  act(() => receive({ disabled: true, epoch: 2 }));
  expect(screen.getByRole('button', { name: 'Resume access' })).toBeEnabled();
  expect(stop).toHaveBeenCalledOnce();
});

it('clears the previous account before the next account receives server state', () => {
  const view = render(<AgentAccessPanel uid="alice" />);
  act(() => receive({ disabled: true, epoch: 1 }));
  const oldReceive = receive;
  act(() => signIn('bob')); view.rerender(<AgentAccessPanel uid="bob" />);
  act(() => oldReceive({ disabled: true, epoch: 1 }));
  expect(screen.getByRole('button')).toBeDisabled();
  expect(observeAgentAccess).toHaveBeenLastCalledWith('bob', expect.any(Function));
});
