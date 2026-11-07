import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, GitMerge, Trash2 } from 'lucide-react';
import { auth } from '../firebase';
import toast from 'react-hot-toast';
import { resolvePersonalSyncConflict, syncConflictWritesEnabled } from '../services/syncConflictResolution';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import type { SessionData } from '../hooks/useSessions';

interface Props {
  sessions: readonly SessionData[];
}

const personalVisible = (session: SessionData, uid: string | undefined) => session.uid === uid && !session.deletedAt && !session.teamId &&
  !session.teamScopeAmbiguous && !session.encLocked &&
  (session.sharedWithIds == null || (Array.isArray(session.sharedWithIds) && session.sharedWithIds.length === 0));

export const SyncConflictPanel: React.FC<Props> = ({ sessions }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const currentUid = auth.currentUser?.uid;
  const feedback=useSyncFeedback();
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const conflicts = useMemo(
    () => sessions.filter((session) => personalVisible(session, currentUid) &&
      (session.tags?.includes('sync-conflict') || session.conflictReason)),
    [sessions, currentUid]
  );
  const sessionById = useMemo(
    () => new Map(sessions.filter(session => personalVisible(session, currentUid)).map((session) => [session.id, session])),
    [sessions, currentUid]
  );

  const textPreview = (value?: string): string[] => (
    (value || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
  );

  const resolveConflict = async (conflict: SessionData, action: 'apply' | 'keep-both' | 'discard') => {
    if (pending.current) return;
    pending.current = true;
    setBusyId(conflict.id);
    const active=feedback.capture(conflict.uid);
    try {
      if (!auth.currentUser || auth.currentUser.uid !== conflict.uid) throw new Error('Account changed');
      const original = sessionById.get(conflict.originalMemoryId || '');
      if(!conflict.syncConflictDigest||action==='apply'&&!original?.syncConflictDigest)throw Error('Atualiza a vista.');
      await resolvePersonalSyncConflict({uid: conflict.uid, conflictId: conflict.id, action,
        conflictViewDigest: conflict.syncConflictDigest,
        originalId: action==='apply'?original!.id:null,
        originalViewDigest: action==='apply'?original!.syncConflictDigest!:null,
      },()=>{if(!active())throw Error('O contexto mudou.');});
      if (mounted.current && active()) toast.success('Conflito resolvido.');
    } catch {
      if (mounted.current && active()) toast.error('Não foi possível confirmar a resolução. O pedido pendente pode ser recuperado.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusyId(null);
    }
  };

  if (conflicts.length === 0) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-300" />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-100">Conflitos de sync</p>
            <p className="text-[10px] text-amber-100/60">{conflicts.length} memória(s) aguardam decisão.</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {conflicts.map((conflict) => (
          <div key={conflict.id} className="space-y-3 rounded-xl border border-white/5 bg-black/20 p-3">
            <div>
              <p className="line-clamp-2 text-xs font-medium text-[#e2e8f0]">{conflict.title || conflict.text}</p>
              <p className="mt-1 text-[10px] text-[#94a3b8]">
                {conflict.originalMemoryId ? `Original ${conflict.originalMemoryId.slice(0, 8)}` : 'Sem memória original'} · {new Date(conflict.updatedAt || conflict.timestamp).toLocaleString()}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Local</p>
                {textPreview(sessionById.get(conflict.originalMemoryId || '')?.text).map((line, index) => (
                  <p key={index} className="mb-1 rounded bg-slate-500/10 px-2 py-1 text-[11px] leading-relaxed text-slate-200">
                    {line}
                  </p>
                ))}
                {!sessionById.get(conflict.originalMemoryId || '') && (
                  <p className="text-[11px] text-slate-500">Original indisponível.</p>
                )}
              </div>

              <div className="rounded-lg border border-amber-400/10 bg-amber-400/[0.04] p-2">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-200/70">Recebido</p>
                {textPreview(conflict.text).map((line, index) => (
                  <p key={index} className="mb-1 rounded bg-amber-400/10 px-2 py-1 text-[11px] leading-relaxed text-amber-50">
                    {line}
                  </p>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => resolveConflict(conflict, 'apply')}
                disabled={!syncConflictWritesEnabled() || !conflict.syncConflictDigest || busyId !== null || !conflict.originalMemoryId || !sessionById.get(conflict.originalMemoryId)?.syncConflictDigest}
                className="flex items-center justify-center gap-1 rounded-lg border border-green-500/20 bg-green-500/10 px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-green-200 disabled:opacity-40"
              >
                <GitMerge className="h-3.5 w-3.5" />
                Aplicar
              </button>
              <button
                onClick={() => resolveConflict(conflict, 'keep-both')}
                disabled={!syncConflictWritesEnabled() || !conflict.syncConflictDigest || busyId !== null}
                className="flex items-center justify-center gap-1 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-cyan-200 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                Ambos
              </button>
              <button
                onClick={() => resolveConflict(conflict, 'discard')}
                disabled={!syncConflictWritesEnabled() || !conflict.syncConflictDigest || busyId !== null}
                className="flex items-center justify-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-red-200 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Descartar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
