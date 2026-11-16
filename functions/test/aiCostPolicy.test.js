'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_MONTHLY_LIMITS, AI_HOURLY_LIMIT, AI_INPUT_OVERHEAD_RESERVATION, parseAiGenerationScope,
  resolveAiPlan, readAiCounters, addAiCounters, emptyAiCounters } = require('../lib/aiCostPolicy');
const { aiBudgetDocumentId } = require('../lib/aiBudget');
const { resolveTextModel, resolveImageModel, aiModelAllowedForPlan } = require('../lib/modelPolicy');
const keyId = '11111111-1111-4111-8111-111111111111';

test('AI cost policy derives plans only from server mode and validated entitlements', () => {
  assert.equal(resolveAiPlan(undefined, { effectiveTier: 'sovereign' }), 'preview');
  assert.equal(resolveAiPlan({ mode: 'free-first' }, undefined), 'preview');
  assert.equal(resolveAiPlan({ mode: 'paid' }, undefined), 'free');
  for (const plan of ['pro', 'sovereign']) {
    for (const status of ['active', 'trialing', 'past_due']) assert.equal(resolveAiPlan({ mode: 'paid' }, { effectiveTier: plan, status }), plan);
    for (const status of ['canceled', 'unpaid', 'unexpected']) assert.equal(resolveAiPlan({ mode: 'paid' }, { effectiveTier: plan, status }), null);
  }
  for (const mode of [null, [], 'paid', { mode: 'unexpected' }]) assert.equal(resolveAiPlan(mode, undefined), null);
  for (const entitlement of [null, [], {}, { effectiveTier: 'business', status: 'active' }, { tier: 'sovereign', status: 'active' }]) {
    assert.equal(resolveAiPlan({ mode: 'paid' }, entitlement), null);
  }
  assert.ok(AI_MONTHLY_LIMITS.free.costUnits < AI_MONTHLY_LIMITS.pro.costUnits);
  assert.equal(AI_MONTHLY_LIMITS.pro.costUnits, AI_MONTHLY_LIMITS.preview.costUnits);
  assert.equal(AI_MONTHLY_LIMITS.sovereign.costUnits, AI_MONTHLY_LIMITS.preview.costUnits);
});

test('generation scope rejects extra authority, malformed epochs and implicit team fallback', () => {
  assert.deepEqual(parseAiGenerationScope(undefined), { kind: 'personal' });
  const scope = { kind: 'team', teamId: 'crew', keyEpoch: 2, keyId };
  assert.deepEqual(parseAiGenerationScope(scope), scope);
  for (const input of [null, [], 'crew', { kind: 'personal', teamId: 'crew' }, { ...scope, uid: 'other' },
    { ...scope, keyEpoch: 0 }, { ...scope, keyEpoch: 1.5 }, { ...scope, keyId: 'legacy' }, { ...scope, teamId: '../crew' }]) {
    assert.equal(parseAiGenerationScope(input), null);
  }
});

test('AI reservations preserve legacy consumption and reject all invalid counters and overflow', () => {
  const zero = emptyAiCounters(); const charge = { ...zero, requests: 1, inputBytes: 10, reservedInputTokens: 522, costUnits: 1 };
  const { reservedInputTokens, ...legacy } = charge;
  assert.equal(readAiCounters(legacy, true).reservedInputTokens, legacy.inputBytes + AI_INPUT_OVERHEAD_RESERVATION);
  assert.equal(readAiCounters(legacy), null);
  assert.deepEqual(addAiCounters(zero, charge, AI_HOURLY_LIMIT), charge);
  for (const field of Object.keys(zero)) {
    for (const value of [-1, 0.5, NaN, Infinity, '1', undefined]) {
      assert.equal(readAiCounters({ ...zero, [field]: value }), null);
      assert.equal(addAiCounters(zero, { ...charge, [field]: value }, AI_HOURLY_LIMIT), null);
    }
    assert.equal(addAiCounters({ ...zero, [field]: Number.MAX_SAFE_INTEGER }, { ...zero, [field]: 1 },
      { ...AI_HOURLY_LIMIT, [field]: Number.MAX_SAFE_INTEGER }), null);
  }
  assert.equal(readAiCounters({ ...zero, rawPrompt: 'synthetic' }), null);
});

test('budget IDs keep colliding sanitized UIDs and personal/team namespaces separate', () => {
  const first = aiBudgetDocumentId('user', 'alice+one', '2026-10');
  const second = aiBudgetDocumentId('user', 'alice_one', '2026-10');
  assert.notEqual(first, second);
  assert.notEqual(first, aiBudgetDocumentId('team', 'alice+one', '2026-10'));
  assert.notEqual(first, aiBudgetDocumentId('user', 'alice+one', '2026-10-03T10'));
  assert.ok(!first.includes('alice'));
  assert.throws(() => aiBudgetDocumentId('user', '../uid', '2026-10'));
  assert.throws(() => aiBudgetDocumentId('user', 'alice', '../period'));
});

test('model allowlist rejects prototype properties and paid free accounts cannot request premium models', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'attacker/model']) {
    assert.equal(resolveTextModel(id), null); assert.equal(resolveImageModel(id), null);
  }
  assert.equal(aiModelAllowedForPlan('text', 'hf-default', 'free'), true);
  assert.equal(aiModelAllowedForPlan('text', 'nvidia-nemotron', 'free'), true);
  assert.equal(aiModelAllowedForPlan('text', 'gemini-flash', 'free'), true);
  assert.equal(aiModelAllowedForPlan('text', 'openai-mini', 'free'), false);
  assert.equal(aiModelAllowedForPlan('image', 'hf-image', 'free'), false);
  for (const plan of ['preview', 'pro', 'sovereign']) {
    assert.equal(aiModelAllowedForPlan('text', 'openai-mini', plan), true);
    assert.equal(aiModelAllowedForPlan('image', 'openai-image', plan), true);
  }
  assert.equal(aiModelAllowedForPlan('text', 'openai-mini', 'unexpected'), false);
});
