import { describe, expect, it } from 'vitest';
import { compareSemver, isNewerRelease, localReleaseMeta, APP_BUILT_AT } from './appVersion';

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

  it('orders prereleases before stable releases and by SemVer identifier precedence', () => {
    const sequence = ['1.0.8-alpha', '1.0.8-alpha.1', '1.0.8-alpha.beta', '1.0.8-beta', '1.0.8-beta.2', '1.0.8-beta.11', '1.0.8-rc.1', '1.0.8'];
    for (let i = 1; i < sequence.length; i++) {
      expect(compareSemver(sequence[i - 1], sequence[i])).toBeLessThan(0);
      expect(compareSemver(sequence[i], sequence[i - 1])).toBeGreaterThan(0);
    }
    expect(isNewerRelease({ version: '1.0.8', buildId: 'stable' }, { version: '1.0.8-rc.2', buildId: 'new-rc' })).toBe(false);
  });

  it('compares numeric identifiers without losing integer precision and accepts a legacy v prefix', () => {
    expect(compareSemver('9007199254740993.0.0', '9007199254740992.0.0')).toBeGreaterThan(0);
    expect(compareSemver('1.0.8-9007199254740993', '1.0.8-9007199254740992')).toBeGreaterThan(0);
    expect(compareSemver('v1.0.8', '1.0.7')).toBeGreaterThan(0);
  });

  it('uses build identity when build metadata differs at equal version precedence', () => {
    expect(compareSemver('1.0.8+one', '1.0.8+two')).toBe(0);
    expect(isNewerRelease({ version: '1.0.8+one', buildId: 'same' }, { version: '1.0.8+two', buildId: 'same' })).toBe(false);
    expect(isNewerRelease({ version: '1.0.8+one', buildId: 'first' }, { version: '1.0.8+two', buildId: 'second' })).toBe(true);
    expect(isNewerRelease({ version: '1.0.9', buildId: 'first' }, { version: '1.0.8', buildId: 'second' })).toBe(false);
  });

  it.each(['1.0', '1.0.8-01', '1.0.8+', '01.0.8', '1.0.8\n', '1'.repeat(257)])('ignores malformed remote versions (%j)', version => {
    expect(isNewerRelease({ version: '1.0.8', buildId: 'first' }, { version, buildId: 'second' })).toBe(false);
    expect(compareSemver(version, '1.0.8')).toBe(0);
  });

  it('includes the embedded build timestamp in the local release metadata', () => {
    expect(localReleaseMeta().builtAt).toBe(APP_BUILT_AT);
  });
});
