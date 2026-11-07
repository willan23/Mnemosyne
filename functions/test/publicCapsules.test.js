const { test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');
const { executeGetPublicCapsule, executeRecordCapsuleOpening, executeRevokePublicCapsule, capsuleOwnerSourceToken, consumePublicCapsuleBudget,
  PUBLIC_CAPSULE_DAILY_REQUESTS, PUBLIC_CAPSULE_NETWORK_DAILY_REQUESTS } = require('../lib/publicCapsules');
const { publicCapsuleSourceBytes } = require('../lib/publicCapsuleContract');
const sha = value => createHash('sha256').update(value).digest('hex');
const cipher = () => ({ v: 1, alg: 'AES-GCM-PBKDF2', salt: 'A'.repeat(22) + '==', iv: 'A'.repeat(16), data: 'A'.repeat(43) + '=' });
function fixture() {
  const state = { now: 1000000, generation: 1, enabled: true, admitted: true, revokeAdmitted: true, disabled: false, removed: false, authMismatch: false, admissions: 0, transactions: 0 };
  const docs = new Map([['users/owner-private', { uid: 'owner-private' }], ['shares/capsule', { uid: 'owner-private', sessionId: 'private-memory-id', encrypted: true, ciphertext: cipher(),
    createdAt: 100, expiresAt: state.now + 86400000, views: 0, importCount: 0, titleHint: 'SYNTHETIC_PRIVATE_TITLE', text: 'SYNTHETIC_PRIVATE_LEGACY_FIELD', other: { email: 'private.synthetic.invalid' } }]]);
  const ref = path => ({ path });
  const snap = value => ({ exists: docs.has(value.path), createTime: new admin.firestore.Timestamp(1, state.generation), data: () => structuredClone(docs.get(value.path)) });
  const db = { doc: ref, runTransaction: async body => {
    state.transactions++; const writes = [];
    const tx = { get: async value => snap(value), getAll: async (...refs) => refs.map(snap),
      set: (value, data) => writes.push(['set', value.path, data]), create: (value, data) => writes.push(['create', value.path, data]), update: (value, data) => writes.push(['update', value.path, data]) };
    const result = await body(tx);
    for (const [mode, path, data] of writes) { if (mode === 'create') assert(!docs.has(path)); if (mode === 'update') assert(docs.has(path)); }
    for (const [mode, path, data] of writes) docs.set(path, mode === 'update' ? { ...docs.get(path), ...data } : data);
    return result;
  } };
  const deps = { firestore: db, now: () => state.now, enabled: () => state.enabled, admit: async () => { state.admissions++; return state.admitted; }, admitRevoke: async () => state.revokeAdmitted,
    auth: { getUser: async uid => { if (state.removed) throw Error(); return { uid: state.authMismatch ? 'another' : uid, disabled: state.disabled }; } } };
  const read = () => executeGetPublicCapsule({ v: 1, shareId: 'capsule' }, deps);
  const opening = source => ({ v: 1, shareId: 'capsule', openingId: 'o'.repeat(32), sourceDigest: source.sourceDigest, viewDeadline: source.viewDeadline });
  return { state, docs, db, deps, read, opening, record: input => executeRecordCapsuleOpening(input, deps),
    ownerToken: () => capsuleOwnerSourceToken('capsule', snap(ref('shares/capsule'))),
    revoke: (uid = 'owner-private', input = { v: 2, actorUid: uid, shareId: 'capsule', sourceToken: capsuleOwnerSourceToken('capsule', snap(ref('shares/capsule'))) }) => executeRevokePublicCapsule(uid, input, deps), dump: () => JSON.stringify([...docs]) };
}
test('public read returns a strict ciphertext-only view and a matching source digest', async () => {
  const f = fixture(), before = f.dump(), output = await f.read();
  assert.deepEqual(Object.keys(output).sort(), ['ciphertext','createdAt','expiresAt','generation','shareId','sourceDigest','v','viewDeadline','views']);
  assert.equal(output.sourceDigest, sha(publicCapsuleSourceBytes(output))); assert.deepEqual(output.ciphertext, cipher());
  for (const privateValue of ['owner-private','private-memory-id','SYNTHETIC_PRIVATE','private.synthetic.invalid']) assert(!JSON.stringify(output).includes(privateValue));
  assert.equal(f.dump(), before); assert.equal(f.state.admissions, 1);
});
test('closed public gate, admission refusal and malformed requests never read a capsule', async () => {
  const f = fixture();
  for (const value of [null, [], { v: 2, shareId: 'capsule' }, { v: 1, shareId: 'a/b' }, { v: 1, shareId: 'capsule', passphrase: 'secret' }])
    await assert.rejects(executeGetPublicCapsule(value, f.deps), { code: 'invalid-argument' });
  f.state.enabled = false; await assert.rejects(f.read(), { code: 'failed-precondition' }); assert.equal(f.state.admissions, 0);
  f.state.enabled = true; f.state.admitted = false; await assert.rejects(f.read(), { code: 'resource-exhausted' }); assert.equal(f.state.transactions, 0);
});
test('missing, expired, revoked, malformed cipher and unavailable owner have the same unavailable result', async () => {
  for (const reason of ['missing','expired','revoked','cipher','disabled','removed','authMismatch','marker','deleting']) {
    const f = fixture(), data = f.docs.get('shares/capsule');
    if (reason === 'missing') f.docs.delete('shares/capsule');
    if (reason === 'expired') data.expiresAt = f.state.now;
    if (reason === 'revoked') data.revokedAt = 10;
    if (reason === 'cipher') data.ciphertext.iv = 'bad';
    if (['disabled','removed','authMismatch'].includes(reason)) f.state[reason] = true;
    if (reason === 'marker') f.docs.set('accountDeletions/owner-private', { status: 'complete' });
    if (reason === 'deleting') f.docs.set('users/owner-private', { deletionState: 'deleting' });
    const before = f.dump(); await assert.rejects(f.read(), { code: 'not-found' }); assert.equal(f.dump(), before);
  }
});
test('fresh source checks after Auth refuse changed ciphertext, generation or owner marker', async () => {
  for (const change of ['cipher','generation','marker']) {
    const f = fixture(); f.deps.auth.getUser = async uid => { if (change === 'cipher') f.docs.get('shares/capsule').ciphertext.data = 'B'.repeat(43)+'=';
      if (change === 'generation') f.state.generation++; if (change === 'marker') f.docs.set('accountDeletions/owner-private', { status: 'complete' }); return { uid, disabled: false }; };
    await assert.rejects(f.read(), { code: 'not-found' }); assert.equal(f.docs.get('shares/capsule').views, 0);
  }
});
test('an opening increments once, retains a receipt and never creates visitor identity data', async () => {
  const indexes = require('../../firestore.indexes.json');
  for (const collectionGroup of ['publicCapsuleBudgets','capsuleOpenings']) {
    const policy = indexes.fieldOverrides.filter(row => row.collectionGroup === collectionGroup && row.fieldPath === 'expiresAt');
    assert.equal(policy.length, 1); assert.equal(policy[0].ttl, true); assert.deepEqual(policy[0].indexes, []);
  }
  const f = fixture(), source = await f.read(), input = f.opening(source); const result = await f.record(input);
  assert.equal(result.changed, true); assert.equal(result.currentViews, 1); const receiptPath = [...f.docs.keys()].find(key => key.includes('/capsuleOpenings/'));
  const receipt = f.docs.get(receiptPath); assert.equal(receipt.viewCountAtCommit, 1); assert.equal(receipt.expiresAt.toMillis(), input.viewDeadline + 86400000);
  assert(!JSON.stringify(receipt).includes('owner-private')); assert(!JSON.stringify(receipt).includes('openingId')); assert(!JSON.stringify(receipt).includes('ip'));
  const committed = f.dump(); f.state.now += 100; const retried = await f.record(input); assert.equal(retried.changed, false); assert.equal(retried.currentViews, 1); assert.equal(f.dump(), committed);
  f.docs.get('shares/capsule').views = 5; assert.equal((await f.record(input)).currentViews, 5); assert.equal(f.docs.get('shares/capsule').views, 5);
});
test('source/command drift, replaced parent and deleted share cannot replay an opening', async () => {
  const f = fixture(), input = f.opening(await f.read()); await f.record(input); let before = f.dump();
  await assert.rejects(f.record({ ...input, viewDeadline: input.viewDeadline + 1 }), { code: 'failed-precondition' }); assert.equal(f.dump(), before);
  f.state.generation++; before = f.dump(); await assert.rejects(f.record(input), { code: 'failed-precondition' }); assert.equal(f.dump(), before);
  f.docs.delete('shares/capsule'); before = f.dump(); await assert.rejects(f.record(input), { code: 'not-found' }); assert.equal(f.dump(), before);
});
test('expired intent cannot create a second count after its receipt was purged', async () => {
  const f = fixture(); f.docs.get('shares/capsule').expiresAt = null;
  const input = f.opening(await f.read()); await f.record(input);
  for (const key of f.docs.keys()) if (key.includes('/capsuleOpenings/')) f.docs.delete(key);
  f.state.now = input.viewDeadline + 2 * 86400000; const before = f.dump();
  await assert.rejects(f.record(input), { code: 'failed-precondition' }); assert.equal(f.dump(), before); assert.equal(f.docs.get('shares/capsule').views, 1);
});
test('unknown/corrupt counters stay unknown on read and cannot be reset by an opening', async () => {
  for (const value of [undefined, -1, 1.5, '0']) {
    const f = fixture(); f.docs.get('shares/capsule').views = value; const output = await f.read(); assert.equal(output.views, null);
    const before = f.dump(); await assert.rejects(f.record(f.opening(output)), { code: 'failed-precondition' }); assert.equal(f.dump(), before);
  }
});
test('revocation stays available with public gate closed, is actor-bound and does not remove ciphertext', async () => {
  const f = fixture(), input = f.opening(await f.read()); f.state.enabled = false;
  await assert.rejects(f.revoke('owner-private', { v: 2, actorUid: 'other', shareId: 'capsule', sourceToken: f.ownerToken() }), { code: 'permission-denied' });
  await assert.rejects(f.revoke('other'), { code: 'not-found' }); assert.equal((await f.revoke()).changed, true);
  assert.deepEqual(f.docs.get('shares/capsule').ciphertext, cipher()); const committed = f.dump(); f.state.now += 100;
  assert.equal((await f.revoke()).changed, false); assert.equal(f.dump(), committed); f.state.enabled = true;
  await assert.rejects(f.read(), { code: 'not-found' }); await assert.rejects(f.record(input), { code: 'not-found' });
});
test('an owner withdrawal cannot target a replacement with the same ID',async()=>{
  const f=fixture(),input={v:2,actorUid:'owner-private',shareId:'capsule',sourceToken:f.ownerToken()};f.state.generation++;
  const before=f.dump();await assert.rejects(f.revoke('owner-private',input),{code:'failed-precondition'});assert.equal(f.dump(),before);
});
test('budget counters bind the server day, hide network hint and fail closed at both limits', async () => {
  const f = fixture(), hint = 'SYNTHETIC_NETWORK_HINT_PRIVATE';
  assert.equal(await consumePublicCapsuleBudget(f.db, hint, f.state.now), true);
  const budgets = [...f.docs.entries()].filter(([key]) => key.startsWith('publicCapsuleBudgets/')); assert.equal(budgets.length, 2); assert(!JSON.stringify(budgets).includes(hint));
  const global = budgets.find(([, value]) => value.scope === 'global'), network = budgets.find(([, value]) => value.scope === 'network');
  f.docs.set(global[0], { ...global[1], requests: PUBLIC_CAPSULE_DAILY_REQUESTS - 1 }); f.docs.set(network[0], { ...network[1], requests: PUBLIC_CAPSULE_NETWORK_DAILY_REQUESTS - 1 });
  assert.equal(await consumePublicCapsuleBudget(f.db, hint, f.state.now), true); const before = f.dump();
  assert.equal(await consumePublicCapsuleBudget(f.db, hint, f.state.now), false); assert.equal(f.dump(), before);
  f.docs.set(global[0], { ...global[1], requests: 'broken' }); const corrupt = f.dump(); assert.equal(await consumePublicCapsuleBudget(f.db, hint, f.state.now), false); assert.equal(f.dump(), corrupt);
});
