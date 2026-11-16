const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isPersonalOwnedLiveSession } = require('../lib/memoryPublic');

test('Admin SDK public API scope excludes team documents even when authored by key owner', () => {
  assert.equal(isPersonalOwnedLiveSession({ uid: 'alice' }, 'alice'), false);
  assert.equal(isPersonalOwnedLiveSession({ uid: 'alice', teamId: null }, 'alice'), true);
  assert.equal(isPersonalOwnedLiveSession({ uid: 'alice', teamId: 'crew' }, 'alice'), false);
  assert.equal(isPersonalOwnedLiveSession({ uid: 'alice', teamId: '' }, 'alice'), false);
  assert.equal(isPersonalOwnedLiveSession({ uid: 'bob', sharedWithIds: ['alice'] }, 'alice'), false);
  assert.equal(isPersonalOwnedLiveSession({ uid: 'alice', deletedAt: 1 }, 'alice'), false);
});
