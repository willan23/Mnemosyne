import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicSiteFooter } from '../components/PublicSiteFooter';
import { useTranslation, type TranslationKey } from '../utils/translations';

const CHANGES: { title: TranslationKey; body: TranslationKey }[] = [
  { title: 'ch11t', body: 'ch11b' },
  { title: 'ch10t', body: 'ch10b' },
  { title: 'ch1t', body: 'ch1b' },
  { title: 'ch2t', body: 'ch2b' },
  { title: 'ch3t', body: 'ch3b' },
  { title: 'ch4t', body: 'ch4b' },
  { title: 'ch5t', body: 'ch5b' },
  { title: 'ch6t', body: 'ch6b' },
  { title: 'ch7t', body: 'ch7b' },
  { title: 'ch8t', body: 'ch8b' },
  { title: 'ch9t', body: 'ch9b' },
];

export const ChangelogPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-[#050816] px-5 py-8 text-slate-100 md:px-8">
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </button>

        <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 md:p-10">
          <header className="border-b border-white/10 pb-7">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">
              Mnemosyne
            </p>
            <h1 className="text-3xl font-bold text-white md:text-4xl">{t('changelogH1')}</h1>
            <p className="mt-3 text-sm text-slate-400">{t('changelogEyebrow')}</p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {t('changelogIntro')}
            </p>
          </header>

          <ol className="mt-8 space-y-6">
            {CHANGES.map((change, index) => (
              <li key={change.title} className="rounded-xl border border-white/8 bg-white/[0.03] p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  {String(index + 1).padStart(2, '0')}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-white">{t(change.title)}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-300">{t(change.body)}</p>
              </li>
            ))}
          </ol>

          <p className="mt-8 text-sm text-slate-400">
            {t('changelogCrypto')}:{' '}
            <Link to="/security" className="text-indigo-300 underline">/security</Link>
            {' · '}
            {t('footerPrivacy')}:{' '}
            <Link to="/privacy" className="text-indigo-300 underline">/privacy</Link>
          </p>
        </article>

        <PublicSiteFooter />
      </div>
    </div>
  );
};
