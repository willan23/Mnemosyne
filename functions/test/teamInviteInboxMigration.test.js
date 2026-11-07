const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { classifyInviteForInbox, migrateTeamInviteInboxPage } = require('../lib/teamInviteInboxMigration');
const wrap = { v: 1, alg: 'RSA-OAEP', ct: Buffer.alloc(256, 3).toString('base64') };
function fixture() {
  return { now: 1000, accountsLive: true,
    invite: { uid: 'bob', fromUid: 'alice', teamId: 'crew', status: 'pending', createdAt: 1, expiresAt: 2000,
      keyEpoch: 1, keyId: 'epoch-key', wrappedKey: wrap, emailHash: 'e'.repeat(64),
      publicKeyFingerprint: createHash('sha256').update('public-bob').digest('hex') },
    team: { ownerUid: 'alice', memberUids: ['alice'], roles: { alice: 'owner' }, wrappedKeys: { alice: wrap },
      activeKeyEpoch: 1, activeKeyId: 'epoch-key', keyRotationStatus: 'active' },
    epoch: { epoch: 1, status: 'active', keyId: 'epoch-key', memberUids: ['alice'], wrappedKeys: { alice: wrap } },
    profile: { uid: 'bob', emailHash: 'e'.repeat(64), publicKeyPem: 'public-bob' } };
}
test('inbox migration classifies epoch and identity proofs without inventing missing legacy bindings', () => {
  const f = fixture(); assert.equal(classifyInviteForInbox(f), 'valid');
  for (const field of ['keyEpoch', 'keyId', 'publicKeyFingerprint']) {
    const value = fixture(); delete value.invite[field]; assert.equal(classifyInviteForInbox(value), 'reissue');
  }
  const rotated = fixture(); rotated.profile.publicKeyPem = 'new-public-bob'; assert.equal(classifyInviteForInbox(rotated), 'reissue');
  const mismatched = fixture(); mismatched.invite.keyId = 'other'; assert.equal(classifyInviteForInbox(mismatched), 'reissue');
  const identity = fixture(); identity.profile.uid = 'carol'; assert.equal(classifyInviteForInbox(identity), 'reissue');
  const malformedWrap = fixture(); malformedWrap.invite.wrappedKey = { ...wrap, raw: 'private' };
  assert.equal(classifyInviteForInbox(malformedWrap), 'reissue');
});
test('inbox migration refuses revoked authorities, inconsistent epochs, full teams and terminal invitations', () => {
  for (const change of [f => { f.accountsLive = false; }, f => { f.team.deletionState = 'deleting'; },
    f => { f.team.keyRotationStatus = 'rotation_pending'; }, f => { f.epoch.memberUids = ['alice', 'carol']; },
    f => { f.team.wrappedKeys = {}; }, f => { f.team.memberUids = ['carol']; },
    f => { f.epoch.wrappedKeys = { alice: { ...wrap, ct: Buffer.alloc(256, 4).toString('base64') } }; }]) {
    const f = fixture(); change(f); assert.equal(classifyInviteForInbox(f), 'unavailable');
  }
  const expired = fixture(); expired.invite.expiresAt = 999; assert.equal(classifyInviteForInbox(expired), 'inactive');
  const accepted = fixture(); accepted.invite.status = 'accepted'; assert.equal(classifyInviteForInbox(accepted), 'inactive');
  const bad = fixture(); bad.invite.uid = 'bad/path'; assert.equal(classifyInviteForInbox(bad), 'malformed');
});
test('inbox page context fails before accessing services and does not accept an arbitrary collection', async () => {
  const good = { collection: 'teamInvites', afterId: null, limit: 25, apply: false, now: 1000 };
  for (const extra of [{ collection: 'users' }, { afterId: 'bad/path' }, { limit: 101 }, { limit: 0 }, { now: -1 }, { apply: 'true' }]) {
    await assert.rejects(migrateTeamInviteInboxPage({ ...good, ...extra }, {}, {}), { code: 'invalid-argument' });
  }
});
