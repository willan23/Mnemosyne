import React from 'react';
import { Link } from 'react-router-dom';
import { PublicSiteFooter } from '../components/PublicSiteFooter';
import { useTranslation } from '../utils/translations';
import { APP_VERSION } from '../config/appVersion';
import { checkoutEnabled, isFreeFirstMode } from '../config/monetization';

/** Build configuration summary; there are no live availability probes here. */
export const StatusPage: React.FC = () => {
  const { t } = useTranslation();
  const generatedAt = new Date().toISOString();

  const rows: { name: string; state: string; note: string }[] = [
    {
      name: 'Hosting / SPA',
      state: 'Não verificado',
      note: `Build ${APP_VERSION} · destino configurado: mnemosyne-one.web.app`,
    },
    {
      name: 'Auth (Firebase)',
      state: 'Não verificado',
      note: 'Autenticação por email / Google configurada no produto',
    },
    {
      name: 'Firestore + Storage',
      state: 'Não verificado',
      note: 'Texto e título cifrados no cliente; anexos históricos sem a cifra do cofre',
    },
    {
      name: 'Cloud Functions (EU)',
      state: 'Não verificado',
      note: 'Região configurada: europe-west1 · rate limits no código',
    },
    {
      name: 'Stripe Checkout',
      state: checkoutEnabled ? 'Configurado no build' : 'Desligado no build',
      note: isFreeFirstMode
        ? 'Founder Preview free-first; upgrade voluntário se checkout activo'
        : 'Modo paid',
    },
    {
      name: 'App Check',
      state: import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY ? 'Site key no build' : 'Sem site key no build',
      note: 'Tokens não verificados · provider web exclui Tauri e Android · sem enforce global',
    },
  ];

  return (
    <div className="min-h-screen bg-[#050816] px-5 py-10 text-slate-100 md:px-8">
      <div className="mx-auto max-w-3xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">
          Mnemosyne
        </p>
        <h1 className="text-3xl font-bold text-white md:text-4xl">{t('statusH1')}</h1>
        <p className="mt-3 text-sm text-slate-400">{t('statusIntro')}</p>
        <p className="mt-2 text-[11px] text-slate-500">
          {t('statusGenerated')}: {generatedAt}
        </p>

        <ul className="mt-8 space-y-3">
          {rows.map((row) => (
            <li
              key={row.name}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-white">{row.name}</p>
                <p className="text-xs font-medium text-slate-300">{row.state}</p>
              </div>
              <p className="mt-1 text-xs text-slate-400">{row.note}</p>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-sm text-slate-400">
          <Link to="/security" className="text-indigo-300 underline">/security</Link>
          {' · '}
          <Link to="/privacy" className="text-indigo-300 underline">/privacy</Link>
          {' · '}
          <a href="mailto:suporte@mnemosyne-one.com" className="text-indigo-300 underline">
            suporte@mnemosyne-one.com
          </a>
        </p>

        <PublicSiteFooter />
      </div>
    </div>
  );
};
