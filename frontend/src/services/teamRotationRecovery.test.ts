import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { completeTeamRotationWithRecovery, type RotationRecoveryDeps } from './teamRotationRecovery';
import { decryptMemoryEnvelope, encryptMemoryFields, setMemoryCryptoKeyForTests } from './memoryCrypto';
import { decryptTeamMemoryEnvelope, encryptLegacyTeamMemoryFields, encryptTeamMemoryFields, generateTeamKey,
  generateTestRsaIdentity, unwrapTeamKeyWithPrivateKey, wrapTeamKeyForPublicPem } from './teamVault';
import type { TeamRecord } from './teamsService';
import { auth } from '../firebase';
vi.mock('../firebase', () => ({ default: {}, auth: { currentUser: null }, db: {} }));

let alice: Awaited<ReturnType<typeof generateTestRsaIdentity>>;
let bob: Awaited<ReturnType<typeof generateTestRsaIdentity>>;
let oldKey: CryptoKey;
const words = Array.from({ length: 12 }, () => 'synthetic');
beforeAll(async () => { [alice, bob] = await Promise.all([generateTestRsaIdentity(), generateTestRsaIdentity()]); });
beforeEach(async () => { oldKey = await generateTeamKey(); setMemoryCryptoKeyForTests(await generateTeamKey()); });
afterEach(() => { setMemoryCryptoKeyForTests(null); vi.unstubAllGlobals(); Object.assign(auth, { currentUser: null }); });
async function setup(actor = 'alice') {
  const values = new Map<string, string>();
  let currentUid = actor;
  let generation = 0;
  let cryptoListener: () => void = () => undefined;
  let currentTeam: TeamRecord = { id: 'crew', name: 'Synthetic team', ownerUid: 'alice', createdAt: 1,
    memberUids: ['alice', 'bob'], roles: { alice: 'owner', bob: 'admin' },
    wrappedKeys: {}, activeKeyEpoch: 1, activeKeyId: 'old-key-id', keyRotationStatus: 'rotation_pending', pendingRotationId: 'rotation-1' };
  const committed: Parameters<RotationRecoveryDeps['commit']>[0][] = [];
  const deps: RotationRecoveryDeps = {
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    currentUid: () => currentUid, cryptoReady: () => true, cacheGeneration: () => generation,
    subscribeCrypto: cb => { cryptoListener = cb; return vi.fn(); },
    loadTeam: vi.fn(async () => structuredClone(currentTeam)),
    loadRotation: vi.fn(async () => ({ id: 'rotation-1', teamId: 'crew', oldEpoch: 1, newEpoch: 2, status: 'pending',
      reason: 'member_removed', targetUid: 'carol', requestedByUid: 'alice' })),
    loadPublicKeys: vi.fn(async () => ({ alice: alice.pemPublic, bob: bob.pemPublic })),
    unlock: vi.fn(async () => oldKey), identity: vi.fn(async uid => ({ privateKey: uid === 'alice' ? alice.privateKey : bob.privateKey })),
    generate: vi.fn(generateTeamKey), wrap: wrapTeamKeyForPublicPem, unwrap: unwrapTeamKeyWithPrivateKey,
    encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope, cache: vi.fn(),
    commit: vi.fn(async input => { committed.push(input); currentTeam = { ...currentTeam, activeKeyEpoch: 2,
      activeKeyId: input.newKeyId, wrappedKeys: input.wrappedKeys, pendingRotationId: null, keyRotationStatus: 'active' };
      return { newEpoch: 2, alreadyCommitted: false }; }),
    exclusive: async (_name, work) => work(),
  };
  return { deps, values, committed, team: () => currentTeam, setTeam: (team: TeamRecord) => { currentTeam = team; },
    changeUid: () => { currentUid = 'different-account'; }, changeCache: () => { generation++; }, lock: () => cryptoListener() };
}
it('reuses an encrypted checkpoint across a failed request, excludes removed members and protects future content', async () => {
  const state = await setup();
  const firstCommit = state.deps.commit;
  const attempts: Parameters<RotationRecoveryDeps['commit']>[0][] = [];
  state.deps.commit = vi.fn(async input => {
    attempts.push(input);
    if (attempts.length === 1) throw new Error('synthetic network failure');
    return firstCommit(input);
  });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'commit' });
  expect(state.deps.cache).not.toHaveBeenCalled();
  const [checkpointKey, encrypted] = [...state.values.entries()][0];
  expect(Object.keys(JSON.parse(encrypted)).sort()).toEqual(['ct', 'iv', 'v']);
  expect(encrypted.includes('"memberUids"')).toBe(false);
  const saved = JSON.parse((await decryptMemoryEnvelope(JSON.parse(encrypted))).text);
  expect(saved.wrappedKeys.carol === undefined).toBe(true);
  expect(saved.teamKey === undefined).toBe(true);
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).resolves.toEqual({ newEpoch: 2, alreadyCommitted: false });
  expect(JSON.stringify(attempts[0]) === JSON.stringify(attempts[1])).toBe(true);
  expect(state.deps.generate).toHaveBeenCalledOnce();
  expect(state.values.has(checkpointKey)).toBe(false);
  const newKey = vi.mocked(state.deps.cache).mock.calls[0][2];
  const context = { teamId: 'crew', keyEpoch: 2, keyId: attempts[1].newKeyId };
  const future = await encryptTeamMemoryFields(newKey, { text: 'synthetic-future' }, context);
  // Carol held the old key; removal does not erase historical copies, but that key cannot open the future.
  await expect(decryptTeamMemoryEnvelope(oldKey, future, context)).rejects.toBeTruthy();
  const bobKey = await unwrapTeamKeyWithPrivateKey(attempts[1].wrappedKeys.bob, bob.privateKey);
  expect((await decryptTeamMemoryEnvelope(bobKey, future, context)).text === 'synthetic-future').toBe(true);
  const history = await encryptLegacyTeamMemoryFields(oldKey, { text: 'synthetic-history' });
  expect((await decryptTeamMemoryEnvelope(oldKey, history)).text === 'synthetic-history').toBe(true);
});
it('recovers a lost acknowledgement from active server state without another generation or commit', async () => {
  const state = await setup();
  const commit = state.deps.commit;
  state.deps.commit = vi.fn(async input => { await commit(input); throw new Error('response lost after commit'); });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'commit' });
  expect(state.values.size).toBe(1);
  const activeKey = await unwrapTeamKeyWithPrivateKey(state.team().wrappedKeys.alice, alice.privateKey);
  state.deps.unlock = vi.fn(async () => activeKey);
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).resolves.toEqual({ newEpoch: 2, alreadyCommitted: true });
  expect(state.deps.commit).toHaveBeenCalledOnce();
  expect(state.deps.generate).toHaveBeenCalledOnce();
  expect(vi.mocked(state.deps.cache).mock.calls[0][2] === activeKey).toBe(true);
  expect(state.values.size).toBe(0);
});
it('lets an active admin complete and blocks a member or removed account before generation', async () => {
  const admin = await setup('bob');
  await expect(completeTeamRotationWithRecovery('bob', 'crew', words, admin.deps)).resolves.toMatchObject({ newEpoch: 2 });
  for (const mode of ['member', 'removed']) {
    const state = await setup('bob');
    state.setTeam({ ...state.team(), memberUids: mode === 'removed' ? ['alice'] : ['alice', 'bob'], roles: { alice: 'owner', bob: 'member' } });
    await expect(completeTeamRotationWithRecovery('bob', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(state.deps.generate).not.toHaveBeenCalled(); expect(state.deps.commit).not.toHaveBeenCalled();
  }
});
it('does not commit if persistence fails or the personal key cannot open the saved checkpoint', async () => {
  const denied = await setup();
  denied.deps.storage.setItem = () => { throw new Error('QuotaExceededError'); };
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, denied.deps)).rejects.toMatchObject({ reason: 'storage' });
  expect(denied.deps.commit).not.toHaveBeenCalled();
  const state = await setup();
  state.deps.commit = vi.fn(async () => { throw Error('temporary'); });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'commit' });
  const saved = [...state.values.values()][0];
  setMemoryCryptoKeyForTests(await generateTeamKey());
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'checkpoint-invalid' });
  expect([...state.values.values()][0] === saved).toBe(true);
  expect(state.deps.generate).toHaveBeenCalledOnce(); expect(state.deps.commit).toHaveBeenCalledOnce();
});
it('rejects stale membership, malformed storage and swapped account checkpoints without overwriting them', async () => {
  const state = await setup();
  state.deps.commit = vi.fn(async () => { throw Error('temporary'); });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'commit' });
  const [key, saved] = [...state.values.entries()][0];
  state.setTeam({ ...state.team(), memberUids: ['alice'] });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'checkpoint-obsolete' });
  expect(state.values.get(key) === saved).toBe(true); expect(state.deps.generate).toHaveBeenCalledOnce();
  state.values.set(key, '{"version":1}');
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'checkpoint-invalid' });
  expect(state.values.get(key)).toBe('{"version":1}');
  const other = await setup('bob');
  other.values.set(key.replace(':alice:', ':bob:'), saved);
  await expect(completeTeamRotationWithRecovery('bob', 'crew', words, other.deps)).rejects.toMatchObject({ reason: 'checkpoint-invalid' });
  expect(other.deps.commit).not.toHaveBeenCalled();
});
it('rejects a saved proposal when a recipient publishes a different public key', async () => {
  const state = await setup();
  state.deps.commit = vi.fn(async () => { throw Error('temporary'); });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'commit' });
  const saved = [...state.values.values()][0];
  state.deps.loadPublicKeys = vi.fn(async () => ({ alice: alice.pemPublic, bob: alice.pemPublic }));
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'checkpoint-obsolete' });
  expect(state.deps.generate).toHaveBeenCalledOnce(); expect(state.deps.commit).toHaveBeenCalledOnce();
  expect([...state.values.values()][0] === saved).toBe(true);
});
it('drops late results after account change, crypto lock or cache invalidation and retains the checkpoint', async () => {
  for (const change of ['uid', 'lock', 'cache']) {
    const state = await setup();
    const commit = state.deps.commit;
    state.deps.commit = vi.fn(async input => {
      const result = await commit(input);
      if (change === 'uid') state.changeUid(); else if (change === 'lock') state.lock(); else state.changeCache();
      return result;
    });
    await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'access-changed' });
    expect(state.deps.cache).not.toHaveBeenCalled(); expect(state.values.size).toBe(1);
  }
});
it('requires the exact committed key/epoch from a fresh server acknowledgement before publishing the cache', async () => {
  const state = await setup();
  const commit = state.deps.commit;
  state.deps.commit = vi.fn(async input => { const result = await commit(input); state.setTeam({ ...state.team(), activeKeyId: 'different-key-id' }); return result; });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, state.deps)).rejects.toMatchObject({ reason: 'unavailable' });
  expect(state.deps.cache).not.toHaveBeenCalled(); expect(state.values.size).toBe(1);
});
it('does not prepare a rotation when the server cannot confirm state or another tab holds the lock', async () => {
  const offline = await setup(); offline.deps.loadTeam = vi.fn(async () => { throw Error('offline'); });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, offline.deps)).rejects.toBeTruthy();
  expect(offline.deps.generate).not.toHaveBeenCalled(); expect(offline.deps.commit).not.toHaveBeenCalled();
  const locked = await setup(); locked.deps.exclusive = vi.fn(async () => { throw Error('busy'); });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words, locked.deps)).rejects.toBeTruthy();
  expect(locked.deps.loadTeam).not.toHaveBeenCalled();
});
it('default coordinator refuses a platform without Web Locks before contacting Firestore', async () => {
  Object.assign(auth, { currentUser: { uid: 'alice' } });
  vi.stubGlobal('navigator', { locks: undefined });
  await expect(completeTeamRotationWithRecovery('alice', 'crew', words)).rejects.toMatchObject({ reason: 'unsupported' });
});
