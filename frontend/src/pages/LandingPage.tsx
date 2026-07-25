import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Sparkles, Lock, ArrowRight, Zap, LogIn } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LandingBackground } from '../components/landing/LandingBackground';
import { AuthPage } from '../components/landing/AuthPage';

type AuthMode = 'login' | 'register';
type View = 'hero' | 'auth';

/* ─── Benefits data ───────────────────────────────────────── */
const BENEFITS = [
  {
    icon: Zap,
    title: 'Memórias vivas',
    desc: 'Cada pensamento cresce e evolui. Nada fica perdido — tudo se torna uma estrela no teu universo.',
    gradient: 'from-violet-500/20 to-violet-500/0',
    iconColor: '#8b5cf6',
  },
  {
    icon: Brain,
    title: 'Ligações automáticas',
    desc: 'A IA cognitiva descobre padrões e liga ideias que nunca conseguirias ver sozinho.',
    gradient: 'from-cyan-500/20 to-cyan-500/0',
    iconColor: '#22d3ee',
  },
  {
    icon: Lock,
    title: 'Privacidade total',
    desc: 'Zero-knowledge. Os teus dados nunca saem do teu dispositivo. Zero rastreio, zero anúncios.',
    gradient: 'from-pink-500/20 to-pink-500/0',
    iconColor: '#f472b6',
  },
] as const;

/* ─── Stagger variants ────────────────────────────────────── */
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const itemVariants = {
  hidden:  { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
};

/* ─── Landing hero ────────────────────────────────────────── */
const HeroView: React.FC<{
  onAuth: (mode: AuthMode) => void;
}> = ({ onAuth }) => (
  <motion.div
    key="hero"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.35 }}
    className="relative z-10 flex flex-col min-h-screen"
  >
    {/* ── Header ─────────────────────────────────────────────── */}
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-10 py-5 mnem-glass-header transition-all">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <div className="absolute inset-0 rounded-lg bg-violet-500/20 blur-md" />
          <div className="relative p-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <Brain className="w-5 h-5 text-violet-400" />
          </div>
        </div>
        <span className="text-base font-semibold tracking-tight text-white">Mnemosyne</span>
      </div>

      {/* Nav */}
      <nav className="flex items-center gap-2">
        <a
          href="#beneficios"
          className="hidden sm:block px-4 py-2 text-sm font-medium transition-colors rounded-lg text-slate-300 hover:text-white"
        >
          Sobre
        </a>
        <Link
          to="/pricing"
          className="hidden sm:block px-4 py-2 text-sm font-medium transition-colors rounded-lg text-slate-300 hover:text-white"
        >
          Planos
        </Link>
        <button
          onClick={() => onAuth('login')}
          className="mnem-btn-ghost text-sm px-5 py-2 hover:bg-white/5"
          style={{ padding: '0.4rem 1.15rem' }}
        >
          Entrar
        </button>
      </nav>
    </header>

    {/* ── Hero ────────────────────────────────────────────────── */}
    <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 md:py-32 relative mt-16">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-3xl w-full"
      >
        {/* Badge */}
        <motion.div variants={itemVariants} className="inline-flex mb-8">
          <span className="mnem-badge group cursor-default">
            <Sparkles className="w-3 h-3 group-hover:animate-spin-slow" />
            Cognitive Universe Engine
          </span>
        </motion.div>

        {/* H1 */}
        <motion.h1
          variants={itemVariants}
          className="text-[clamp(2.8rem,8vw,5.5rem)] font-bold tracking-tight leading-[1.06] mb-6 text-white"
        >
          Entra no teu
          <br />
          <span className="mnem-gradient-text">universo mental</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          variants={itemVariants}
          className="text-lg md:text-xl mb-10 max-w-xl mx-auto leading-relaxed text-slate-300"
        >
          Guarda pensamentos, liga ideias e explora a tua memória
          <br className="hidden sm:block" />
          num espaço vivo e privado.
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={itemVariants}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          {/* Primary */}
          <button
            id="cta-start-free"
            onClick={() => onAuth('register')}
            className="mnem-btn-primary group"
          >
            <Sparkles className="w-4 h-4" />
            Começar grátis
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </button>

          {/* Entrar (Tertiary) */}
          <button
            id="cta-login"
            onClick={() => onAuth('login')}
            className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-400 hover:text-slate-100 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            Entrar
          </button>
        </motion.div>

        {/* Social proof */}
        <motion.div
          variants={itemVariants}
          className="mt-12 flex items-center justify-center gap-3 text-sm text-slate-400"
        >
          <div className="flex -space-x-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="w-7 h-7 rounded-full border-2 border-slate-900 flex items-center justify-center text-[10px] font-bold"
                style={{
                  background: `hsl(${260 + i * 15}, 70%, 55%)`,
                  color: '#fff',
                }}
              >
                {['A','R','M','T'][i]}
              </div>
            ))}
          </div>
          <span>Junta-te a +1.200 mentes a explorar</span>
        </motion.div>
      </motion.div>
    </main>

    {/* ── Benefits ────────────────────────────────────────────── */}
    <section
      id="beneficios"
      className="relative z-10 px-6 md:px-10 pb-24 pt-12"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative max-w-5xl mx-auto"
      >
        <p className="text-center text-xs uppercase tracking-[0.2em] mb-10 text-slate-500 font-semibold">
          Porque o Mnemosyne é diferente
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {BENEFITS.map(({ icon: Icon, title, desc, gradient, iconColor }) => (
            <motion.div
              key={title}
              whileHover={{ y: -6, transition: { duration: 0.2 } }}
              className="relative flex flex-col gap-5 p-8 rounded-3xl overflow-hidden cursor-default mnem-glass"
            >
              {/* Gradient accent */}
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${gradient}`} />

              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg"
                style={{ background: `${iconColor}15`, border: `1px solid ${iconColor}30` }}
              >
                <Icon className="w-5 h-5" style={{ color: iconColor }} />
              </div>

              <div>
                <h3 className="text-base font-semibold text-slate-100 mb-2">{title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">
                  {desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>

    {/* Footer */}
    <footer className="relative z-10 px-6 md:px-10 pb-8 pt-8 flex items-center justify-between gap-4 flex-wrap border-t border-white/5">
      <span className="text-xs text-slate-500">
        © 2026 Mnemosyne. Todos os direitos reservados.
      </span>
      <div className="flex gap-6 text-xs text-slate-500 font-medium">
        <Link to="/privacy" className="hover:text-slate-300 transition-colors">Privacidade</Link>
        <Link to="/pricing" className="hover:text-slate-300 transition-colors">Planos</Link>
      </div>
    </footer>
  </motion.div>
);

/* ─── LandingPage ─────────────────────────────────────────── */
export const LandingPage: React.FC = () => {
  const [view, setView] = useState<View>('hero');
  const [authMode, setAuthMode] = useState<AuthMode>('login');

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setView('auth');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent">
      {/* Living universe background — always visible */}
      <LandingBackground />

      <div className="fixed inset-0 z-[1] pointer-events-none bg-gradient-to-b from-transparent to-[#0b1120]/20" />

      {/* View transitions */}
      <AnimatePresence mode="wait">
        {view === 'hero' && (
          <HeroView 
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
            <AuthPage initialMode={authMode} onBack={() => setView('hero')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
