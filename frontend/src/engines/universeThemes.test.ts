import { describe, expect, it } from 'vitest';
import { getUniverseTheme, listUniverseThemes, SETTINGS_UNIVERSE_TYPES } from './universeThemes';

describe('universeThemes', () => {
  it('expõe perfis distintos para os tipos do picker', () => {
    const themes = listUniverseThemes();
    expect(themes.map((t) => t.id)).toEqual(SETTINGS_UNIVERSE_TYPES);

    const stellar = getUniverseTheme('stellar');
    const solar = getUniverseTheme('solar');
    const voidTheme = getUniverseTheme('void');

    expect(stellar.backdrop.spiralWeight).toBeGreaterThan(solar.backdrop.spiralWeight);
    expect(solar.backdrop.planeBias).toBeGreaterThan(0.8);
    expect(voidTheme.backdrop.showAccretionDisk).toBe(true);
    expect(stellar.bg).not.toBe(solar.bg);
    expect(stellar.lights.corePointColor).not.toBe(voidTheme.lights.corePointColor);
  });

  it('mantém nebulosa com mais nuvens que o void', () => {
    expect(getUniverseTheme('mythic').backdrop.nebulaCount)
      .toBeGreaterThan(getUniverseTheme('void').backdrop.nebulaCount);
  });
});
