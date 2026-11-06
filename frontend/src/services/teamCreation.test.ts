import type { User } from 'firebase/auth';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cancelPendingTeamCreation, createTeamWithActiveEpoch, TeamCreationError, type TeamCreationDeps } from './teamCreation';
import { decryptMemoryEnvelope, encryptMemoryFields, setMemoryCryptoKeyForTests } from './memoryCrypto';
import { decryptTeamMemoryEnvelope, encryptTeamMemoryFields, fingerprintTeamPublicKey, generateTeamKey,
  generateTestRsaIdentity, unwrapTeamKeyWithPrivateKey, wrapTeamKeyForIdentity } from './teamVault';
import type { TeamRecord } from './teamsService';
vi.mock('../firebase', () => ({ default: {}, db: {}, auth: { currentUser: null } }));
const user = { uid: 'alice' } as User;
const words = Array.from({ length: 12 }, () => 'synthetic');
const keyId = '12345678-1234-4234-8234-123456789abc';
let identity: Awaited<ReturnType<typeof generateTestRsaIdentity>>;
beforeAll(async () => { identity = await generateTestRsaIdentity(); });
beforeEach(async () => { setMemoryCryptoKeyForTests(await generateTeamKey()); });
afterEach(() => { setMemoryCryptoKeyForTests(null); vi.unstubAllGlobals(); });
function harness() {
  const state = { uid: 'alice' as string | null, ready: true, generation: 0, listener: () => undefined as void };
  const values = new Map<string, string>();
  const team: TeamRecord = { id: 'crew', name: 'Crew', ownerUid: 'alice', createdAt: 1, memberUids: ['alice'], roles: { alice: 'owner' },
    wrappedKeys: {}, activeKeyEpoch: 1, activeKeyId: keyId, keyRotationStatus: 'active', pendingRotationId: null };
  const result = { teamId: 'crew', name: 'Crew', activeKeyEpoch: 1, activeKeyId: keyId, alreadyCreated: false };
  const deps: TeamCreationDeps = { currentUid: () => state.uid, cryptoReady: () => state.ready,
    storage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } },
    cacheGeneration: () => state.generation, subscribeCrypto: cb => { state.listener = cb; return vi.fn(); },
    publish: vi.fn().mockResolvedValue(identity), identity: vi.fn().mockResolvedValue(identity), generate: vi.fn(generateTeamKey),
    wrap: wrapTeamKeyForIdentity, unwrap: vi.fn(unwrapTeamKeyWithPrivateKey), fingerprint: fingerprintTeamPublicKey,
    encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope, loadTeam: vi.fn(async () => structuredClone(team)),
    unlock: vi.fn(), exclusive: async (_name, work) => work(),
    create: vi.fn(async (_name, wrap) => { team.wrappedKeys.alice = wrap; return result; }), cancel: vi.fn().mockResolvedValue(undefined), cache: vi.fn() };
  return { state, deps, values, team, result };
}
it('persists encrypted preparation before sending and caches the recoverable acknowledged epoch', async () => {
  const { deps, values, result } = harness(); const create = deps.create;
  deps.create = vi.fn(async (...args) => {
    expect(values.size).toBe(1); const saved = [...values.values()][0];
    expect(Object.keys(JSON.parse(saved)).sort()).toEqual(['ct', 'iv', 'v']); expect(saved.includes('"wrappedKey"')).toBe(false);
    return create(...args);
  });
  await createTeamWithActiveEpoch(user, words, 'Crew', deps);
  expect(deps.publish).toHaveBeenCalledWith(user, words,expect.any(Function));
  expect(deps.create).toHaveBeenCalledExactlyOnceWith('Crew', expect.any(Object), 'alice', await fingerprintTeamPublicKey(identity.pemPublic), expect.stringMatching(/^[a-f0-9-]{36}$/));
  expect(values.size).toBe(0);
  const cached = vi.mocked(deps.cache).mock.calls[0][2]; const context = { teamId: 'crew', keyEpoch: 1, keyId: result.activeKeyId };
  const content = await encryptTeamMemoryFields(cached, { text: 'synthetic-content' }, context);
  expect((await decryptTeamMemoryEnvelope(cached, content, context)).text === 'synthetic-content').toBe(true);
});
it('reuses identical preparation after a lost response and coordinator restart without republishing or generating', async () => {
  const { deps, values } = harness(); const create = deps.create;
  deps.create = vi.fn(async (...args) => { await create(...args); throw Error('synthetic lost ACK'); });
  await expect(createTeamWithActiveEpoch(user, words, 'Crew', deps)).rejects.toThrow();
  const prepared = vi.mocked(deps.create).mock.calls[0]; expect(values.size).toBe(1); expect(deps.cache).not.toHaveBeenCalled();
  deps.create = vi.fn(async (...args) => create(...args)); await createTeamWithActiveEpoch(user, words, null, { ...deps });
  expect(deps.create).toHaveBeenCalledExactlyOnceWith(...prepared); expect(deps.generate).toHaveBeenCalledOnce();
  expect(deps.publish).toHaveBeenCalledOnce(); expect(values.size).toBe(0);
});
it('never creates when identity publication, local unwrap or durable storage fails', async () => {
  for (const failed of ['publish', 'unwrap', 'storage'] as const) {
    const { deps } = harness(); if (failed === 'storage') deps.storage.setItem = () => { throw Error('synthetic quota'); };
    else vi.mocked(deps[failed]).mockRejectedValue(Error('synthetic'));
    await expect(createTeamWithActiveEpoch(user, words, 'Crew', deps)).rejects.toThrow();
    expect(deps.create).not.toHaveBeenCalled(); expect(deps.cache).not.toHaveBeenCalled();
  }
});
it('preserves unreadable, swapped-account and wrong-cofre checkpoints and refuses a different creation', async () => {
  for (const mode of ['malformed', 'uid', 'cofre', 'different-name'] as const) {
    const { deps, values } = harness(); deps.create = vi.fn().mockRejectedValue(Error('synthetic'));
    await expect(createTeamWithActiveEpoch(user, words, 'Crew', deps)).rejects.toThrow(); const key = [...values.keys()][0];
    if (mode === 'malformed') values.set(key, '{invalid');
    else if (mode === 'uid') { const job = JSON.parse((await decryptMemoryEnvelope(JSON.parse(values.get(key)!))).text);
      job.uid = 'bob'; values.set(key, JSON.stringify(await encryptMemoryFields({ text: JSON.stringify(job) }))); }
    else if (mode === 'cofre') setMemoryCryptoKeyForTests(await generateTeamKey());
    const saved = values.get(key); vi.mocked(deps.create).mockClear();
    await expect(createTeamWithActiveEpoch(user, words, mode === 'different-name' ? 'Other' : null, deps)).rejects.toMatchObject({ reason: mode === 'different-name' ? 'pending' : 'checkpoint-invalid' });
    expect(values.get(key) === saved).toBe(true); expect(deps.create).not.toHaveBeenCalled(); expect(deps.generate).toHaveBeenCalledOnce();
  }
});
it('preserves preparation when the local identity changes and never sends a replacement wrap', async () => {
  const { deps, values } = harness(); deps.create = vi.fn().mockRejectedValue(Error('synthetic'));
  await expect(createTeamWithActiveEpoch(user, words, 'Crew', deps)).rejects.toThrow(); const saved = [...values.values()][0];
  deps.identity = vi.fn().mockResolvedValue({ ...identity, pemPublic: 'different-identity' }); vi.mocked(deps.create).mockClear();
  await expect(createTeamWithActiveEpoch(user, words, null, deps)).rejects.toMatchObject({ reason: 'checkpoint-obsolete' });
  expect([...values.values()][0] === saved).toBe(true); expect(deps.create).not.toHaveBeenCalled();
});
it('refuses stale preparation and keeps late acknowledgements out of cache after account, lock or cache changes', async () => {
  for (const change of ['uid', 'ready', 'generation', 'listener'] as const) for (const step of ['publish', 'create'] as const) {
    const { deps, state, values } = harness();
    const mutate = () => { if (change === 'uid') state.uid = 'bob'; else if (change === 'ready') state.ready = false;
      else if (change === 'generation') state.generation++; else state.listener(); };
    if (step === 'publish') deps.publish = vi.fn(async () => { mutate(); return identity; });
    else { const create = deps.create; deps.create = vi.fn(async (...args) => { const result = await create(...args); mutate(); return result; }); }
    await expect(createTeamWithActiveEpoch(user, words, 'Crew', deps)).rejects.toMatchObject({ reason: 'access-changed' });
    expect(deps.cache).not.toHaveBeenCalled(); if (step === 'publish') expect(deps.create).not.toHaveBeenCalled(); else expect(values.size).toBe(1);
  }
});
it('recovers the current key after a later rotation and refuses mismatched ACK or removed ownership', async () => {
  const { deps, team, result } = harness(); const active = await generateTeamKey(); deps.unlock = vi.fn(async () => active); const create = deps.create;
  deps.create = vi.fn(async (...args) => { await create(...args); team.activeKeyEpoch = 2; result.activeKeyEpoch = 2; return result; });
  await createTeamWithActiveEpoch(user, words, 'Crew', deps); expect(deps.cache).toHaveBeenCalledExactlyOnceWith('crew', 2, active);
  for (const mode of ['ack', 'owner', 'membership'] as const) { const state = harness();
    if (mode === 'ack') state.team.activeKeyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; else if (mode === 'owner') state.team.ownerUid = 'bob'; else state.team.memberUids = [];
    await expect(createTeamWithActiveEpoch(user, words, 'Crew', state.deps)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(state.deps.cache).not.toHaveBeenCalled(); expect(state.values.size).toBe(1);
  }
});
it('does not start without Web Locks or while another preparation holds the lock', async () => {
  vi.stubGlobal('navigator', { locks: undefined }); await expect(createTeamWithActiveEpoch(user, words, 'Crew')).rejects.toMatchObject({ reason: 'unsupported' });
  const { deps } = harness(); deps.exclusive = async () => { throw new TeamCreationError('busy'); };
  await expect(createTeamWithActiveEpoch(user, words, 'Crew', deps)).rejects.toMatchObject({ reason: 'busy' });
  expect(deps.publish).not.toHaveBeenCalled(); expect(deps.create).not.toHaveBeenCalled();
});
it('invalidates on the server before clearing local preparation and retains it on failure or account change', async () => {
  for (const mode of ['success', 'failure', 'account'] as const) {
    const { deps, values, state } = harness(); deps.create = vi.fn().mockRejectedValue(Error('synthetic'));
    await expect(createTeamWithActiveEpoch(user, words, 'Crew', deps)).rejects.toThrow();
    const saved = [...values.values()][0]; const job = JSON.parse((await decryptMemoryEnvelope(JSON.parse(saved))).text);
    deps.cancel = vi.fn(async () => { expect(values.size).toBe(1);
      if (mode === 'failure') throw Error('synthetic'); if (mode === 'account') state.uid = 'bob'; });
    if (mode === 'success') { await cancelPendingTeamCreation(user, deps); expect(values.size).toBe(0); }
    else { await expect(cancelPendingTeamCreation(user, deps)).rejects.toThrow(); expect([...values.values()][0] === saved).toBe(true); }
    expect(deps.cancel).toHaveBeenCalledExactlyOnceWith(job.requestId, 'alice'); expect(deps.cache).not.toHaveBeenCalled();
  }
});
