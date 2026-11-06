process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: 'demo-mnemosyne-test',
});

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  keyHasScope,
  parseAndValidateScopes,
} = require('../lib/apiKeys.js');

test('hashApiKey is stable SHA-256 hex', () => {
  const secret = 'mne_live_test-secret';
  const hash = hashApiKey(secret);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, hashApiKey(secret));
  assert.notEqual(hash, hashApiKey(`${secret}x`));
});

test('generateApiKey uses mne_live_ prefix and hashes the shown secret', () => {
  const generated = generateApiKey(1_700_000_000_000);
  assert.ok(generated.secret.startsWith(API_KEY_PREFIX));
  assert.equal(generated.keyHash, hashApiKey(generated.secret));
  assert.equal(generated.keyPrefix, generated.secret.slice(0, 16));
  assert.notEqual(generated.secret, generateApiKey().secret);
});

test('parseAndValidateScopes defaults to read-only and rejects writes during personal launch', () => {
  assert.deepEqual(parseAndValidateScopes(undefined), [
    'memories:read',
    'memories:search',
  ]);
  assert.deepEqual(parseAndValidateScopes(['memories:read']), ['memories:read']);
  assert.throws(() => parseAndValidateScopes(['memories:write']), /paused/);
  assert.throws(() => parseAndValidateScopes(['admin']), /unknown scope/);
  const syntheticSecret = 'synthetic-secret-as-scope';
  assert.throws(() => parseAndValidateScopes([syntheticSecret]), (error) =>
    error.message === 'unknown scope');
  assert.throws(() => parseAndValidateScopes([]), /non-empty/);
});

test('keyHasScope checks listed scopes only', () => {
  const key = { scopes: ['memories:read'] };
  assert.equal(keyHasScope(key, 'memories:read'), true);
  assert.equal(keyHasScope(key, 'memories:write'), false);
  assert.equal(keyHasScope(key, 'memories:search'), false);
});
