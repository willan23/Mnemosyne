import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicSiteFooter } from '../components/PublicSiteFooter';
import { formatLocaleDate, useTranslation } from '../utils/translations';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h2 className="text-xl font-bold text-indigo-300">{title}</h2>
    <div className="space-y-3 text-sm leading-7 text-slate-300 md:text-base">{children}</div>
  </section>
);

export const EnterprisePage: React.FC = () => {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const updated = formatLocaleDate(new Date(2026, 8, 1), language);

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
            <h1 className="text-3xl font-bold text-white md:text-4xl">{t('enterpriseH1')}</h1>
            <p className="mt-3 text-sm text-slate-400">{t('updatedOn', { date: updated })}</p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {t('enterpriseIntro')}
            </p>
          </header>

          <div className="mt-8 space-y-8">
            <Section title={t('enterpriseS1')}>
              <p>{t('enterpriseS1P1')}</p>
              <p>
                {t('enterpriseS1P2')}{' '}
                <a href="mailto:suporte@mnemosyne-one.com" className="text-indigo-300 underline">
                  suporte@mnemosyne-one.com
                </a>
              </p>
            </Section>

            <Section title={t('enterpriseS2')}>
              <p>{t('enterpriseS2P1')}</p>
              <p className="text-slate-400">{t('enterpriseS2P2')}</p>
            </Section>

            <Section title={t('enterpriseS3')}>
              <p>{t('enterpriseS3P1')}</p>
              <p className="text-slate-400">{t('enterpriseS3P2')}</p>
            </Section>

            <Section title={t('enterpriseS4')}>
              <p>{t('enterpriseS4P1')}</p>
              <p className="text-slate-400">{t('enterpriseS4P2')}</p>
            </Section>

            <Section title={t('enterpriseS5')}>
              <p>{t('enterpriseS5P1')}</p>
              <p className="text-slate-400">{t('enterpriseS5P2')}</p>
            </Section>

            <p className="text-sm text-slate-400">
              {t('enterpriseLinks')}:{' '}
              <Link to="/security" className="text-indigo-300 underline">/security</Link>
              {' · '}
              {t('enterpriseLinksPrivacy')}:{' '}
              <Link to="/privacy" className="text-indigo-300 underline">/privacy</Link>
              {' · '}
              {t('enterpriseLinksPricing')}:{' '}
              <Link to="/pricing" className="text-indigo-300 underline">/pricing</Link>
            </p>
          </div>
        </article>

        <PublicSiteFooter />
      </div>
    </div>
  );
};
