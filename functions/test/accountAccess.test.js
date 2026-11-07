const test = require('node:test');
const assert = require('node:assert/strict');
const { liveAccountInTransaction, withLiveAccount, AccountUnavailableError } = require('../lib/accountAccess');

test('external work checks admission and completion and discards a result revoked while in flight', async () => {
  let live = false; let calls = 0;
  const check = async uid => { assert.equal(uid, 'alice'); return live; };
  await assert.rejects(withLiveAccount('alice', async () => { calls++; }, check), AccountUnavailableError);
  assert.equal(calls, 0);
  live = true;
  await assert.rejects(withLiveAccount('alice', async () => { calls++; live = false; return 'synthetic result'; }, check), AccountUnavailableError);
  assert.equal(calls, 1);
  live = true;
  assert.equal(await withLiveAccount('alice', async () => 'synthetic result', check), 'synthetic result');
});

test('invalid account IDs fail before any document lookup', async () => {
  const forbidden = () => { throw Error('unexpected document lookup'); };
  for (const uid of ['', 'alice/bob', 'alice\\bob', '..', '\u0000']) {
    assert.equal(await liveAccountInTransaction({ getAll: forbidden }, { doc: forbidden }, uid), false);
  }
});
