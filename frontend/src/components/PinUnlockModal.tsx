import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, Lock, Shield } from 'lucide-react';
import { unlockWithLocalPin, isLocalPinEnabled } from '../utils/localPin';
import { assertWebAuthnGate, readWebAuthnCredentialId } from '../utils/webauthnVault';

interface PinUnlockModalProps {
  isOpen: boolean;
  onUnlocked: (mnemonic: string[]) => void;
  onUseMnemonicInstead: () => void;
}

export const PinUnlockModal: React.FC<PinUnlockModalProps> = ({
  isOpen,
  onUnlocked,
  onUseMnemonicInstead,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isOpen || !isLocalPinEnabled()) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const passed = await assertWebAuthnGate();
      if (!passed) {
        throw new Error('Autenticação do dispositivo cancelada.');
      }
      const words = await unlockWithLocalPin(pin);
      setPin('');
      onUnlocked(words);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível desbloquear.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-[#020617]/80 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pin-unlock-title"
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-cyan-400/20 bg-[#0b1224]/95 p-6 shadow-[0_0_60px_rgba(34,211,238,0.12)]"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
          >
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/15 p-3">
                <Lock className="h-5 w-5 text-cyan-200" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">
                  Sessão bloqueada
                </p>
                <h2 id="pin-unlock-title" className="mt-1 text-lg font-semibold text-white">
                  Desbloqueia com o PIN local
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  O PIN só existe neste dispositivo. A mnemónica permanece cifrada e não sai do teu
                  ambiente.
                  {readWebAuthnCredentialId()
                    ? ' Será pedida também a autenticação do dispositivo (Windows Hello / biometria).'
                    : ''}
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  <KeyRound className="h-3.5 w-3.5" />
                  PIN
                </span>
                <input
                  type="password"
                  inputMode="text"
                  autoComplete="off"
                  autoFocus
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-cyan-50 outline-none transition focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15"
                  placeholder="••••"
                />
              </label>

              {error && (
                <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || pin.length < 4}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/20 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Shield className="h-4 w-4" />
                {busy ? 'A desbloquear…' : 'Desbloquear sessão'}
              </button>
            </form>

            <button
              type="button"
              onClick={onUseMnemonicInstead}
              className="mt-4 w-full text-center text-xs text-slate-400 transition hover:text-slate-200"
            >
              Usar frase de 12 palavras em vez do PIN
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
