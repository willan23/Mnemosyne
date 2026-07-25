import React, { useMemo, useState } from 'react';
import { deleteDoc, deleteField, doc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, Check, GitMerge, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import type { SessionData } from '../hooks/useSessions';

interface Props {
  sessions: SessionData[];
}

export const SyncConflictPanel: React.FC<Props> = ({ sessions }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const conflicts = useMemo(
    () => sessions.filter((session) => session.tags?.includes('sync-conflict') || session.conflictReason),
    [sessions]
  );
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  );

  const textPreview = (value?: string): string[] => (
    (value || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
  );

  const resolveConflict = async (conflict: SessionData, action: 'apply' | 'keep-both' | 'discard') => {
    setBusyId(conflict.id);
    try {
      if (action === 'discard') {
        await deleteDoc(doc(db, 'sessions', conflict.id));
        return;
      }

      if (action === 'apply' && conflict.originalMemoryId) {
        await updateDoc(doc(db, 'sessions', conflict.originalMemoryId), {
          text: conflict.text,
          title: conflict.title || null,
          tags: (conflict.tags || []).filter((tag) => tag !== 'sync-conflict'),
          category: conflict.category || null,
          updatedAt: Date.now(),
          resolvedFromConflictId: conflict.id,
        });
        await deleteDoc(doc(db, 'sessions', conflict.id));
        return;
      }

      await updateDoc(doc(db, 'sessions', conflict.id), {
        tags: (conflict.tags || []).filter((tag) => tag !== 'sync-conflict'),
        originalMemoryId: deleteField(),
        conflictReason: deleteField(),
        updatedAt: Date.now(),
      });
    } finally {
      setBusyId(null);
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
                disabled={busyId === conflict.id || !conflict.originalMemoryId}
                className="flex items-center justify-center gap-1 rounded-lg border border-green-500/20 bg-green-500/10 px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-green-200 disabled:opacity-40"
              >
                <GitMerge className="h-3.5 w-3.5" />
                Aplicar
              </button>
              <button
                onClick={() => resolveConflict(conflict, 'keep-both')}
                disabled={busyId === conflict.id}
                className="flex items-center justify-center gap-1 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-cyan-200 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                Ambos
              </button>
              <button
                onClick={() => resolveConflict(conflict, 'discard')}
                disabled={busyId === conflict.id}
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
