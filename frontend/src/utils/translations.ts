import { useEffect } from 'react';
import { useUniverseStore } from '../store/universeStore';
import { translationCatalog, type AppLocale, type TranslationKey } from './translationCatalog';

export type { AppLocale, TranslationKey };
export { translationCatalog };

export const APP_LOCALES: AppLocale[] = ['pt-pt', 'pt-br', 'en', 'fr'];

export const HTML_LANG: Record<AppLocale, string> = {
  'pt-pt': 'pt-PT',
  'pt-br': 'pt-BR',
  en: 'en',
  fr: 'fr',
};

function buildTranslations(): Record<AppLocale, Record<TranslationKey, string>> {
  const out = {
    'pt-pt': {} as Record<TranslationKey, string>,
    'pt-br': {} as Record<TranslationKey, string>,
    en: {} as Record<TranslationKey, string>,
    fr: {} as Record<TranslationKey, string>,
  };
  for (const key of Object.keys(translationCatalog) as TranslationKey[]) {
    const row = translationCatalog[key];
    out['pt-pt'][key] = row[0];
    out['pt-br'][key] = row[1];
    out.en[key] = row[2];
    out.fr[key] = row[3];
  }
  return out;
}

export const translations = buildTranslations();

export function isAppLocale(value: string): value is AppLocale {
  return value === 'pt-pt' || value === 'pt-br' || value === 'en' || value === 'fr';
}

export function applyDocumentLang(locale: AppLocale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = HTML_LANG[locale];
}

export function formatLocaleDate(date: Date, locale: AppLocale): string {
  return date.toLocaleDateString(HTML_LANG[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  let out = text;
  for (const [key, value] of Object.entries(params)) {
    out = out.replaceAll(`{${key}}`, String(value));
  }
  return out;
}

export function translate(
  key: TranslationKey,
  locale: AppLocale = 'en',
  params?: Record<string, string | number>,
): string {
  const lang = isAppLocale(locale) ? locale : 'en';
  const text = translations[lang][key] || translations.en[key] || String(key);
  return interpolate(text, params);
}

export function useDocumentLang(): void {
  const language = useUniverseStore((state) => state.language) || 'en';
  useEffect(() => {
    applyDocumentLang(isAppLocale(language) ? language : 'en');
  }, [language]);
}

export const useTranslation = () => {
  const language = useUniverseStore((state) => state.language) || 'en';
  const locale: AppLocale = isAppLocale(language) ? language : 'en';
  useEffect(() => {
    applyDocumentLang(locale);
  }, [locale]);
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(key, locale, params);
  return { t, language: locale };
};
