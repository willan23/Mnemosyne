process.env.GCLOUD_PROJECT = 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-mnemosyne-test' });
const assert = require('node:assert/strict'), { test } = require('node:test');
const contract = require('../lib/agentMutationContract');
const server = require('../lib/agentMutations');
const apiKeys = require('../lib/apiKeys');
const { publicApiHandler } = require('../lib/publicApi');
const { handleMcpRpc, listMcpToolsForKey } = require('../lib/mcpServer');
const proposalId = '32345678-1234-4234-8234-123456789012';
const baseline = { kind: 'personal', sessionId: 'synthetic-note', teamId: null, authorUid: 'alice', ownerUid: 'alice', stateHash: 'a'.repeat(64), stateDigest: 'b'.repeat(64), revision: 1,
  teamStateHash: null, epochStateHash: null, keyEpoch: null, keyId: null, priorKeyEpoch: null, priorKeyId: null };
const cipher = byte => ({ v: 1, iv: 'A'.repeat(16), ct: byte.repeat(32) });
const request = () => ({ operationId: proposalId, operation: 'edit', baseline: structuredClone(baseline), priorEnc: cipher('B'), enc: cipher('C'), metadata: { tags: ['synthetic'] } });
const key = () => ({ credentialKind: 'agent-grant', keyPrefix: 'mne_review_', id: 'c'.repeat(64), uid: 'alice', name: 'Synthetic app', clientId: 'synthetic-app',
  agentSessionId: 'd'.repeat(64), agentSessionExpiresAt: 901000, grantVersion: 1, accessEpoch: 0, vault: { kind: 'personal' }, scopes: ['memories:read', 'memories:write'], createdAt: 1000, lastUsedAt: null, revoked: false });
const decision = { expectedUid: 'alice', proposalId, reviewDigest: 'e'.repeat(64), confirmed: true };
const noDatabase = { doc() { assert.fail('must not access data'); }, runTransaction() { assert.fail('must not transact'); } };
const deps = enabled => ({ firestore: noDatabase, now: () => 1002, enabled, memoryWritesEnabled: () => true });
const response = () => ({ statusCode: 200, headers: {}, set(k,v) { this.headers[k]=v; return this; }, status(n) { this.statusCode=n; return this; }, json(v) { this.body=v; return this; }, send(v) { this.body=v; return this; } });
const http = (url, body) => ({ method: 'POST', url, body, headers: { authorization: 'Bearer mne_review_' + 'A'.repeat(43) } });

test('agent proposals reject plaintext, authority fields, multiple targets and oversized encrypted requests', () => {
  const original = request(), parsed = contract.parseAgentMutationRequest(original); original.metadata.tags[0] = 'changed later'; assert.equal(parsed.metadata.tags[0], 'synthetic');
  for (const raw of [{ ...request(), text: 'Synthetic private text' }, { ...request(), confirmed: true }, { ...request(), expectedUid: 'bob' },
    [request(), request()], { ...request(), metadata: { agentAccessDisabled: false } }, { ...request(), enc: { ...cipher('C'), ct: 'C'.repeat(400000) }, priorEnc: { ...cipher('B'), ct: 'B'.repeat(400000) } }]) assert.throws(() => contract.parseAgentMutationRequest(raw));
  for (const raw of [{ ...decision, confirmed: false }, { ...decision, request: request() }, { ...decision, reviewDigest: '' }, { ...decision, expectedUid: '../alice' }]) assert.throws(() => contract.parseAgentMutationDecision(raw));
});
test('new mutation entrypoints remain closed before database work and never accept a permanent or read-only key', async () => {
  await assert.rejects(server.executePrepareAgentMutation(key(), { sessionId: baseline.sessionId, teamId: null }, deps(false)), { code: 'failed-precondition' });
  await assert.rejects(server.executeProposeAgentMutation(key(), request(), deps(false)), { code: 'failed-precondition' });
  await assert.rejects(server.executeApproveAgentMutation('alice', decision, deps(false)), { code: 'failed-precondition' });
  for (const current of [{ ...key(), credentialKind: undefined }, { ...key(), keyPrefix: 'mne_live_' }, { ...key(), scopes: ['memories:read'] }]) {
    await assert.rejects(server.executePrepareAgentMutation(current, { sessionId: baseline.sessionId, teamId: null }, deps(true)), { code: 'permission-denied' });
    await assert.rejects(server.executeProposeAgentMutation(current, request(), deps(true)), { code: 'permission-denied' });
  }
});
test('owner decision, review and list bind the captured UID before rate limits or datastore access', async () => {
  const target = { expectedUid: 'alice', proposalId };
  for (const [executor, callable, input] of [[server.executeApproveAgentMutation, server.approveAgentMutationProposal, decision],
    [server.executeRejectAgentMutation, server.rejectAgentMutationProposal, decision], [server.executeGetAgentMutation, server.getAgentMutationProposal, target],
    [server.executeListAgentMutations, server.listAgentMutationProposals, { expectedUid: 'alice', mode: 'pending', cursor: null }]]) {
    await assert.rejects(executor('bob', input, deps(true)), { code: 'permission-denied' });
    await assert.rejects(callable.run(input, { auth: { uid: 'bob' } }), { code: 'permission-denied' });
    await assert.rejects(callable.run(input, {}), { code: 'unauthenticated' });
  }
});
test('retired HTTP and MCP direct creation cannot reopen when the reviewed write gate is enabled', async () => {
  const before = apiKeys.API_MEMORY_WRITES_ENABLED; apiKeys.API_MEMORY_WRITES_ENABLED = true; let writes = 0;
  try {
    const memories = { create() { writes++; assert.fail('must not write'); } }, current = { ...key(), keyPrefix: 'mne_live_', credentialKind: undefined };
    const res = response(); await publicApiHandler(http('/api/v1/memories', { enc: cipher('C') }), res,
      { verifyApiKey: async () => current, consumeRateLimit: async () => ({ allowed: true, remaining: 1 }), touchLastUsed: async () => {}, memories });
    assert.equal(res.statusCode, 403);
    const rpc = await handleMcpRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_memory', arguments: { enc: cipher('C') } } }, { key: current, memories });
    assert.equal(rpc.payload.result.isError, true); assert.equal(writes, 0);
    assert.equal(listMcpToolsForKey(current, { enabled: true }).some(tool => tool.name === 'propose_memory_change' || tool.name === 'create_memory'), false);
  } finally { apiKeys.API_MEMORY_WRITES_ENABLED = before; }
});
test('agent tools expose proposal and status only; no tool can approve and HTTP returns pending 202', async () => {
  const receipt = { proposalId, status: 'pending' }, gateway = { enabled: true, prepare: async () => baseline, propose: async (_key, input) => { assert.equal(input.operationId, proposalId); return receipt; }, status: async () => receipt };
  const listed = listMcpToolsForKey(key(), gateway).map(tool => tool.name);
  assert.equal(listed.includes('propose_memory_change'), true); assert.equal(listed.some(name => /approve|apply|create_memory/.test(name)), false);
  const res = response(); await publicApiHandler(http('/api/v1/agent/changes/propose', request()), res,
    { verifyApiKey: async () => key(), consumeRateLimit: async () => ({ allowed: true, remaining: 1 }), touchLastUsed: async () => {}, memories: {}, agentMutations: gateway });
  assert.equal(res.statusCode, 202); assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(res.body.status, 'pending');
  const rpc = await handleMcpRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'propose_memory_change', arguments: { request: request(), confirmed: true } } }, { key: key(), memories: {}, agentMutations: gateway });
  assert.equal(rpc.payload.result.isError, true);
});
test('receipt polling stays available with proposal admission closed and discards a revoked read', async () => {
  const gateway = { enabled: false, prepare() { assert.fail('closed'); }, propose() { assert.fail('closed'); }, status: async () => ({ proposalId, status: 'applied' }) };
  const names = listMcpToolsForKey(key(), gateway).map(tool => tool.name); assert.equal(names.includes('get_memory_change'), true); assert.equal(names.includes('propose_memory_change'), false);
  let checks = 0; const res = response();
  await publicApiHandler(http('/api/v1/agent/changes/status', { proposalId, digest: decision.reviewDigest }), res,
    { verifyApiKey: async () => checks++ ? null : key(), consumeRateLimit: async () => ({ allowed: true, remaining: 1 }), touchLastUsed: async () => {}, memories: {}, agentMutations: gateway });
  assert.equal(res.statusCode, 403); assert.equal(res.body.error, 'change_unavailable'); assert.equal(JSON.stringify(res.body).includes(proposalId), false);
});
