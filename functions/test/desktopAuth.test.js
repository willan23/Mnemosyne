const test = require('node:test');
const assert = require('node:assert/strict');
const { executeSealDesktopAuthBridge, executeRedeemDesktopAuthBridge } = require('../lib/desktopAuth');
const bridgeId = '11111111-1111-4111-8111-111111111111';

test('desktop bridge rejects invalid identities and extra request fields before storage or signing', async () => {
  const forbidden = () => { throw Error('unexpected storage or signing'); };
  const deps = { firestore: { doc: forbidden }, now: forbidden, verifyUser: forbidden, mint: forbidden };
  for (const input of [null, [], {}, { bridgeId, uid: 'bob' }, { bridgeId: 'not-a-uuid' }]) {
    await assert.rejects(executeSealDesktopAuthBridge('alice', input, deps), error => ['invalid-argument', 'failed-precondition'].includes(error.code));
    await assert.rejects(executeRedeemDesktopAuthBridge(input, deps), error => ['invalid-argument', 'failed-precondition'].includes(error.code));
  }
  await assert.rejects(executeSealDesktopAuthBridge('alice/bob', { bridgeId }, deps), { code: 'failed-precondition' });
});
