import * as admin from 'firebase-admin';
import { AI_MONTHLY_LIMITS, addAiCounters, readAiCounters } from './aiCostPolicy';
import { reserveInternalAiBudget } from './aiBudgetReservations';
export { aiBudgetDocumentId, reserveAiGenerationBudget, isAiGenerationAdmissionLive, AiGenerationAccessError } from './aiBudgetReservations';

export interface BudgetCharge {
  requests: number;
  inputBytes: number;
  reservedInputTokens?: number;
  reservedOutputTokens: number;
  images: number;
  costUnits: number;
}

export const MONTHLY_AI_LIMIT = AI_MONTHLY_LIMITS.preview;

export function nextBudgetUsage(current: BudgetCharge, charge: BudgetCharge): BudgetCharge | null {
  const before = readAiCounters(current, true); const reserved = readAiCounters(charge, true);
  return before && reserved ? addAiCounters(before, reserved, MONTHLY_AI_LIMIT) : null;
}

/** Reservations are atomic and fail closed. Failed provider calls retain the reservation. */
export async function reserveAiBudget(uid: string, charge: BudgetCharge, now = new Date(), db?: admin.firestore.Firestore): Promise<boolean> {
  const counters = readAiCounters(charge, true);
  return counters ? (await reserveInternalAiBudget(uid, counters, now, { kind: 'personal' }, undefined, db)).admitted : false;
}
