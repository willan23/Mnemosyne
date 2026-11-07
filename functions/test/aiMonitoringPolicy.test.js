'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { buildAiMonitoringPlan, buildAiEmailChannelPlan, AI_MONITORING_THRESHOLDS } = require('../lib/aiMonitoringPolicy');
const { args, audit, apply, applyChannel, validatePlan, list } = require('../../scripts/ai-monitoring');
const project = 'mnemosyne-one'; const channel = `projects/${project}/notificationChannels/123`;
function fixture() {
  const metrics = new Map(); const policies = new Map(); const calls = []; let id = 1000;
  const state = { channel: { name: 'projects/456/notificationChannels/123', enabled: true, verificationStatus: 'VERIFIED' }, failMetric: null };
  const api = { project, number: '456', request: async (service, method, resource, data) => {
    calls.push({ service, method, resource });
    if (resource.endsWith('/notificationChannels/123')) return state.channel;
    if (resource.endsWith('/notificationChannels')) return { notificationChannels: [state.channel] };
    if (resource.endsWith('/metrics')) {
      if (method === 'GET') return { metrics: [...metrics.values()] };
      metrics.set(data.name, structuredClone(data));
      if (state.failMetric === data.name) { state.failMetric = null; throw Error('synthetic lost create ACK'); }
      return data;
    }
    if (resource.includes('/metrics/')) {
      const name = resource.split('/').at(-1); if (method === 'PUT') metrics.set(name, structuredClone(data));
      return { ...metrics.get(name), createTime: 'output-only', metricDescriptor: { ...metrics.get(name).metricDescriptor, name: 'output-only', type: 'output-only' } };
    }
    if (resource.endsWith('/alertPolicies')) {
      if (method === 'GET') return { alertPolicies: [...policies.values()] };
      const name = `projects/456/alertPolicies/${id++}`; policies.set(name, { ...structuredClone(data), name }); return { name };
    }
    if (resource.includes('/alertPolicies/')) {
      const name = resource.slice(4); if (method === 'PATCH') policies.set(name, structuredClone(data));
      const value = policies.get(name); return { ...value, creationRecord: { mutateTime: 'output-only' },
        conditions: value.conditions.map((condition, index) => ({ ...condition, name: `${name}/conditions/${index}` })) };
    }
    throw Error('unexpected synthetic request');
  } };
  return { api, metrics, policies, state, calls, writes: () => calls.filter(call => call.method !== 'GET') };
}
test('monitoring plan uses fixed low-cardinality labels, bounded thresholds, project filters and sum of reserved relative units', () => {
  const plan = buildAiMonitoringPlan(project); assert.equal(plan.metrics.length, 5); assert.equal(plan.policies.length, 5);
  assert.equal(plan.notificationReady, false); assert.ok(plan.policies.every(policy => policy.enabled === false && policy.notificationChannels.length === 0));
  const cost = plan.metrics.find(metric => metric.name.includes('reserved_cost')); assert.equal(cost.metricDescriptor.valueType, 'DISTRIBUTION');
  assert.equal(cost.valueExtractor, 'EXTRACT(jsonPayload.costUnitsReserved)');
  for (const metric of plan.metrics) {
    assert.ok(metric.filter.includes(`resource.labels.project_id="${project}"`)); assert.ok(metric.filter.includes('jsonPayload.v=1'));
    assert.ok(metric.metricDescriptor.labels.every(label => ['kind', 'provider', 'scope_kind', 'reason', 'event'].includes(label.key)));
  }
  const costQuery = plan.policies[0].conditions[0].conditionPrometheusQueryLanguage.query;
  assert.ok(costQuery.includes('_sum')); assert.ok(costQuery.includes('[5m]')); assert.ok(costQuery.includes(`>= ${AI_MONITORING_THRESHOLDS.costUnits}`));
  assert.ok(plan.policies.every(policy => policy.conditions[0].conditionPrometheusQueryLanguage.disableMetricValidation === undefined));
  for (const bad of ['other/path', 'secret" OR true', '', null]) assert.throws(() => buildAiMonitoringPlan(bad));
  for (const channels of [['projects/other-project/notificationChannels/123'], [channel, channel], ['https://synthetic.invalid']]) assert.throws(() => buildAiMonitoringPlan(project, channels));
  for (const value of [0, -1, Infinity, '100', 1.5]) assert.throws(() => buildAiMonitoringPlan(project, [], { ...AI_MONITORING_THRESHOLDS, costUnits: value }));
});
test('application validates channels, reads back every resource and is idempotent without mutating other resources', async () => {
  const f = fixture(); const plan = buildAiMonitoringPlan(project, [channel]);
  const first = await apply(f.api, plan); assert.equal(first.applied, true); assert.equal(first.pilotVerified, false); assert.equal(first.mutations, 10);
  assert.equal(first.metricsVerified, 5); assert.equal(first.policiesVerified, 5);
  assert.equal((await apply(f.api, plan)).mutations, 0); assert.equal(f.metrics.size, 5); assert.equal(f.policies.size, 5);
  assert.ok([...f.policies.values()].every(policy => policy.notificationChannels[0] === f.state.channel.name));
  assert.ok(f.calls.every(call => call.resource.startsWith('/v2/projects/mnemosyne-one/') || call.resource.startsWith('/v3/projects/mnemosyne-one/') || call.resource.startsWith('/v3/projects/456/')));
});
test('application resumes after a create ACK is lost without duplicating metrics or policies', async () => {
  const f = fixture(); const plan = buildAiMonitoringPlan(project, [channel]); f.state.failMetric = plan.metrics[1].name;
  await assert.rejects(apply(f.api, plan), /lost create ACK/); assert.equal(f.metrics.size, 2); assert.equal(f.policies.size, 0);
  const resumed = await apply(f.api, plan); assert.equal(resumed.mutations, 8); assert.equal(f.metrics.size, 5); assert.equal(f.policies.size, 5);
});
test('conflicting ownership, descriptor schemas and duplicate policy identities refuse all writes', async () => {
  const plan = buildAiMonitoringPlan(project, [channel]);
  for (const type of ['owner', 'schema', 'policy', 'name']) {
    const f = fixture();
    if (type === 'owner') f.metrics.set(plan.metrics[0].name, { ...plan.metrics[0], description: 'Synthetic unrelated owner' });
    if (type === 'schema') f.metrics.set(plan.metrics[0].name, { ...plan.metrics[0], metricDescriptor: { ...plan.metrics[0].metricDescriptor, valueType: 'DOUBLE' } });
    if (type === 'policy') for (let index = 1; index <= 2; index++) f.policies.set(`projects/456/alertPolicies/${index}`, { ...plan.policies[0], name: `projects/456/alertPolicies/${index}` });
    if (type === 'name') f.policies.set('projects/456/alertPolicies/9', { ...plan.policies[0], userLabels: {}, name: 'projects/456/alertPolicies/9' });
    await assert.rejects(apply(f.api, plan)); assert.equal(f.writes().length, 0);
  }
});
test('unverified, disabled or wrong-bound channels and tampered plans refuse mutation', async () => {
  const plan = buildAiMonitoringPlan(project, [channel]);
  for (const patch of [{ enabled: false }, { verificationStatus: 'UNVERIFIED' }, { name: 'projects/other-project/notificationChannels/123' },
    { name: 'projects/456/notificationChannels/999' }]) {
    const f = fixture(); f.state.channel = { ...f.state.channel, ...patch };
    await assert.rejects(apply(f.api, plan), { code: 'notification_channel_unavailable' }); assert.equal(f.writes().length, 0);
  }
  assert.throws(() => validatePlan(buildAiMonitoringPlan(project), project), { code: 'unready_or_modified_plan' });
  const forged = structuredClone(plan); forged.policies[0].conditions[0].conditionPrometheusQueryLanguage.disableMetricValidation = true;
  assert.throws(() => validatePlan(forged, project), { code: 'unready_or_modified_plan' });
});
test('read-only audit omits channel addresses, labels and policy contents and marks unreadable APIs as unavailable', async () => {
  const f = fixture(); f.state.channel = { ...f.state.channel, type: 'email', displayName: 'synthetic-private-email@example.invalid', labels: { email_address: 'synthetic-private-email@example.invalid', token: 'synthetic-secret' } };
  f.metrics.set('unrelated-metric', { name: 'unrelated-metric', description: 'synthetic-private-content' });
  const read = f.api.request; f.api.request = async (...values) => { if (values[2].endsWith('/alertPolicies')) throw Object.assign(Error('synthetic private API body'), { code: 'http_403' }); return read(...values); };
  const report = await audit(f.api); assert.equal(report.productionMutations, 0); assert.equal(f.writes().length, 0); assert.equal(report.complete, false);
  assert.equal(report.inventories.policies.readable, false); assert.equal(report.inventories.policies.total, undefined);
  assert.equal(report.inventories.channels.total, 1); assert.deepEqual(report.inventories.metrics.managedNames, []);
  assert.equal(JSON.stringify(report).includes('synthetic-private'), false); assert.equal(JSON.stringify(report).includes('synthetic-secret'), false);
});
test('inventory refuses pagination cycles and excess pages, and CLI never takes an implicit global project', async () => {
  let calls = 0; const api = { project, request: async () => { calls++; return { metrics: [], nextPageToken: 'same-token' }; } };
  await assert.rejects(list(api, 'metrics'), { code: 'invalid_cursor' }); assert.equal(calls, 2);
  assert.throws(() => args(['audit', '--out', 'synthetic.json']), { code: 'explicit_project_required' });
  assert.throws(() => args(['apply', '--project', project, '--plan', 'synthetic.json']), { code: 'apply_context_required' });
  assert.throws(() => args(['audit', '--project', project, '--out', 'synthetic.json', '--apply', 'yes']), { code: 'invalid_arguments' });
});
test('email channel bootstrap resumes a lost create ACK without duplicating the human-selected recipient or claiming delivery', async () => {
  const plan = buildAiEmailChannelPlan(project, 'synthetic-operator@example.invalid'); let saved; let writes = 0; let fail = true;
  const api = { project, number: '456', request: async (_service, method, resource, data) => {
    if (resource.endsWith('/notificationChannels') && method === 'GET') return { notificationChannels: saved ? [saved] : [] };
    if (resource.endsWith('/notificationChannels') && method === 'POST') {
      writes++; saved = { ...data, name: 'projects/456/notificationChannels/123', verificationStatus: 'UNVERIFIED' };
      if (fail) { fail = false; throw Error('synthetic channel ACK lost'); } return saved;
    }
    return saved;
  } };
  await assert.rejects(applyChannel(api, plan), /ACK lost/);
  const resumed = await applyChannel(api, plan); assert.equal(writes, 1); assert.equal(resumed.mutations, 0);
  assert.equal(resumed.notificationReady, false); assert.equal(resumed.deliveryVerified, false);
  assert.equal(JSON.stringify(resumed).includes(plan.channel.labels.email_address), false);
});
test('channel preparation rejects ambiguous recipients and bootstrap preserves an existing unowned channel', async () => {
  for (const email of ['synthetic-secret', 'test@example.invalid\nprivate', 'test@other..invalid', 'test@-other.invalid', 'test@other.invalid/secret']) {
    assert.throws(() => buildAiEmailChannelPlan(project, email));
  }
  const plan = buildAiEmailChannelPlan(project, 'synthetic-operator@example.invalid'); let writes = 0;
  const api = { project, number: '456', request: async (_service, method) => {
    if (method !== 'GET') writes++;
    return { notificationChannels: [{ ...plan.channel, name: 'projects/456/notificationChannels/123', userLabels: {} }] };
  } };
  await assert.rejects(applyChannel(api, plan), { code: 'notification_channel_ownership_conflict' }); assert.equal(writes, 0);
  assert.throws(() => args(['channel-plan', '--project', project, '--out', 'synthetic.json']), { code: 'output_context_required' });
});
