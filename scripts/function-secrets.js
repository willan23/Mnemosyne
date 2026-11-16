'use strict';
// Read-only metadata. Never calls SecretVersion:access or copies dotenv values.
const fs = require('node:fs'); const path = require('node:path');
const { GoogleAuth } = require('../functions/node_modules/google-auth-library');
const { FUNCTION_SECRET_NAMES, FUNCTION_SECRET_BINDINGS, isFunctionCredentialName } = require('../functions/lib/functionSecretPolicy');
const { monitoringProjectValid } = require('../functions/lib/aiMonitoringPolicy');
class SecretCheckFailure extends Error {constructor(code) {super('Function secret check failed.'); this.code = code;}}
function args(values) {
  const command = values.shift(); if (!['plan', 'audit', 'preflight'].includes(command)) throw new SecretCheckFailure('invalid_command');
  const result = {command};
  while (values.length) {
    const key = values.shift(); const value = values.shift();
    if (!['--project', '--out'].includes(key) || !value || result[key.slice(2)]) throw new SecretCheckFailure('invalid_arguments'); result[key.slice(2)] = value;
  }
  if (!monitoringProjectValid(result.project) || !result.out || !path.isAbsolute(result.out)) throw new SecretCheckFailure('explicit_project_and_absolute_output_required');
  return result;
}
function plan(project) {
  if (!monitoringProjectValid(project)) throw new SecretCheckFailure('invalid_project');
  return {v: 1, projectId: project, secretNames: [...FUNCTION_SECRET_NAMES],
    bindings: FUNCTION_SECRET_BINDINGS.map(row => ({functionId: row.functionId, secretNames: [...row.secretNames]})),
    applied: false, payloadAccesses: 0, historicalRevocationProven: false,
    steps: ['Obtain new credentials after provider-side revocation; never import old dotenv credentials automatically.',
      'Create required Secret Manager versions in the explicit project using the authorized operator procedure.',
      'Remove credential keys from deploy dotenv files without committing or copying their values.',
      'Run preflight and resolve enabled versions and configuration conflicts.',
      'Deploy only after all product gates; verify live bindings, IAM and provider smoke.',
      'Drain old instances and reconcile provider revocation and retained historical configuration.']};
}
function localConfiguration(root, project) {
  if (!monitoringProjectValid(project)) throw new SecretCheckFailure('invalid_project');
  const result = {readable: true, filesInspected: 0, credentialKeys: [], errors: []}; const aliases = new Set();
  const rc = path.join(root, '.firebaserc');
  if (fs.existsSync(rc)) {
    try {for (const [alias, id] of Object.entries(JSON.parse(fs.readFileSync(rc, 'utf8').replace(/^\uFEFF/, '')).projects || {})) {
      if (id === project && /^[A-Za-z0-9_-]{1,64}$/.test(alias)) aliases.add(alias);
    }} catch {result.readable = false; result.errors.push('project_alias_config_unreadable');}
  }
  const functionFiles = new Set(['.env', '.env.local', `.env.${project}`, ...[...aliases].map(alias => `.env.${alias}`)]);
  for (const target of ['functions', 'frontend']) {
    const folder = path.join(root, target); if (!fs.existsSync(folder)) {result.readable = false; result.errors.push(`${target}_directory_unavailable`); continue;}
    for (const filename of fs.readdirSync(folder)) {
      const inspect = target === 'functions' ? functionFiles.has(filename) : /^\.env(?:\.[A-Za-z0-9_-]+)*$/.test(filename) && !/\.(example|sample|template)$/.test(filename);
      if (!inspect) continue;
      try {
        const file = path.join(folder, filename); const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new SecretCheckFailure('invalid_environment_file');
        const keys = new Set();
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
          const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|:\s)/.exec(line);
          if (match && isFunctionCredentialName(match[1])) keys.add(match[1]);
        }
        result.filesInspected++;
        for (const key of keys) result.credentialKeys.push({target, file: filename, key});
      } catch {result.readable = false; result.errors.push(`${target}_environment_file_unreadable`);}
    }
  }
  return result;
}
async function connect(project) {
  if (!monitoringProjectValid(project) || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new SecretCheckFailure('invalid_api_context');
  const auth = new GoogleAuth({projectId: project, scopes: ['https://www.googleapis.com/auth/cloud-platform']});
  const client = await auth.getClient(); client.quotaProjectId = project;
  const origins = {resource: 'https://cloudresourcemanager.googleapis.com', secrets: 'https://secretmanager.googleapis.com', functions: 'https://cloudfunctions.googleapis.com'};
  const get = async (service, resource, fields) => {
    if (!origins[service] || !resource.startsWith('/v') || resource.includes(':')) throw new SecretCheckFailure('invalid_metadata_request');
    try {return {ok: true, data: (await client.request({url: origins[service] + resource, method: 'GET', params: {fields}, timeout: 30000, retry: false})).data};}
    catch (error) {return {ok: false, status: Number.isInteger(error?.response?.status) ? error.response.status : null};}
  };
  const binding = await get('resource', `/v3/projects/${project}`, 'name,projectId'); const number = /^projects\/([0-9]+)$/.exec(binding.data?.name || '')?.[1];
  if (!binding.ok || binding.data.projectId !== project || !number) throw new SecretCheckFailure('project_binding_unavailable');
  return {project, number, get};
}
async function audit(api, local) {
  const definition = plan(api.project);
  const result = {v: 1, generatedAt: new Date().toISOString(), projectId: api.project, projectBindingVerified: true,
    mode: 'read-only', productionMutations: 0, payloadAccesses: 0, environmentValueOutputs: 0, complete: true,
    localConfiguration: local, secrets: [], functions: [], secretPrerequisitesReady: false, deployedBindingsVerified: false,
    runtimeSmokeVerified: false, historicalRevocationProven: false, releaseReady: false};
  for (let start = 0; start < definition.secretNames.length; start += 4) {
    const rows = await Promise.all(definition.secretNames.slice(start, start + 4).map(async name => {
      const metadata = await api.get('secrets', `/v1/projects/${api.project}/secrets/${name}`, 'name');
      if (!metadata.ok) return {name, readable: metadata.status === 404, exists: metadata.status === 404 ? false : null, enabled: false, status: metadata.status};
      if (!new RegExp(`^projects/(${api.project}|${api.number})/secrets/${name}$`).test(metadata.data.name || '')) return {name, readable: false, exists: null, enabled: false, error: 'secret_binding_mismatch'};
      const version = await api.get('secrets', `/v1/projects/${api.project}/secrets/${name}/versions/latest`, 'name,state');
      if (!version.ok) return {name, readable: version.status === 404, exists: true, enabled: false, status: version.status};
      const match = new RegExp(`^projects/(${api.project}|${api.number})/secrets/${name}/versions/([0-9]+)$`).exec(version.data.name || '');
      return {name, readable: Boolean(match), exists: true, enabled: Boolean(match && version.data.state === 'ENABLED'), version: match?.[2] || null,
        state: ['ENABLED', 'DISABLED', 'DESTROYED'].includes(version.data.state) ? version.data.state : 'unknown'};
    })); result.secrets.push(...rows);
  }
  for (let start = 0; start < definition.bindings.length; start += 4) {
    const rows = await Promise.all(definition.bindings.slice(start, start + 4).map(async desired => {
      const name = `projects/${api.project}/locations/europe-west1/functions/${desired.functionId}`;
      let metadata = await api.get('functions', `/v1/${name}`, 'name,status,runtime,secretEnvironmentVariables(key,projectId,secret,version)'); let generation = 1;
      if (!metadata.ok && metadata.status === 404) {generation = 2; metadata = await api.get('functions', `/v2/${name}`, 'name,state,buildConfig(runtime),serviceConfig(secretEnvironmentVariables(key,projectId,secret,version))');}
      if (!metadata.ok) return {functionId: desired.functionId, readable: metadata.status === 404, exists: metadata.status === 404 ? false : null, bindingsMatch: false, status: metadata.status};
      const data = metadata.data; const vars = (generation === 1 ? data.secretEnvironmentVariables : data.serviceConfig?.secretEnvironmentVariables) || [];
      if (data.name !== name || !Array.isArray(vars)) return {functionId: desired.functionId, readable: false, bindingsMatch: false, error: 'function_binding_mismatch'};
      const versionsMatch = vars.every(row => /^[0-9]+$/.test(row.version || '') && result.secrets.some(secret => secret.name === row.key && secret.version === row.version && secret.enabled));
      const keysMatch = vars.length === desired.secretNames.length && desired.secretNames.every(secret => vars.filter(row => row.key === secret && row.secret === secret &&
        (!row.projectId || row.projectId === api.project || row.projectId === api.number)).length === 1);
      return {functionId: desired.functionId, readable: true, exists: true, generation, secretBindingCount: vars.length,
        runtimeNode22: (data.runtime || data.buildConfig?.runtime) === 'nodejs22', active: (data.status || data.state) === 'ACTIVE', bindingsMatch: keysMatch && versionsMatch};
    })); result.functions.push(...rows);
  }
  result.complete = result.secrets.every(row => row.readable) && result.functions.every(row => row.readable) && local.readable;
  result.secretPrerequisitesReady = result.complete && local.credentialKeys.length === 0 && result.secrets.every(row => row.enabled);
  result.deployedBindingsVerified = result.complete && result.functions.every(row => row.bindingsMatch && row.active && row.runtimeNode22);
  return result;
}
async function main(values) {
  if (process.versions.node.split('.')[0] !== '22') throw new SecretCheckFailure('node22_required');
  const input = args([...values]); const root = path.resolve(__dirname, '..');
  const report = input.command === 'plan' ? plan(input.project) : await audit(await connect(input.project), localConfiguration(root, input.project));
  fs.writeFileSync(input.out, JSON.stringify(report, null, 2) + '\n', {encoding: 'utf8', flag: 'wx'});
  process.stdout.write(JSON.stringify({command: input.command, projectId: input.project, output: input.out, complete: report.complete ?? null,
    secretPrerequisitesReady: report.secretPrerequisitesReady ?? false, deployedBindingsVerified: report.deployedBindingsVerified ?? false, productionMutations: 0, payloadAccesses: 0}) + '\n');
  if (input.command === 'preflight' && !report.secretPrerequisitesReady) process.exitCode = 2;
}
module.exports = {args, plan, localConfiguration, audit, SecretCheckFailure};
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({complete: false, error: error instanceof SecretCheckFailure ? error.code : 'secret_check_failed'}) + '\n'); process.exitCode = 1;
});
