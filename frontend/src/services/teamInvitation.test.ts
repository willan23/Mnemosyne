import { beforeAll, expect, it, vi } from 'vitest';
import { acceptWithCurrentVault, inviteWithCurrentTeamKey, type TeamInvitationDeps, type TeamInviteAcceptanceDeps } from './teamInvitation';
import { decryptTeamMemoryEnvelope, encryptTeamMemoryFields, fingerprintTeamPublicKey, generateTeamKey,
  generateTestRsaIdentity, unwrapTeamKeyWithPrivateKey, wrapTeamKeyForPublicPem } from './teamVault';
import type { TeamInviteRecord, TeamRecord } from './teamsService';
vi.mock('../firebase', () => ({ default: {}, db: {}, auth: { currentUser: null } }));
const words = Array.from({ length: 12 }, () => 'synthetic');
const keyId = '12345678-1234-4234-8234-123456789abc';
let identity: Awaited<ReturnType<typeof generateTestRsaIdentity>>;
let key: CryptoKey;
beforeAll(async () => { identity = await generateTestRsaIdentity(); key = await generateTeamKey(); });
function harness() {
  const state = { uid: 'alice' as string | null, ready: true, generation: 0, current: true, changed: () => undefined as void };
  const stop = vi.fn();
  const team: TeamRecord = { id: 'crew', name: 'Crew', ownerUid: 'alice', createdAt: 1, memberUids: ['alice'],
    wrappedKeys: {}, roles: { alice: 'owner' }, activeKeyEpoch: 2, activeKeyId: keyId, keyRotationStatus: 'active' };
  const deps: TeamInvitationDeps = {
    currentUid: () => state.uid, cryptoReady: () => state.ready, cacheGeneration: () => state.generation,
    subscribeContext: (_uid, cb) => { state.changed = cb; return stop; },
    lookup: vi.fn().mockResolvedValue({ uid: 'bob', displayName: 'Bob', publicKeyPem: identity.pemPublic, emailHash: '' }),
    unlock: vi.fn().mockResolvedValue(key), fingerprint: vi.fn(fingerprintTeamPublicKey), wrap: vi.fn(wrapTeamKeyForPublicPem),
    invite: vi.fn().mockResolvedValue({ inviteId: 'inv1', displayName: 'Bob' }),
  };
  return { state, stop, team, deps };
}
it('binds a real encrypted envelope to the selected epoch and recipient identity', async () => {
  const { deps, team, stop } = harness();
  await inviteWithCurrentTeamKey('alice', words, team, ' BOB@example.com ', () => true, deps);
  const input = vi.mocked(deps.invite).mock.calls[0][0];
  expect(input.expectedKeyEpoch).toBe(2); expect(input.expectedKeyId).toBe(keyId);
  expect(input.expectedUid).toBe('alice'); expect(input.inviteeUid).toBe('bob'); expect(input.email).toBe('bob@example.com');
  expect(input.publicKeyFingerprint).toBe(await fingerprintTeamPublicKey(identity.pemPublic));
  const recovered = await unwrapTeamKeyWithPrivateKey(input.wrappedKey, identity.privateKey);
  const context = { teamId: 'crew', keyEpoch: 2, keyId };
  const encrypted = await encryptTeamMemoryFields(key, { text: 'synthetic-content' }, context);
  expect((await decryptTeamMemoryEnvelope(recovered, encrypted, context)).text === 'synthetic-content').toBe(true);
  expect(stop).toHaveBeenCalledOnce();
});
it('blocks before any lookup when the account or vault is unavailable', async () => {
  for (const change of ['uid', 'ready'] as const) {
    const { state, deps, team, stop } = harness();
    if (change === 'uid') state.uid = 'other'; else state.ready = false;
    await expect(inviteWithCurrentTeamKey('alice', words, team, 'bob@example.com', () => true, deps)).rejects.toThrow();
    expect(deps.lookup).not.toHaveBeenCalled(); expect(deps.invite).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
  }
});
it('checks each asynchronous preparation boundary and never sends after access changes', async () => {
  for (const phase of ['lookup', 'fingerprint', 'unlock', 'wrap'] as const) {
    const { state, deps, team, stop } = harness();
    if (phase === 'lookup') deps.lookup = vi.fn(async () => { state.uid = 'other'; return { uid: 'bob', displayName: 'Bob', publicKeyPem: identity.pemPublic, emailHash: '' }; });
    if (phase === 'fingerprint') deps.fingerprint = vi.fn(async pem => { state.ready = false; return fingerprintTeamPublicKey(pem); });
    if (phase === 'unlock') deps.unlock = vi.fn(async () => { state.generation++; return key; });
    if (phase === 'wrap') deps.wrap = vi.fn(async (...args) => { state.changed(); return wrapTeamKeyForPublicPem(...args); });
    await expect(inviteWithCurrentTeamKey('alice', words, team, 'bob@example.com', () => state.current, deps)).rejects.toThrow();
    expect(deps.invite).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
  }
});
it('rejects a changed team selection and a switch away and back to the same account', async () => {
  for (const switchAccount of [false, true]) {
    const { state, deps, team } = harness();
    deps.unlock = vi.fn(async () => {
      if (switchAccount) { state.uid = 'other'; state.changed(); state.uid = 'alice'; }
      else state.current = false;
      return key;
    });
    await expect(inviteWithCurrentTeamKey('alice', words, team, 'bob@example.com', () => state.current, deps)).rejects.toThrow();
    expect(deps.invite).not.toHaveBeenCalled();
  }
});
it('discards a late invitation response after the vault changes', async () => {
  const { state, deps, team } = harness();
  deps.invite = vi.fn(async () => { state.changed(); return { inviteId: 'inv1', displayName: 'Bob' }; });
  await expect(inviteWithCurrentTeamKey('alice', words, team, 'bob@example.com', () => true, deps)).rejects.toThrow();
  expect(deps.invite).toHaveBeenCalledOnce();
});
async function acceptanceHarness() {
  const { state, team, deps: context, stop } = harness(); state.uid = 'bob';
  const wrappedKey = await wrapTeamKeyForPublicPem(key, identity.pemPublic);
  const invite: TeamInviteRecord = { id: 'inv1', teamId: 'crew', teamName: 'Crew', fromUid: 'alice', uid: 'bob', emailHash: '',
    wrappedKey, status: 'pending', createdAt: 1, expiresAt: 10000, keyEpoch: 2, keyId };
  team.memberUids.push('bob'); team.wrappedKeys.bob = wrappedKey; team.roles.bob = 'member';
  const deps: TeamInviteAcceptanceDeps = { currentUid: context.currentUid, cryptoReady: context.cryptoReady,
    cacheGeneration: context.cacheGeneration, subscribeContext: context.subscribeContext,
    identity: vi.fn().mockResolvedValue(identity), unwrap: vi.fn(unwrapTeamKeyWithPrivateKey),
    accept: vi.fn().mockResolvedValue({ teamId: 'crew', name: 'Crew' }), loadTeam: vi.fn().mockResolvedValue(team), cache: vi.fn() };
  return { state, team, invite, deps, stop };
}
it('caches a successfully acknowledged invite at its actual epoch', async () => {
  const { invite, deps, stop } = await acceptanceHarness();
  await acceptWithCurrentVault('bob', words, invite, deps);
  expect(vi.mocked(deps.cache).mock.calls[0].slice(0, 2)).toEqual(['crew', 2]); expect(stop).toHaveBeenCalledOnce();
});
it('never caches the old invitation key when rotation supersedes the ACK', async () => {
  const { team, invite, deps } = await acceptanceHarness(); team.activeKeyEpoch = 3;
  await acceptWithCurrentVault('bob', words, invite, deps); expect(deps.cache).not.toHaveBeenCalled();
});
it('does not accept after unwrap loses account access and does not cache a late ACK', async () => {
  for (const phase of ['unwrap', 'accept', 'loadTeam'] as const) {
    const { state, invite, deps, stop, team } = await acceptanceHarness();
    if (phase === 'unwrap') deps.unwrap = vi.fn(async (...args) => { state.changed(); return unwrapTeamKeyWithPrivateKey(...args); });
    if (phase === 'accept') deps.accept = vi.fn(async () => { state.uid = 'other'; return { teamId: 'crew', name: 'Crew' }; });
    if (phase === 'loadTeam') deps.loadTeam = vi.fn(async () => { state.generation++; return team; });
    await expect(acceptWithCurrentVault('bob', words, invite, deps)).rejects.toThrow(); expect(deps.cache).not.toHaveBeenCalled();
    if (phase === 'unwrap') expect(deps.accept).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
  }
});
