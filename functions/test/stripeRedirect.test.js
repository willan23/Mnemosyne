process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: 'demo-mnemosyne-test',
});

const assert = require('node:assert/strict');
const test = require('node:test');
const { assertAllowedRedirectUrl } = require('../lib/stripe.js');

test('allows production and local checkout redirects', () => {
  assert.equal(
    assertAllowedRedirectUrl('https://mnemosyne-one.com/checkout/success', 'successUrl'),
    'https://mnemosyne-one.com/checkout/success',
  );
  assert.equal(
    assertAllowedRedirectUrl('https://mnemosyne-one.web.app/pricing', 'cancelUrl'),
    'https://mnemosyne-one.web.app/pricing',
  );
  assert.equal(
    assertAllowedRedirectUrl('http://localhost:5173/checkout/success', 'successUrl'),
    'http://localhost:5173/checkout/success',
  );
});

test('rejects open-redirect phishing hosts', () => {
  assert.throws(
    () => assertAllowedRedirectUrl('https://evil.example/phish', 'successUrl'),
    (err) => err && err.code === 'invalid-argument',
  );
  assert.throws(
    () => assertAllowedRedirectUrl('https://mnemosyne-one.com.evil.com/x', 'successUrl'),
    (err) => err && err.code === 'invalid-argument',
  );
  assert.throws(
    () => assertAllowedRedirectUrl('not-a-url', 'successUrl'),
    (err) => err && err.code === 'invalid-argument',
  );
  assert.throws(
    () => assertAllowedRedirectUrl('', 'successUrl'),
    (err) => err && err.code === 'invalid-argument',
  );
});
