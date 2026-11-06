const assert = require('node:assert/strict');
const test = require('node:test');
const {
  circuitAfterFailure,
  CIRCUIT_COOLDOWN_MS,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_WINDOW_MS,
} = require('../lib/providerCircuit');

test('three provider failures in a rolling window open the circuit', () => {
  const start = 1_800_000_000_000;
  let state = { failures: 0, windowStartedAt: 0, openUntil: 0, leaseUntil: 0, leaseId: null };
  for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i += 1) {
    state = circuitAfterFailure(state, start + i * 1000);
  }
  assert.equal(state.failures, CIRCUIT_FAILURE_THRESHOLD);
  assert.equal(state.openUntil, start + 2000 + CIRCUIT_COOLDOWN_MS);
});

test('old provider failures expire instead of keeping the circuit open', () => {
  const start = 1_800_000_000_000;
  const prior = { failures: 2, windowStartedAt: start, openUntil: 0, leaseUntil: 0, leaseId: null };
  const state = circuitAfterFailure(prior, start + CIRCUIT_WINDOW_MS);
  assert.equal(state.failures, 1);
  assert.equal(state.openUntil, 0);
});
