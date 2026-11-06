'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const {spawnSync} = require('node:child_process');
const params = require('../lib/params');
const {FUNCTION_CREDENTIAL_NAMES, FUNCTION_SECRET_NAMES, FUNCTION_SECRET_BINDINGS, isFunctionCredentialName} = require('../lib/functionSecretPolicy');
const {args, plan, localConfiguration, audit} = require('../../scripts/function-secrets');
const project = 'mnemosyne-one';
const cleanLocal = () => ({readable: true, filesInspected: 0, credentialKeys: [], errors: []});
function removeFixture(root) {
  const absolute = path.resolve(root);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !/^mnemosyne-secret(?:s|-cli)-/.test(path.basename(absolute))) throw Error('Fixture cleanup outside intended directory');
  fs.rmSync(absolute, {recursive: true, force: true});
}
function fixture() {
  const state = {missing: null, unavailable: null, disabled: null, malformed: null, mismatch: null, generation2: false}; const calls = [];
  const api = {project, number: '456', get: async (service, resource, fields) => {
    calls.push({service, resource, fields});
    if (service === 'secrets') {
      const name = resource.split('/secrets/')[1].split('/')[0];
      if (name === state.missing) return {ok: false, status: 404}; if (name === state.unavailable) return {ok: false, status: 403};
      const base = `projects/${name === state.malformed ? 'other-project' : '456'}/secrets/${name}`;
      return {ok: true, data: resource.includes('/versions/') ? {name: `${base}/versions/2`, state: name === state.disabled ? 'DISABLED' : 'ENABLED'} : {name: base}};
    }
    const id = resource.split('/').at(-1); const desired = FUNCTION_SECRET_BINDINGS.find(row => row.functionId === id);
    const name = `projects/${project}/locations/europe-west1/functions/${id}`;
    const vars = desired.secretNames.map(key => ({key, secret: key, projectId: '456', version: '2'}));
    if (state.mismatch === id) vars[0] = {...vars[0], projectId: 'other-project'};
    if (state.generation2 && resource.startsWith('/v1/')) return {ok: false, status: 404};
    return {ok: true, data: state.generation2 ? {name, state: 'ACTIVE', buildConfig: {runtime: 'nodejs22'}, serviceConfig: {secretEnvironmentVariables: vars}}
      : {name, status: 'ACTIVE', runtime: 'nodejs22', secretEnvironmentVariables: vars}};
  }};
  return {api, state, calls};
}
test('declared parameters reject unknown names, swapped parameters and value errors without falling back to environment', () => {
  const original = params.openrouterApiKey.value; const prior = process.env.OPENROUTER_API_KEY;
  try {
    process.env.OPENROUTER_API_KEY = 'synthetic-private-env-fallback';
    params.openrouterApiKey.value = () => ' synthetic-private-declared-value ';
    assert.equal(params.readSecret(params.openrouterApiKey, 'OPENROUTER_API_KEY') === 'synthetic-private-declared-value', true);
    assert.equal(params.readSecret(params.nvidiaApiKey, 'OPENROUTER_API_KEY'), '');
    assert.equal(params.readSecret(params.openrouterApiKey, 'constructor'), '');
    params.openrouterApiKey.value = () => {throw Error('synthetic-private-sdk-error');};
    assert.equal(params.readSecret(params.openrouterApiKey, 'OPENROUTER_API_KEY'), '');
  } finally {params.openrouterApiKey.value = original; if (prior === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prior;}
});

test('disabled OpenAI has no registered parameter and cannot read a legacy environment value', () => {
  const prior = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'synthetic-private-disabled-value';
    assert.equal(params.openaiApiKey, undefined);
    assert.equal(params.readSecret(undefined, 'OPENAI_API_KEY'), '');
    assert.equal(params.readEnv('OPENAI_API_KEY'), undefined);
    assert.equal(FUNCTION_SECRET_NAMES.includes('OPENAI_API_KEY'), false);
  } finally {if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior;}
});
test('ordinary environment configuration cannot return canonical, legacy or Vite credentials', () => {
  const names = [...FUNCTION_CREDENTIAL_NAMES, 'HF_TOKEN', 'NVIDIA_API_KEY_FAST', 'VITE_OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY', 'VITE_GEMINI_API_KEY', 'STRIPE_PRICE_PRO_MONTHLY'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    names.forEach(name => {process.env[name] = 'synthetic-private-env-value';});
    for (const name of names.slice(0, -1)) {assert.equal(isFunctionCredentialName(name), true); assert.equal(params.readEnv(name), undefined);}
    assert.equal(params.readEnv('STRIPE_PRICE_PRO_MONTHLY') === 'synthetic-private-env-value', true);
  } finally {names.forEach(name => {if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];});}
});
test('real deployment exports bind precisely the necessary declared secrets without reading values at module load', () => {
  const control = process.env.FUNCTIONS_CONTROL_API; const projectBefore = process.env.GCLOUD_PROJECT;
  process.env.FUNCTIONS_CONTROL_API = 'true'; process.env.GCLOUD_PROJECT = 'demo-mnemosyne-rules';
  try {
    const functions = require('../lib/index'); const expected = new Map(FUNCTION_SECRET_BINDINGS.map(row => [row.functionId, [...row.secretNames].sort()]));
    for (const [id, func] of Object.entries(functions)) {
      if (!func.__endpoint) continue;
      const keys = (func.__endpoint.secretEnvironmentVariables || []).map(row => row.key).sort();
      assert.deepEqual(keys, expected.get(id) || [], id); expected.delete(id);
    }
    assert.equal(expected.size, 0);
    const {declaredParams} = require('firebase-functions/params');
    assert.deepEqual(declaredParams.map(parameter => parameter.name).sort(), [...FUNCTION_SECRET_NAMES].sort());
  } finally {
    if (control === undefined) delete process.env.FUNCTIONS_CONTROL_API; else process.env.FUNCTIONS_CONTROL_API = control;
    if (projectBefore === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = projectBefore;
  }
});
test('local migration scan detects project aliases and Vite credentials and never projects dotenv values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemosyne-secrets-'));
  try {
    fs.mkdirSync(path.join(root, 'functions')); fs.mkdirSync(path.join(root, 'frontend'));
    fs.writeFileSync(path.join(root, '.firebaserc'), JSON.stringify({projects: {default: project}}));
    fs.writeFileSync(path.join(root, 'functions', '.env.default'), 'export OPENAI_API_KEY=synthetic-private-value\nHF_TOKEN=synthetic-private-value\nSAFE_CONFIG=value\n');
    fs.writeFileSync(path.join(root, 'functions', '.env.example'), 'STRIPE_SECRET_KEY=synthetic-private-example\n');
    fs.writeFileSync(path.join(root, 'functions', '.env.other-project'), 'STRIPE_SECRET_KEY=synthetic-private-other-project\n');
    fs.writeFileSync(path.join(root, 'frontend', '.env.production.local'), 'VITE_NVIDIA_API_KEY=synthetic-private-value\n');
    const result = localConfiguration(root, project); assert.equal(result.readable, true); assert.equal(result.filesInspected, 2);
    assert.deepEqual(result.credentialKeys.map(row => row.key).sort(), ['HF_TOKEN', 'OPENAI_API_KEY', 'VITE_NVIDIA_API_KEY']);
    assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
    fs.writeFileSync(path.join(root, '.firebaserc'), '{broken'); assert.equal(localConfiguration(root, project).readable, false);
  } finally {removeFixture(root);}
});
test('read-only prerequisites and live bindings can pass independently without claiming release or provider revocation', async () => {
  for (const generation2 of [false, true]) {
    const f = fixture(); f.state.generation2 = generation2; const result = await audit(f.api, cleanLocal());
    assert.equal(result.complete, true); assert.equal(result.secretPrerequisitesReady, true); assert.equal(result.deployedBindingsVerified, true);
    assert.equal(result.runtimeSmokeVerified, false); assert.equal(result.historicalRevocationProven, false); assert.equal(result.releaseReady, false);
    assert.equal(result.productionMutations, 0); assert.equal(result.payloadAccesses, 0);
    assert.ok(f.calls.every(row => !row.resource.includes(':access') && !row.fields.includes('environmentVariables') && !row.fields.includes('payload')));
  }
});
test('missing, disabled, inaccessible and wrongly bound secrets cannot produce a ready preflight', async () => {
  for (const field of ['missing', 'disabled', 'unavailable', 'malformed']) {
    const f = fixture(); f.state[field] = 'OPENROUTER_API_KEY'; const result = await audit(f.api, cleanLocal());
    assert.equal(result.secretPrerequisitesReady, false); assert.equal(result.deployedBindingsVerified, false);
    assert.equal(result.complete, field === 'missing' || field === 'disabled');
    if (field === 'unavailable') assert.equal(result.secrets.find(row => row.name === 'OPENROUTER_API_KEY').exists, null);
  }
  const f = fixture(); f.state.mismatch = 'generateText';
  const result = await audit(f.api, cleanLocal()); assert.equal(result.secretPrerequisitesReady, true); assert.equal(result.deployedBindingsVerified, false);
  const conflict = await audit(f.api, {...cleanLocal(), credentialKeys: [{target: 'functions', file: '.env', key: 'OPENAI_API_KEY'}]});
  assert.equal(conflict.secretPrerequisitesReady, false);
});
test('CLI requires explicit project and new absolute output and the PowerShell wrapper only prepares a plan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemosyne-secret-cli-')); const output = path.join(root, 'plan.json');
  try {
    assert.equal(args(['plan', '--project', project, '--out', output]).project, project);
    for (const input of [['plan'], ['apply', '--project', project, '--out', output], ['plan', '--project', 'other/path', '--out', output],
      ['plan', '--project', project, '--out', 'relative.json'], ['plan', '--project', project, '--project', project, '--out', output]]) assert.throws(() => args(input));
    assert.equal(plan(project).applied, false); assert.equal(plan(project).bindings.length, 7);
    if (process.platform === 'win32') {
      const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.resolve(__dirname, '../../scripts/sync-function-secrets.ps1'),
        '-Project', project, '-Out', output, '-Mode', 'plan'], {encoding: 'utf8', timeout: 30000});
      assert.equal(run.status, 0); assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).payloadAccesses, 0);
      const again = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/function-secrets.js'), 'plan', '--project', project, '--out', output], {encoding: 'utf8'});
      assert.equal(again.status, 1); assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).applied, false);
    }
  } finally {removeFixture(root);}
});
