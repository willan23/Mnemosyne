import { describe, expect, it } from 'vitest';
import { getUniverseQualityProfile } from './qualityProfile';

describe('getUniverseQualityProfile', () => {
  it('keeps desktop quality for a small universe', () => {
    const profile = getUniverseQualityProfile(40, { android: false, native: false });

    expect(profile.dpr).toEqual([1, 1.5]);
    expect(profile.antialias).toBe(true);
    expect(profile.reduceEffects).toBe(false);
    expect(profile.connectionSegments).toBe(10);
  });

  it('reduces effects above 150 memories', () => {
    const profile = getUniverseQualityProfile(180, { android: false, native: false });

    expect(profile.reduceEffects).toBe(true);
    expect(profile.dpr).toEqual([1, 1.5]);
    expect(profile.connectionSegments).toBe(6);
    expect(profile.maxPulseSignals).toBe(2);
  });

  it('locks Android to 1× dpr and reduced effects', () => {
    const profile = getUniverseQualityProfile(12, { android: true, native: true });

    expect(profile.dpr).toEqual([1, 1]);
    expect(profile.antialias).toBe(false);
    expect(profile.reduceEffects).toBe(true);
    expect(profile.isAndroid).toBe(true);
  });
});
