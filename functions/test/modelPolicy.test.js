'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTextModel, resolveImageModel, validImageOptions, validTextTokenRequest, aiModelAllowedForPlan } = require('../lib/modelPolicy');

test('server model policy allows only known text and image models', () => {
  const free=resolveTextModel('openrouter-gemma-4-free');assert.equal(free.provider,'openrouter');assert.equal(free.externalModel,'google/gemma-4-31b-it:free');assert.equal(resolveTextModel(undefined).id,free.id);
  assert.equal(resolveTextModel('google/gemma-4-31b-it:free'),null);assert.equal(resolveTextModel('google/gemma-4-31b-it'),null);assert.equal(resolveImageModel(free.id),null);
  for(const plan of ['free','preview','pro','sovereign'])assert.equal(aiModelAllowedForPlan('text',free.id,plan),true);
  assert.equal(resolveTextModel('nvidia-llama').provider, 'nvidia');
  assert.equal(resolveTextModel('meta/llama-3.1-70b-instruct').id, 'nvidia-nemotron');
  assert.equal(resolveTextModel('nvidia-llama').externalModel, 'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(resolveTextModel('hf-default').externalModel, 'openai/gpt-oss-120b:nscale');
  assert.equal(resolveImageModel('nvidia-image').externalModel, 'black-forest-labs/flux.1-schnell');
  assert.equal(resolveTextModel('gpt-4o'), null);
  assert.equal(resolveTextModel('attacker/expensive-sku'), null);
  assert.equal(resolveImageModel('nvidia-image').width, 1024);
  assert.equal(resolveImageModel('attacker/huge-image'), null);
  assert.equal(validImageOptions('4096x4096', 'high'), false);
  assert.equal(validTextTokenRequest(4096, resolveTextModel('hf-default')), false);
  assert.equal(validTextTokenRequest(900, resolveTextModel('hf-default')), true);
});

test('Ultra requires its own server ID, retains token and plan limits, and does not remap Super', () => {
  const model = resolveTextModel('nvidia-nemotron-ultra');
  assert.equal(model.externalModel, 'nvidia/nemotron-3-ultra-550b-a55b');
  assert.equal(model.provider, 'nvidia');
  assert.equal(model.costUnitsPerRequest, 4);
  assert.equal(validTextTokenRequest(900, model), true);
  for (const tokens of [63, 901, 100000, '900', NaN]) assert.equal(validTextTokenRequest(tokens, model), false);
  for (const plan of ['free', 'preview', 'pro', 'sovereign']) assert.equal(aiModelAllowedForPlan('text', model.id, plan), true);
  assert.equal(aiModelAllowedForPlan('text', model.id, 'unexpected'), false);
  assert.equal(resolveTextModel(model.externalModel), null);
  assert.equal(resolveTextModel('google/gemma-4-31b-it'), null);
  assert.equal(resolveTextModel('openai/gpt-oss-20b'), null);
  assert.equal(resolveTextModel('nvidia-nemotron').externalModel, 'nvidia/nemotron-3-super-120b-a12b');
});
