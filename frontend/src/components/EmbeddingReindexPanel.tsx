import { useEffect, useRef, useState } from 'react';
import type { SessionData } from '../hooks/useSessions';
import { discardEmbeddingReindex, prepareEmbeddingReindex } from '../services/embeddingReindex';
import { promotePreparedEmbeddings, rollbackEmbeddingSelection } from '../services/embeddingPromotion';
import { onEmbeddingSelectionChanged, readEmbeddingSelection } from '../services/embeddingSelection';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';
import { useTranslation } from '../utils/translations';

export function EmbeddingReindexPanel({ uid, sessions }: { uid: string | null; sessions: SessionData[] }) {
  const { t } = useTranslation();
  const current = useRef(sessions);
  const controller = useRef<AbortController | null>(null);
  const [ready, setReady] = useState(isMemoryCryptoReady);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'prepared' | 'cancelled' | 'failed' | 'discarded' | 'activated'>('idle');
  const [selected, setSelected] = useState(() => uid ? readEmbeddingSelection(uid) : null);
  useEffect(() => uid ? onEmbeddingSelectionChanged(uid, () => setSelected(readEmbeddingSelection(uid))) : undefined, [uid]);
  const [progress, setProgress] = useState({ prepared: 0, reused: 0, skipped: 0, total: 0 });
  useEffect(() => { current.current = sessions; }, [sessions]);
  useEffect(() => {
    const stop = onMemoryCryptoChanged(() => {
      controller.current?.abort();
      setReady(isMemoryCryptoReady());
    });
    return () => { stop(); controller.current?.abort(); controller.current = null; };
  }, [uid]);

  const run = async (operation: 'prepare' | 'discard' | 'activate' = 'prepare') => {
    if (!uid || controller.current || (operation !== 'discard' && !isMemoryCryptoReady())) return;
    const job = new AbortController();
    controller.current = job;
    setBusy(true);
    setStatus('idle');
    setProgress({ prepared: 0, reused: 0, skipped: 0, total: 0 });
    try {
      if (operation === 'discard') await discardEmbeddingReindex(uid, 'multilingualCandidate');
      else if (operation === 'activate') await promotePreparedEmbeddings(uid, 'multilingualCandidate',
        () => current.current, { signal: job.signal });
      else await prepareEmbeddingReindex(uid, 'multilingualCandidate', () => current.current, {
        signal: job.signal,
        onProgress: next => { if (!job.signal.aborted && controller.current === job) setProgress(next); },
      });
      if (controller.current === job) setStatus(job.signal.aborted ? 'cancelled' :
        operation === 'discard' ? 'discarded' : operation === 'activate' ? 'activated' : 'prepared');
    } catch {
      if (controller.current === job) setStatus(job.signal.aborted ? 'cancelled' : 'failed');
    } finally {
      if (controller.current === job) { controller.current = null; setBusy(false); }
    }
  };
  const button = 'rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-40';
  return <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
    <h3 className="text-sm font-medium">{t('reindexTitle')}</h3>
    <p className="text-xs text-slate-400">{t('reindexDescription')}</p>
    <p className="text-xs text-slate-300">{t(selected ? 'reindexSelected' : 'reindexLegacy')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!uid || !ready || busy} onClick={() => void run()}>{t('reindexStart')}</button>
      <button type="button" className={button} disabled={!busy} onClick={() => controller.current?.abort()}>{t('reindexCancel')}</button>
      <button type="button" className={button} disabled={!uid || !ready || busy} onClick={() => void run('activate')}>{t('reindexActivate')}</button>
      <button type="button" className={button} disabled={!uid || !selected || busy} onClick={() => { if (uid) { rollbackEmbeddingSelection(uid); setStatus('idle'); } }}>{t('reindexRollback')}</button>
      <button type="button" className={button} disabled={!uid || busy} onClick={() => void run('discard')}>{t('reindexDiscard')}</button>
    </div>
    <p role="status" aria-live="polite" className="text-xs text-slate-300">
      {(busy || status === 'prepared') && t('reindexProgress', progress)}
      {!busy && status !== 'idle' && ` ${t(`reindexStatus_${status}`)}`}
    </p>
  </div>;
}
