import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Edit3, Trash2, BookOpen, Download, FileText, Send, Link2, Shield, GitBranch, Package, Layers } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, doc, onSnapshot, query, updateDoc, where, limit } from 'firebase/firestore';
import { useNotificationStore } from '../store/notificationStore';
import type { SessionData } from '../hooks/useSessions';
import { markMemoryDeleted } from '../services/memoryDeletion';
import { AttachmentPreviewGrid } from './AttachmentPreviewGrid';
import { buildMemoryDeepLink } from '../utils/deepLinks';
import { ShareModal } from './ShareModal';

interface Props {
  node: { id: string; x?: number; y?: number; screenX?: number; screenY?: number } | null;
  session: SessionData | null;
  /** Todas as sessões (para pack de memórias ligadas) */
  allSessions?: SessionData[];
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  graphRef: React.RefObject<any>;
  onDeleted: (id: string) => void;
  onTransmit?: (session: SessionData, options?: { includeLinked?: boolean }) => void;
}

type Panel = 'menu' | 'read' | 'edit' | 'links';

interface CapsuleStat {
  id: string;
  titleHint?: string;
  importCount: number;
  views: number;
  pack?: boolean;
  itemCount?: number;
  createdAt?: number;
  expiresAt?: number;
}

export const MemoryActionPanel: React.FC<Props> = ({
  node, session, allSessions = [], onClose, containerRef, graphRef, onDeleted, onTransmit,
}) => {
  const [panel, setPanel] = useState<Panel>('menu');
  const [editText, setEditText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(0);
  const [isCapsuleOpen, setIsCapsuleOpen] = useState(false);
  const [capsuleStats, setCapsuleStats] = useState<CapsuleStat[]>([]);
  const { addNotification } = useNotificationStore();

  // Position panel near node on screen
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Histórico de cápsulas criadas a partir desta memória
  useEffect(() => {
    if (!session?.id || !auth.currentUser) {
      setCapsuleStats([]);
      return;
    }
    const q = query(
      collection(db, 'shares'),
      where('uid', '==', auth.currentUser.uid),
      where('sessionId', '==', session.id),
      limit(10),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: CapsuleStat[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            titleHint: data.titleHint,
            importCount: typeof data.importCount === 'number' ? data.importCount : 0,
            views: typeof data.views === 'number' ? data.views : 0,
            pack: Boolean(data.pack),
            itemCount: data.itemCount,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
          };
        });
        rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setCapsuleStats(rows);
      },
      () => setCapsuleStats([]),
    );
    return () => unsub();
  }, [session?.id]);

  const linkedOut = useMemo(() => {
    if (!session?.connections?.length) return [] as SessionData[];
    const byId = new Map(allSessions.map((s) => [s.id, s]));
    return session.connections
      .map((id) => byId.get(id))
      .filter((s): s is SessionData => Boolean(s))
      .slice(0, 12);
  }, [session, allSessions]);

  const linkedIn = useMemo(() => {
    if (!session?.id) return [] as SessionData[];
    return allSessions
      .filter((s) => s.id !== session.id && s.connections?.includes(session.id))
      .slice(0, 12);
  }, [session, allSessions]);

  useEffect(() => {
    if (!node || !containerRef.current) return;
    setPanel('menu');
    setEditText(session?.text || '');
    setDeleteProgress(0);
    setIsDeleting(false);

    // If graphRef has node coords in graph space, convert to screen
    if (graphRef.current && node.x !== undefined && node.y !== undefined) {
      try {
        const { x: sx, y: sy } = graphRef.current.graph2ScreenCoords(node.x, node.y);
        const rect = containerRef.current.getBoundingClientRect();
        // Clamp so the panel stays inside the container
        const panelW = 300;
        const panelH = 280;
        setPos({
          x: Math.min(Math.max(sx + rect.left, rect.left + 8), rect.right - panelW - 8),
          y: Math.min(Math.max(sy + rect.top - panelH / 2, rect.top + 8), rect.bottom - panelH - 8),
        });
      } catch {
        // Fallback to center
        const rect = containerRef.current.getBoundingClientRect();
        setPos({ x: rect.left + rect.width / 2 - 150, y: rect.top + rect.height / 2 - 140 });
      }
    }
  }, [node, session, containerRef, graphRef]);

  const handleSave = useCallback(async () => {
    if (!session || !auth.currentUser || isSaving) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'sessions', session.id), {
        text: editText,
        updatedAt: Date.now(),
      });
      addNotification({ type: 'success', title: 'Memória guardada', message: editText.slice(0, 50) });
      setPanel('menu');
    } catch {
      addNotification({ type: 'error', title: 'Erro ao guardar', message: 'Tenta novamente.' });
    } finally {
      setIsSaving(false);
    }
  }, [session, editText, isSaving, addNotification]);

  const handleDelete = useCallback(async () => {
    if (!session || !auth.currentUser || isDeleting) return;
    setIsDeleting(true);
    // Animate dissipation: count progress from 0→100 over 1.2s
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      setDeleteProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        markMemoryDeleted(session.id)
          .then(() => {
            addNotification({ type: 'info', title: 'Memória dissipada', message: 'Desapareceu no cosmos.' });
            onDeleted(session.id);
            onClose();
          })
          .catch(() => {
            addNotification({ type: 'error', title: 'Erro ao apagar', message: 'Tenta novamente.' });
            setIsDeleting(false);
            setDeleteProgress(0);
          });
      }
    }, 60);
  }, [session, isDeleting, addNotification, onDeleted, onClose]);

  const exportMarkdown = useCallback(() => {
    if (!session) return;
    const date = new Date(session.timestamp).toLocaleDateString('pt-PT');
    const md = `# Memória\n\n> ${date}\n\n${session.text}\n\n${
      session.tags?.length ? `**Tags:** ${session.tags.join(', ')}\n` : ''
    }`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memoria_${session.id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    addNotification({ type: 'success', title: 'Exportado em Markdown' });
  }, [session, addNotification]);

  const exportPDF = useCallback(() => {
    if (!session) return;
    const date = new Date(session.timestamp).toLocaleDateString('pt-PT');
    const html = `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<title>Memória Mnemosyne</title>
<style>
body { font-family: Georgia, serif; max-width: 700px; margin: 60px auto; color: #1a1a2e; line-height: 1.8; }
h1 { font-size: 28px; border-bottom: 2px solid #8b5cf6; padding-bottom: 12px; }
.meta { color: #666; font-size: 13px; margin-bottom: 24px; }
.body { font-size: 16px; }
.tags { margin-top: 24px; font-size: 12px; color: #888; }
</style></head><body>
<h1>Memória</h1>
<div class="meta">📅 ${date}</div>
<div class="body">${session.text.replace(/\n/g, '<br/>')}</div>
${session.tags?.length ? `<div class="tags">🏷 ${session.tags.join(' · ')}</div>` : ''}
</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    setTimeout(() => {
      win?.print();
      URL.revokeObjectURL(url);
    }, 400);
    addNotification({ type: 'success', title: 'A gerar PDF', message: 'Use Ctrl+P para imprimir.' });
  }, [session, addNotification]);

  if (!node || !session) return null;

  const date = new Date(session.timestamp).toLocaleDateString('pt-PT', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Share modal portal sibling
  const relatedForPack = (() => {
    if (!session?.connections?.length || allSessions.length === 0) return [] as SessionData[];
    const byId = new Map(allSessions.map((s) => [s.id, s]));
    return session.connections
      .map((id) => byId.get(id))
      .filter((s): s is SessionData => Boolean(s?.text?.trim()))
      .slice(0, 12);
  })();

  const capsuleModal = isCapsuleOpen ? (
    <ShareModal
      session={session}
      relatedSessions={relatedForPack}
      onClose={() => setIsCapsuleOpen(false)}
      onOpenComms={onTransmit ? () => {
        setIsCapsuleOpen(false);
        onTransmit(session);
        onClose();
      } : undefined}
    />
  ) : null;

  // Deletion animation overlay
  if (isDeleting) {
    return (
      <div
        className="fixed z-[150] pointer-events-none"
        style={{ left: pos.x, top: pos.y, width: 300 }}
      >
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/30 backdrop-blur-xl p-6 text-center">
          <div className="relative w-16 h-16 mx-auto mb-3">
            <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
              <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(239,68,68,0.2)" strokeWidth="4" />
              <circle
                cx="32" cy="32" r="28" fill="none" stroke="#ef4444" strokeWidth="4"
                strokeDasharray={`${2 * Math.PI * 28}`}
                strokeDashoffset={`${2 * Math.PI * 28 * (1 - deleteProgress / 100)}`}
                className="transition-all duration-75"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-rose-400 text-xl">✦</span>
            </div>
          </div>
          <p className="text-rose-300 text-sm font-medium">A dissipar...</p>
          <p className="text-rose-400/60 text-xs mt-1">{deleteProgress}%</p>
        </div>
      </div>
    );
  }

  return (
    <>
    {capsuleModal}
    <div
      className="fixed z-[150] memory-action-panel"
      style={{ left: pos.x, top: pos.y, width: 300 }}
    >
      <div className="mnem-scroll max-h-[calc(100vh-1rem)] overflow-y-auto rounded-2xl border border-violet-400/15 bg-[#07101f]/92 shadow-2xl shadow-violet-900/30 backdrop-blur-2xl">

        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.9)]" />
            <span className="text-xs font-medium uppercase tracking-widest text-white/50">Memória</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-white/30 transition hover:bg-white/10 hover:text-white/70">
            <X className="h-4 w-4" />
          </button>
        </div>

        {panel === 'menu' && (
          <div className="space-y-2 p-4">
            {session.title && (
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-violet-300/70">
                {session.title}
              </p>
            )}
            <p className="mb-3 line-clamp-3 text-sm font-medium leading-relaxed text-white/85">{session.text}</p>
            <AttachmentPreviewGrid attachments={session.attachments} compact limit={4} />
            <p className="mb-4 text-xs text-white/30">{date}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPanel('read')}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 text-white/70 hover:text-white transition-all text-sm"
              >
                <BookOpen className="w-4 h-4 text-blue-400" />
                <span>Ler</span>
              </button>
              <button
                onClick={() => setPanel('edit')}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 text-white/70 hover:text-white transition-all text-sm"
              >
                <Edit3 className="w-4 h-4 text-violet-400" />
                <span>Editar</span>
              </button>
              <button
                onClick={() => setPanel('links')}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 text-white/70 hover:text-white transition-all text-sm"
              >
                <GitBranch className="w-4 h-4 text-emerald-400" />
                <span>Ligações</span>
              </button>
              <button
                onClick={() => {
                  if (!session || !onTransmit) return;
                  onTransmit(session);
                  onClose();
                }}
                disabled={!onTransmit}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-500/40 text-cyan-300 hover:text-cyan-200 transition-all text-sm disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
                <span>Comms</span>
              </button>
            </div>

            {linkedOut.length > 0 && onTransmit && (
              <button
                type="button"
                onClick={() => {
                  onTransmit(session, { includeLinked: true });
                  onClose();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-400/25 bg-indigo-500/10 px-3 py-2.5 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/20"
              >
                <Package className="h-3.5 w-3.5" />
                Enviar pack Comms ({1 + linkedOut.length} memórias)
              </button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={async () => {
                  const link = buildMemoryDeepLink(session.id, 'graph');
                  try {
                    await navigator.clipboard.writeText(link);
                    addNotification({ type: 'success', title: 'Link privado', message: 'Só funciona se estiveres logado.' });
                  } catch {
                    addNotification({ type: 'info', title: 'Link da memória', message: link });
                  }
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-violet-400/20 bg-violet-500/10 px-2 py-2 text-[11px] text-violet-200 transition hover:bg-violet-500/20"
              >
                <Link2 className="h-3.5 w-3.5" />
                Link privado
              </button>
              <button
                type="button"
                onClick={() => setIsCapsuleOpen(true)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-2 py-2 text-[11px] text-cyan-100 transition hover:bg-cyan-500/20"
              >
                <Shield className="h-3.5 w-3.5" />
                Cápsula cifrada
              </button>
            </div>

            {(capsuleStats.length > 0 || linkedOut.length > 0 || linkedIn.length > 0) && (
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                  <Layers className="h-3 w-3" /> Associações
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-semibold text-white">{linkedOut.length}</p>
                    <p className="text-[9px] uppercase tracking-wide text-white/35">Saída</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">{linkedIn.length}</p>
                    <p className="text-[9px] uppercase tracking-wide text-white/35">Entrada</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-cyan-200">
                      {capsuleStats.reduce((s, c) => s + c.importCount, 0)}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide text-white/35">Importações</p>
                  </div>
                </div>
                {capsuleStats[0] && (
                  <p className="mt-2 text-[10px] leading-relaxed text-white/40">
                    Última cápsula: {capsuleStats[0].views} vistas · {capsuleStats[0].importCount} assimilação(ões)
                    {capsuleStats[0].pack ? ' · pack' : ''}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setPanel('links')}
                  className="mt-2 text-[11px] font-medium text-violet-300 underline-offset-2 hover:underline"
                >
                  Ver detalhe
                </button>
              </div>
            )}

            <div className="flex gap-2 border-t border-white/5 pt-1">
              <button
                onClick={exportMarkdown}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-white/3 hover:bg-white/8 border border-white/5 text-white/40 hover:text-white/70 transition-all text-xs"
              >
                <FileText className="w-3 h-3" />
                <span>.md</span>
              </button>
              <button
                onClick={exportPDF}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-white/3 hover:bg-white/8 border border-white/5 text-white/40 hover:text-white/70 transition-all text-xs"
              >
                <Download className="w-3 h-3" />
                <span>PDF</span>
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 transition hover:bg-rose-500/20"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {panel === 'links' && (
          <div className="space-y-3 p-4">
            <button
              type="button"
              onClick={() => setPanel('menu')}
              className="mb-1 flex items-center gap-1 text-xs text-white/30 transition hover:text-white/60"
            >
              ← Voltar
            </button>

            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                Ligações de saída ({linkedOut.length})
              </p>
              {linkedOut.length === 0 ? (
                <p className="text-xs text-white/35">Sem ligações de saída.</p>
              ) : (
                <ul className="space-y-1.5">
                  {linkedOut.map((m) => (
                    <li
                      key={m.id}
                      className="truncate rounded-lg border border-white/5 bg-black/25 px-2.5 py-1.5 text-xs text-white/70"
                      title={m.text}
                    >
                      {m.title || m.text.slice(0, 48)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                Ligações de entrada ({linkedIn.length})
              </p>
              {linkedIn.length === 0 ? (
                <p className="text-xs text-white/35">Ninguém aponta para esta memória.</p>
              ) : (
                <ul className="space-y-1.5">
                  {linkedIn.map((m) => (
                    <li
                      key={m.id}
                      className="truncate rounded-lg border border-white/5 bg-black/25 px-2.5 py-1.5 text-xs text-white/70"
                      title={m.text}
                    >
                      {m.title || m.text.slice(0, 48)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                Cápsulas desta memória ({capsuleStats.length})
              </p>
              {capsuleStats.length === 0 ? (
                <p className="text-xs text-white/35">Ainda sem cápsulas públicas.</p>
              ) : (
                <ul className="space-y-2">
                  {capsuleStats.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-lg border border-cyan-400/15 bg-cyan-500/[0.06] px-2.5 py-2 text-[11px] text-cyan-50/90"
                    >
                      <p className="font-medium truncate">{c.titleHint || c.id.slice(0, 10)}</p>
                      <p className="mt-0.5 text-white/40">
                        {c.views} vistas · {c.importCount} assimilação(ões)
                        {c.pack ? ` · pack ${c.itemCount || '?'}` : ''}
                      </p>
                      {c.createdAt && (
                        <p className="text-white/30">
                          {new Date(c.createdAt).toLocaleDateString('pt-PT')}
                          {c.expiresAt ? ` · expira ${new Date(c.expiresAt).toLocaleDateString('pt-PT')}` : ''}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* READ panel */}
        {panel === 'read' && (
          <div className="p-4">
            <button onClick={() => setPanel('menu')} className="text-xs text-white/30 hover:text-white/60 mb-3 flex items-center gap-1 transition-colors">
              ← Voltar
            </button>
            <div className="max-h-60 overflow-y-auto pr-1 custom-scrollbar">
              <p className="text-white/80 text-sm leading-relaxed">{session.text}</p>
              <div className="mt-3">
                <AttachmentPreviewGrid attachments={session.attachments} />
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap gap-1.5">
              {session.tags?.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/20 text-violet-300 text-xs">
                  #{tag}
                </span>
              ))}
            </div>
            <p className="text-white/25 text-xs mt-2">{date}</p>
          </div>
        )}

        {/* EDIT panel */}
        {panel === 'edit' && (
          <div className="p-4">
            <button onClick={() => setPanel('menu')} className="text-xs text-white/30 hover:text-white/60 mb-3 flex items-center gap-1 transition-colors">
              ← Voltar
            </button>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full h-36 bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white/80 resize-none focus:outline-none focus:border-violet-500/50 placeholder-white/20"
              placeholder="Escreve a tua memória..."
              autoFocus
            />
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full mt-2 py-2.5 rounded-xl bg-violet-600/80 hover:bg-violet-600 text-white text-sm font-medium transition-all disabled:opacity-50"
            >
              {isSaving ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        )}

      </div>
    </div>
    </>
  );
};
