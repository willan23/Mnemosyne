import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Compass, Orbit, Radio, Search, Sparkles, X, ArrowRight, Check } from 'lucide-react';
import { useTranslation } from '../utils/translations';

const STORAGE_KEY = 'mnemosyne.onboarding.v1.done';

export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // ignore
  }
}

export function resetOnboarding(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface Step {
  id: string;
  title: string;
  body: string;
  icon: React.ReactNode;
  cta?: string;
  action?: 'capture' | 'search' | 'universe' | 'done';
}

const STEP_ICONS = {
  welcome: <Brain className="h-6 w-6 text-violet-300" />,
  capture: <Compass className="h-6 w-6 text-cyan-300" />,
  graph: <Sparkles className="h-6 w-6 text-violet-300" />,
  search: <Search className="h-6 w-6 text-sky-300" />,
  universe: <Orbit className="h-6 w-6 text-indigo-300" />,
  comms: <Radio className="h-6 w-6 text-indigo-200" />,
} as const;

interface OnboardingTourProps {
  enabled: boolean;
  /** Força abertura (ex: replay nas Definições) */
  forceOpen?: boolean;
  onForceConsumed?: () => void;
  onFocusCapture: () => void;
  onOpenSearch: () => void;
  onOpenUniverse: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({
  enabled,
  forceOpen = false,
  onForceConsumed,
  onFocusCapture,
  onOpenSearch,
  onOpenUniverse,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const steps: Step[] = [
    { id: 'welcome', title: t('onbWelcomeTitle'), body: t('onbWelcomeBody'), icon: STEP_ICONS.welcome, cta: t('onbWelcomeCta') },
    { id: 'capture', title: t('onbCaptureTitle'), body: t('onbCaptureBody'), icon: STEP_ICONS.capture, cta: t('onbCaptureCta'), action: 'capture' },
    { id: 'graph', title: t('onbGraphTitle'), body: t('onbGraphBody'), icon: STEP_ICONS.graph, cta: t('onbGraphCta') },
    { id: 'search', title: t('onbSearchTitle'), body: t('onbSearchBody'), icon: STEP_ICONS.search, cta: t('onbSearchCta'), action: 'search' },
    { id: 'universe', title: t('onbUniverseTitle'), body: t('onbUniverseBody'), icon: STEP_ICONS.universe, cta: t('onbUniverseCta'), action: 'universe' },
    { id: 'comms', title: t('onbCommsTitle'), body: t('onbCommsBody'), icon: STEP_ICONS.comms, cta: t('onbCommsCta'), action: 'done' },
  ];

  useEffect(() => {
    if (!enabled) return;
    if (forceOpen) {
      setStep(0);
      setOpen(true);
      onForceConsumed?.();
      return;
    }
    if (hasCompletedOnboarding()) return;
    const t = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(t);
  }, [enabled, forceOpen, onForceConsumed]);

  const finish = useCallback(() => {
    markOnboardingDone();
    setOpen(false);
  }, []);

  const current = steps[step];
  const progress = ((step + 1) / steps.length) * 100;

  const next = () => {
    const action = current.action;
    if (action === 'capture') onFocusCapture();
    if (action === 'search') onOpenSearch();
    if (action === 'universe') {
      finish();
      onOpenUniverse();
      return;
    }
    if (action === 'done' || step >= steps.length - 1) {
      finish();
      return;
    }
    setStep((s) => s + 1);
  };

  const skip = () => finish();

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-end justify-center bg-black/55 p-4 backdrop-blur-sm sm:items-center"
        >
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-[#07101f]/95 shadow-[0_32px_100px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
          >
            <div className="h-1 w-full bg-white/5">
              <motion.div
                className="h-full bg-gradient-to-r from-violet-500 to-cyan-400"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            <button
              type="button"
              onClick={skip}
              className="absolute right-3 top-4 rounded-full p-2 text-white/35 transition hover:bg-white/10 hover:text-white"
              aria-label={t('onbSkipAria')}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="p-6 pt-5">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                {current.icon}
              </div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300/60">
                {t('onbStepOf', { step: step + 1, total: steps.length })}
              </p>
              <h2 id="onboarding-title" className="text-xl font-semibold text-white">
                {current.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{current.body}</p>

              <div className="mt-6 flex items-center gap-2">
                <button
                  type="button"
                  onClick={next}
                  className="mnem-btn-primary flex-1 justify-center"
                  style={{ borderRadius: '0.875rem' }}
                >
                  {step >= steps.length - 1 ? (
                    <>
                      <Check className="h-4 w-4" /> {t('onbEnterUniverse')}
                    </>
                  ) : (
                    <>
                      {current.cta || t('next')}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
                {step < steps.length - 1 && (
                  <button
                    type="button"
                    onClick={skip}
                    className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
                  >
                    {t('skip')}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
