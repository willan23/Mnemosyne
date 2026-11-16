import { beforeEach, expect, it, vi } from 'vitest';
import { auth } from '../firebase';
import { AgentAccountError, withAgentAccount } from './agentAccount';
import { observeAgentAccess, setAgentAccess } from './agentAccess';
import { authorizeAgentClient, listAgentGrants, previewAgentAuthorization, revokeAgentGrant } from './agentAuthorization';

const mocks = vi.hoisted(() => ({
  listeners: new Set<(user: { uid: string } | null) => void>(), stops: vi.fn(), rpc: vi.fn(),
  snapshot: vi.fn(), stopSnapshot: vi.fn(),
}));
vi.mock('../firebase', () => ({ default: {}, auth: { currentUser: { uid: 'alice' } }, db: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn((_auth, callback) => {
  mocks.listeners.add(callback); callback(auth.currentUser);
  return () => { mocks.stops(); mocks.listeners.delete(callback); };
}) }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(() => ({})), httpsCallable: vi.fn((_functions, name) =>
  (command: unknown) => mocks.rpc(name, command)) }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn((_db, collection, uid) => ({ collection, uid })),
  onSnapshot: (...args: unknown[]) => { mocks.snapshot(...args); return mocks.stopSnapshot; } }));
const signIn = (uid: string | null) => {
  const user = uid ? { uid } : null;
  Object.assign(auth, { currentUser: user }); mocks.listeners.forEach(callback => callback(user));
};
const request = { response_type: 'code', client_id: 'synthetic-client', redirect_uri: 'https://client.example/callback',
  scope: 'memories:read', state: 'synthetic-state-0123456789', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256' };
beforeEach(() => {
  vi.clearAllMocks(); mocks.listeners.clear(); Object.assign(auth, { currentUser: { uid: 'alice' } });
  mocks.rpc.mockReset();
});

it('rejects an account mismatch before work or any callable can start', async () => {
  signIn('bob'); const work = vi.fn();
  await expect(withAgentAccount('alice', work)).rejects.toBeInstanceOf(AgentAccountError);
  await expect(setAgentAccess('alice', { disabled: false, epoch: 0 }, true)).rejects.toBeInstanceOf(AgentAccountError);
  await expect(listAgentGrants('alice')).rejects.toBeInstanceOf(AgentAccountError);
  await expect(previewAgentAuthorization(request, 'alice')).rejects.toBeInstanceOf(AgentAccountError);
  await expect(authorizeAgentClient(request, 'alice', 'digest')).rejects.toBeInstanceOf(AgentAccountError);
  await expect(revokeAgentGrant('synthetic-grant', 'alice')).rejects.toBeInstanceOf(AgentAccountError);
  expect(work).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.listeners.size).toBe(0);
});

it.each([['bob', 'alice'], [null, 'alice']] as const)('discards a late result after the account round trip %s -> %s', async (away, back) => {
  let resolve!: (value: { data: { grants: [] } }) => void;
  mocks.rpc.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const pending = listAgentGrants('alice');
  const rejection = expect(pending).rejects.toBeInstanceOf(AgentAccountError);
  signIn(away); signIn(back); resolve({ data: { grants: [] } });
  await rejection; expect(mocks.listeners.size).toBe(0); expect(mocks.stops).toHaveBeenCalledOnce();
});

it('guards token acquisition work after an observed account change', async () => {
  const sent = vi.fn();
  await expect(withAgentAccount('alice', async guard => {
    await Promise.resolve(); signIn('bob'); signIn('alice'); guard(); sent();
  })).rejects.toBeInstanceOf(AgentAccountError);
  expect(sent).not.toHaveBeenCalled();
});

it('binds every callable to the captured account and copies consent input', async () => {
  mocks.rpc.mockResolvedValue({ data: { redirectUrl: 'synthetic-callback', grants: [] } });
  const input = { ...request };
  await previewAgentAuthorization(input, 'alice');
  input.client_id = 'changed-later';
  expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'previewAgentAuthorization', { ...request, expectedUid: 'alice' });
  await authorizeAgentClient(request, 'alice', 'digest');
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'authorizeAgentClient', { ...request, expectedUid: 'alice', confirmed: true, consentDigest: 'digest' });
  await listAgentGrants('alice'); await revokeAgentGrant('synthetic-grant', 'alice');
  expect(mocks.rpc).toHaveBeenNthCalledWith(3, 'listAgentGrants', { expectedUid: 'alice' });
  expect(mocks.rpc).toHaveBeenNthCalledWith(4, 'revokeAgentGrant', { grantId: 'synthetic-grant', expectedUid: 'alice' });
  expect(mocks.listeners.size).toBe(0);
});

it('uses the captured switch baseline even if the caller mutates its object', async () => {
  let resolve!: (value: { data: { disabled: boolean; epoch: number } }) => void;
  mocks.rpc.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const baseline = { disabled: false, epoch: 4 };
  const pending = setAgentAccess('alice', baseline, true);
  baseline.epoch = 99;
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('setAgentAccess', { expectedUid: 'alice', baseline: { disabled: false, epoch: 4 }, disabled: true });
  resolve({ data: { disabled: true, epoch: 5 } }); await pending;
});

it('rejects a contradictory acknowledgement and never returns remote error content', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { disabled: false, epoch: 0 } });
  await expect(setAgentAccess('alice', { disabled: false, epoch: 0 }, true)).rejects.toBeInstanceOf(AgentAccountError);
  mocks.rpc.mockRejectedValueOnce(new Error('private diagnostic'));
  await expect(listAgentGrants('alice')).rejects.toHaveProperty('message', new AgentAccountError().message);
  expect(mocks.listeners.size).toBe(0);
});

it('only accepts confirmed server switch state and fails closed for malformed fields', () => {
  const receive = vi.fn(); const stop = observeAgentAccess('alice', receive);
  const update = mocks.snapshot.mock.calls[0][2];
  const snapshot = (data: unknown, fromCache = false, hasPendingWrites = false) => ({ exists: () => true,
    data: () => data, metadata: { fromCache, hasPendingWrites } });
  update(snapshot({ agentAccessDisabled: true, agentAccessEpoch: 7 }, true));
  expect(receive).toHaveBeenLastCalledWith(null);
  update(snapshot({ agentAccessDisabled: true, agentAccessEpoch: 7 }, false, true));
  expect(receive).toHaveBeenLastCalledWith(null);
  update(snapshot({ agentAccessDisabled: true, agentAccessEpoch: 7 }));
  expect(receive).toHaveBeenLastCalledWith({ disabled: true, epoch: 7 });
  update(snapshot({ agentAccessEpoch: null })); expect(receive).toHaveBeenLastCalledWith(null);
  update(snapshot({ agentAccessDisabled: 'true' })); expect(receive).toHaveBeenLastCalledWith(null);
  stop();
});

it('retires switch snapshots permanently after an account round trip and cleans up once', () => {
  const receive = vi.fn(); const stop = observeAgentAccess('alice', receive);
  const update = mocks.snapshot.mock.calls[0][2], lateAuth = [...mocks.listeners][0];
  signIn('bob'); signIn('alice'); receive.mockClear();
  update({ exists: () => true, data: () => ({}), metadata: {} });
  expect(receive).not.toHaveBeenCalled(); stop(); stop(); lateAuth(null);
  expect(receive).not.toHaveBeenCalled(); expect(mocks.stopSnapshot).toHaveBeenCalledOnce();
  expect(mocks.stops).toHaveBeenCalledOnce();
});

it('does not start a profile listener for a foreign account', () => {
  signIn('bob'); const receive = vi.fn(); const stop = observeAgentAccess('alice', receive);
  expect(mocks.snapshot).not.toHaveBeenCalled(); expect(receive).toHaveBeenCalledWith(null); stop();
});

it('requires the server preview to identify the exact requested team vault', async () => {
  const input = { ...request, vault: 'team:crew' };
  for (const data of [{}, { vault: 'personal' }, { vault: 'team:other' }, { vault: 'team:crew', vaultName: 123 }]) {
    mocks.rpc.mockResolvedValueOnce({ data });
    await expect(previewAgentAuthorization(input, 'alice')).rejects.toBeInstanceOf(AgentAccountError);
  }
  mocks.rpc.mockResolvedValueOnce({ data: { vault: 'team:crew', vaultName: 'Synthetic crew' } });
  await expect(previewAgentAuthorization(input, 'alice')).resolves.toMatchObject({ vault: 'team:crew', vaultName: 'Synthetic crew' });
  expect(mocks.rpc).toHaveBeenLastCalledWith('previewAgentAuthorization', { ...input, expectedUid: 'alice' });
});
