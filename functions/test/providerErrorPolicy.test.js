const assert = require('node:assert/strict');
const test = require('node:test');
const { ProviderHttpError, shouldTripProviderCircuit } = require('../lib/providerErrorPolicy');

test('provider HTTP errors never retain response content', () => {
  const error = new ProviderHttpError(400);
  assert.equal(error.status, 400);
  assert.equal(error.message, 'Fornecedor devolveu erro HTTP.');
});

test('client-side prompt rejection does not trip a provider-wide circuit', () => {
  for (const status of [400, 403, 413, 422]) {
    assert.equal(shouldTripProviderCircuit(new ProviderHttpError(status)), false);
  }
  for (const status of [401, 402, 404, 408, 410, 429, 500, 503]) {
    assert.equal(shouldTripProviderCircuit(new ProviderHttpError(status)), true);
  }
  assert.equal(shouldTripProviderCircuit(new Error('network failure')), true);
});
