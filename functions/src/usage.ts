/**
 * Server-side memory usage accounting (memories created per calendar month, UTC).
 *
 * Design (documented in docs/AUDIT_FIXES_2026-08-31.md):
 * - `users/{uid}.usage` holds { memoriesThisMonth, periodYear, periodMonth }.
 *   It is Admin-SDK-only (firestore.rules block client writes to `usage`).
 * - A Firestore onCreate trigger on sessions/{id} increments the counter in a
 *   transaction with an immutable memoryUsageReceipts/{sessionId} receipt.
 *   Initial attached-memory creation charges usage and creates that receipt in
 *   its own transaction; the trigger then verifies it and does not charge again.
 *   The counter rolls over automatically when the UTC month of
 *   the stored period differs from the current one.
 * - firestore.rules validate session creation against this counter for free
 *   tier users when paid enforcement mode is on (config/monetization.mode ==
 *   'paid'), using request.time.year()/month() so a stale counter from a past
 *   month never blocks a user.
 * - A monthly scheduled function resets counters as hygiene; correctness does
 *   not depend on it because both the trigger and the rules are period-aware.
 */

export interface UsageState {
    memoriesThisMonth: number;
    periodYear: number;
    periodMonth: number; // 1-12, matches request.time.month() in security rules
}

export function currentPeriod(now: Date = new Date()): { periodYear: number; periodMonth: number } {
    return {
        periodYear: now.getUTCFullYear(),
        periodMonth: now.getUTCMonth() + 1,
    };
}

/** Compute the next usage state after one memory creation. Pure/testable. */
export function nextUsageAfterMemoryCreate(previous: unknown, now: Date = new Date()): UsageState {
    const { periodYear, periodMonth } = currentPeriod(now);
    const prev = (typeof previous === 'object' && previous !== null ? previous : {}) as Record<string, unknown>;

    const samePeriod = prev.periodYear === periodYear && prev.periodMonth === periodMonth;
    const previousCount = typeof prev.memoriesThisMonth === 'number' && Number.isFinite(prev.memoriesThisMonth)
        ? Math.max(0, Math.floor(prev.memoriesThisMonth))
        : 0;

    return {
        memoriesThisMonth: samePeriod ? previousCount + 1 : 1,
        periodYear,
        periodMonth,
    };
}

/** Usage count valid for the current period (stale periods count as zero). */
export function memoriesUsedInCurrentPeriod(usage: unknown, now: Date = new Date()): number {
    const { periodYear, periodMonth } = currentPeriod(now);
    const data = (typeof usage === 'object' && usage !== null ? usage : {}) as Record<string, unknown>;
    if (data.periodYear !== periodYear || data.periodMonth !== periodMonth) return 0;
    return typeof data.memoriesThisMonth === 'number' && Number.isFinite(data.memoriesThisMonth)
        ? Math.max(0, Math.floor(data.memoriesThisMonth))
        : 0;
}
