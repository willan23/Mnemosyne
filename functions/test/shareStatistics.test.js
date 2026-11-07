const test = require('node:test');
const assert = require('node:assert/strict');
const { recordLiveShareStatistic } = require('../lib/shareStatistics');

test('share statistics reject path injection, extra fields and invalid identities before any write', async () => {
  const db = { runTransaction: () => { throw Error('unexpected transaction'); } };
  for (const input of [null, [], { shareId: 'alice/bob' }, { shareId: 'synthetic', uid: 'bob' }]) {
    await assert.rejects(recordLiveShareStatistic('alice', input, 'view', db), { code: 'invalid-argument' });
  }
  await assert.rejects(recordLiveShareStatistic('alice/bob', { shareId: 'synthetic' }, 'view', db), { code: 'invalid-argument' });
});

test('legacy view and client-asserted conversion counters are retired before any database access', async () => {
  const db = { runTransaction: () => { throw Error('unexpected transaction'); } };
  for (const kind of ['view', 'conversion']) await assert.rejects(recordLiveShareStatistic('alice', { shareId: 'capsule' }, kind, db), { code: 'failed-precondition' });
});
