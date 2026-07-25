import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Mail, Lock, ArrowLeft, Eye, EyeOff, Sparkles, KeyRound
} from 'lucide-react';
import { auth } from '../../firebase';
import { deriveAesKeyFromMnemonic, generateMnemonic, validateBip39Mnemonic } from '../../utils/crypto';
import { getAuthErrorMessage, isNewAuthUser, signInWithGoogle } from '../../services/authFlow';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';

type AuthMode = 'login' | 'register' | 'reset' | 'zeroKnowledge';

interface AuthPageProps {
  initialMode?: AuthMode;
  onBack: () => void;
  onMnemonicComplete?: (mnemonic: string[]) => void;
  onGeneratedMnemonic?: (mnemonic: string[]) => void;
}

/* ─── Animated tab indicator ──────────────────────────────── */
const TabBar: React.FC<{
  mode: AuthMode;
  onSwitch: (m: AuthMode) => void;
}> = ({ mode, onSwitch }) => (
  <div
    className="flex rounded-xl p-1 mb-7"
    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
  >
    {(['login', 'register'] as const).map((tab) => (
      <button
        key={tab}
        onClick={() => onSwitch(tab)}
        className="relative flex-1 py-2 text-sm font-medium rounded-lg transition-colors z-10"
        style={{
          color: mode === tab ? '#f0f0ff' : 'rgba(240,240,255,0.4)',
        }}
      >
        {mode === tab && (
          <motion.div
            layoutId="auth-tab-indicator"
            className="absolute inset-0 rounded-lg"
            style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)' }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
          />
        )}
        <span className="relative z-10">
          {tab === 'login' ? 'Entrar' : 'Criar conta'}
        </span>
      </button>
    ))}
  </div>
);

/* ─── InputField ──────────────────────────────────────────── */
const InputField: React.FC<{
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  icon: React.ReactNode;
  right?: React.ReactNode;
  hasError?: boolean;
}> = ({ type, placeholder, value, onChange, onEnter, icon, right, hasError }) => (
  <div className="relative">
    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(240,240,255,0.25)' }}>
      {icon}
    </div>
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && onEnter?.()}
      className="mnem-input"
      style={{
        paddingLeft: '2.75rem',
        paddingRight: right ? '2.75rem' : '1rem',
        borderColor: hasError ? 'rgba(248,113,113,0.5)' : undefined,
      }}
    />
    {right && (
      <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
        {right}
      </div>
    )}
  </div>
);

const MnemonicField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  hasError?: boolean;
}> = ({ value, onChange, hasError }) => (
  <div className="relative">
    <div className="absolute left-3.5 top-3.5 pointer-events-none" style={{ color: 'rgba(103,232,249,0.5)' }}>
      <KeyRound className="w-4 h-4" />
    </div>
    <textarea
      placeholder="12 palavras da tua chave soberana"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="mnem-input min-h-[104px] resize-none leading-relaxed"
      style={{
        paddingLeft: '2.75rem',
        paddingTop: '0.8rem',
        borderColor: hasError ? 'rgba(248,113,113,0.5)' : 'rgba(34,211,238,0.28)',
      }}
    />
  </div>
);

/* ─── Google icon SVG ─────────────────────────────────────── */
const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

/* ─── AuthPage ────────────────────────────────────────────── */
export const AuthPage: React.FC<AuthPageProps> = ({
  initialMode = 'login',
  onBack,
  onMnemonicComplete,
  onGeneratedMnemonic,
}) => {
  const [mode,            setMode]            = useState<AuthMode>(initialMode);
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mnemonic,        setMnemonic]        = useState('');
  const [showPass,        setShowPass]        = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [googleLoading,   setGoogleLoading]   = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [success,         setSuccess]         = useState<string | null>(null);

  const completeGeneratedMnemonic = (words: string[]) => {
    if (onGeneratedMnemonic) {
      onGeneratedMnemonic(words);
      return;
    }
    onMnemonicComplete?.(words);
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode !== 'reset' && (!email.trim() || !password)) {
        setError('Preenche email e password.');
        return;
      }
      if (mode === 'reset' && !email.trim()) {
        setError('Preenche o email para recuperar a password.');
        return;
      }
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else if (mode === 'register') {
        if (password !== confirmPassword) {
          setError('As passwords não coincidem.');
          return;
        }
        const words = await generateMnemonic();
        await createUserWithEmailAndPassword(auth, email, password);
        completeGeneratedMnemonic(words);
      } else if (mode === 'zeroKnowledge') {
        const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!(await validateBip39Mnemonic(words))) {
          setError('A chave Zero-Knowledge deve conter exatamente 12 palavras BIP39 válidas.');
          return;
        }

        await signInWithEmailAndPassword(auth, email, password);
        await deriveAesKeyFromMnemonic(words, `mnemosyne:${auth.currentUser?.uid ?? email.toLowerCase()}`);
        onMnemonicComplete?.(words);
      } else {
        await sendPasswordResetEmail(auth, email);
        setSuccess('Email de recuperação enviado. Verifica a tua caixa de entrada.');
      }
    } catch (e) {
      setError(getAuthErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const credential = await signInWithGoogle();
      if (credential && isNewAuthUser(credential)) {
        completeGeneratedMnemonic(await generateMnemonic());
      }
    } catch (e) {
      setError(getAuthErrorMessage(e, 'Erro ao entrar com Google.'));
    } finally {
      setGoogleLoading(false);
    }
  };

  const TITLES: Record<AuthMode, string> = {
    login:    'Tu não estás a entrar numa conta.',
    register: 'Tu não estás a criar uma conta.',
    reset:    'Recuperar password',
    zeroKnowledge: 'Entrar com Zero-Knowledge',
  };
  const SUBS: Record<AuthMode, string> = {
    login:    'Estás a aceder à tua mente digital. As tuas memórias são encriptadas localmente. Só tu controlas a chave.',
    register: 'Estás a criar a tua mente digital. As tuas memórias são encriptadas localmente. Só tu controlas a chave.',
    reset:    'Envia-nos o teu email e tratamos do resto.',
    zeroKnowledge: 'Autentica a tua identidade e desbloqueia a chave local apenas em memória. A seed nunca sai deste dispositivo.',
  };

  return (
    <div className="relative z-20 min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[420px]"
      >
        {/* Back + Logo */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm transition-colors group"
            style={{ color: 'rgba(240,240,255,0.35)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(240,240,255,0.8)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(240,240,255,0.35)')}
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Voltar
          </button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <Brain className="w-4 h-4 text-indigo-400" />
            </div>
            <span className="text-sm font-semibold text-white">Mnemosyne</span>
          </div>
        </div>

        {/* Card */}
        <div className="mnem-glass-heavy p-8">

          {/* Reset mode: simplified, no tabs */}
          {mode === 'reset' ? (
            <AnimatePresence mode="wait">
              <motion.div
                key="reset"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-6">
                  <h2 className="text-xl font-semibold text-white mb-1">{TITLES.reset}</h2>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{SUBS.reset}</p>
                </div>

                <div className="space-y-3">
                  <InputField
                    type="email" placeholder="Email" value={email}
                    onChange={setEmail} onEnter={handleSubmit} icon={<Mail className="w-4 h-4" />}
                  />
                  {error   && <ErrorMsg msg={error} />}
                  {success && <SuccessMsg msg={success} />}
                  <SubmitBtn loading={loading} label="Enviar email de recuperação" disabled={!!success} onClick={handleSubmit} />
                </div>

                <div className="mt-5 text-center">
                  <button onClick={() => switchMode('login')} className="text-sm" style={{ color: '#818cf8' }}>
                    ← Voltar ao login
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            <>
              {/* Heading */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  className="mb-6"
                >
                  <h2 className="text-xl font-semibold text-white mb-1">{TITLES[mode]}</h2>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{SUBS[mode]}</p>
                </motion.div>
              </AnimatePresence>

              {/* Tab bar */}
              {mode !== 'zeroKnowledge' && <TabBar mode={mode} onSwitch={switchMode} />}

              {/* Google */}
              {mode !== 'zeroKnowledge' && (
                <button
                  onClick={handleGoogle}
                  disabled={googleLoading || loading}
                  className="w-full flex items-center justify-center gap-3 py-2.5 rounded-xl text-sm font-medium mb-4 transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(240,240,255,0.8)',
                    opacity: googleLoading ? 0.6 : 1,
                  }}
                  onMouseEnter={e => { if (!googleLoading) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                >
                  {googleLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
                  ) : (
                    <GoogleIcon />
                  )}
                  {googleLoading ? 'A conectar…' : 'Continuar com Google'}
                </button>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {mode === 'zeroKnowledge' ? 'identidade + chave local' : 'ou com email'}
                </span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
              </div>

              {/* Form fields */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={mode + '-fields'}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-3"
                >
                  <InputField
                    type="email" placeholder="Email" value={email}
                    onChange={setEmail} icon={<Mail className="w-4 h-4" />}
                    hasError={!!error}
                  />

                  <InputField
                    type={showPass ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={setPassword}
                    onEnter={mode === 'login' ? handleSubmit : undefined}
                    icon={<Lock className="w-4 h-4" />}
                    hasError={!!error}
                    right={
                      <button
                        type="button"
                        onClick={() => setShowPass(v => !v)}
                        style={{ color: 'rgba(240,240,255,0.3)' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'rgba(240,240,255,0.7)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(240,240,255,0.3)')}
                      >
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    }
                  />

                  {mode === 'register' && (
                    <InputField
                      type={showPass ? 'text' : 'password'}
                      placeholder="Confirmar password"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      onEnter={handleSubmit}
                      icon={<Lock className="w-4 h-4" />}
                      hasError={!!error}
                    />
                  )}

                  {mode === 'zeroKnowledge' && (
                    <MnemonicField
                      value={mnemonic}
                      onChange={setMnemonic}
                      hasError={!!error}
                    />
                  )}

                  {error   && <ErrorMsg msg={error} />}
                  {success && <SuccessMsg msg={success} />}

                  <SubmitBtn
                    loading={loading}
                    disabled={!!success || googleLoading}
                    onClick={handleSubmit}
                    label={
                      mode === 'login'
                        ? 'Entrar'
                        : mode === 'zeroKnowledge'
                          ? 'Desbloquear mente'
                          : 'Criar conta'
                    }
                    icon={mode === 'zeroKnowledge' ? <KeyRound className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  />
                </motion.div>
              </AnimatePresence>

              {/* Footer links */}
              <div className="mt-5 flex flex-col items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                {mode === 'login' && (
                  <>
                    <button
                      onClick={() => switchMode('zeroKnowledge')}
                      className="inline-flex items-center gap-1.5 text-xs text-cyan-300 hover:text-cyan-100 transition-colors"
                    >
                      <KeyRound className="w-3 h-3" />
                      Entrar com Zero-Knowledge
                    </button>
                    <button
                      onClick={() => switchMode('reset')}
                      className="text-xs hover:text-white/60 transition-colors"
                    >
                      Esqueceste a password?
                    </button>
                  </>
                )}
                {mode === 'zeroKnowledge' && (
                  <button
                    onClick={() => switchMode('login')}
                    className="text-xs hover:text-white/60 transition-colors"
                  >
                    Voltar ao login por email
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

/* ─── Helpers ─────────────────────────────────────────────── */
const ErrorMsg: React.FC<{ msg: string }> = ({ msg }) => (
  <motion.p
    initial={{ opacity: 0, y: -4 }}
    animate={{ opacity: 1, y: 0 }}
    className="text-xs px-3 py-2.5 rounded-xl"
    style={{
      color: '#f87171',
      background: 'rgba(239,68,68,0.1)',
      border: '1px solid rgba(239,68,68,0.2)',
    }}
  >
    {msg}
  </motion.p>
);

const SuccessMsg: React.FC<{ msg: string }> = ({ msg }) => (
  <motion.p
    initial={{ opacity: 0, y: -4 }}
    animate={{ opacity: 1, y: 0 }}
    className="text-xs px-3 py-2.5 rounded-xl"
    style={{
      color: '#34d399',
      background: 'rgba(52,211,153,0.1)',
      border: '1px solid rgba(52,211,153,0.2)',
    }}
  >
    {msg}
  </motion.p>
);

const SubmitBtn: React.FC<{
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}> = ({ loading, disabled, onClick, label, icon }) => (
  <button
    onClick={onClick}
    disabled={loading || disabled}
    className="mnem-btn-primary w-full justify-center mt-1"
    style={{ opacity: loading || disabled ? 0.6 : 1 }}
  >
    {loading ? (
      <>
        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        A processar…
      </>
    ) : (
      <>
        {icon}
        {label}
      </>
    )}
  </button>
);
