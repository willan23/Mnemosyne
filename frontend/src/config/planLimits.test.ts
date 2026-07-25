import { describe, expect, it } from 'vitest';
import { getEffectivePlanLimits, getPlanLimits, getUsagePercentage, hasReachedLimit, normalizePlanName } from './planLimits';

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

  it('opens core limits in Free-first mode without deleting paid plan definitions', () => {
    const effective = getEffectivePlanLimits('free');
    const free = getPlanLimits('free');
    const sovereign = getPlanLimits('sovereign');

    // Paid plan definitions remain intact for latent monetization.
    expect(free.memories.monthly).toBe(30);
    expect(sovereign.name).toBe('Sovereign');
    expect(sovereign.features.prioritySupport).toBe(true);

    // Free-first exposes Founder Preview with fair-use ceilings (not unlimited cloud).
    expect(effective.name).toBe('Founder Preview');
    expect(effective.memories.monthly).toBe(-1);
    expect(effective.storage.maxGB).toBe(5);
    expect(effective.attachments.images.enabled).toBe(true);
    expect(effective.attachments.audio.enabled).toBe(true);
    expect(effective.attachments.pdfs.enabled).toBe(true);
    expect(effective.features.apiAccess).toBe(true);
    expect(effective.features.prioritySupport).toBe(false);
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
