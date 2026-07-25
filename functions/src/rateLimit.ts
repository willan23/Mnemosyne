/**
 * Rate limit server-side (sliding window) em Firestore.
 * Usado pelas HTTP Functions públicas (web research, generate text/image).
 */

import * as admin from 'firebase-admin';

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

/** Extrai chave de cliente (IP preferencial; fallback Authorization hash). */
export function clientKeyFromRequest(req: {
  headers?: Record<string, unknown>;
  ip?: string;
}): string {
  const headers = req.headers || {};
  const forwarded = String(headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '')
    .split(',')[0]
    .trim();
  const realIp = String(headers['x-real-ip'] || headers['X-Real-IP'] || '').trim();
  const ip = forwarded || realIp || req.ip || 'unknown';
  const auth = String(headers.authorization || headers.Authorization || '').slice(0, 48);
  return auth ? `${ip}:${auth.length}` : ip;
}

/**
 * Consome 1 slot. Atomicidade best-effort via transaction.
 * Documentos: rateLimits/{bucket}__{hash(clientKey)}
 */
export async function consumeServerRateLimit(
  clientKey: string,
  config: RateLimitConfig,
  now = Date.now(),
): Promise<RateLimitDecision> {
  const safeClient = clientKey.replace(/[^\w.:-]/g, '_').slice(0, 120) || 'unknown';
  const docId = `${config.bucket}__${safeClient}`.slice(0, 700);
  const ref = getDb().collection(collectionName).doc(docId);

  try {
    return await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() || {} : {};
      const hits: number[] = Array.isArray(data.hits)
        ? (data.hits as unknown[]).filter((n): n is number => typeof n === 'number')
        : [];
      const fresh = hits.filter((ts) => now - ts < config.windowMs);

      if (fresh.length >= config.max) {
        const oldest = Math.min(...fresh);
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, config.windowMs - (now - oldest)),
          key: docId,
        };
      }

      fresh.push(now);
      tx.set(ref, {
        bucket: config.bucket,
        clientKey: safeClient,
        hits: fresh.slice(-config.max * 2),
        updatedAt: now,
        expiresAt: now + config.windowMs * 2,
      }, { merge: true });

      return {
        allowed: true,
        remaining: Math.max(0, config.max - fresh.length),
        retryAfterMs: 0,
        key: docId,
      };
    });
  } catch (error) {
    // Fail-open controlado: se Firestore falhar, permite mas loga
    console.warn('rateLimit transaction failed, allowing request:', error);
    return {
      allowed: true,
      remaining: config.max,
      retryAfterMs: 0,
      key: docId,
    };
  }
}

/** Defaults Mnemosyne fair-use server-side */
export const RATE_LIMITS = {
  webResearch: { bucket: 'web-research', max: 40, windowMs: 60 * 60 * 1000 },
  generateText: { bucket: 'generate-text', max: 60, windowMs: 60 * 60 * 1000 },
  generateImage: { bucket: 'generate-image', max: 20, windowMs: 60 * 60 * 1000 },
} as const;
