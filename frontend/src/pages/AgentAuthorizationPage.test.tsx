import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { useUniverseStore } from '../store/universeStore';
import { authorizeAgentClient, navigateAgentCallback, previewAgentAuthorization } from '../services/agentAuthorization';
import AgentAuthorizationPage from './AgentAuthorizationPage';
const mocks = vi.hoisted(() => ({ listener: undefined as undefined | ((user: User | null) => void), stop: vi.fn() }));
vi.mock('../firebase', () => ({ auth: { currentUser: null } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn((_auth, callback) => { mocks.listener = callback; return mocks.stop; }) }));
vi.mock('../components/landing/AuthPage', () => ({ AuthPage: () => <p>Login form</p> }));
vi.mock('../components/MnemonicBackupModal', () => ({ MnemonicBackupModal: () => null }));
vi.mock('../services/agentAuthorization', async importOriginal => ({ ...await importOriginal<typeof import('../services/agentAuthorization')>(),
  previewAgentAuthorization: vi.fn(), authorizeAgentClient: vi.fn(), navigateAgentCallback: vi.fn() }));
const request = { response_type: 'code', client_id: 'synthetic-client', redirect_uri: 'https://client.example/callback',
  scope: 'memories:read', state: 'synthetic-state-0123456789', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256' };
const preview = { clientName: 'Synthetic integration', redirectUri: request.redirect_uri, scopes: ['memories:read'], consentDigest: 'digest', denialUrl: 'denial-callback' };
const signIn = (uid: string | null) => act(() => {
  const user = uid ? { uid, email: `${uid}@example.test` } as User : null;
  Object.assign(auth, { currentUser: user }); mocks.listener!(user);
});
const mount = (search = new URLSearchParams(request).toString()) => render(<MemoryRouter initialEntries={['/agent/authorize?' + search]}><AgentAuthorizationPage /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(auth, { currentUser: null });
  useUniverseStore.setState({ language: 'en' });
  vi.mocked(previewAgentAuthorization).mockResolvedValue(preview);
  vi.mocked(authorizeAgentClient).mockResolvedValue('approved-callback');
});
it('login and preview never authorize; only explicit approval does, once while pending', async () => {
  mount(); signIn(null); expect(screen.getByText('Login form')).toBeInTheDocument();
  signIn('alice');
  const approve = await screen.findByRole('button', { name: 'Authorize access' });
  expect(authorizeAgentClient).not.toHaveBeenCalled(); expect(navigateAgentCallback).not.toHaveBeenCalled();
  expect(screen.getByText('Read encrypted data and metadata')).toBeInTheDocument();
  fireEvent.click(approve); fireEvent.click(approve);
  await waitFor(() => expect(navigateAgentCallback).toHaveBeenCalledWith('approved-callback', request, request.redirect_uri));
  expect(authorizeAgentClient).toHaveBeenCalledExactlyOnceWith(request, 'alice', 'digest');
  expect(previewAgentAuthorization).toHaveBeenCalledExactlyOnceWith(request, 'alice');
});

it('retires approval during a batched account round trip', async () => {
  let resolve!: (value: string) => void;
  vi.mocked(authorizeAgentClient).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  mount(); signIn('alice'); fireEvent.click(await screen.findByRole('button', { name: 'Authorize access' }));
  act(() => { signIn('bob'); signIn('alice'); });
  await screen.findByRole('button', { name: 'Authorize access' });
  await act(async () => resolve('stale-callback'));
  expect(navigateAgentCallback).not.toHaveBeenCalled();
  expect(previewAgentAuthorization).toHaveBeenCalledTimes(2);
});
it('deny returns access_denied without issuing a code', async () => {
  mount(); signIn('alice');
  fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));
  expect(navigateAgentCallback).toHaveBeenCalledWith('denial-callback', request, request.redirect_uri);
  expect(authorizeAgentClient).not.toHaveBeenCalled();
});

it('shows the team name and exact vault identity before explicit approval', async () => {
  const input = { ...request, vault: 'team:crew' };
  vi.mocked(previewAgentAuthorization).mockResolvedValueOnce({ ...preview, vault: input.vault, vaultName: 'Synthetic crew' });
  mount(new URLSearchParams(input).toString()); signIn('alice');
  await screen.findByText('Team: Synthetic crew', { exact: false });
  expect(screen.getByText('(crew)')).toBeInTheDocument(); expect(authorizeAgentClient).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Authorize access' }));
  await waitFor(() => expect(authorizeAgentClient).toHaveBeenCalledExactlyOnceWith(input, 'alice', 'digest'));
});
it('ignores an approval response after account change', async () => {
  let resolve!: (value: string) => void;
  vi.mocked(authorizeAgentClient).mockReturnValue(new Promise(r => { resolve = r; }));
  mount(); signIn('alice'); fireEvent.click(await screen.findByRole('button', { name: 'Authorize access' }));
  signIn('bob'); await screen.findByText('Account: bob@example.test');
  await act(async () => resolve('stale-callback'));
  expect(navigateAgentCallback).not.toHaveBeenCalled();
});
it('ignores pending preview after logout or unmount', async () => {
  let resolve!: (value: typeof preview) => void;
  vi.mocked(previewAgentAuthorization).mockReturnValue(new Promise(r => { resolve = r; }));
  const view = mount(); signIn('alice'); signIn(null);
  await act(async () => resolve(preview));
  expect(screen.queryByRole('button', { name: 'Authorize access' })).not.toBeInTheDocument();
  view.unmount(); expect(mocks.stop).toHaveBeenCalledOnce();
});
it('invalid duplicate parameters or failed server validation cannot authorize or redirect', async () => {
  const view = mount(new URLSearchParams(request).toString() + '&client_id=other'); signIn('alice');
  expect(screen.getByRole('alert')).toBeInTheDocument(); expect(previewAgentAuthorization).not.toHaveBeenCalled();
  view.unmount();
  vi.mocked(previewAgentAuthorization).mockRejectedValue(new Error('sensitive diagnostic'));
  mount(); signIn('alice'); await screen.findByRole('alert');
  expect(screen.queryByText('sensitive diagnostic')).not.toBeInTheDocument();
  expect(authorizeAgentClient).not.toHaveBeenCalled(); expect(navigateAgentCallback).not.toHaveBeenCalled();
});
