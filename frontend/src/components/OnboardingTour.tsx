import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Compass, Orbit, Radio, Search, Sparkles, X, ArrowRight, Check } from 'lucide-react';

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
  action?: 'flow' | 'search' | 'universe' | 'done';
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Bem-vindo ao teu universo',
    body: 'O Mnemosyne transforma pensamentos em estrelas ligadas. Em ~30 segundos vês o essencial.',
    icon: <Brain className="h-6 w-6 text-violet-300" />,
    cta: 'Começar',
  },
  {
    id: 'flow',
    title: 'Flow · capturar',
    body: 'No dock inferior, toca em Flow. Escreve livremente e Ctrl+Enter cristaliza a memória com ligações automáticas.',
    icon: <Compass className="h-6 w-6 text-cyan-300" />,
    cta: 'Abrir Flow',
    action: 'flow',
  },
  {
    id: 'graph',
    title: 'Grafo · explorar',
    body: 'Cada memória é um corpo celeste. Arrasta para rodar, scroll para zoom, clique para mergulhar. Violeta = recém-criada.',
    icon: <Sparkles className="h-6 w-6 text-violet-300" />,
    cta: 'Continuar',
  },
  {
    id: 'search',
    title: 'Search · encontrar',
    body: 'Ctrl+K abre a command palette. Pesquisa memórias, abre o Universo 3D ou Comms sem sair do teclado.',
    icon: <Search className="h-6 w-6 text-sky-300" />,
    cta: 'Experimentar Ctrl+K',
    action: 'search',
  },
  {
    id: 'universe',
    title: 'Universe · espaço vivo',
    body: 'O Universo 3D é a mesma mente noutro modo: física, clusters e zoom até ao detalhe. Usa “Nova memória” no centro.',
    icon: <Orbit className="h-6 w-6 text-indigo-300" />,
    cta: 'Ver Universo',
    action: 'universe',
  },
  {
    id: 'comms',
    title: 'Comms · transmitir',
    body: 'Envia memórias cifradas a outros utilizadores. Cápsulas por link usam passphrase — nunca texto em claro na cloud.',
    icon: <Radio className="h-6 w-6 text-indigo-200" />,
    cta: 'Pronto',
    action: 'done',
  },
];

interface OnboardingTourProps {
  enabled: boolean;
  /** Força abertura (ex: replay nas Definições) */
  forceOpen?: boolean;
  onForceConsumed?: () => void;
  onOpenFlow: () => void;
  onOpenSearch: () => void;
  onOpenUniverse: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({
  enabled,
  forceOpen = false,
  onForceConsumed,
  onOpenFlow,
  onOpenSearch,
  onOpenUniverse,
}) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

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

  const current = STEPS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  const next = () => {
    const action = current.action;
    if (action === 'flow') onOpenFlow();
    if (action === 'search') onOpenSearch();
    if (action === 'universe') {
      finish();
      onOpenUniverse();
      return;
    }
    if (action === 'done' || step >= STEPS.length - 1) {
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
              aria-label="Saltar onboarding"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="p-6 pt-5">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                {current.icon}
              </div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300/60">
                Passo {step + 1} de {STEPS.length}
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
                  {step >= STEPS.length - 1 ? (
                    <>
                      <Check className="h-4 w-4" /> Entrar no universo
                    </>
                  ) : (
                    <>
                      {current.cta || 'Seguinte'}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
                {step < STEPS.length - 1 && (
                  <button
                    type="button"
                    onClick={skip}
                    className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
                  >
                    Saltar
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
