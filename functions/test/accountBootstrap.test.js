const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT = 'demo-mnemosyne-bootstrap';
const { bootstrapAccount, initializeAccount } = require('../lib/accountBootstrap');

function fixture(initial = []) {
  const docs = new Map(initial), writes = [], authCalls = [];
  let now = 1234, active = true;
  const db = { doc: path => ({ path }), runTransaction: async work => {
    const queued = [];
    const result = await work({ getAll: async (...refs) => { assert.equal(queued.length, 0); return refs.map(ref => ({ ref, exists: docs.has(ref.path), data: () => docs.get(ref.path) })); },
      create: (ref, data) => { assert(!docs.has(ref.path)); queued.push([ref.path, data]); } });
    for (const [path, value] of queued) { docs.set(path, value); writes.push(path); }
    return result;
  } };
  return { docs, writes, authCalls, deps: { firestore: db, now: () => now, activeAuthUser: async uid => { authCalls.push(uid); return active; } },
    time: value => { now = value; }, disable: () => { active = false; } };
}
test('bootstrap creates one minimal server-owned profile; retry preserves usage and entitlements', async () => {
  const f = fixture();
  assert.deepEqual(await bootstrapAccount('alice', {}, f.deps), { ready: true });
  assert.deepEqual(f.docs.get('users/alice'), { accountSchemaVersion: 1, createdAt: 1234 });
  f.docs.set('users/alice', { ...f.docs.get('users/alice'), usage: { memoriesThisMonth: 21 }, subscription: { tier: 'sovereign' } });
  const before = structuredClone(f.docs.get('users/alice')); f.time(2000);
  await bootstrapAccount('alice', {}, f.deps);
  assert.deepEqual(f.docs.get('users/alice'), before); assert.deepEqual(f.writes, ['users/alice']);
});
test('permanent deletion markers deny bootstrap before and after profile removal', async () => {
  for (const profile of [null, {}, { deletionState: 'deleting' }]) {
    const f = fixture([['accountDeletions/alice', { status: 'complete' }], ...(profile ? [['users/alice', profile]] : [])]);
    await assert.rejects(bootstrapAccount('alice', {}, f.deps), { code: 'permission-denied' }); assert.equal(f.writes.length, 0);
  }
});
test('profile deletion state denies re-admission even before the permanent marker is written', async () => {
  const f = fixture([['users/alice', { deletionState: 'deleting' }]]);
  await assert.rejects(bootstrapAccount('alice', {}, f.deps), { code: 'permission-denied' }); assert.equal(f.writes.length, 0);
});
test('missing or disabled Auth account cannot bootstrap an absent or existing profile', async () => {
  for (const rows of [[], [['users/alice', {}]]]) { const f = fixture(rows); f.disable();
    await assert.rejects(bootstrapAccount('alice', {}, f.deps), { code: 'permission-denied' }); assert.equal(f.writes.length, 0); }
});
test('no caller fields or arbitrary UID paths are accepted', async () => {
  const f = fixture();
  for (const data of [null, [], 'alice', { uid: 'bob' }, { subscription: { tier: 'sovereign' } }, { usage: {} }]) {
    await assert.rejects(bootstrapAccount('alice', data, f.deps), { code: 'invalid-argument' });
  }
  for (const uid of ['', 'alice/bob', 'alice\\bob', '..']) await assert.rejects(bootstrapAccount(uid, {}, f.deps), { code: 'permission-denied' });
  assert.equal(f.authCalls.length, 0); assert.equal(f.writes.length, 0);
});
test('invalid server clocks do not create accounts', async () => {
  for (const now of [0, -1, NaN, 1.5]) { const f = fixture(); f.time(now); await assert.rejects(bootstrapAccount('alice', {}, f.deps)); assert.equal(f.writes.length, 0); }
});
test('callable requires authentication and binds no provider secrets', async () => {
  await assert.rejects(initializeAccount.run({}, {}), { code: 'unauthenticated' });
  assert.deepEqual(initializeAccount.__endpoint.secretEnvironmentVariables || [], []);
});
