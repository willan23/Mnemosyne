import { describe, expect, it } from 'vitest';
import { compareSemver, isNewerRelease } from './appVersion';

describe('app version compare', () => {
  it('orders semver correctly', () => {
    expect(compareSemver('1.0.7', '1.0.6')).toBeGreaterThan(0);
    expect(compareSemver('1.0.6', '1.0.7')).toBeLessThan(0);
    expect(compareSemver('1.0.6', '1.0.6')).toBe(0);
  });

  it('detects new deploy by buildId', () => {
    expect(
      isNewerRelease(
        { version: '1.0.6', buildId: 'abc' },
        { version: '1.0.6', buildId: 'def' },
      ),
    ).toBe(true);
    expect(
      isNewerRelease(
        { version: '1.0.6', buildId: 'abc' },
        { version: '1.0.6', buildId: 'abc' },
      ),
    ).toBe(false);
  });

  it('detects higher version when buildId missing', () => {
    expect(
      isNewerRelease(
        { version: '1.0.5', buildId: 'dev' },
        { version: '1.0.6', buildId: 'dev' },
      ),
    ).toBe(true);
  });
});
