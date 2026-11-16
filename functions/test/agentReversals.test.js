process.env.GCLOUD_PROJECT = 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-mnemosyne-test' });
const assert = require('node:assert/strict'), { test } = require('node:test');
const contract = require('../lib/agentReversalContract'), server = require('../lib/agentReversals');
const { parseAgentMutationReceipt } = require('../lib/agentMutationContract');
const { listMcpToolsForKey } = require('../lib/mcpServer');
const id = '32345678-1234-4234-8234-123456789012', operationId = '42345678-1234-4234-8234-123456789012';
const baseline = { proposalId: id, sessionId: 'note', teamId: null, authorUid: 'alice', ownerUid: 'alice', originalDigest: 'a'.repeat(64), originalRevision: 1002, revision: 1002, reversalEpoch: 0,
  stateHash: 'b'.repeat(64), stateDigest: 'c'.repeat(64), versionId: 'memory-edit-' + id, versionHash: 'd'.repeat(64), teamStateHash: null, epochStateHash: null,
  keyEpoch: null, keyId: null, currentKeyEpoch: null, currentKeyId: null, sourceKeyEpoch: null, sourceKeyId: null };
const enc = { v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(32) }, request = () => ({ operationId, baseline: structuredClone(baseline), enc: { ...enc } });
const preparation = () => ({ baseline, currentEnc: enc, sourceEnc: enc, currentMetadata: {}, sourceMetadata: {}, currentLearning: null, sourceLearning: null, currentLearningPresent: false, sourceLearningPresent: false, deleted: false });
const noDatabase = { runTransaction() { assert.fail('must not access data'); } };
test('reversal contract admits one immutable ciphertext target, preserves field presence and rejects authority/plaintext', () => {
  const raw = request(), parsed = contract.parseAgentReversalRequest(raw); raw.baseline.stateHash = 'f'.repeat(64); assert.equal(parsed.baseline.stateHash, baseline.stateHash);
  for (const value of [{ ...request(), text: 'Synthetic private source' }, { ...request(), metadata: {} }, { ...request(), confirmed: true },
    { ...request(), operationId: id }, { ...request(), enc: { ...enc, ct: 'B'.repeat(700000) } }, { ...request(), baseline: { ...baseline, versionId: 'other-version' } },
    { ...request(), baseline: { ...baseline, ownerUid: 'bob' } }, { ...request(), baseline: { ...baseline, sourceKeyEpoch: 1 } }]) assert.throws(() => contract.parseAgentReversalRequest(value));
  assert.equal(contract.parseAgentReversalPreparation(preparation()).sourceLearningPresent, false);
  assert.equal(contract.parseAgentReversalPreparation({ ...preparation(), sourceLearningPresent: true }).sourceLearningPresent, true);
  assert.throws(() => contract.parseAgentReversalPreparation({ ...preparation(), sourceLearning: { revisedAt: 1 } }));
});
test('owner reversal commands require the captured UID and exact affirmative digest before rate limits or database', async () => {
  const command = { expectedUid: 'alice', request: request(), reviewDigest: 'e'.repeat(64), confirmed: true };
  for (const callable of [server.prepareAgentMutationReversal, server.applyAgentMutationReversal, server.getAgentMutationReversalStatus, server.cancelAgentMutationReversal]) {
    await assert.rejects(callable.run(command, {}), { code: 'unauthenticated' });
    await assert.rejects(callable.run(command, { auth: { uid: 'bob' } }), { code: 'permission-denied' });
  }
  await assert.rejects(server.applyAgentMutationReversal.run({ ...command, confirmed: false }, { auth: { uid: 'alice' } }), { code: 'invalid-argument' });
  await assert.rejects(server.executeAgentReversal('bob', command, 'apply', { firestore: noDatabase, enabled: () => true }), { code: 'permission-denied' });
  await assert.rejects(server.executeAgentReversal('alice', command, 'apply', { firestore: noDatabase, enabled: () => false }), { code: 'permission-denied' });
  const { createHash } = require('node:crypto'); command.reviewDigest = createHash('sha256').update(contract.agentReversalRequestBytes(command.request)).digest('hex');
  await assert.rejects(server.executeAgentReversal('alice', command, 'apply', { firestore: noDatabase, enabled: () => false }), { code: 'failed-precondition' });
});
test('a reverted public receipt retains the original applied result and cannot masquerade as a new proposal', () => {
  const result = { operationId: id, sessionId: 'note', teamId: null, operation: 'edit', digest: baseline.originalDigest, status: 'committed', revision: 1002, createdAt: 1002 };
  const receipt = { proposalId: id, uid: 'alice', clientId: 'synthetic-client', clientName: 'Synthetic app', vault: 'personal', digest: baseline.originalDigest,
    sessionId: 'note', teamId: null, operation: 'edit', status: 'reverted', createdAt: 1000, expiresAt: 901000, decidedAt: 2000, result };
  assert.deepEqual(parseAgentMutationReceipt(receipt), receipt);
  assert.throws(() => parseAgentMutationReceipt({ ...receipt, result: null }));
  assert.throws(() => parseAgentMutationReceipt({ ...receipt, result: { ...result, digest: 'e'.repeat(64) } }));
});
test('no agent tool advertises owner confirmation or reversal, including reviewed write sessions', () => {
  const tools = listMcpToolsForKey({ uid: 'alice', keyPrefix: 'mne_review_', credentialKind: 'agent-grant', scopes: ['memories:read', 'memories:write'] }, { enabled: true });
  assert.equal(tools.some(tool => /revers|revert|approv|apply/.test(tool.name)), false);
});
