import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Star, Sun, Circle, Orbit, Zap, Infinity as InfinityIcon, Cloud,
  Edit3, Save, Send, Shield, ChevronDown, ChevronUp, Link2, Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useUniverseStore } from '../../store/universeStore';
import type { CelestialType, MemoryObject } from '../../types/universe';
import { AttachmentPreviewGrid } from '../AttachmentPreviewGrid';
import { buildMemoryDeepLink } from '../../utils/deepLinks';

const TYPE_ICONS: Record<CelestialType, React.ReactNode> = {
  star: <Star size={16} />,
  sun: <Sun size={16} />,
  planet: <Circle size={16} />,
  moon: <Orbit size={16} />,
  comet: <Zap size={16} />,
  black_hole: <InfinityIcon size={16} />,
  nebula: <Cloud size={16} />,
};

const TYPE_LABELS: Record<CelestialType, string> = {
  star: 'Estrela',
  sun: 'Sol · núcleo',
  planet: 'Planeta',
  moon: 'Lua',
  comet: 'Cometa',
  black_hole: 'Buraco negro',
  nebula: 'Nebulosa',
};

const TYPE_COLORS: Record<CelestialType, string> = {
  star: '#aaccff',
  sun: '#ffdd44',
  planet: '#4488ff',
  moon: '#aaaaaa',
  comet: '#44ddff',
  black_hole: '#aa44ff',
  nebula: '#ff44aa',
};

interface MemoryDetailProps {
  onDelete?: (id: string) => void;
  onSave?: (memory: MemoryObject) => Promise<void> | void;
  onTransmit?: (memory: MemoryObject) => void;
}

export const MemoryDetail: React.FC<MemoryDetailProps> = ({ onDelete, onSave, onTransmit }) => {
  const { memories, selectedMemoryId, selectMemory, startDeletion, removeMemory, updateMemory } = useUniverseStore();
  const selected = memories.find((m) => m.id === selectedMemoryId);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    setDraftText(selected?.text ?? '');
    setIsEditing(false);
  }, [selected?.id, selected?.text]);

  const connectedMemories = selected
    ? memories.filter((m) => selected.connections.includes(m.id)).slice(0, 8)
    : [];

  const handleDelete = () => {
    if (!selected) return;
    if (!window.confirm('Apagar esta memória do universo? (animação de supernova)')) return;
    startDeletion(selected.id, 'supernova');
    onDelete?.(selected.id);
    setTimeout(() => {
      removeMemory(selected.id);
      selectMemory(null);
    }, 800);
  };

  const handleSave = async () => {
    if (!selected || !draftText.trim() || isSaving) return;
    const nextMemory: MemoryObject = {
      ...selected,
      text: draftText.trim(),
      updatedAt: Date.now(),
    };
    setIsSaving(true);
    updateMemory(selected.id, {
      text: nextMemory.text,
      updatedAt: nextMemory.updatedAt,
    });
    try {
      await onSave?.(nextMemory);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {selected && (
        <motion.div
          initial={{ opacity: 0, x: 36 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 36 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto absolute bottom-28 right-3 top-20 z-30 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-3 md:right-5 md:top-24"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-2xl border border-white/10 bg-[#07101f]/92 p-5 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2" style={{ color: TYPE_COLORS[selected.celestialType] }}>
                {TYPE_ICONS[selected.celestialType]}
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {TYPE_LABELS[selected.celestialType]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => selectMemory(null)}
                className="rounded-full p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
                aria-label="Fechar detalhe"
              >
                <X size={16} />
              </button>
            </div>

            {selected.title && (
              <h3 className="text-base font-semibold leading-snug text-white">
                {selected.title}
              </h3>
            )}

            <div className="mnem-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {isEditing ? (
                <textarea
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  className="min-h-40 w-full resize-none rounded-xl border border-white/10 bg-white/[0.05] p-3 text-sm leading-relaxed text-white/85 outline-none transition focus:border-indigo-300/35 focus:ring-2 focus:ring-indigo-300/10"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/75">
                  {selected.text}
                </p>
              )}

              <AttachmentPreviewGrid attachments={selected.attachments} />

              {selected.tags && selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {connectedMemories.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/40">
                    <Link2 size={12} />
                    Ligadas ({selected.connections.length})
                  </p>
                  <div className="flex flex-col gap-1">
                    {connectedMemories.map((mem) => (
                      <button
                        key={mem.id}
                        type="button"
                        onClick={() => selectMemory(mem.id)}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-white/60 transition hover:bg-white/10 hover:text-white"
                      >
                        <span style={{ color: TYPE_COLORS[mem.celestialType] }}>
                          {TYPE_ICONS[mem.celestialType]}
                        </span>
                        <span className="truncate">{mem.title || mem.text.substring(0, 40)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selected.auditTrail && selected.auditTrail.length > 0 && (
                <div className="mt-2 border-t border-white/5 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowAudit(!showAudit)}
                    className="flex w-full items-center justify-between text-left text-xs uppercase tracking-wider text-white/40 transition hover:text-white"
                  >
                    <span className="flex items-center gap-1.5 font-semibold text-indigo-300">
                      <Shield size={12} />
                      Auditoria
                    </span>
                    {showAudit ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  <AnimatePresence>
                    {showAudit && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="mt-2 space-y-2 overflow-hidden"
                      >
                        {selected.auditTrail.map((entry, idx) => (
                          <div
                            key={idx}
                            className="flex flex-col gap-1 rounded-lg border border-white/5 bg-black/40 p-2 font-mono text-[10px] text-white/50"
                          >
                            <div className="flex items-center justify-between">
                              <span className="truncate font-semibold text-indigo-300">
                                {entry.action.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[9px] text-white/30">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="font-sans text-[10px] leading-relaxed text-white/70">
                              {entry.details}
                            </p>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-white/5 pt-2 text-xs text-white/35">
              <span>{new Date(selected.timestamp).toLocaleDateString('pt-PT')}</span>
              <span className="ml-auto">
                Importância {(selected.importance * 100).toFixed(0)}%
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isEditing) {
                    void handleSave();
                    return;
                  }
                  setIsEditing(true);
                }}
                disabled={isSaving}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-indigo-300/20 bg-indigo-300/10 px-3 py-2 text-xs text-indigo-100 transition hover:bg-indigo-300/20 disabled:opacity-50"
              >
                {isEditing ? <Save size={14} /> : <Edit3 size={14} />}
                {isEditing ? (isSaving ? '…' : 'Guardar') : 'Editar'}
              </button>
              <button
                type="button"
                onClick={() => onTransmit?.(selected)}
                disabled={!onTransmit}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-40"
              >
                <Send size={14} />
                Comms
              </button>
              <button
                type="button"
                onClick={async () => {
                  const link = buildMemoryDeepLink(selected.id, 'universe');
                  try {
                    await navigator.clipboard.writeText(link);
                    toast.success('Deep-link copiado');
                  } catch {
                    toast(link, { icon: '🔗' });
                  }
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-xs text-violet-100 transition hover:bg-violet-300/20"
              >
                <Copy size={14} />
                Link
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300 transition hover:bg-red-400/20"
              >
                Apagar
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
