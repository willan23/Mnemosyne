import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  Download,
  Monitor,
  Shield,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { LandingBackground } from '../components/landing/LandingBackground';
import { PublicSiteFooter } from '../components/PublicSiteFooter';
import { useTranslation } from '../utils/translations';
import {
  DESKTOP_APP_VERSION,
  DESKTOP_MANUAL_MIGRATION_VERSION,
  DESKTOP_MSI_DOWNLOAD_URL,
  DESKTOP_SETUP_DOWNLOAD_URL,
  MOBILE_APP_DOWNLOAD_URL,
  openExternalDownload,
} from '../config/downloads';

const FEATURES = [
  'downloadFeatureViews',
  'downloadFeatureUpdates',
  'downloadFeatureCipher',
  'downloadFeatureReview',
] as const;

export const DownloadPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050816] text-slate-100">
      <LandingBackground />

      <div className="relative z-10 mx-auto max-w-4xl px-5 py-8 md:px-8 md:py-12">
        <Link
          to="/"
          className="mb-10 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-indigo-200 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('downloadBack')}
        </Link>

        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center"
        >
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-violet-200">
            <Sparkles className="h-3.5 w-3.5" />
            {t('downloadFree')}
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-white md:text-5xl">
            {t('downloadHeading')}
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
            {t('downloadIntro')}
          </p>
          <p className="mt-3 text-sm text-slate-500">
            {t('downloadCurrent')} <span className="text-slate-300">v{DESKTOP_APP_VERSION}</span> · Windows 10/11 x64
          </p>
        </motion.header>

        <section aria-labelledby="desktop-migration-title" className="mb-6 rounded-2xl border border-cyan-400/25 bg-cyan-500/5 p-5 text-sm text-slate-200">
          <h2 id="desktop-migration-title" className="font-semibold text-cyan-100">{t('downloadMigrationTitle')}</h2>
          <p className="mt-2 leading-relaxed">{t('downloadMigrationBody', { first: DESKTOP_MANUAL_MIGRATION_VERSION })}</p>
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.5 }}
            className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md md:col-span-2"
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-400/30 bg-indigo-500/15">
                  <Monitor className="h-6 w-6 text-indigo-300" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">{t('downloadInstaller')}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {t('downloadInstallerHint')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openExternalDownload(DESKTOP_SETUP_DOWNLOAD_URL)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
              >
                <Download className="h-4 w-4" />
                {t('downloadWindows')}
              </button>
            </div>

            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  {t(feature)}
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-wrap gap-3 border-t border-white/5 pt-5">
              <button
                type="button"
                onClick={() => openExternalDownload(DESKTOP_MSI_DOWNLOAD_URL)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
              >
                {t('downloadMsi')}
              </button>
              <Link
                to="/privacy"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
              >
                {t('footerPrivacy')}
              </Link>
              <Link
                to="/security"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
              >
                {t('footerSecurity')}
              </Link>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14, duration: 0.5 }}
            className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md"
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/15">
                <Smartphone className="h-5 w-5 text-cyan-300" />
              </div>
              <div>
                <h2 className="font-semibold text-white">Android APK</h2>
                <p className="text-xs text-slate-400">{t('downloadAndroidHint')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openExternalDownload(MOBILE_APP_DOWNLOAD_URL)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
            >
              <Download className="h-4 w-4" />
              {t('downloadAndroid')}
            </button>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.5 }}
            className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md"
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/15">
                <Shield className="h-5 w-5 text-emerald-300" />
              </div>
              <div>
                <h2 className="font-semibold text-white">{t('downloadTrustTitle')}</h2>
                <p className="text-xs text-slate-400">{t('downloadTrustHint')}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              {t('downloadTrustBody')}
            </p>
          </motion.section>
        </div>

        <footer className="mt-12 flex flex-col items-center gap-3 text-center text-sm text-slate-500">
          <div className="flex items-center gap-2 text-slate-400">
            <Brain className="h-4 w-4 text-violet-400" />
            Mnemosyne Cognitive OS
          </div>
          <p>
            {t('downloadPreferWeb')}{' '}
            <Link to="/" className="text-indigo-300 underline-offset-2 hover:underline">
              {t('downloadOpenWeb')}
            </Link>
          </p>
        </footer>
        <PublicSiteFooter className="mt-4" />
      </div>
    </div>
  );
};
