import { describe, expect, it } from 'vitest';
import { getPlanLimits, getUsagePercentage, hasReachedLimit, normalizePlanName } from './planLimits';

describe('plan limits', () => {
  it('normalizes unsupported and legacy plan names safely', () => {
    expect(normalizePlanName()).toBe('free');
    expect(normalizePlanName('unknown')).toBe('free');
    expect(normalizePlanName('business')).toBe('sovereign');
    expect(normalizePlanName('SOVEREIGN')).toBe('sovereign');
    expect(normalizePlanName('pro')).toBe('pro');
  });

  it('keeps the free plan constrained for market gating', () => {
    const free = getPlanLimits('free');

    expect(free.memories.monthly).toBe(30);
    expect(free.attachments.images.enabled).toBe(false);
    expect(free.attachments.audio.enabled).toBe(false);
    expect(free.attachments.pdfs.enabled).toBe(false);
    expect(free.features.apiAccess).toBe(false);
  });

  it('maps legacy business users to sovereign limits', () => {
    const business = getPlanLimits('business');
    const sovereign = getPlanLimits('sovereign');

    expect(business).toEqual(sovereign);
    expect(sovereign.attachments.pdfs.enabled).toBe(true);
    expect(sovereign.features.apiAccess).toBe(true);
  });

  it('treats -1 limits as unlimited', () => {
    expect(hasReachedLimit(10_000, -1)).toBe(false);
    expect(getUsagePercentage(10_000, -1)).toBe(0);
  });

  it('detects bounded usage limits', () => {
    expect(hasReachedLimit(29, 30)).toBe(false);
    expect(hasReachedLimit(30, 30)).toBe(true);
    expect(getUsagePercentage(15, 30)).toBe(50);
    expect(getUsagePercentage(99, 30)).toBe(100);
  });
});
