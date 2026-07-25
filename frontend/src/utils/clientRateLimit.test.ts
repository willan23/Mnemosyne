import { beforeEach, describe, expect, it } from 'vitest';
import { consumeRateLimit, peekRateLimit } from './clientRateLimit';

describe('client rate limit', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('allows up to max hits inside the window', () => {
    const now = 1_000_000;
    expect(consumeRateLimit('web-research', 3, 60_000, now).allowed).toBe(true);
    expect(consumeRateLimit('web-research', 3, 60_000, now + 10).allowed).toBe(true);
    expect(consumeRateLimit('web-research', 3, 60_000, now + 20).allowed).toBe(true);
    const blocked = consumeRateLimit('web-research', 3, 60_000, now + 30);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after window elapses', () => {
    const now = 2_000_000;
    consumeRateLimit('test-bucket', 1, 1_000, now);
    expect(peekRateLimit('test-bucket', 1, 1_000, now + 500).allowed).toBe(false);
    expect(peekRateLimit('test-bucket', 1, 1_000, now + 1_001).allowed).toBe(true);
  });
});
