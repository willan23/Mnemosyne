process.env.GCLOUD_PROJECT = 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-mnemosyne-test' });
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { executeSetAgentAccess, setAgentAccess } = require('../lib/agentAccess');
const { readAgentAccessState, parseAgentAccessCommand } = require('../lib/agentAccountContract');
const oauth = require('../lib/agentOAuth');
const command = { expectedUid: 'alice', baseline: { disabled: false, epoch: 0 }, disabled: true };

test('agent account controls reject incomplete legacy commands and cross-account commands before database access', async () => {
  const db = { collection() { assert.fail('must not access database'); }, runTransaction() { assert.fail('must not transact'); } };
  await assert.rejects(setAgentAccess.run(command, {}), { code: 'unauthenticated' });
  for (const input of [true, { disabled: true }, { ...command, uid: 'alice' }, { ...command, expectedUid: '../alice' },
    { ...command, baseline: { disabled: false, epoch: -1 } }, { ...command, baseline: { disabled: false, epoch: null } },
    { ...command, baseline: { disabled: false, epoch: 0.1 } }, { ...command, disabled: false }]) {
    await assert.rejects(executeSetAgentAccess('alice', input, db), { code: 'invalid-argument' });
  }
  await assert.rejects(executeSetAgentAccess('bob', command, db), { code: 'failed-precondition' });
  await assert.rejects(setAgentAccess.run(command, { auth: { uid: 'bob' } }), { code: 'failed-precondition' });
});

test('agent account state fails closed for corrupt epochs and copies the baseline', () => {
  assert.deepEqual(readAgentAccessState({}), { disabled: false, epoch: 0 });
  for (const epoch of [null, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) assert.equal(readAgentAccessState({ agentAccessEpoch: epoch }), null);
  assert.equal(readAgentAccessState({ agentAccessDisabled: 'false' }), null);
  const input = structuredClone(command), parsed = parseAgentAccessCommand(input);
  input.baseline.epoch = 99; assert.equal(parsed.baseline.epoch, 0);
});

test('all agent OAuth callables require the expected account before rate limits or database work', async () => {
  for (const name of ['previewAgentAuthorization', 'authorizeAgentClient', 'listAgentGrants', 'revokeAgentGrant']) {
    await assert.rejects(oauth[name].run({}, {}), { code: 'unauthenticated' });
    for (const input of [{}, { expectedUid: 'bob' }, { expectedUid: '../alice' }]) {
      await assert.rejects(oauth[name].run(input, { auth: { uid: 'alice' } }), { code: 'failed-precondition' });
    }
  }
});
