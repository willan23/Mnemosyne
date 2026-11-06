import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PublicSiteFooter } from '../components/PublicSiteFooter';
import { PUBLIC_API_BASE, PUBLIC_MCP_URL } from '../services/apiKeys';
import { formatLocaleDate, useTranslation } from '../utils/translations';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h2 className="text-xl font-bold text-indigo-300">{title}</h2>
    <div className="space-y-3 text-sm leading-7 text-slate-300 md:text-base">{children}</div>
  </section>
);

export const SecurityPage: React.FC = () => {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const updated = formatLocaleDate(new Date(2026, 8, 24), language);

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
            <h1 className="text-3xl font-bold text-white md:text-4xl">{t('securityH1')}</h1>
            <p className="mt-3 text-sm text-slate-400">{t('updatedOn', { date: updated })}</p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              {t('securityIntro')}
            </p>
          </header>

          <div className="mt-8 space-y-8">
            <Section title={t('securityS1')}>
              <p>{t('securityS1P1')}</p>
              <p>{t('securityS1P2')}</p>
            </Section>

            <Section title={t('securityS2')}>
              <p>{t('securityS2P1')}</p>
            </Section>

            <Section title={t('securityS3')}>
              <p>{t('securityS3P1')}</p>
              <p>{t('securityS3P2')}</p>
              <p>{t('securityS3P3')}</p>
            </Section>

            <Section title={t('securityS4')}>
              <p>{t('securityS4P1')}</p>
            </Section>

            <Section title={t('securityS5')}>
              <p>
                {t('securityS5P1')}{' '}
                <code className="rounded bg-black/40 px-1.5 py-0.5 text-[13px] text-indigo-200">{PUBLIC_API_BASE}</code>
                {' · '}
                <code className="rounded bg-black/40 px-1.5 py-0.5 text-[13px] text-indigo-200">{PUBLIC_MCP_URL}</code>
              </p>
            </Section>

            <Section title={t('securityS6')}>
              <ul className="list-disc space-y-2 pl-6">
                <li>{t('securityS6L1')}</li>
                <li>{t('securityS6L2')}</li>
                <li>{t('securityS6L3')}</li>
                <li>{t('securityS6L4')}</li>
              </ul>
            </Section>

            <p className="text-sm text-slate-400">
              {t('securityLinks')}:{' '}
              <Link to="/privacy" className="text-indigo-300 underline">/privacy</Link>
              {' · '}
              {t('footerEnterprise')}:{' '}
              <Link to="/enterprise" className="text-indigo-300 underline">/enterprise</Link>
              {' · '}
              {t('footerChangelog')}:{' '}
              <Link to="/changelog" className="text-indigo-300 underline">/changelog</Link>
            </p>
          </div>
        </article>

        <PublicSiteFooter />
      </div>
    </div>
  );
};
