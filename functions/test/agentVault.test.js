process.env.GCLOUD_PROJECT = 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-mnemosyne-test' });
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseAgentVaultSelector, parseAgentVaultAdmission } = require('../lib/agentVaultContract');
const { createTeamAgentMemoryApi } = require('../lib/agentVaultMemories');
const { publicApiHandler } = require('../lib/publicApi');
const { issueAgentSession } = require('../lib/agentSessions');
const vault = { kind: 'team', teamId: 'crew', keyEpoch: 1, keyId: '12345678-1234-4234-8234-123456789012', teamStateHash: 'a'.repeat(64), epochStateHash: 'b'.repeat(64) };
const key = () => ({ id: 'c'.repeat(64), uid: 'alice', name: 'Synthetic', scopes: ['memories:read', 'memories:search'],
  createdAt: 1, lastUsedAt: null, revoked: false, keyPrefix: 'mne_agent_', credentialKind: 'agent-grant', vault: structuredClone(vault) });
const res = () => ({ statusCode: 200, headers: {}, status(n) { this.statusCode=n; return this; }, set(k,v) { this.headers[k]=v; return this; }, json(v) { this.body=v; return this; }, send(v) { this.body=v; return this; } });
const req = (url, body) => ({ method: body ? 'POST' : 'GET', url, headers: { authorization: 'Bearer mne_agent_' + 'A'.repeat(43) }, query: {}, body });
const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_memories', arguments: { teamId: 'other', vault: 'personal' } } };
const deps = (overrides = {}) => ({ verifyApiKey: async () => key(), consumeRateLimit: async () => ({ allowed: true, remaining: 10 }), touchLastUsed: async () => {},
  memories: { list() { assert.fail('must not use personal store'); } }, ...overrides });

test('agent vault selectors cannot express wildcards, multiple vaults or missing team identities', () => {
  assert.deepEqual(parseAgentVaultSelector(undefined), { kind: 'personal' });
  assert.deepEqual(parseAgentVaultSelector('team:crew'), { kind: 'team', teamId: 'crew' });
  for (const raw of [null, '', '*', 'teams:*', 'team:', 'team:../crew', ['personal', 'team:crew'], { kind: 'team', teamId: 'crew' }]) assert.throws(() => parseAgentVaultSelector(raw));
  // A team named '*' is not an ACL wildcard; it is still an exact document ID.
  assert.deepEqual(parseAgentVaultSelector('team:*'), { kind: 'team', teamId: '*' });
});
test('agent vault admission never promotes absent or corrupt persisted fields to team authority', () => {
  assert.throws(() => parseAgentVaultAdmission(undefined));
  assert.deepEqual(parseAgentVaultAdmission(undefined, true), { kind: 'personal' });
  assert.deepEqual(parseAgentVaultAdmission(vault), vault);
  for (const raw of [null, {}, { kind: 'personal', teamId: 'crew' }, { ...vault, keyEpoch: 0 }, { ...vault, keyId: 'invalid' },
    { ...vault, teamStateHash: '' }, { ...vault, epochStateHash: undefined }, { ...vault, extra: true }]) assert.throws(() => parseAgentVaultAdmission(raw, true));
  const parsed = parseAgentVaultAdmission(vault); parsed.teamId = 'other'; assert.equal(vault.teamId, 'crew');
});
test('team memory factory refuses personal, permanent and malformed authority before any data access', () => {
  const database = { collection() { assert.fail('must not read'); }, runTransaction() { assert.fail('must not transact'); } };
  for (const change of [{ credentialKind: undefined }, { vault: { kind: 'personal' } }, { uid: '../alice' }, { vault: { kind: 'team' } }]) assert.throws(() => createTeamAgentMemoryApi({ ...key(), ...change }, database));
});
test('team credentials cannot issue delegated sessions even without the grant marker', async () => {
  const database = { collection() { assert.fail('must not read'); }, runTransaction() { assert.fail('must not transact'); } };
  await assert.rejects(issueAgentSession({ ...key(), keyPrefix: 'mne_vault_', credentialKind: undefined }, undefined, database), /Delegation is not allowed/);
  const response = res();
  await publicApiHandler(req('/api/v1/agent/session', {}), response, deps({ issueAgentSession() { assert.fail('must not delegate'); } }));
  assert.equal(response.statusCode, 403); assert.equal(response.body.error, 'delegation_not_allowed');
});
test('HTTP team authority cannot fall back to the personal store or an unscoped permanent key', async () => {
  for (const override of [{}, { verifyApiKey: async () => ({ ...key(), credentialKind: undefined }) }, { verifyApiKey: async () => ({ ...key(), vault: null }) }]) {
    const response = res(); await publicApiHandler(req('/api/v1/memories'), response, deps(override));
    assert.equal(response.statusCode, 403); assert.deepEqual(response.body, { error: 'account_unavailable', detail: 'Account unavailable.' });
  }
});
test('HTTP and MCP use the authenticated vault even when arguments request another team or personal data', async () => {
  let reads = 0, factories = 0;
  const options = deps({ memoriesForTeamGrant: current => {
    factories++; assert.equal(current.vault.teamId, 'crew');
    return { list: async (uid, input) => { reads++; assert.equal(uid, 'alice'); assert.equal(input.teamId, undefined); assert.equal(input.vault, undefined); return { memories: [], nextStartAfter: null }; } };
  } });
  const http = res(); await publicApiHandler({ ...req('/api/v1/memories'), query: { teamId: 'other', vault: 'personal' } }, http, options);
  const mcp = res(); await publicApiHandler(req('/api/v1/mcp', rpc), mcp, options);
  assert.equal(http.statusCode, 200); assert.equal(mcp.statusCode, 200); assert.equal(reads, 2); assert.equal(factories, 2);
});
test('HTTP missing limits preserve documented list and search defaults', async () => {
  let reads = 0;
  const options = deps({ memoriesForTeamGrant: () => ({
    list: async (_uid, input) => { reads++; assert.equal(input.limit, 50); return { memories: [], nextStartAfter: null }; },
    search: async (_uid, input) => { reads++; assert.equal(input.limit, 20); return { results: [], mode: 'tags_ids', tradeoff: 'synthetic' }; },
  }) });
  for (const route of ['/api/v1/memories', '/api/v1/search']) { const response = res(); await publicApiHandler(req(route), response, options); assert.equal(response.statusCode, 200); }
  assert.equal(reads, 2);
});
test('HTTP and MCP discard a result if the credential is revoked or its authority changes during the read', async () => {
  for (const [url, body] of [['/api/v1/memories'], ['/api/v1/memories/note'], ['/api/v1/search'], ['/api/v1/mcp', rpc]]) {
    for (const change of ['revoked', 'vault', 'scope', 'network']) {
      let verified = 0;
      const current = key(), sentinel = { id: 'synthetic-private-result' };
      const options = deps({ verifyApiKey: async () => {
        if (!verified++) return current;
        if (change === 'revoked') return null;
        if (change === 'network') throw Error('private diagnostic');
        return change === 'vault' ? { ...key(), vault: { ...vault, teamId: 'other' } } : { ...key(), scopes: ['memories:read'] };
      }, memoriesForTeamGrant: () => ({ list: async () => ({ memories: [sentinel] }), get: async () => sentinel, search: async () => ({ results: [sentinel] }) }) });
      const response = res(); await publicApiHandler(req(url, body), response, options);
      assert.equal(response.statusCode, 403); assert.equal(verified, 2);
      assert.equal(JSON.stringify(response.body).includes(sentinel.id), false); assert.equal(JSON.stringify(response.body).includes('private diagnostic'), false);
    }
  }
});
