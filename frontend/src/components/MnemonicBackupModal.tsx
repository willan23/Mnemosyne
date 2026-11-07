import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Clipboard, KeyRound, ShieldCheck } from 'lucide-react';

interface MnemonicBackupModalProps {
  mnemonic: string[] | null;
  onClose: () => void;
}

export const MnemonicBackupModal: React.FC<MnemonicBackupModalProps> = ({ mnemonic, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const isOpen = Boolean(mnemonic?.length);

  const handleCopy = async () => {
    if (!mnemonic) return;
    await navigator.clipboard.writeText(mnemonic.join(' '));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleClose = () => {
    setConfirmed(false);
    setCopied(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && mnemonic && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
          />

          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.24 }}
            className="relative w-full max-w-[520px] overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#020617]/95 shadow-2xl"
          >
            <div className="border-b border-white/10 bg-white/[0.04] p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10">
                  <ShieldCheck className="h-5 w-5 text-cyan-200" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">A tua chave unica foi criada</h2>
                  <p className="text-xs uppercase tracking-widest text-cyan-100/55">Zero-Knowledge Key</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-slate-300">
                Guarda estas 12 palavras. Elas desbloqueiam as memorias cifradas nesta conta e nao ficam guardadas nos servidores.
              </p>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {mnemonic.map((word, index) => (
                  <div
                    key={`${word}-${index}`}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2"
                  >
                    <span className="w-5 text-right text-[10px] font-bold text-cyan-200/55">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm text-slate-100">{word}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleCopy}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/20"
              >
                {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                {copied ? 'Chave copiada' : 'Copiar 12 palavras'}
              </button>

              <p className="text-xs text-slate-400">Para recuperar mensagens Comms e chaves de equipa noutra instalação, guarda também o backup cifrado das identidades nas definições de identidade.</p>

              <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-cyan-300"
                />
                <span>Guardei esta chave num local seguro.</span>
              </label>

              <button
                onClick={handleClose}
                disabled={!confirmed}
                className="mnem-btn-primary w-full justify-center"
                style={{ opacity: confirmed ? 1 : 0.45 }}
              >
                <KeyRound className="h-4 w-4" />
                Entrar na Mnemosyne
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
