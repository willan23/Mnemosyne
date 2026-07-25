import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Brain, KeyRound, LogIn, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LandingBackground } from '../components/landing/LandingBackground';
import { AuthPage } from '../components/landing/AuthPage';

type AuthMode = 'login' | 'register' | 'zeroKnowledge';
type LoginView = 'hero' | 'auth';

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const LoginHero: React.FC<{
  onAuth: (mode: AuthMode) => void;
}> = ({ onAuth }) => (
  <motion.div
    key="login-hero"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.35 }}
    className="relative z-10 flex min-h-screen flex-col overflow-hidden text-white"
  >
    <header className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between px-6 py-5 transition-all md:px-10 mnem-glass-header">
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <div className="absolute inset-0 rounded-lg bg-violet-500/20 blur-md" />
          <div className="relative rounded-lg border border-violet-500/20 bg-violet-500/10 p-1.5">
            <Brain className="h-5 w-5 text-violet-400" />
          </div>
        </div>
        <span className="text-base font-semibold tracking-tight text-white">Mnemosyne</span>
      </div>

      <nav className="flex items-center gap-2">
        <Link
          to="/"
          className="hidden rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white sm:block"
        >
          Sobre
        </Link>
        <Link
          to="/pricing"
          className="hidden rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white sm:block"
        >
          Planos
        </Link>
        <button
          onClick={() => onAuth('login')}
          className="mnem-btn-ghost px-5 py-2 text-sm hover:bg-white/5"
          style={{ padding: '0.4rem 1.15rem' }}
        >
          Entrar
        </button>
      </nav>
    </header>

    <main className="relative flex flex-1 items-center justify-center px-6 pb-16 pt-28 text-center md:pb-20 md:pt-32">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="w-full max-w-[1000px] translate-y-2 sm:translate-y-6 md:translate-y-10"
      >
        <motion.div variants={itemVariants} className="mb-8 inline-flex">
          <span className="mnem-badge group cursor-default">
            <Sparkles className="h-3 w-3 group-hover:animate-spin-slow" />
            Cognitive Universe Engine
          </span>
        </motion.div>

        <motion.h1
          variants={itemVariants}
          className="mb-6 text-[clamp(3.25rem,7.2vw,8rem)] font-bold leading-[1.08] tracking-tight text-white md:mb-8"
        >
          Entra no teu
          <br />
          <span className="mnem-gradient-text">universo mental</span>
        </motion.h1>

        <motion.p
          variants={itemVariants}
          className="mx-auto mb-12 max-w-3xl text-lg leading-relaxed text-slate-300 md:mb-20 md:text-[1.75rem] md:leading-[1.55]"
        >
          Guarda pensamentos, liga ideias e explora a tua memória{' '}
          <br className="hidden sm:block" />
          num espaço vivo e privado.
        </motion.p>

        <motion.div variants={itemVariants} className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <button
            id="login-start-free"
            onClick={() => onAuth('register')}
            className="mnem-btn-primary group"
          >
            <Sparkles className="h-4 w-4" />
            Começar grátis
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>

          <button
            id="login-zero-knowledge"
            onClick={() => onAuth('zeroKnowledge')}
            className="mnem-btn-ghost group flex items-center gap-2 bg-cyan-500/5 text-cyan-100"
          >
            <KeyRound className="h-4 w-4 text-cyan-300" />
            Zero-Knowledge
          </button>

          <button
            id="login-enter"
            onClick={() => onAuth('login')}
            className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100"
          >
            <LogIn className="h-4 w-4" />
            Entrar
          </button>
        </motion.div>
      </motion.div>
    </main>
  </motion.div>
);

interface LoginPageProps {
  onMnemonicComplete?: (mnemonic: string[]) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onMnemonicComplete }) => {
  const [view, setView] = useState<LoginView>('hero');
  const [authMode, setAuthMode] = useState<AuthMode>('login');

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setView('auth');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent">
      <LandingBackground />
      <div className="fixed inset-0 z-[1] pointer-events-none bg-gradient-to-b from-transparent to-[#0b1120]/20" />

      <AnimatePresence mode="wait">
        {view === 'hero' && (
          <LoginHero
            key="hero"
            onAuth={openAuth}
          />
        )}

        {view === 'auth' && (
          <motion.div
            key="auth"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="relative z-10"
          >
            <AuthPage
              initialMode={authMode}
              onBack={() => setView('hero')}
              onMnemonicComplete={onMnemonicComplete}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
