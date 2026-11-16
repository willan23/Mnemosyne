import { describe, expect, it } from 'vitest';
import { APP_LOCALES, HTML_LANG, interpolate, translate, translations } from './translations';
import { translationCatalog } from './translationCatalog';

describe('i18n catalog', () => {
  it('keeps the same keys in all four locales', () => {
    const keys = Object.keys(translationCatalog);
    expect(keys.length).toBeGreaterThan(80);
    for (const locale of APP_LOCALES) {
      expect(Object.keys(translations[locale]).sort()).toEqual(keys.sort());
    }
  });

  it('maps html lang tags', () => {
    expect(HTML_LANG['pt-pt']).toBe('pt-PT');
    expect(HTML_LANG['pt-br']).toBe('pt-BR');
    expect(HTML_LANG.en).toBe('en');
    expect(HTML_LANG.fr).toBe('fr');
  });

  it('interpolates placeholders and falls back to English', () => {
    expect(interpolate('Hello {name}', { name: 'Ada' })).toBe('Hello Ada');
    expect(translate('settings', 'en')).toBe('Settings');
    expect(translate('settings', 'pt-pt')).toBe('Definições');
    expect(translate('settings', 'fr')).toBe('Paramètres');
  });
});
