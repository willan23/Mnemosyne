import React from 'react';
import { Link } from 'react-router-dom';
import { LanguagePicker } from './LanguagePicker';
import { useTranslation, type TranslationKey } from '../utils/translations';

const LINKS: { to: string; label: TranslationKey }[] = [
  { to: '/privacy', label: 'footerPrivacy' },
  { to: '/security', label: 'footerSecurity' },
  { to: '/status', label: 'footerStatus' },
  { to: '/enterprise', label: 'footerEnterprise' },
  { to: '/changelog', label: 'footerChangelog' },
  { to: '/download', label: 'footerDownload' },
  { to: '/pricing', label: 'footerPricing' },
];

interface PublicSiteFooterProps {
  className?: string;
}

export const PublicSiteFooter: React.FC<PublicSiteFooterProps> = ({ className = '' }) => {
  const { t } = useTranslation();
  return (
    <footer className={`mt-12 flex flex-col items-center gap-3 text-center text-sm text-slate-500 ${className}`}>
      <LanguagePicker compact />
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" aria-label={t('publicNav')}>
        {LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="text-slate-400 underline-offset-2 transition hover:text-indigo-200 hover:underline"
          >
            {t(link.label)}
          </Link>
        ))}
      </nav>
      <p className="text-xs text-slate-600">{t('footerTagline')}</p>
    </footer>
  );
};
