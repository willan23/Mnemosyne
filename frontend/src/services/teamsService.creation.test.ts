import { beforeEach, expect, it, vi } from 'vitest';
import { cancelTeamCreationRemote, createTeamRemote } from './teamsService';
const callable = vi.hoisted(() => vi.fn());
vi.mock('../firebase', () => ({ default: {}, db: {} }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: () => callable }));
const wrap = { v: 1 as const, alg: 'RSA-OAEP' as const, ct: 'synthetic-ciphertext' };
const requestId = '12345678-1234-4234-8234-123456789abc';
const response = { teamId: 'crew', name: 'Crew', activeKeyEpoch: 1, activeKeyId: requestId, alreadyCreated: false };
beforeEach(() => callable.mockReset());
it('sends only the account binding, public fingerprint and wrapped key and returns explicit epoch metadata', async () => {
  callable.mockResolvedValue({ data: response });
  expect(await createTeamRemote(' Crew ', wrap, 'alice', 'a'.repeat(64), requestId)).toEqual(response);
  expect(callable).toHaveBeenCalledExactlyOnceWith({ name: 'Crew', wrappedKey: wrap, expectedUid: 'alice', publicKeyFingerprint: 'a'.repeat(64), requestId });
});
it('refuses legacy or malformed responses instead of assuming epoch 1', async () => {
  for (const data of [{ teamId: 'crew' }, { ...response, activeKeyEpoch: 0 }, { ...response, activeKeyEpoch: 1.5 }, { ...response, alreadyCreated: undefined }, { ...response, activeKeyId: '' },
    { ...response, activeKeyId: 'invalid' }, { ...response, teamId: '' }, { ...response, teamId: 'a/b' }]) {
    callable.mockResolvedValue({ data });
    await expect(createTeamRemote('Crew', wrap, 'alice', 'a'.repeat(64), requestId)).rejects.toThrow('Resposta inválida');
  }
});
it('accepts the current epoch of an existing team on an idempotent recovery', async () => {
  callable.mockResolvedValue({ data: { ...response, activeKeyEpoch: 2, alreadyCreated: true } });
  expect(await createTeamRemote('Crew', wrap, 'alice', 'a'.repeat(64), requestId)).toMatchObject({ activeKeyEpoch: 2, alreadyCreated: true });
});
it('requires a valid cancellation acknowledgement', async () => {
  callable.mockResolvedValue({ data: { ok: false } }); await expect(cancelTeamCreationRemote(requestId, 'alice')).rejects.toThrow();
  callable.mockResolvedValue({ data: { ok: true } }); await cancelTeamCreationRemote(requestId, 'alice');
  expect(callable).toHaveBeenLastCalledWith({ requestId, expectedUid: 'alice', confirmed: true });
});
