'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {ACTIVE_GENERATION_PROVIDERS, generationSecretNames, declareGenerationSecrets, isGenerationProviderEnabled} = require('../lib/generationProviderPolicy');

test('release enables only free OpenRouter inference and registers no paid provider secret', () => {
  assert.deepEqual(ACTIVE_GENERATION_PROVIDERS, ['openrouter']);
  assert.equal(Object.isFrozen(ACTIVE_GENERATION_PROVIDERS), true);
  assert.deepEqual(generationSecretNames(), ['OPENROUTER_API_KEY']);
  assert.deepEqual(require('../lib/generationProviderPolicy').generationImageSecretNames(), []);
  for (const name of ['nvidia', 'openai', 'huggingface', 'gemini', 'constructor', 'unknown']) assert.equal(isGenerationProviderEnabled(name), false);
  for (const providers of [null, ['nvidia', 'nvidia'], ['constructor'], ['unknown'], ['openai', 'nvidia', 'huggingface', 'openai']]) {
    let calls = 0; assert.throws(() => declareGenerationSecrets(providers, () => { calls++; })); assert.equal(calls, 0);
  }
});

for (const [provider, name, parameter] of [['nvidia', 'NVIDIA_API_KEY', 'nvidiaApiKey'], ['openai', 'OPENAI_API_KEY', 'openaiApiKey'], ['huggingface', 'HUGGINGFACE_API_KEY', 'huggingfaceApiKey'], ['gemini', 'GEMINI_API_KEY', 'geminiApiKey']]) test(`future explicit ${provider} configuration retains real SDK declaration, runtime identity checks and function bindings`, () => {
  // Separate process avoids changing this release policy or contaminating SDK module registration in other tests.
  const run = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    process.env.FUNCTIONS_CONTROL_API = 'true'; process.env.GCLOUD_PROJECT = 'demo-mnemosyne-rules';
    const policy = require('./lib/generationProviderPolicy');
    policy.ACTIVE_GENERATION_PROVIDERS = Object.freeze([${JSON.stringify(provider)}]);
    const parameters = require('./lib/params');
    const functions = require('./lib/index');
    assert.deepEqual(require('firebase-functions/params').declaredParams.map(x => x.name).sort(),
      [${JSON.stringify(name)}, 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'].sort());
    for (const name of ['generateText', 'generateImage'])
      assert.deepEqual(functions[name].__endpoint.secretEnvironmentVariables.map(x => x.key), [${JSON.stringify(name)}]);
    parameters[${JSON.stringify(parameter)}].value = () => 'synthetic-future-secret';
    assert.equal(parameters.readSecret(parameters[${JSON.stringify(parameter)}], ${JSON.stringify(name)}) === 'synthetic-future-secret', true);
    assert.equal(parameters.readSecret(undefined, ${JSON.stringify(name)}), '');
  `], {cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000});
  assert.equal(run.status, 0, run.stderr);
});
