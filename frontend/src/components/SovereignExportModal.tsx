import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Archive, Lock, Shield, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from '../utils/translations';
import {
  downloadSovereignExport,
  EXPORT_PASSPHRASE_MIN_LENGTH,
  SovereignExportLockedError,
  type SovereignExportMemoryInput,
} from '../utils/sovereignExport';

interface SovereignExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  memories: SovereignExportMemoryInput[];
  vaultUnlocked: boolean;
  encryptByDefault?: boolean;
}

export const SovereignExportModal: React.FC<SovereignExportModalProps> = ({
  isOpen,
  onClose,
  memories,
  vaultUnlocked,
  encryptByDefault = false,
}) => {
  const { t } = useTranslation();
  const [encryptZip, setEncryptZip] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) setEncryptZip(encryptByDefault);
  }, [isOpen, encryptByDefault]);

  const lockedCount = useMemo(
    () => memories.filter((memory) => memory.encLocked).length,
    [memories]
  );
  const exportable = vaultUnlocked && lockedCount === 0;

  const reset = () => {
    setEncryptZip(false);
    setPassphrase('');
    setConfirm('');
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleExport = async () => {
    if (!exportable) {
      toast.error(t('exportVaultLocked'));
      return;
    }
    if (encryptZip) {
      if (passphrase.trim().length < EXPORT_PASSPHRASE_MIN_LENGTH) {
        toast.error(t('exportPassphraseShort', { min: EXPORT_PASSPHRASE_MIN_LENGTH }));
        return;
      }
      if (passphrase !== confirm) {
        toast.error(t('exportPassphraseMismatch'));
        return;
      }
    }

    setBusy(true);
    try {
      const result = await downloadSovereignExport(memories, {
        vaultUnlocked: true,
        passphrase: encryptZip ? passphrase : undefined,
      });
      toast.success(
        result.encrypted
          ? t('exportEncryptedDone', { count: result.memoryCount })
          : t('exportDone', { count: result.memoryCount })
      );
      reset();
      onClose();
    } catch (error) {
      const message = error instanceof SovereignExportLockedError
        ? error.message
        : error instanceof Error
          ? error.message
          : t('exportFailed');
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-[#020617]/80 backdrop-blur-md"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sovereign-export-title"
            className="relative w-full max-w-lg rounded-2xl border border-white/12 bg-[#07101f]/95 p-6 text-slate-100 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleClose}
              className="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
              aria-label={t('close')}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 p-2">
                <Archive className="h-5 w-5 text-cyan-300" />
              </div>
              <div>
                <h2 id="sovereign-export-title" className="text-lg font-semibold text-white">
                  {t('exportTitle')}
                </h2>
                <p className="text-xs text-slate-400">{t('exportSubtitle')}</p>
              </div>
            </div>

            <p className="text-sm leading-6 text-slate-300">
              {t('exportBody', { count: memories.length })}
            </p>

            {!exportable && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {vaultUnlocked
                    ? t('exportSomeLocked', { count: lockedCount })
                    : t('exportVaultLocked')}
                </span>
              </div>
            )}

            <label className="mt-5 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
              <input
                type="checkbox"
                checked={encryptZip}
                onChange={(event) => setEncryptZip(event.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="flex items-center gap-1.5 font-medium text-white">
                  <Shield className="h-3.5 w-3.5 text-cyan-300" />
                  {t('exportEncryptOption')}
                </span>
                <span className="mt-1 block text-xs text-slate-400">{t('exportEncryptHint')}</span>
              </span>
            </label>

            {encryptZip && (
              <div className="mt-3 space-y-2">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  placeholder={t('exportPassphrase')}
                  className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder={t('exportPassphraseConfirm')}
                  className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50"
                />
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/10"
              >
                {t('close')}
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={busy || !exportable}
                className="rounded-xl bg-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? t('exportWorking') : t('exportAction')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
