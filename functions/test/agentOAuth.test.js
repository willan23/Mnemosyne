process.env.GCLOUD_PROJECT = 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-mnemosyne-test' });
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { parseAgentAuthorization, executePreviewAgentAuthorization, executeAuthorizeAgentClient } = require('../lib/agentOAuth');
const { publicApiHandler } = require('../lib/publicApi');
const request = { response_type: 'code', client_id: 'synthetic-client', redirect_uri: 'https://client.example/callback',
  scope: 'memories:read memories:search', state: 'synthetic-state-0123456789',
  code_challenge: createHash('sha256').update('v'.repeat(43)).digest('base64url'), code_challenge_method: 'S256' };
test('authorization parser requires S256, bounded canonical challenge, state, exact HTTPS and explicit known scopes', () => {
  assert.deepEqual(parseAgentAuthorization(request).scopes, ['memories:read', 'memories:search']);
  for (const change of [{ response_type: 'token' }, { code_challenge_method: 'plain' }, { code_challenge: 'x'.repeat(42) },
    { code_challenge: 'A'.repeat(42) + 'B' }, { state: 'short' }, { scope: 'cloud:admin' }, { scope: '' },
    { scope: ['memories:read'] }, { client_id: '../evil' }, { redirect_uri: 'http://client.example/callback' },
    { vault: null }, { vault: '*' }, { vault: 'team:' }, { vault: 'team:../crew' }, { vault: ['personal', 'team:crew'] },
    { redirect_uri: 'https://user:pass@client.example/callback' }, { redirect_uri: 'https://client.example/callback#fragment' },
    { redirect_uri: 'https://client.example/callback?code=existing' }, { redirect_uri: 'javascript:alert(1)' }]) {
    assert.throws(() => parseAgentAuthorization({ ...request, ...change }), { code: 'invalid-argument' });
  }
  assert.equal(parseAgentAuthorization(request).vault, 'personal');
  assert.equal(parseAgentAuthorization({ ...request, vault: 'team:crew' }).vault, 'team:crew');
  assert.deepEqual(parseAgentAuthorization({ ...request, scope: 'memories:read memories:write' }).scopes, ['memories:read', 'memories:write']);
});
test('reviewed write consent stays operationally closed before database access', async () => {
  const db = { runTransaction() { assert.fail('must not access database'); } }, input = { ...request, scope: 'memories:write' };
  await assert.rejects(executePreviewAgentAuthorization('alice', input, db), { code: 'failed-precondition' });
  await assert.rejects(executeAuthorizeAgentClient('alice', { ...input, expectedUid: 'alice', confirmed: true, consentDigest: 'synthetic' }, db, 1000), { code: 'failed-precondition' });
});
const res = () => ({ statusCode: 200, headers: {}, set(k,v) { this.headers[k]=v; return this; },
  status(s) { this.statusCode=s; return this; }, json(v) { this.body=v; return this; }, send(v) { this.body=v; return this; } });
test('token route needs no permanent key, uses trusted IP rate limit, no-store and fixed failure', async () => {
  let calls = 0;
  const deps = { verifyApiKey: async () => { throw Error('must not authenticate long key'); },
    consumeTokenRateLimit: async key => { assert.equal(key, 'ip:127.0.0.1'); return { allowed: true }; },
    redeemAgentAuthorizationCode: async input => { calls++; assert.equal(input.grant_type, 'authorization_code'); return { token_type: 'Bearer', access_token: 'synthetic-token' }; } };
  const req = { method: 'POST', url: '/api/v1/oauth/token', ip: '127.0.0.1', headers: { 'x-forwarded-for': 'forged' }, body: { grant_type: 'authorization_code' } };
  const success = res();
  await publicApiHandler(req, success, deps);
  assert.equal(success.statusCode, 200);
  assert.equal(success.headers['Cache-Control'], 'no-store');
  assert.equal(success.headers.Pragma, 'no-cache');
  const denied = res();
  await publicApiHandler(req, denied, { ...deps, consumeTokenRateLimit: async () => ({ allowed: false, retryAfterMs: 4000 }) });
  assert.equal(denied.statusCode, 429);
  assert.equal(denied.headers['Retry-After'], '4');
  assert.equal(calls, 1);
  const failed = res();
  await publicApiHandler(req, failed, { ...deps, redeemAgentAuthorizationCode: async () => { throw Error('sensitive verifier'); } });
  assert.deepEqual(failed.body, { error: 'invalid_grant' });
  const missing = res(); await publicApiHandler(req, missing, {}); assert.equal(missing.statusCode, 503);
  const get = res(); await publicApiHandler({ ...req, method: 'GET' }, get, deps); assert.equal(get.statusCode, 405);
});
