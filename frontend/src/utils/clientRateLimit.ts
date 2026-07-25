/**
 * Rate limit client-side genérico (sliding window em localStorage).
 * Complementa fair-use; não substitui App Check / quotas server-side.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface RateWindow {
  hits: number[];
}

const storageKey = (bucket: string) => `mnemosyne.rate.${bucket}`;

function readWindow(bucket: string): RateWindow {
  try {
    const raw = localStorage.getItem(storageKey(bucket));
    if (!raw) return { hits: [] };
    const parsed = JSON.parse(raw) as RateWindow;
    return Array.isArray(parsed?.hits) ? { hits: parsed.hits.filter((n) => typeof n === 'number') } : { hits: [] };
  } catch {
    return { hits: [] };
  }
}

function writeWindow(bucket: string, hits: number[]): void {
  try {
    localStorage.setItem(storageKey(bucket), JSON.stringify({ hits }));
  } catch {
    // ignore quota
  }
}

/** Consome 1 slot se permitido. */
export function consumeRateLimit(
  bucket: string,
  maxHits: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  const window = readWindow(bucket);
  const fresh = window.hits.filter((ts) => now - ts < windowMs);
  if (fresh.length >= maxHits) {
    const oldest = Math.min(...fresh);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, windowMs - (now - oldest)),
    };
  }
  fresh.push(now);
  writeWindow(bucket, fresh);
  return {
    allowed: true,
    remaining: Math.max(0, maxHits - fresh.length),
    retryAfterMs: 0,
  };
}

export function peekRateLimit(
  bucket: string,
  maxHits: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  const window = readWindow(bucket);
  const fresh = window.hits.filter((ts) => now - ts < windowMs);
  if (fresh.length >= maxHits) {
    const oldest = Math.min(...fresh);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, windowMs - (now - oldest)),
    };
  }
  return {
    allowed: true,
    remaining: Math.max(0, maxHits - fresh.length),
    retryAfterMs: 0,
  };
}
