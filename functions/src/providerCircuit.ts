import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import type { ImageProvider, TextProvider } from './modelPolicy';
import { recordAiCircuitEvent } from './aiOperationalEvents';

export type ProviderChannel = `text_${TextProvider}` | `image_${ImageProvider}`;

export interface ProviderAttempt {
  channel: ProviderChannel;
  leaseId?: string;
}

interface CircuitState {
  failures: number;
  windowStartedAt: number;
  openUntil: number;
  leaseUntil: number;
  leaseId: string | null;
}

export const CIRCUIT_WINDOW_MS = 5 * 60_000;
export const CIRCUIT_COOLDOWN_MS = 2 * 60_000;
export const CIRCUIT_PROBE_LEASE_MS = 30_000;
export const CIRCUIT_FAILURE_THRESHOLD = 3;

const emptyState = (): CircuitState => ({
  failures: 0, windowStartedAt: 0, openUntil: 0, leaseUntil: 0, leaseId: null,
});

function stateFrom(value: unknown): CircuitState {
  if (!value || typeof value !== 'object') return emptyState();
  const data = value as Record<string, unknown>;
  return {
    failures: typeof data.failures === 'number' && Number.isInteger(data.failures) && data.failures >= 0
      ? data.failures : 0,
    windowStartedAt: typeof data.windowStartedAt === 'number' ? data.windowStartedAt : 0,
    openUntil: typeof data.openUntil === 'number' ? data.openUntil : 0,
    leaseUntil: typeof data.leaseUntil === 'number' ? data.leaseUntil : 0,
    leaseId: typeof data.leaseId === 'string' ? data.leaseId : null,
  };
}

export function circuitAfterFailure(current: CircuitState, now: number): CircuitState {
  const withinWindow = current.windowStartedAt > 0 && now - current.windowStartedAt < CIRCUIT_WINDOW_MS;
  const failures = withinWindow ? current.failures + 1 : 1;
  return {
    failures,
    windowStartedAt: withinWindow ? current.windowStartedAt : now,
    openUntil: failures >= CIRCUIT_FAILURE_THRESHOLD ? now + CIRCUIT_COOLDOWN_MS : 0,
    leaseUntil: 0,
    leaseId: null,
  };
}

function circuitRef(channel: ProviderChannel): admin.firestore.DocumentReference {
  return admin.firestore().collection('providerCircuits').doc(channel);
}

/** Fail closed if circuit state cannot be read. Only one probe may enter after cooldown. */
export async function beginProviderAttempt(channel: ProviderChannel, now = Date.now()): Promise<ProviderAttempt | null> {
  const ref = circuitRef(channel);
  try {
    return await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = stateFrom(snap.data());
      if (state.openUntil > now) return null;
      if (state.openUntil > 0) {
        if (state.leaseUntil > now) return null;
        const leaseId = randomUUID();
        tx.set(ref, { ...state, leaseId, leaseUntil: now + CIRCUIT_PROBE_LEASE_MS });
        return { channel, leaseId };
      }
      return { channel };
    });
  } catch {
    return null;
  }
}

/** Release a probe if budget admission fails before the provider is contacted. */
export async function releaseProviderAttempt(attempt: ProviderAttempt): Promise<void> {
  if (!attempt.leaseId) return;
  const ref = circuitRef(attempt.channel);
  try {
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = stateFrom(snap.data());
      if (state.leaseId === attempt.leaseId) {
        tx.set(ref, { ...state, leaseId: null, leaseUntil: 0 });
      }
    });
  } catch {
    // The lease expires after 30 seconds even if release fails.
  }
}

/** A stale response never closes a circuit opened by newer failures. */
export async function finishProviderAttempt(
  attempt: ProviderAttempt, success: boolean, now = Date.now(),
): Promise<void> {
  if (success && !attempt.leaseId) return;
  const ref = circuitRef(attempt.channel);
  try {
    const opened = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = stateFrom(snap.data());
      if (attempt.leaseId) {
        if (state.leaseId !== attempt.leaseId) return false;
        tx.set(ref, success ? emptyState() : {
          ...state,
          failures: CIRCUIT_FAILURE_THRESHOLD,
          openUntil: now + CIRCUIT_COOLDOWN_MS,
          leaseUntil: 0,
          leaseId: null,
        });
        return !success;
      } else if (!success && state.openUntil === 0) {
        const next = circuitAfterFailure(state, now);
        tx.set(ref, next);
        return next.openUntil > 0;
      }
      return false;
    });
    if (opened) recordAiCircuitEvent(attempt.channel, 'circuit_opened');
  } catch {
    // Do not turn a completed provider response into an application failure.
    recordAiCircuitEvent(attempt.channel, 'circuit_write_failed');
  }
}
