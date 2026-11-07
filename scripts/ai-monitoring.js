'use strict';
// Explicit project, bounded read-only audit, and resumable application of a reviewed plan.
const fs = require('node:fs'); const path = require('node:path'); const { isDeepStrictEqual } = require('node:util');
const { GoogleAuth } = require('../functions/node_modules/google-auth-library');
const { buildAiMonitoringPlan, buildAiEmailChannelPlan, monitoringProjectValid, monitoringChannelValid, AI_MONITORING_OWNER } = require('../functions/lib/aiMonitoringPolicy');
class MonitoringFailure extends Error { constructor(code) { super('Monitoring operation failed.'); this.code = code; } }
function args(values) {
  const command = values.shift(); if (!['audit', 'plan', 'apply', 'channel-plan', 'channel-apply'].includes(command)) throw new MonitoringFailure('invalid_command');
  const result = { command, channels: [] };
  while (values.length) {
    const key = values.shift(); const value = values.shift();
    if (!value || !['--project', '--out', '--channel', '--plan', '--confirm-project', '--email'].includes(key)) throw new MonitoringFailure('invalid_arguments');
    if (key === '--channel') result.channels.push(value);
    else { const field = key.slice(2); if (result[field]) throw new MonitoringFailure('duplicate_argument'); result[field] = value; }
  }
  if (!monitoringProjectValid(result.project)) throw new MonitoringFailure('explicit_project_required');
  if (['apply', 'channel-apply'].includes(command) && (!result.plan || result['confirm-project'] !== result.project || result.out || result.channels.length || result.email)) throw new MonitoringFailure('apply_context_required');
  if (!['apply', 'channel-apply'].includes(command) && (!result.out || result.plan || result['confirm-project'] ||
      (command !== 'plan' && result.channels.length) || (command === 'channel-plan' ? !result.email : result.email))) throw new MonitoringFailure('output_context_required');
  return result;
}
function remoteError(error) { const status = error?.response?.status; return new MonitoringFailure(Number.isInteger(status) ? `http_${status}` : 'remote_unavailable'); }
async function connect(project) {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new MonitoringFailure('emulator_context_present');
  const auth = new GoogleAuth({ projectId: project, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient(); client.quotaProjectId = project;
  const request = async (service, method, resource, data, params) => {
    const origins = { resource: 'https://cloudresourcemanager.googleapis.com', monitoring: 'https://monitoring.googleapis.com', logging: 'https://logging.googleapis.com' };
    if (!origins[service] || !['GET', 'POST', 'PUT', 'PATCH'].includes(method) || !resource.startsWith('/v')) throw new MonitoringFailure('invalid_api_context');
    try { return (await client.request({ url: `${origins[service]}${resource}`, method, data, params, timeout: 30000, retry: false })).data; }
    catch (error) { throw remoteError(error); }
  };
  const binding = await request('resource', 'GET', `/v3/projects/${project}`);
  const number = /^projects\/([0-9]+)$/.exec(binding.name || '')?.[1];
  if (binding.projectId !== project || !number) throw new MonitoringFailure('project_binding_mismatch');
  return { project, number, request };
}
async function list(api, kind) {
  const spec = {
    channels: { service: 'monitoring', url: `/v3/projects/${api.project}/notificationChannels`, field: 'notificationChannels',
      fields: 'notificationChannels(name,type,enabled,verificationStatus),nextPageToken' },
    channelAddresses: { service: 'monitoring', url: `/v3/projects/${api.project}/notificationChannels`, field: 'notificationChannels',
      fields: 'notificationChannels(name,type,enabled,verificationStatus,labels,userLabels),nextPageToken' },
    policies: { service: 'monitoring', url: `/v3/projects/${api.project}/alertPolicies`, field: 'alertPolicies' },
    metrics: { service: 'logging', url: `/v2/projects/${api.project}/metrics`, field: 'metrics' },
  }[kind];
  if (!spec) throw new MonitoringFailure('invalid_list');
  const rows = []; const tokens = new Set(); let cursor;
  for (let page = 0; page < 100; page++) {
    const payload = await api.request(spec.service, 'GET', spec.url, undefined, { pageSize: 100, ...(cursor ? { pageToken: cursor } : {}), ...(spec.fields ? { fields: spec.fields } : {}) });
    const batch = payload[spec.field] ?? []; if (!Array.isArray(batch) || batch.length > 100) throw new MonitoringFailure('invalid_page');
    rows.push(...batch); if (rows.length > 10000) throw new MonitoringFailure('inventory_bound_exceeded');
    const next = payload.nextPageToken; if (!next) return rows;
    if (typeof next !== 'string' || next.length > 4096 || tokens.has(next)) throw new MonitoringFailure('invalid_cursor'); tokens.add(next); cursor = next;
  }
  throw new MonitoringFailure('inventory_bound_exceeded');
}
async function audit(api) {
  const expectedMetrics = new Set(buildAiMonitoringPlan(api.project).metrics.map(metric => metric.name));
  const result = { v: 1, generatedAt: new Date().toISOString(), projectId: api.project, projectBindingVerified: true,
    mode: 'read-only', productionMutations: 0, complete: true, inventories: {} };
  // Preserve a partial inventory on permission/API errors; never mistake unavailable data for zero resources.
  for (const kind of ['channels', 'metrics', 'policies']) {
    try {
      const rows = await list(api, kind);
      result.inventories[kind] = kind === 'channels' ? { readable: true, total: rows.length,
        channels: rows.map(row => ({ name: monitoringChannelValid(row.name, api.project, api.number) ? row.name : 'invalid_binding',
          type: ['email', 'sms', 'slack', 'webhook_basicauth', 'webhook_tokenauth', 'pagerduty', 'pubsub', 'campfire', 'hipchat'].includes(row.type) ? row.type : 'other',
          enabled: row.enabled !== false, verification: ['VERIFIED', 'UNVERIFIED'].includes(row.verificationStatus) ? row.verificationStatus : 'NOT_REQUIRED_OR_UNKNOWN' })) }
        : kind === 'metrics' ? { readable: true, total: rows.length, managedNames: rows.filter(row => expectedMetrics.has(row.name)).map(row => row.name) }
        : { readable: true, total: rows.length, managed: rows.filter(row => row.userLabels?.managed_by === AI_MONITORING_OWNER).map(row => ({
          enabled: row.enabled !== false, channelCount: Array.isArray(row.notificationChannels) ? row.notificationChannels.length : 0,
          conditionCount: Array.isArray(row.conditions) ? row.conditions.length : 0 })) };
    } catch (error) { result.complete = false; result.inventories[kind] = { readable: false, error: error instanceof MonitoringFailure ? error.code : 'inventory_unavailable' }; }
  }
  return result;
}
const metricProjection = value => Object.fromEntries(['name', 'description', 'filter', 'metricDescriptor', 'valueExtractor', 'labelExtractors', 'bucketOptions']
  .filter(key => value[key] !== undefined).map(key => [key, key === 'metricDescriptor' ? Object.fromEntries(['metricKind', 'valueType', 'unit', 'labels']
    .filter(field => value[key][field] !== undefined).map(field => [field, value[key][field]])) : value[key]]));
function policyProjection(value) {
  return { ...Object.fromEntries(['displayName', 'userLabels', 'documentation', 'combiner', 'enabled', 'notificationChannels', 'alertStrategy'].map(key => [key, value[key]])),
    conditions: (value.conditions || []).map(({ name, ...condition }) => condition) };
}
function validatePlan(plan, project) {
  let expected; try { expected = buildAiMonitoringPlan(project, plan?.policies?.[0]?.notificationChannels, plan?.thresholds); }
  catch { throw new MonitoringFailure('invalid_plan'); }
  if (!isDeepStrictEqual(plan, expected) || !plan.notificationReady) throw new MonitoringFailure('unready_or_modified_plan');
  return expected;
}
async function apply(api, submitted) {
  const plan = validatePlan(submitted, api.project); const channels = plan.policies[0].notificationChannels; const canonicalChannels = [];
  for (const channel of channels) {
    const live = await api.request('monitoring', 'GET', `/v3/${channel}`);
    if (!monitoringChannelValid(live.name, api.project, api.number) || live.name.split('/').at(-1) !== channel.split('/').at(-1) ||
        live.enabled === false || live.verificationStatus === 'UNVERIFIED') throw new MonitoringFailure('notification_channel_unavailable');
    canonicalChannels.push(live.name);
  }
  // Every existing resource is inspected before mutation; conflicting ownership prevents partial overwrite.
  const [metrics, policies] = await Promise.all([list(api, 'metrics'), list(api, 'policies')]);
  const selectedMetrics = plan.metrics.map(desired => {
    const found = metrics.filter(row => row.name === desired.name); if (found.length > 1) throw new MonitoringFailure('duplicate_metric');
    if (found[0] && (!String(found[0].description).startsWith(`Managed by ${AI_MONITORING_OWNER}.`) || !isDeepStrictEqual(metricProjection(found[0]).metricDescriptor, desired.metricDescriptor))) {
      throw new MonitoringFailure('metric_ownership_or_schema_conflict');
    }
    return { desired, existing: found[0] };
  });
  const selectedPolicies = plan.policies.map(desired => {
    const found = policies.filter(row => row.userLabels?.managed_by === AI_MONITORING_OWNER && row.userLabels?.policy_key === desired.userLabels.policy_key);
    if (found.length > 1 || policies.some(row => row.displayName === desired.displayName && !found.includes(row))) throw new MonitoringFailure('policy_ownership_conflict');
    if (found[0] && !new RegExp(`^projects/(${api.project}|${api.number})/alertPolicies/[0-9]+$`).test(found[0].name)) throw new MonitoringFailure('policy_binding_mismatch');
    return { desired: { ...desired, notificationChannels: canonicalChannels }, existing: found[0] };
  });
  const result = { v: 1, projectId: api.project, applied: false, pilotVerified: false, mutations: 0, metricsVerified: 0, policiesVerified: 0 };
  for (const { desired, existing } of selectedMetrics) {
    const url = `/v2/projects/${api.project}/metrics/${desired.name}`;
    if (!existing || !isDeepStrictEqual(metricProjection(existing), desired)) {
      await api.request('logging', existing ? 'PUT' : 'POST', existing ? url : `/v2/projects/${api.project}/metrics`, desired); result.mutations++;
    }
    const live = await api.request('logging', 'GET', url);
    if (!isDeepStrictEqual(metricProjection(live), desired)) throw new MonitoringFailure('metric_readback_mismatch'); result.metricsVerified++;
  }
  for (const { desired, existing } of selectedPolicies) {
    let name = existing?.name;
    if (!existing || !isDeepStrictEqual(policyProjection(existing), desired)) {
      const saved = await api.request('monitoring', existing ? 'PATCH' : 'POST', existing ? `/v3/${existing.name}` : `/v3/projects/${api.project}/alertPolicies`,
        existing ? { ...desired, name: existing.name } : desired,
        existing ? { updateMask: 'displayName,userLabels,documentation,conditions,combiner,enabled,notificationChannels,alertStrategy' } : undefined);
      name = saved.name; result.mutations++;
    }
    if (!new RegExp(`^projects/(${api.project}|${api.number})/alertPolicies/[0-9]+$`).test(name || '')) throw new MonitoringFailure('policy_binding_mismatch');
    const live = await api.request('monitoring', 'GET', `/v3/${name}`);
    if (!isDeepStrictEqual(policyProjection(live), desired)) throw new MonitoringFailure('policy_readback_mismatch'); result.policiesVerified++;
  }
  result.applied = true; return result;
}
async function applyChannel(api, plan) {
  let expected; try { expected = buildAiEmailChannelPlan(api.project, plan?.channel?.labels?.email_address); }
  catch { throw new MonitoringFailure('invalid_channel_plan'); }
  if (!isDeepStrictEqual(plan, expected)) throw new MonitoringFailure('modified_channel_plan');
  const rows = await list(api, 'channelAddresses');
  const candidates = rows.filter(row => row.type === 'email' && row.labels?.email_address === expected.channel.labels.email_address);
  if (candidates.length > 1 || (candidates[0] && candidates[0].userLabels?.managed_by !== AI_MONITORING_OWNER)) throw new MonitoringFailure('notification_channel_ownership_conflict');
  let name = candidates[0]?.name; let mutations = 0;
  if (!name) {
    const created = await api.request('monitoring', 'POST', `/v3/projects/${api.project}/notificationChannels`, expected.channel);
    name = created.name; mutations++;
  }
  if (!monitoringChannelValid(name, api.project, api.number)) throw new MonitoringFailure('notification_channel_binding_mismatch');
  const live = await api.request('monitoring', 'GET', `/v3/${name}`);
  if (live.name !== name || live.type !== 'email' || live.labels?.email_address !== expected.channel.labels.email_address ||
      live.userLabels?.managed_by !== AI_MONITORING_OWNER || live.enabled === false) throw new MonitoringFailure('notification_channel_readback_mismatch');
  return { v: 1, projectId: api.project, channelName: name, applied: true, mutations,
    notificationReady: live.verificationStatus !== 'UNVERIFIED', deliveryVerified: false };
}
async function main(values) {
  if (process.versions.node.split('.')[0] !== '22') throw new MonitoringFailure('node22_required');
  const input = args([...values]);
  if (['apply', 'channel-apply'].includes(input.command)) {
    const api = await connect(input.project); const plan = JSON.parse(fs.readFileSync(path.resolve(input.plan), 'utf8').replace(/^\uFEFF/, ''));
    return input.command === 'apply' ? apply(api, plan) : applyChannel(api, plan);
  }
  const output = path.resolve(input.out);
  const report = input.command === 'plan' ? buildAiMonitoringPlan(input.project, input.channels)
    : input.command === 'channel-plan' ? buildAiEmailChannelPlan(input.project, input.email) : await audit(await connect(input.project));
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { command: input.command, projectId: input.project, output, complete: report.complete ?? null, notificationReady: report.notificationReady ?? null, productionMutations: 0 };
}
module.exports = { args, audit, apply, applyChannel, validatePlan, metricProjection, policyProjection, list, MonitoringFailure };
if (require.main === module) main(process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
  process.stderr.write(`${JSON.stringify({ error: error instanceof MonitoringFailure ? error.code : 'monitoring_operation_failed', complete: false })}\n`); process.exitCode = 1;
});
