const assert = require('node:assert/strict'); const test = require('node:test');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const { parseAccountDeletionInput, accountDeletionRecoveryDigest, executeAccountDeletion, deleteUserAccount, getAccountDeletionStatus, deleteAccountDocumentTree, purgeLegacyAccountObjects } = require('../lib/accountDeletion');
test('account deletion binds the originally confirmed UID before storage, billing or database access', async () => {
  assert.equal(parseAccountDeletionInput('alice', { uid: 'alice' }), 'alice');
  const untouched = { firestore: { runTransaction: () => { throw Error('database must remain untouched'); } } };
  for (const input of [{}, { uid: 'alice', confirmed: true }, { uid: '../alice' }, null]) await assert.rejects(executeAccountDeletion('alice', input, untouched), { code: 'invalid-argument' });
  await assert.rejects(executeAccountDeletion('bob', { uid: 'alice' }, untouched), { code: 'permission-denied' });
  for (const callable of [deleteUserAccount, getAccountDeletionStatus]) await assert.rejects(callable.run({ uid: 'alice' }, {}), { code: 'unauthenticated' });
});

test('a recovery receipt has a strict 256-bit representation and a digest bound to its purpose and UID', () => {
  const token = 'ab'.repeat(32);
  assert.equal(parseAccountDeletionInput('alice', { recoveryToken: token, uid: 'alice' }), 'alice');
  assert.match(accountDeletionRecoveryDigest('alice', token), /^[a-f0-9]{64}$/);
  assert.notEqual(accountDeletionRecoveryDigest('alice', token), token);
  assert.notEqual(accountDeletionRecoveryDigest('alice', token), accountDeletionRecoveryDigest('bob', token));
  for (const bad of ['', 'ab'.repeat(31), token.toUpperCase(), 'g'.repeat(64), null]) {
    assert.throws(() => parseAccountDeletionInput('alice', { uid: 'alice', recoveryToken: bad }), { code: 'invalid-argument' });
  }
});
test('legacy Storage cleanup pins generations, rejects provider failures and verifies a bounded prefix is exhausted', async () => {
  let failure = true; const objects = new Set(['attachments/alice/synthetic']); const events = [];
  const file = name => ({ name, metadata: { generation: '100' }, delete: async options => {
    assert.deepEqual(options, { ifGenerationMatch: '100', ignoreNotFound: true }); events.push(name);
    if (failure) throw Error('synthetic provider outage'); objects.delete(name);
  }, getMetadata: async () => { if (!objects.has(name)) throw Object.assign(Error('synthetic not found'), { code: 404 }); return [{ generation: '100' }]; } });
  const bucket = { getFiles: async options => { assert.equal(options.prefix, 'attachments/alice/'); assert.equal(options.autoPaginate, false);
    return [Array.from(objects).slice(0, options.maxResults).map(file)]; }, file };
  await assert.rejects(purgeLegacyAccountObjects('alice', bucket)); assert.equal(objects.size, 1);
  failure = false; assert.equal(await purgeLegacyAccountObjects('alice', bucket), true); assert.equal(events.length, 2);
  for (let i = 0; i < 1001; i++) objects.add(`attachments/alice/synthetic-${i}`);
  assert.equal(await purgeLegacyAccountObjects('alice', bucket), false); assert.equal(objects.size, 1);
  assert.equal(await purgeLegacyAccountObjects('alice', bucket), true);
});
test('a failed child cleanup preserves the parent query anchor; a retry confirms children before deleting it', async () => {
  let fail = true; const events = []; const children = ['synthetic-versions', 'synthetic-proposals'];
  const ref = { listCollections: async () => children, delete: async () => { events.push('parent-deleted'); } };
  const db = { recursiveDelete: async child => { events.push(child); if (fail) throw Error('synthetic failure'); } };
  await assert.rejects(deleteAccountDocumentTree(db, ref)); assert.deepEqual(events, ['synthetic-versions']);
  fail = false; events.length = 0; await deleteAccountDocumentTree(db, ref); assert.deepEqual(events, [...children, 'parent-deleted']);
});
