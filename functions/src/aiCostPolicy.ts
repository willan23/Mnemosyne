/** Pure server cost/admission contract. No provider calls or billing mutations. */
import { attachmentActorIdValid, attachmentIdValid } from './attachmentEnvelope';

export type AiPlan = 'preview' | 'free' | 'pro' | 'sovereign';
export type AiGenerationKind = 'text' | 'image';
export type AiGenerationScope = { kind: 'personal' } | { kind: 'team'; teamId: string; keyEpoch: number; keyId: string };
export interface AiBudgetCounters {
  requests: number; inputBytes: number; reservedInputTokens: number;
  reservedOutputTokens: number; images: number; costUnits: number;
}
export const AI_COUNTER_KEYS = ['requests', 'inputBytes', 'reservedInputTokens', 'reservedOutputTokens', 'images', 'costUnits'] as const;
export const AI_INPUT_OVERHEAD_RESERVATION = 512;
export const AI_COST_POLICY_VERSION = 2;
const standard = (): AiBudgetCounters => ({ requests: 200, inputBytes: 300_000, reservedInputTokens: 402_400,
  reservedOutputTokens: 100_000, images: 20, costUnits: 200 });
// Technical ceilings, not prices. Pro/Sovereign do not increase the previous per-user cost ceiling.
export const AI_MONTHLY_LIMITS: Record<AiPlan, AiBudgetCounters> = {
  preview: standard(), free: { requests: 50, inputBytes: 75_000, reservedInputTokens: 100_600,
    reservedOutputTokens: 25_000, images: 0, costUnits: 50 }, pro: standard(), sovereign: standard(),
};
export const AI_HOURLY_LIMIT: AiBudgetCounters = { requests: 60, inputBytes: 100_000, reservedInputTokens: 130_720,
  reservedOutputTokens: 60_000, images: 20, costUnits: 100 };
export const emptyAiCounters = (): AiBudgetCounters => ({ requests: 0, inputBytes: 0, reservedInputTokens: 0,
  reservedOutputTokens: 0, images: 0, costUnits: 0 });

export function parseAiGenerationScope(value: unknown): AiGenerationScope | null {
  if (value === undefined) return { kind: 'personal' }; // Older personal clients.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>; const keys = Object.keys(data).sort().join(',');
  if (data.kind === 'personal' && keys === 'kind') return { kind: 'personal' };
  if (data.kind === 'team' && keys === 'keyEpoch,keyId,kind,teamId' && attachmentActorIdValid(data.teamId) &&
      Number.isSafeInteger(data.keyEpoch) && (data.keyEpoch as number) >= 1 && attachmentIdValid(data.keyId)) {
    return { kind: 'team', teamId: data.teamId, keyEpoch: data.keyEpoch as number, keyId: data.keyId };
  }
  return null;
}

/** Never trust subscription fields on the writable user profile. */
export function resolveAiPlan(monetization: unknown, entitlement: unknown): AiPlan | null {
  if (monetization !== undefined && (!monetization || typeof monetization !== 'object' || Array.isArray(monetization))) return null;
  const config = monetization as { mode?: unknown } | undefined;
  if (config === undefined || config.mode === undefined || config.mode === 'free-first') return 'preview';
  if (config.mode !== 'paid') return null;
  if (entitlement === undefined) return 'free';
  if (!entitlement || typeof entitlement !== 'object' || Array.isArray(entitlement)) return null;
  const data = entitlement as Record<string, unknown>;
  if (!['free', 'pro', 'sovereign'].includes(data.effectiveTier as string) || typeof data.status !== 'string') return null;
  if (data.effectiveTier !== 'free' && !['active', 'trialing', 'past_due'].includes(data.status)) return null;
  return data.effectiveTier as AiPlan;
}

export function addAiCounters(current: AiBudgetCounters, charge: AiBudgetCounters, limit: AiBudgetCounters): AiBudgetCounters | null {
  const next = emptyAiCounters();
  for (const key of AI_COUNTER_KEYS) {
    if ([current[key], charge[key], limit[key]].some(value => !Number.isSafeInteger(value) || value < 0)) return null;
    const sum = current[key] + charge[key];
    if (!Number.isSafeInteger(sum) || sum > limit[key]) return null;
    next[key] = sum;
  }
  return next;
}

/** Legacy requests have no tokenizer count: reserve bytes plus bounded chat framing per request.
 * These are conservative token units, never represented as provider billing/actual token usage. */
export function readAiCounters(value: unknown, legacy = false): AiBudgetCounters | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data);
  if (keys.some(key => !AI_COUNTER_KEYS.includes(key as typeof AI_COUNTER_KEYS[number]))) return null;
  const result = emptyAiCounters();
  for (const key of AI_COUNTER_KEYS) {
    const counter = key === 'reservedInputTokens' && legacy && data[key] === undefined
      ? Number(data.inputBytes) + Number(data.requests) * AI_INPUT_OVERHEAD_RESERVATION : data[key];
    if (!Number.isSafeInteger(counter) || (counter as number) < 0) return null;
    result[key] = counter as number;
  }
  return result;
}
