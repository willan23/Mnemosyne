/** Declarative Cloud Logging/Monitoring plan. No credentials or cloud mutations. */
export const AI_MONITORING_VERSION = 1;
export const AI_MONITORING_OWNER = 'mnemosyne-ai-v1';
export const AI_MONITORING_THRESHOLDS = { costUnits: 100, refusals: 20, providerFailures: 5, admissionFailures: 3 } as const;
export type AiMonitoringThresholds = { [K in keyof typeof AI_MONITORING_THRESHOLDS]: number };
export function monitoringProjectValid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
}
export function monitoringChannelValid(value: unknown, project: string, projectNumber?: string): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^projects\/([^/]+)\/notificationChannels\/([0-9]+)$/.exec(value);
  return Boolean(parts && (parts[1] === project || (projectNumber && parts[1] === projectNumber)));
}
export function buildAiEmailChannelPlan(project: string, email: string) {
  if (!monitoringProjectValid(project) || typeof email !== 'string' || email.length > 254 ||
      !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email) ||
      email.split('@')[1].split('.').some(label => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) {
    throw Error('Invalid notification channel context');
  }
  const [local, domain] = email.split('@');
  return { v: 1, projectId: project, channel: { type: 'email', displayName: 'Mnemosyne AI operations',
    description: `Managed by ${AI_MONITORING_OWNER}. Human-selected operational recipient.`,
    labels: { email_address: `${local}@${domain.toLowerCase()}` }, userLabels: { managed_by: AI_MONITORING_OWNER }, enabled: true },
    applied: false, deliveryVerified: false };
}
export function buildAiMonitoringPlan(project: string, channels: string[] = [], thresholds: AiMonitoringThresholds = { ...AI_MONITORING_THRESHOLDS }) {
  if (!monitoringProjectValid(project) || !Array.isArray(channels) || channels.length > 10 ||
      new Set(channels).size !== channels.length || channels.some(channel => !monitoringChannelValid(channel, project)) ||
      !thresholds || Object.keys(thresholds).sort().join(',') !== Object.keys(AI_MONITORING_THRESHOLDS).sort().join(',') ||
      Object.values(thresholds).some(value => !Number.isSafeInteger(value) || value < 1 || value > 1_000_000)) throw Error('Invalid monitoring plan context');
  const base = '(resource.type="cloud_function" OR resource.type="cloud_run_revision")\n' +
    `resource.labels.project_id="${project}"\njsonPayload.component="mnemosyne-ai"\njsonPayload.v=1`;
  const labels = [
    { key: 'kind', valueType: 'STRING', description: 'Server-defined text or image.' },
    { key: 'provider', valueType: 'STRING', description: 'Server-defined provider or unknown.' },
    { key: 'scope_kind', valueType: 'STRING', description: 'Personal, team or unknown; no identity.' },
  ];
  const extractors = { kind: 'EXTRACT(jsonPayload.kind)', provider: 'EXTRACT(jsonPayload.provider)', scope_kind: 'EXTRACT(jsonPayload.scopeKind)' };
  const counter = (name: string, event: string, extraLabel?: { key: string; field: string }) => ({
    name: `mnemosyne_ai_${name}_v1`, description: `Managed by ${AI_MONITORING_OWNER}. Counts ${event} events; not provider billing.`,
    filter: `${base}\njsonPayload.event="${event}"`, metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1',
      labels: extraLabel ? [...labels, { key: extraLabel.key, valueType: 'STRING', description: 'Fixed server outcome category.' }] : labels },
    labelExtractors: extraLabel ? { ...extractors, [extraLabel.key]: `EXTRACT(jsonPayload.${extraLabel.field})` } : extractors,
  });
  const circuits = { ...counter('circuits', 'circuit_opened', { key: 'event', field: 'event' }),
    filter: `${base}\n(jsonPayload.event="circuit_opened" OR jsonPayload.event="circuit_write_failed")` };
  const metrics = [counter('reservations', 'reservation'), {
    name: 'mnemosyne_ai_reserved_cost_units_v1', description: `Managed by ${AI_MONITORING_OWNER}. Reserved relative technical units; never currency or actual billing.`,
    filter: `${base}\njsonPayload.event="reservation"\njsonPayload.costUnitsReserved>0`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'DISTRIBUTION', unit: '1', labels },
    valueExtractor: 'EXTRACT(jsonPayload.costUnitsReserved)', labelExtractors: extractors,
    bucketOptions: { explicitBuckets: { bounds: [1, 2, 10, 20, 21] } },
  }, counter('outcomes', 'outcome', { key: 'reason', field: 'reason' }), counter('provider_attempts', 'provider_attempt'),
  circuits];
  const selector = (name: string, extra = '') => `{"logging.googleapis.com/user/mnemosyne_ai_${name}_v1",` +
    `monitored_resource=~"cloud_function|cloud_run_revision",project_id="${project}"${extra}}`;
  // Cloud Monitoring exposes distribution sums through the PromQL _sum suffix.
  const sum = (name: string, extra = '') => `sum(increase(${selector(name, extra)}[5m]))`;
  const costSelector = `{"logging.googleapis.com/user/mnemosyne_ai_reserved_cost_units_v1_sum",` +
    `monitored_resource=~"cloud_function|cloud_run_revision",project_id="${project}"}`;
  const definitions = [
    { key: 'cost-spike', query: `sum(increase(${costSelector}[5m])) >= ${thresholds.costUnits}`,
      title: 'Reserved relative cost spike', action: 'Inspect reservation rate and model distribution. Units are relative reservations, not money or actual provider tokens. Reconcile provider billing separately.' },
    { key: 'refusal-spike', query: `${sum('outcomes', ',reason=~"auth_required|invalid_request|rate_limited|budget_exhausted|admission_denied"')} >= ${thresholds.refusals}`,
      title: 'Generation refusal spike', action: 'Inspect fixed refusal categories and current rollout. Refusal volume is a signal to investigate, not proof of malicious activity. Never log prompts, identities, tokens or raw errors.' },
    { key: 'provider-failure', query: `${sum('outcomes', ',reason="provider_failed"')} >= ${thresholds.providerFailures}`,
      title: 'Repeated provider failures', action: 'Check provider health, approved model availability and server secrets. Keep circuit and budget controls active; do not enable a fallback provider.' },
    { key: 'circuit-open', query: `${sum('circuits', ',event="circuit_opened"')} >= 1`, title: 'Provider circuit opened',
      action: 'Check provider status and recovery probe. A single approved probe resumes service after cooldown; stale responses must not close a newer circuit.' },
    { key: 'admission-failure', query: `(${sum('outcomes', ',reason=~"budget_unavailable|handler_failed"')} or vector(0)) + ` +
      `(${sum('circuits', ',event="circuit_write_failed"')} or vector(0)) >= ${thresholds.admissionFailures}`,
      title: 'Admission infrastructure unavailable', action: 'Check Firestore admission/counter schema, transaction failures and runtime. Preserve reservations and fail-closed access. Do not erase ambiguous legacy usage to restore availability.' },
  ];
  const policies = definitions.map(item => ({
    displayName: `Mnemosyne AI v1 — ${item.title}`, userLabels: { managed_by: AI_MONITORING_OWNER, policy_key: item.key },
    documentation: { content: `${item.action}\n\nProject: ${project}. Window: 5 minutes. Defaults require pilot calibration. No personal identifiers in metric labels.`, mimeType: 'text/markdown' },
    conditions: [{ displayName: item.title, conditionPrometheusQueryLanguage: { query: item.query, duration: '0s', evaluationInterval: '60s' } }],
    combiner: 'OR', enabled: channels.length > 0, notificationChannels: channels,
    alertStrategy: { autoClose: '1800s' },
  }));
  return { v: AI_MONITORING_VERSION, projectId: project, thresholds, metrics, policies,
    notificationReady: channels.length > 0, applied: false, pilotVerified: false };
}
