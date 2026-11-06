const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeCapsuleNoticeAcknowledgement, capsuleNoticeSourceDigest } = require('../lib/capsuleNotices');
const { capsuleNoticeSourceBytes } = require('../lib/capsuleNoticeContract');
const { OBSIDIAN_IMPORT_MAX_MEMORIES } = require('../lib/obsidianImportContract');
const source = () => ({ ownerUid: 'alice', shareId: 'share', importerUid: 'bob', itemCount: 2, createdAt: 1, read: false, titleHint: 'Synthetic á漢🙂' });
function fixture() {
  const docs = new Map([['users/alice', { uid: 'alice' }], ['capsuleImportNotices/notice', source()]]);
  const state = { now: 2, disabled: false, missingAuth: false, foreignAuth: false, admitted: true, transactions: 0, admits: 0 };
  const ref = path => ({ path });
  const snap = value => ({ exists: docs.has(value.path), data: () => structuredClone(docs.get(value.path)) });
  const deps = { now: () => state.now, auth: { getUser: async uid => { if (state.missingAuth) throw Error(); return { uid: state.foreignAuth ? 'bob' : uid, disabled: state.disabled }; } },
    admit: async uid => { assert.equal(uid, 'alice'); state.admits++; return state.admitted; },
    firestore: { doc: ref, runTransaction: async body => {
      state.transactions++; const writes = [];
      const tx = { get: async value => snap(value), getAll: async (...refs) => refs.map(snap), update: (value, patch) => writes.push([value.path, patch]) };
      const result = await body(tx);
      for (const [path, patch] of writes) { assert(docs.has(path)); docs.set(path, { ...docs.get(path), ...patch }); }
      return result;
    } } };
  const command = () => ({ v: 1, actorUid: 'alice', noticeId: 'notice', sourceDigest: capsuleNoticeSourceDigest('notice', source()) });
  return { docs, state, deps, command, run: (input = command(), uid = 'alice') => executeCapsuleNoticeAcknowledgement(uid, input, deps), dump: () => JSON.stringify([...docs]) };
}
test('notice source bytes bind every displayed identity and preserve exact Unicode; read state does not change the source', () => {
  const row = source();
  assert.equal(capsuleNoticeSourceBytes('notice', row), '[1,"notice","alice","share","bob",2,1,"Synthetic á漢🙂",null,null]');
  assert.equal(capsuleNoticeSourceDigest('notice', row), capsuleNoticeSourceDigest('notice', { ...row, read: true, readAt: 2 }));
  assert.notEqual(capsuleNoticeSourceDigest('notice', row), capsuleNoticeSourceDigest('notice', { ...row, titleHint: 'Synthetic á漢🙂 ' }));
});
test('invalid actor, path injection, extra fields and forged actor fail before Auth or rate admission', async () => {
  const f = fixture();
  for (const command of [null, [], { ...f.command(), v: 2 }, { ...f.command(), noticeId: 'a/b' }, { ...f.command(), sourceDigest: 'A'.repeat(64) }, { ...f.command(), extra: true }])
    await assert.rejects(f.run(command), { code: 'invalid-argument' });
  await assert.rejects(f.run(f.command(), 'a/b'), { code: 'unauthenticated' });
  await assert.rejects(f.run({ ...f.command(), actorUid: 'bob' }), { code: 'permission-denied' });
  assert.equal(f.state.admits, 0); assert.equal(f.state.transactions, 0);
});
test('disabled, removed or mismatched Auth users cannot acknowledge or consume admission', async () => {
  for (const field of ['disabled', 'missingAuth', 'foreignAuth']) {
    const f = fixture(), before = f.dump(); f.state[field] = true;
    await assert.rejects(f.run(), { code: 'permission-denied' }); assert.equal(f.dump(), before); assert.equal(f.state.admits, 0);
  }
});
test('profile absence, deletion state and permanent deletion marker refuse acknowledgement', async () => {
  for (const reason of ['missing', 'deleting', 'marker']) {
    const f = fixture();
    if (reason === 'missing') f.docs.delete('users/alice');
    if (reason === 'deleting') f.docs.set('users/alice', { deletionState: 'deleting' });
    if (reason === 'marker') f.docs.set('accountDeletions/alice', { status: 'complete' });
    const before = f.dump(); await assert.rejects(f.run(), { code: 'permission-denied' }); assert.equal(f.dump(), before);
  }
});
test('acknowledgement changes only delivery metadata and response retry never rewrites it', async () => {
  const f = fixture(), input = f.command(); const outcome = await f.run(input);
  assert.deepEqual(outcome, { ...input, acknowledged: true, changed: true });
  assert.deepEqual(f.docs.get('capsuleImportNotices/notice'), { ...source(), read: true, readAt: 2 });
  const committed = f.dump(); f.state.now = 9000;
  assert.deepEqual(await f.run(input), { ...input, acknowledged: true, changed: false }); assert.equal(f.dump(), committed);
  assert(!JSON.stringify(outcome).includes('Synthetic')); assert.equal(f.docs.size, 2);
});
test('foreign and removed notices are refused without creating an event or a receipt', async () => {
  const f = fixture(); f.docs.get('capsuleImportNotices/notice').ownerUid = 'bob';
  let before = f.dump(); await assert.rejects(f.run(), { code: 'not-found' }); assert.equal(f.dump(), before);
  f.docs.delete('capsuleImportNotices/notice'); before = f.dump();
  await assert.rejects(f.run(), { code: 'not-found' }); assert.equal(f.dump(), before);
});
test('a stale source cannot acknowledge a replaced displayed event', async () => {
  for (const patch of [{ shareId: 'other' }, { importerUid: 'charlie' }, { itemCount: 3 }, { createdAt: 2 }, { titleHint: 'Other' },
    { importId: 'notice', planDigest: 'a'.repeat(64) }]) {
    const f = fixture(); Object.assign(f.docs.get('capsuleImportNotices/notice'), patch); const before = f.dump();
    await assert.rejects(f.run(), { code: 'failed-precondition' }); assert.equal(f.dump(), before);
  }
});
test('malformed legacy sources are refused without invented defaults or rewriting', async () => {
  for (const patch of [{ itemCount: 0 }, { itemCount: OBSIDIAN_IMPORT_MAX_MEMORIES + 1 }, { createdAt: undefined }, { read: 'false' }, { importerUid: 'a/b' },
    { titleHint: '漢'.repeat(334) }, { importId: 'other', planDigest: 'a'.repeat(64) }, { planDigest: 'a'.repeat(64) }]) {
    const f = fixture(); Object.assign(f.docs.get('capsuleImportNotices/notice'), patch); const before = f.dump();
    await assert.rejects(f.run(), { code: 'failed-precondition' }); assert.equal(f.dump(), before);
  }
});
test('admission refusal and invalid server time leave the source unread', async () => {
  const f = fixture(), before = f.dump(); f.state.admitted = false;
  await assert.rejects(f.run(), { code: 'resource-exhausted' }); assert.equal(f.state.transactions, 0); assert.equal(f.dump(), before);
  f.state.admitted = true; f.state.now = 0; await assert.rejects(f.run(), { code: 'failed-precondition' }); assert.equal(f.dump(), before);
});
test('input is captured before asynchronous Auth lookup and cannot be retargeted', async () => {
  const f = fixture(), command = f.command(); let release;
  f.deps.auth.getUser = () => new Promise(resolve => { release = resolve; });
  const pending = f.run(command); command.noticeId = 'other'; command.actorUid = 'bob'; release({ uid: 'alice', disabled: false });
  const outcome = await pending; assert.equal(outcome.noticeId, 'notice'); assert.equal(outcome.actorUid, 'alice');
  assert.equal(f.docs.get('capsuleImportNotices/notice').read, true); assert.equal(f.docs.has('capsuleImportNotices/other'), false);
});
test('notice accepts the existing server import maximum without lowering the import contract', async () => {
  const f = fixture(), data = { ...source(), itemCount: OBSIDIAN_IMPORT_MAX_MEMORIES };
  assert.equal(OBSIDIAN_IMPORT_MAX_MEMORIES, 300); f.docs.set('capsuleImportNotices/notice', data);
  const input = { ...f.command(), sourceDigest: capsuleNoticeSourceDigest('notice', data) };
  assert.equal((await f.run(input)).changed, true); assert.equal(f.docs.get('capsuleImportNotices/notice').itemCount, 300);
});
