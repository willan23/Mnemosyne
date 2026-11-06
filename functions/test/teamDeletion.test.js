const assert = require('node:assert/strict'); const test = require('node:test');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const { executeDeleteTeam, parseTeamDeletionInput, parsePendingTeamDeletionInput, deleteTeam, getTeamDeletionStatus, getPendingTeamDeletions, TEAM_DELETION_ENABLED } = require('../lib/teamDeletion');
const { validTeamDeletionMarker, teamDeletionOwnerDigest } = require('../lib/teamDeletionContract');
test('team deletion requires the exact confirmed UID and one team before database or object access', async () => {
  assert.equal(TEAM_DELETION_ENABLED, false);
  assert.deepEqual(parseTeamDeletionInput('alice', { teamId: 'crew', expectedUid: 'alice' }), { teamId: 'crew', expectedUid: 'alice' });
  const untouched = { firestore: { runTransaction: () => { throw Error('Unexpected database access'); } } };
  for (const input of [null, {}, { teamId: 'crew' }, { teamId: '../crew', expectedUid: 'alice' },
    { teamId: 'crew', expectedUid: 'alice', confirmed: true }]) {
    await assert.rejects(executeDeleteTeam('alice', input, untouched), { code: 'invalid-argument' });
  }
  await assert.rejects(executeDeleteTeam('bob', { teamId: 'crew', expectedUid: 'alice' }, untouched), { code: 'permission-denied' });
  for (const callable of [deleteTeam, getTeamDeletionStatus, getPendingTeamDeletions]) await assert.rejects(callable.run({ teamId: 'crew', expectedUid: 'alice' }, {}), { code: 'unauthenticated' });
});
test('pending team discovery validates the account and bounded cursor before querying', () => {
  assert.deepEqual(parsePendingTeamDeletionInput('alice', { expectedUid: 'alice', afterTeamId: null }), { afterTeamId: null });
  assert.deepEqual(parsePendingTeamDeletionInput('alice', { expectedUid: 'alice', afterTeamId: 'crew' }), { afterTeamId: 'crew' });
  for (const input of [null, {}, { expectedUid: 'alice' }, { expectedUid: 'alice', afterTeamId: '../crew' },
    { expectedUid: 'alice', afterTeamId: null, uid: 'alice' }]) assert.throws(() => parsePendingTeamDeletionInput('alice', input), { code: 'invalid-argument' });
  assert.throws(() => parsePendingTeamDeletionInput('alice', { expectedUid: 'bob', afterTeamId: null }), { code: 'permission-denied' });
});
test('a complete team marker is compact, UID-bound and cannot claim an active lease or missing completion timestamp', () => {
  const value = { v: 1, ownerDigest: teamDeletionOwnerDigest('alice', 'crew'), phase: 'complete', status: 'complete', completedAt: 1000, leaseUntil: 0 };
  assert.equal(validTeamDeletionMarker(value, 'alice', 'crew'), true);
  for (const invalid of [{ ...value, ownerUid: 'alice' }, { ...value, leaseUntil: 1000 }, { ...value, completedAt: undefined },
    { ...value, worker: 'synthetic' }, { ...value, phase: 'objects' }]) assert.equal(validTeamDeletionMarker(invalid, 'alice', 'crew'), false);
  assert.equal(validTeamDeletionMarker(value, 'bob', 'crew'), false);
});
