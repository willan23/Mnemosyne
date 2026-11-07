import { randomUUID } from 'node:crypto';
import { logger } from 'firebase-functions/logger';
import type * as functions from 'firebase-functions/v1';
import { attachmentIdValid } from './attachmentEnvelope';
import { AI_COST_POLICY_VERSION, AI_INPUT_OVERHEAD_RESERVATION, type AiGenerationKind } from './aiCostPolicy';
import { resolveImageModel, resolveTextModel } from './modelPolicy';

export const AI_OPERATIONAL_COMPONENT = 'mnemosyne-ai';
const statuses = {
  success: 200, auth_required: 401, invalid_request: 400, access_changed: 403, account_unavailable: 403,
  admission_denied: 403, budget_exhausted: 429, budget_unavailable: 503, rate_limited: 429,
  circuit_unavailable: 503, provider_rejected: 422, provider_failed: 503, method_not_allowed: 405, handler_failed: 500,
} as const;
export type AiOutcomeReason = keyof typeof statuses;
type EventKind = 'reservation' | 'provider_attempt' | 'outcome' | 'circuit_opened' | 'circuit_write_failed';
const baseKeys = ['v', 'component', 'event', 'operationId', 'kind', 'provider', 'modelId', 'scopeKind', 'at'];
const reservationKeys = ['policyVersion', 'inputBytes', 'inputTokenUnitsReserved', 'outputTokensReserved', 'imagesReserved', 'costUnitsReserved'];
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) &&
  (value as number) >= 0 && (value as number) <= maximum;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Exact schema, bounded labels and model-derived amounts. Never accept an Error, request or arbitrary strings. */
export function buildAiOperationalEvent(value: unknown): Record<string, unknown> | null {
  if (!record(value) || value.v !== 1 || value.component !== AI_OPERATIONAL_COMPONENT || !attachmentIdValid(value.operationId) ||
      !['text', 'image'].includes(value.kind as string) || !integer(value.at) ||
      !['personal', 'team', 'unknown'].includes(value.scopeKind as string)) return null;
  const event = value.event as EventKind;
  if (!['reservation', 'provider_attempt', 'outcome', 'circuit_opened', 'circuit_write_failed'].includes(event)) return null;
  const extra = event === 'reservation' ? reservationKeys : event === 'outcome' ? ['reason', 'httpStatus', 'durationMs'] : [];
  const keys = [...baseKeys, ...extra];
  if (Object.keys(value).length !== keys.length || !keys.every(key => has(value, key))) return null;
  const model = typeof value.modelId === 'string' && value.modelId !== 'unknown'
    ? value.kind === 'text' ? resolveTextModel(value.modelId) : resolveImageModel(value.modelId) : null;
  if (model ? value.modelId !== model.id || value.provider !== model.provider :
      value.modelId !== 'unknown' || !['unknown', 'huggingface', 'nvidia', 'openai', 'gemini', 'openrouter'].includes(value.provider as string)) return null;
  if ((event === 'reservation' || event === 'provider_attempt') && (!model || value.scopeKind === 'unknown')) return null;
  if ((event === 'circuit_opened' || event === 'circuit_write_failed') &&
      (value.modelId !== 'unknown' || value.provider === 'unknown' || value.scopeKind !== 'unknown')) return null;
  if (event === 'reservation' && (!model || value.policyVersion !== AI_COST_POLICY_VERSION ||
      !integer(value.inputBytes, 16_000) || value.inputBytes < 1 ||
      value.inputTokenUnitsReserved !== value.inputBytes + AI_INPUT_OVERHEAD_RESERVATION ||
      value.costUnitsReserved !== model.costUnitsPerRequest || value.imagesReserved !== (value.kind === 'image' ? 1 : 0) ||
      !integer(value.outputTokensReserved) || (value.kind === 'text' ? value.outputTokensReserved < 64 ||
        value.outputTokensReserved > ('maxOutputTokens' in model ? model.maxOutputTokens : 0) : value.outputTokensReserved !== 0))) return null;
  if (event === 'outcome' && (typeof value.reason !== 'string' || !has(statuses, value.reason) ||
      value.httpStatus !== statuses[value.reason as AiOutcomeReason] || !integer(value.durationMs, 86_400_000))) return null;
  if (event === 'outcome' && ['success', 'provider_failed', 'provider_rejected'].includes(value.reason as string) &&
      (!model || value.scopeKind === 'unknown')) return null;
  // Copy scalar fields only; none of the callers' other objects survive this boundary.
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
export interface AiOperationalSink { write: (entry: Record<string, unknown>) => void; now: () => number; id: () => string }
const defaults = (): AiOperationalSink => ({ write: entry => logger.write(entry as Parameters<typeof logger.write>[0]), now: Date.now, id: randomUUID });
function emit(value: Record<string, unknown>, sink: AiOperationalSink) {
  const entry = buildAiOperationalEvent(value); if (!entry) return;
  const severity = entry.event === 'circuit_write_failed' || entry.reason === 'provider_failed' || entry.reason === 'handler_failed' ? 'ERROR'
    : entry.event === 'circuit_opened' || (entry.event === 'outcome' && entry.reason !== 'success') ? 'WARNING' : 'INFO';
  try { sink.write({ ...entry, severity, message: 'Mnemosyne AI operational event.' }); }
  catch { /* Telemetry failure must not retry an already charged/provider operation. */ }
}

export function createAiOperation(kind: AiGenerationKind, sink = defaults()) {
  const started = sink.now(); const operationId = sink.id();
  let bound: { provider: string; modelId: string; scopeKind: string } = { provider: 'unknown', modelId: 'unknown', scopeKind: 'unknown' };
  let inputBytes = 0; let reserved = false; let attempted = false; let closed = false;
  const base = (event: EventKind) => ({ v: 1, component: AI_OPERATIONAL_COMPONENT, operationId, kind, ...bound, event, at: sink.now() });
  const finish = (reason: AiOutcomeReason) => {
    if (closed) return; closed = true;
    emit({ ...base('outcome'), reason, httpStatus: statuses[reason], durationMs: Math.min(86_400_000, Math.max(0, sink.now() - started)) }, sink);
  };
  return {
    bind: (modelId: string, scopeKind: 'personal' | 'team', bytes: number) => {
      if (closed || reserved || attempted || !integer(bytes, 16_000) || bytes < 1 || !['personal', 'team'].includes(scopeKind)) return;
      const model = kind === 'text' ? resolveTextModel(modelId) : resolveImageModel(modelId);
      if (!model || model.id !== modelId) return;
      bound = { provider: model.provider, modelId: model.id, scopeKind }; inputBytes = bytes;
    },
    reservation: (outputTokens: number) => {
      if (closed || reserved || bound.modelId === 'unknown') return;
      const model = kind === 'text' ? resolveTextModel(bound.modelId)! : resolveImageModel(bound.modelId)!;
      const value = { ...base('reservation'), policyVersion: AI_COST_POLICY_VERSION, inputBytes,
        inputTokenUnitsReserved: inputBytes + AI_INPUT_OVERHEAD_RESERVATION, outputTokensReserved: outputTokens,
        imagesReserved: kind === 'image' ? 1 : 0, costUnitsReserved: model.costUnitsPerRequest };
      if (!buildAiOperationalEvent(value)) return;
      reserved = true; emit(value, sink);
    },
    providerAttempt: () => { if (closed || attempted || !reserved) return; attempted = true; emit(base('provider_attempt'), sink); },
    finish,
    ensureClosed: () => { if (!closed) finish('handler_failed'); },
  };
}
export type AiOperation = ReturnType<typeof createAiOperation>;
/** Cover unexpected handler exceptions with a fixed event; keep the original HTTP exception semantics. */
export function observeAiHandler(kind: AiGenerationKind,
  handler: (req: functions.Request, res: functions.Response, operation: AiOperation) => Promise<void>) {
  return async (req: functions.Request, res: functions.Response): Promise<void> => {
    const operation = createAiOperation(kind);
    try { await handler(req, res, operation); }
    finally { if (req.method !== 'OPTIONS') operation.ensureClosed(); }
  };
}
export function recordAiCircuitEvent(channel: string, event: 'circuit_opened' | 'circuit_write_failed', sink = defaults()) {
  const match = /^(text|image)_(huggingface|nvidia|openai|gemini|openrouter)$/.exec(channel); if (!match) return;
  emit({ v: 1, component: AI_OPERATIONAL_COMPONENT, operationId: sink.id(), kind: match[1], provider: match[2], modelId: 'unknown',
    scopeKind: 'unknown', at: sink.now(), event }, sink);
}
