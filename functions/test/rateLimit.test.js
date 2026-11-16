const assert = require('node:assert/strict');
const test = require('node:test');
const { clientKeyFromRequest, evaluateSlidingWindow } = require('../lib/rateLimit.js');

test('client key prefers authenticated uid over IP', () => {
  assert.equal(
    clientKeyFromRequest({ headers: { 'x-forwarded-for': '1.2.3.4' }, ip: '10.0.0.1' }, 'user-abc'),
    'uid:user-abc',
  );
});

test('client key uses platform ip (ignores spoofable x-forwarded-for)', () => {
  assert.equal(
    clientKeyFromRequest({ headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }, ip: '10.0.0.1' }),
    'ip:10.0.0.1',
  );
});

test('sliding window blocks after max hits', () => {
  const config = { max: 3, windowMs: 60_000 };
  let hits = [];
  const now = 1_000_000;
  for (let i = 0; i < 3; i += 1) {
    const r = evaluateSlidingWindow(hits, config, now + i);
    assert.equal(r.allowed, true);
    hits = r.hits;
  }
  const blocked = evaluateSlidingWindow(hits, config, now + 10);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test('sliding window resets after window elapses', () => {
  const config = { max: 1, windowMs: 1_000 };
  const hits = [2_000_000];
  const blocked = evaluateSlidingWindow(hits, config, 2_000_500);
  assert.equal(blocked.allowed, false);
  const open = evaluateSlidingWindow(hits, config, 2_001_001);
  assert.equal(open.allowed, true);
});
