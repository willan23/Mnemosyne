import React, { useState, useEffect, useCallback } from 'react';
import { X, Edit3, Trash2, BookOpen, Download, FileText, Send } from 'lucide-react';
import { db, auth } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useNotificationStore } from '../store/notificationStore';
import type { SessionData } from '../hooks/useSessions';
import { markMemoryDeleted } from '../services/memoryDeletion';

interface Props {
  node: { id: string; x?: number; y?: number; screenX?: number; screenY?: number } | null;
  session: SessionData | null;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  graphRef: React.RefObject<any>;
  onDeleted: (id: string) => void;
  onTransmit?: (session: SessionData) => void;
}

type Panel = 'menu' | 'read' | 'edit';

export const MemoryActionPanel: React.FC<Props> = ({
  node, session, onClose, containerRef, graphRef, onDeleted, onTransmit,
}) => {
  const [panel, setPanel] = useState<Panel>('menu');
  const [editText, setEditText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(0);
  const { addNotification } = useNotificationStore();

  // Position panel near node on screen
  const [pos, setPos] = useState({ x: 0, y: 0 });

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
    <div
      className="fixed z-[150] memory-action-panel"
      style={{ left: pos.x, top: pos.y, width: 300 }}
    >
      <div className="rounded-2xl border border-white/10 bg-[#0b1120]/85 backdrop-blur-2xl shadow-2xl shadow-violet-900/20 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_6px_rgba(139,92,246,0.8)]" />
            <span className="text-xs text-white/50 font-medium tracking-widest uppercase">Memória</span>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* MENU panel */}
        {panel === 'menu' && (
          <div className="p-4 space-y-2">
            <p className="text-white/80 text-sm font-medium line-clamp-2 mb-3">{session.text}</p>
            <p className="text-white/30 text-xs mb-4">{date}</p>
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
                onClick={handleDelete}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 text-rose-400 hover:text-rose-300 transition-all text-sm"
              >
                <Trash2 className="w-4 h-4" />
                <span>Apagar</span>
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
                <span>Enviar</span>
              </button>
            </div>
            {/* Export row */}
            <div className="flex gap-2 pt-1 border-t border-white/5">
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
  );
};
