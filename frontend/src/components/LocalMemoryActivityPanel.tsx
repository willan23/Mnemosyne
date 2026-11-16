import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';
import { clearLocalMemoryActivity, exportLocalMemoryActivity, loadLocalMemoryActivity, type LocalMemoryActivity } from '../services/localMemoryActivity';
import { useTranslation } from '../utils/translations';

export function LocalMemoryActivityPanel({ uid }: { uid: string }) {
  const { t } = useTranslation();
  const epoch = useRef(0), actor = useRef(uid);
  if (actor.current !== uid) { actor.current = uid; epoch.current++; }
  const [view, setView] = useState<{ uid: string; rows: LocalMemoryActivity[] | null; busy: boolean; error: boolean }>({ uid, rows: null, busy: false, error: false });
  useEffect(() => {
    // This ref is a latched operation epoch; cleanup must invalidate every pending operation.
    const retire = () => { epoch.current++; };
    const invalidate = () => { retire(); setView({ uid, rows: null, busy: false, error: false }); };
    const stopVault = onMemoryCryptoChanged(invalidate);
    const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) invalidate(); });
    return () => { retire(); stopVault(); stopAuth(); };
  }, [uid]);
  const active = Boolean(uid) && auth.currentUser?.uid === uid && isMemoryCryptoReady();
  const current = view.uid === uid && active;
  const rows = current ? view.rows : null, busy = current && view.busy;
  const run = async (mode: 'load' | 'export' | 'clear') => {
    const token = ++epoch.current;
    const guard = () => { if (token !== epoch.current || actor.current !== uid || auth.currentUser?.uid !== uid || !isMemoryCryptoReady()) throw Error('local_activity_scope_changed'); };
    try {
      guard(); setView({ uid, rows, busy: true, error: false });
      if (mode === 'clear') { await clearLocalMemoryActivity(uid); guard(); setView({ uid, rows: [], busy: false, error: false }); return; }
      if (mode === 'export') {
        const text = await exportLocalMemoryActivity(uid); guard();
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
        try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'mnemosyne-local-activity.json'; guard(); anchor.click(); }
        finally { URL.revokeObjectURL(url); }
      }
      const next = await loadLocalMemoryActivity(uid); guard(); setView({ uid, rows: next, busy: false, error: false });
    } catch { if (token === epoch.current && actor.current === uid) setView({ uid, rows: null, busy: false, error: true }); }
  };
  return <section aria-label={t('activityTitle')} className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
    <h3 className="text-sm font-semibold">{t('activityTitle')}</h3>
    <p className="text-xs text-slate-400">{t('activityDescription')}</p>
    <div className="flex flex-wrap gap-2">
      {(['load', 'export', 'clear'] as const).map(mode => <button type="button" key={mode} disabled={busy || !active}
        onClick={() => { void run(mode); }} className="rounded-lg border border-white/15 px-3 py-2 text-xs disabled:opacity-40">{t(mode === 'load' ? 'activityLoad' : mode === 'export' ? 'activityExport' : 'activityClear')}</button>)}
    </div>
    {!active && <p role="status" className="text-xs text-slate-400">{t('activityUnlock')}</p>}
    {current && view.error && <p role="status" className="text-xs text-amber-200">{t('activityUnavailable')}</p>}
    {rows && <p role="status" className="text-xs text-slate-400">{t('activityCount', { count: rows.length })}</p>}
    {rows && rows.length > 0 && <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-slate-400">
      {[...rows].reverse().map(row => <li key={row.id}>{new Date(row.at).toLocaleString()} · {row.kind === 'retrieve'
        ? t('activityRetrieved', { count: row.resultCount }) : t('activityIndexed', { changed: row.changed, removed: row.removed })}</li>)}
    </ul>}
  </section>;
}
