const assert = require('node:assert/strict');
const test = require('node:test');
const { readLegacyTeamKeys } = require('../lib/teamEpochMigration');

const wrap = { v: 1, alg: 'RSA-OAEP', ct: 'synthetic-ciphertext-long' };

test('legacy team migration accepts only an exact wrap for every active member', () => {
  const base = {
    ownerUid: 'alice', memberUids: ['alice', 'bob'],
    wrappedKeys: { alice: wrap, bob: wrap },
  };
  assert.deepEqual(Object.keys(readLegacyTeamKeys(base).wrappedKeys), ['alice', 'bob']);
  assert.equal(readLegacyTeamKeys({ ...base, wrappedKeys: { alice: wrap } }), null);
  assert.equal(readLegacyTeamKeys({ ...base, wrappedKeys: { ...base.wrappedKeys, exMember: wrap } }), null);
  assert.equal(readLegacyTeamKeys({ ...base, memberUids: ['alice', 'alice'] }), null);
  assert.equal(readLegacyTeamKeys({ ...base, wrappedKeys: { alice: wrap, bob: { ...wrap, teamKey: 'synthetic' } } }), null);
});
