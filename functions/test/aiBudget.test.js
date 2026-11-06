'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextBudgetUsage, MONTHLY_AI_LIMIT } = require('../lib/aiBudget');

test('monthly AI budget rejects requests that exceed cost, image, or token caps', () => {
  const zero = { requests: 0, inputBytes: 0, reservedOutputTokens: 0, images: 0, costUnits: 0 };
  const image = { requests: 1, inputBytes: 100, reservedOutputTokens: 0, images: 1, costUnits: 10 };
  const first = nextBudgetUsage(zero, image);
  assert.equal(first.images, 1);
  assert.equal(nextBudgetUsage({ ...first, images: MONTHLY_AI_LIMIT.images }, image), null);
  assert.equal(nextBudgetUsage({ ...zero, costUnits: MONTHLY_AI_LIMIT.costUnits }, image), null);
  assert.equal(nextBudgetUsage(zero, { ...image, reservedOutputTokens: MONTHLY_AI_LIMIT.reservedOutputTokens + 1 }), null);
});

test('negative, fractional, non-finite and unsafe budget counters never create credit', () => {
  const zero = { requests: 0, inputBytes: 0, reservedOutputTokens: 0, images: 0, costUnits: 0 };
  for (const field of Object.keys(zero)) {
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', undefined]) {
      assert.equal(nextBudgetUsage(zero, { ...zero, [field]: invalid }), null);
      assert.equal(nextBudgetUsage({ ...zero, [field]: invalid }, zero), null);
    }
  }
});
