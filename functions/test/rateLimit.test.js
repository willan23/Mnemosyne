const assert = require('node:assert/strict');
const test = require('node:test');

// Pure helpers reimplemented for unit test without admin init
// (mirror of clientKey logic; full Firestore consume is integration)

function clientKeyFromRequest(req) {
  const headers = req.headers || {};
  const forwarded = String(headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '')
    .split(',')[0]
    .trim();
  const realIp = String(headers['x-real-ip'] || headers['X-Real-IP'] || '').trim();
  const ip = forwarded || realIp || req.ip || 'unknown';
  const auth = String(headers.authorization || headers.Authorization || '').slice(0, 48);
  return auth ? `${ip}:${auth.length}` : ip;
}

function slidingWindowAllow(hits, max, windowMs, now) {
  const fresh = hits.filter((ts) => now - ts < windowMs);
  if (fresh.length >= max) {
    const oldest = Math.min(...fresh);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, windowMs - (now - oldest)), hits: fresh };
  }
  const next = [...fresh, now];
  return { allowed: true, remaining: Math.max(0, max - next.length), retryAfterMs: 0, hits: next };
}

test('client key prefers x-forwarded-for', () => {
  assert.equal(
    clientKeyFromRequest({ headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }, ip: '10.0.0.1' }),
    '1.2.3.4',
  );
});

test('sliding window blocks after max hits', () => {
  const windowMs = 60_000;
  const max = 3;
  let hits = [];
  let now = 1_000_000;
  for (let i = 0; i < 3; i += 1) {
    const r = slidingWindowAllow(hits, max, windowMs, now + i);
    assert.equal(r.allowed, true);
    hits = r.hits;
  }
  const blocked = slidingWindowAllow(hits, max, windowMs, now + 10);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test('sliding window resets after window elapses', () => {
  const windowMs = 1_000;
  const max = 1;
  let hits = [2_000_000];
  const blocked = slidingWindowAllow(hits, max, windowMs, 2_000_500);
  assert.equal(blocked.allowed, false);
  const open = slidingWindowAllow(hits, max, windowMs, 2_001_001);
  assert.equal(open.allowed, true);
});
