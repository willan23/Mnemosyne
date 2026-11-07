/**
 * Rate limit server-side (sliding window) em Firestore.
 * Usado pelas HTTP Functions públicas (web research, generate text/image).
 */

import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { liveAccountInTransaction } from './accountAccess';

export interface RateLimitConfig {
  /** Identificador lógico do endpoint */
  bucket: string;
  /** Máximo de pedidos na janela */
  max: number;
  /** Janela em ms */
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  key: string;
}

const collectionName = 'rateLimits';

const getDb = () => admin.firestore();

/**
 * Chave de cliente para rate limit.
 * Prefer authenticated UID; otherwise platform IP only (never client-spoofed XFF).
 */
export function clientKeyFromRequest(req: {
  headers?: Record<string, unknown>;
  ip?: string;
}, uid?: string | null): string {
  if (uid && uid.trim()) {
    return `uid:${uid.trim()}`;
  }
  // Firebase Functions / Cloud Run set req.ip from the trusted proxy chain.
  const ip = (req.ip || 'unknown').trim() || 'unknown';
  return `ip:${ip}`;
}

export interface SlidingWindowResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  /** Hits to persist (only meaningful when allowed). */
  hits: number[];
}

/**
 * Pure sliding-window evaluation, exported so unit tests exercise the exact
 * production logic (no reimplementation in test files).
 */
export function evaluateSlidingWindow(
  hits: number[],
  config: Pick<RateLimitConfig, 'max' | 'windowMs'>,
  now = Date.now(),
): SlidingWindowResult {
  const fresh = hits
    .filter((ts): ts is number => typeof ts === 'number')
    .filter((ts) => now - ts < config.windowMs);

  if (fresh.length >= config.max) {
    const oldest = Math.min(...fresh);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, config.windowMs - (now - oldest)),
      hits: fresh,
    };
  }

  const next = [...fresh, now];
  return {
    allowed: true,
    remaining: Math.max(0, config.max - next.length),
    retryAfterMs: 0,
    hits: next,
  };
}

/**
 * Consome 1 slot. Atomicidade best-effort via transaction.
 * Fail-closed: se Firestore falhar, nega o pedido.
 */
export async function consumeServerRateLimit(
  clientKey: string,
  config: RateLimitConfig,
  now = Date.now(),
): Promise<RateLimitDecision> {
  const safeClient = clientKey.replace(/[^\w.:-]/g, '_').slice(0, 120) || 'unknown';
  const authenticated = clientKey.startsWith('uid:');
  const storedClient = authenticated ? clientKey : safeClient;
  const docId = `${config.bucket}__${authenticated ? createHash('sha256').update(clientKey).digest('hex') : safeClient}`.slice(0, 700);
  const ref = getDb().collection(collectionName).doc(docId);

  try {
    return await getDb().runTransaction(async (tx) => {
      // Desktop registration can precede profile initialization; the permanent deletion marker still denies it.
      if (authenticated && !await liveAccountInTransaction(tx, getDb(), clientKey.slice(4), false)) {
        return { allowed: false, remaining: 0, retryAfterMs: 30000, key: docId };
      }
      const snap = await tx.get(ref);
      // Preserve the existing window only when the old sanitization was lossless; ambiguous legacy IDs need an inventory.
      const legacy = authenticated && !snap.exists && storedClient === safeClient
        ? await tx.get(getDb().collection(collectionName).doc(`${config.bucket}__${safeClient}`.slice(0, 700))) : null;
      const data = snap.exists ? snap.data() || {} : legacy?.exists ? legacy.data() || {} : {};
      if (snap.exists && data.clientKey !== storedClient) return { allowed: false, remaining: 0, retryAfterMs: 30000, key: docId };
      if (legacy?.exists && data.clientKey !== storedClient) return { allowed: false, remaining: 0, retryAfterMs: 30000, key: docId };
      const hits: number[] = Array.isArray(data.hits)
        ? (data.hits as unknown[]).filter((n): n is number => typeof n === 'number')
        : [];

      const decision = evaluateSlidingWindow(hits, config, now);
      if (!decision.allowed) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: decision.retryAfterMs,
          key: docId,
        };
      }

      tx.set(ref, {
        bucket: config.bucket,
        clientKey: storedClient,
        hits: decision.hits.slice(-config.max * 2),
        updatedAt: now,
        expiresAt: now + config.windowMs * 2,
      }, { merge: true });
      if (legacy?.exists) tx.delete(legacy.ref);

      return {
        allowed: true,
        remaining: decision.remaining,
        retryAfterMs: 0,
        key: docId,
      };
    });
  } catch {
    console.error('rateLimit transaction failed, denying request (fail-closed)');
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: 30_000,
      key: docId,
    };
  }
}

/** Defaults Mnemosyne fair-use server-side (per authenticated UID) */
export const RATE_LIMITS = {
  webResearch: { bucket: 'web-research', max: 40, windowMs: 60 * 60 * 1000 },
  generateText: { bucket: 'generate-text', max: 60, windowMs: 60 * 60 * 1000 },
  generateImage: { bucket: 'generate-image', max: 20, windowMs: 60 * 60 * 1000 },
  publicApi: { bucket: 'public-api-v1', max: 120, windowMs: 60 * 60 * 1000 },
} as const;
