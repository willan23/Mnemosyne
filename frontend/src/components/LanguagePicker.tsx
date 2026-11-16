import React from 'react';
import { APP_LOCALES, useTranslation } from '../utils/translations';
import { useUniverseStore } from '../store/universeStore';

const LABELS = {
  'pt-pt': 'languagePortuguesePT',
  'pt-br': 'languagePortugueseBR',
  en: 'languageEnglish',
  fr: 'languageFrench',
} as const;

interface LanguagePickerProps {
  compact?: boolean;
  className?: string;
}

export const LanguagePicker: React.FC<LanguagePickerProps> = ({ compact = false, className = '' }) => {
  const { t, language } = useTranslation();
  const setLanguage = useUniverseStore((state) => state.setLanguage);

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`}
      role="group"
      aria-label={t('languagePickerLabel')}
    >
      {APP_LOCALES.map((locale) => {
        const active = language === locale;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => setLanguage(locale)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
              active
                ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-100'
                : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
            }`}
            aria-pressed={active}
          >
            {compact ? locale.toUpperCase() : t(LABELS[locale])}
          </button>
        );
      })}
    </div>
  );
};
