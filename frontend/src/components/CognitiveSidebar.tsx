import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Star, Sun, Circle, Orbit, Zap, Infinity as InfinityIcon, Cloud,
  Edit3, Save, Send, Link2, Copy, Download,
  Sparkles, Globe, Radio, Activity, Trash2, FileText, BookOpen,
  ChevronRight, Archive, Users
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useUniverseStore } from '../store/universeStore';
import type { CelestialType } from '../types/universe';
import type { SessionData } from '../hooks/useSessions';
import { AttachmentPreviewGrid } from './AttachmentPreviewGrid';
import { MemoryAttachmentsPanel } from './MemoryAttachmentsPanel';
import { buildMemoryDeepLink } from '../utils/deepLinks';
import { InsightsPanel } from './InsightsPanel';
import { WebResearchPanel } from './WebResearchPanel';
import { type TransmissionDraft } from './TransmissionPanel';
import { useTranslation, type TranslationKey } from '../utils/translations';
import {
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from '../utils/taxonomy';
import { downloadMemory, type ExportFormat } from '../utils/export';
import { TeamMemoryConnectionsPanel } from './TeamMemoryConnectionsPanel';
import {auth} from '../firebase';
import {useMemoryEditor} from '../hooks/useMemoryEditor';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {MemoryEditorStatus} from './MemoryEditorStatus';

const TYPE_ICONS: Record<CelestialType, React.ReactNode> = {
  star: <Star size={15} />,
  sun: <Sun size={15} />,
  planet: <Circle size={15} />,
  moon: <Orbit size={15} />,
  comet: <Zap size={15} />,
  black_hole: <InfinityIcon size={15} />,
  nebula: <Cloud size={15} />,
};

const TYPE_LABEL_KEYS: Record<CelestialType, TranslationKey> = {
  star: 'typeStar',
  sun: 'typeSun',
  planet: 'typePlanet',
  moon: 'typeMoon',
  comet: 'typeComet',
  black_hole: 'typeBlackHole',
  nebula: 'typeNebula',
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

export type SidebarTab = 'memory' | 'insights' | 'web' | 'comms';

interface CognitiveSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab?: SidebarTab;
  onTabChange?: (tab: SidebarTab) => void;
  allSessions?: readonly SessionData[];
  onSaveMemory?: import('../types/universe').MemorySaveCallback;
  onDeleteMemory?: import('../types/universe').MemoryDeleteCallback;
  onOpenTransmission?: (
    draft?: TransmissionDraft | null,
    tab?: 'compose' | 'contacts' | 'inbox' | 'sent' | 'identity',
  ) => void;
  onOpenWebResearch?: (query: string) => void;
  onOpenExport?: () => void;
}

export const CognitiveSidebar: React.FC<CognitiveSidebarProps> = ({
  isOpen,
  onClose,
  activeTab: externalTab,
  onTabChange,
  allSessions = [],
  onSaveMemory,
  onDeleteMemory,
  onOpenTransmission,
  onOpenExport,
}) => {
  const { t, language } = useTranslation();
  const {
    memories,
    selectedMemoryId,
    selectMemory,
    startDeletion,
    removeMemory,
    setStudyMemoryId,
  } = useUniverseStore();
  const [internalTab, setInternalTab] = useState<SidebarTab>('memory');
  const currentTab = externalTab || internalTab;

  const setTab = (tab: SidebarTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  const selected = useMemo(() => memories.find((m) => m.id === selectedMemoryId), [memories, selectedMemoryId]);
  const selectedId=selected?.id;
  const editor=useMemoryEditor(selected,onSaveMemory,isOpen&&currentTab==='memory');
  const isEditing=editor.editing,draftText=editor.text,draftTitle=editor.title,setDraftText=editor.setText,setDraftTitle=editor.setTitle;
  const [metadataSaving, setIsSaving] = useState(false);
  const isSaving=metadataSaving||editor.busy;
  const feedback=useSyncFeedback(isOpen&&currentTab==='memory');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (selectedId) {
      if (!externalTab) setInternalTab('memory');
    }
  }, [selectedId, externalTab]);

  const connectedMemories = useMemo(() => {
    if (!selected) return [];
    return memories.filter((m) => selected.connections.includes(m.id)).slice(0, 10);
  }, [memories, selected]);

  const handleDelete = async () => {
    if (!selected || !onDeleteMemory || isDeleting || isSaving) return;
    if (!window.confirm('Apagar este corpo celeste da galáxia cognitiva? (Supernova)')) return;
    setIsDeleting(true);
    try {
      const captured=structuredClone(selected),actor=auth.currentUser?.uid;if(!actor)return;const current=feedback.capture(actor);if(!current())return;
      await onDeleteMemory(captured.id,captured,()=>{if(!current())throw Error('Deletion view changed');});if(!current())return;
      if(useUniverseStore.getState().selectedMemoryId!==captured.id)return;
      startDeletion(selected.id, 'supernova');
      setTimeout(() => {
        if(!current())return;const state=useUniverseStore.getState(),present=state.memories.find(item=>item.id===captured.id);if(present&&present.persistedStateDigest!==captured.persistedStateDigest)return;removeMemory(captured.id);
        if (state.selectedMemoryId === captured.id) selectMemory(null);
      }, 800);
      toast.success('Memória absorvida pelo cosmos.', { icon: '✨' });
    } catch { /* Keep the memory visible if persistence refuses deletion. */ }
    finally { setIsDeleting(false); }
  };

  const handleSave = async () => {
    if (!selected || !onSaveMemory || !draftText.trim() || isSaving || isDeleting) return;
    if(await editor.submit())toast.success('Memória atualizada com sucesso.');
  };

  const handleCopyLink = () => {
    if (!selected) return;
    const url = buildMemoryDeepLink(selected.id);
    navigator.clipboard.writeText(url);
    toast.success('Link direto copiado para a área de transferência.');
  };

  const handleProjectStatus = async (status: ProjectStatus | null) => {
    if (!selected || !onSaveMemory || isSaving || isDeleting || !editor.writesEnabled) return;
    const actor=auth.currentUser?.uid;if(!actor)return;const current=feedback.capture(actor),target=selected.id;
    if(!current())return;
    const nextTags = (selected.tags || []).filter((tag) => !/^status:/i.test(tag));
    if (status) nextTags.push(`status:${status}`);
    setIsSaving(true);
    try {
      if(!await editor.saveMetadata({projectStatus:status,tags:nextTags})&&current()&&useUniverseStore.getState().selectedMemoryId===target)toast.error('Não foi possível confirmar o estado do projeto. A memória atual foi conservada.');
    } catch {
      if(current()&&useUniverseStore.getState().selectedMemoryId===target)toast.error('Não foi possível confirmar o estado do projeto. A memória atual foi conservada.');
    } finally {
      setIsSaving(false);
    }
  };

  const statusLang = language.startsWith('en') || language.startsWith('fr') ? 'en' : 'pt';

  const handleExport = (format: ExportFormat) => {
    if (!selected) return;
    try {
      downloadMemory(
        {
          id: selected.id,
          text: selected.text || '',
          title: selected.title,
          tags: selected.tags,
          category: selected.category,
          timestamp: selected.timestamp,
        },
        format,
      );
      toast.success(
        format === 'html'
          ? 'HTML descarregado — abre e usa Imprimir → Guardar como PDF'
          : `Ficheiro .${format === 'docx' ? 'doc' : format} descarregado`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível exportar.');
    }
  };

  const handleTransmitClick = () => {
    if (!selected) return;
    onOpenTransmission?.({
      memoryId: selected.id,
      title: selected.title,
      text: selected.text,
    });
  };

  // Convert universe memories to SessionData format for InsightsPanel/WebResearchPanel if needed
  const sessionDataList: readonly SessionData[] = useMemo(() => {
    if (allSessions.length > 0) return allSessions;
    return memories.map((m) => ({
      id: m.id,
      uid: m.uid,
      text: m.text,
      title: m.title,
      timestamp: m.timestamp,
      updatedAt: m.updatedAt,
      tags: m.tags,
      category: m.category,
      connections: m.connections,
      embedding: m.embedding,
      embeddingModel: m.embeddingModel,
    }));
  }, [allSessions, memories]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 340 }}
          className="pointer-events-auto fixed bottom-0 right-0 top-0 z-40 flex w-full max-w-md flex-col border-l border-white/10 bg-[#040817]/94 shadow-[-20px_0_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl sm:max-w-lg"
        >
          {/* Header & Tabs */}
          <div className="flex flex-col border-b border-white/[0.08] bg-black/30 p-4 pb-3">
            <div className="flex items-center justify-between gap-3 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl border border-violet-400/25 bg-violet-500/15 p-2 text-violet-300">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-white">Cognitive Sidebar</h2>
                  <p className="text-[11px] text-slate-400">
                    {memories.length} corpos celestes · {memories.reduce((acc, m) => acc + m.connections.length, 0) / 2} ligações
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {onOpenExport && (
                  <button
                    type="button"
                    onClick={onOpenExport}
                    className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                    title={t('exportOpen')}
                  >
                    <Archive className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                  title="Fechar Sidebar (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Tab Pills */}
            <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              <button
                type="button"
                onClick={() => setTab('memory')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                  currentTab === 'memory'
                    ? 'bg-violet-500/25 text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.3)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Orbit className="h-3.5 w-3.5 text-indigo-300" />
                <span className="truncate">Foco</span>
              </button>

              <button
                type="button"
                onClick={() => setTab('insights')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                  currentTab === 'insights'
                    ? 'bg-violet-500/25 text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.3)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
                <span className="truncate">Insights</span>
              </button>

              <button
                type="button"
                onClick={() => setTab('web')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                  currentTab === 'web'
                    ? 'bg-violet-500/25 text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.3)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Globe className="h-3.5 w-3.5 text-sky-300" />
                <span className="truncate">Web</span>
              </button>

              <button
                type="button"
                onClick={() => setTab('comms')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                  currentTab === 'comms'
                    ? 'bg-violet-500/25 text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.3)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Radio className="h-3.5 w-3.5 text-fuchsia-300" />
                <span className="truncate">Comms</span>
              </button>
            </div>
          </div>

          {/* Tab Content Area */}
          <div className="mnem-scroll flex-1 overflow-y-auto p-4 sm:p-5">
            {/* 1. MEMORY TAB */}
            {currentTab === 'memory' && (
              <div className="space-y-5">
                {selected ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2" style={{ color: TYPE_COLORS[selected.celestialType] }}>
                        {TYPE_ICONS[selected.celestialType]}
                        <span className="text-xs font-semibold uppercase tracking-wider">
                          {t(TYPE_LABEL_KEYS[selected.celestialType])}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setStudyMemoryId(selected.id)}
                          className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-1.5 text-amber-100 transition hover:bg-amber-500/25"
                          title={t('studyOpen')}
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyLink}
                          className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                          title="Copiar Deep Link"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <div className="relative group">
                          <button
                            type="button"
                            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                            title="Descarregar (MD / PDF / Word)"
                            aria-haspopup="menu"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <div className="invisible absolute right-0 top-full z-20 mt-1 min-w-[9.5rem] rounded-xl border border-white/10 bg-[#0b1220]/95 p-1 opacity-0 shadow-xl backdrop-blur-xl transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                            {(
                              [
                                ['md', 'Markdown (.md)'],
                                ['html', 'PDF via HTML'],
                                ['docx', 'Word (.doc)'],
                                ['txt', 'Texto (.txt)'],
                              ] as const
                            ).map(([fmt, label]) => (
                              <button
                                key={fmt}
                                type="button"
                                onClick={() => handleExport(fmt)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] text-slate-200 hover:bg-white/10"
                              >
                                <FileText className="h-3 w-3 text-cyan-300" />
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleTransmitClick}
                          className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                          title="Transmitir E2E"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={isDeleting || isSaving || !onDeleteMemory}
                          className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-1.5 text-rose-300 transition hover:bg-rose-500/25 hover:text-rose-100"
                          title="Apagar Memória (Supernova)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {(selected.taxonomyLane === 'B' || selected.projectStatus || (selected.tags || []).some((tag) => tag === 'projeto' || tag.startsWith('status:'))) && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/35">
                          {t('projectStatusLabel')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {([
                            ['planned', 'projectStatusPlanned'],
                            ['active', 'projectStatusActive'],
                            ['done', 'projectStatusDone'],
                          ] as const).map(([status, labelKey]) => {
                            const active = selected.projectStatus === status;
                            return (
                              <button
                                key={status}
                                type="button"
                                disabled={isSaving||!editor.writesEnabled}
                                onClick={() => void handleProjectStatus(active ? null : status)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                                  active
                                    ? 'border-sky-400/50 bg-sky-500/25 text-sky-100'
                                    : 'border-white/10 bg-white/5 text-white/55 hover:bg-white/10'
                                }`}
                              >
                                {t(labelKey)}
                              </button>
                            );
                          })}
                        </div>
                        {selected.projectStatus && (
                          <p className="mt-2 text-[11px] text-white/40">
                            {PROJECT_STATUS_LABELS[selected.projectStatus][statusLang]}
                          </p>
                        )}
                      </div>
                    )}

                    {isEditing ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          disabled={isSaving||!editor.ready}
                          placeholder="Título da memória…"
                          className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm font-semibold text-white outline-none focus:border-violet-400/50"
                        />
                        <textarea
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          disabled={isSaving||!editor.ready}
                          rows={8}
                          className="w-full resize-none rounded-xl border border-white/15 bg-white/[0.06] p-3.5 text-sm leading-relaxed text-slate-100 outline-none focus:border-violet-400/50"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={editor.close}
                            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/10"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving||!editor.canSubmit}
                            className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-violet-500"
                          >
                            <Save className="h-3.5 w-3.5" /> Gravar Alterações
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {selected.title && (
                          <h3 className="text-lg font-bold tracking-tight text-white">{selected.title}</h3>
                        )}

                        {selected.attachments && selected.attachments.some((a) => a.type === 'image') && (
                          <AttachmentPreviewGrid
                            attachments={selected.attachments.filter((a) => a.type === 'image')}
                            sessionId={selected.id}
                          />
                        )}

                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{selected.text}</p>
                        <MemoryAttachmentsPanel key={`attachments:${selected.id}`} memory={selected} />
                        {selected.teamId && <TeamMemoryConnectionsPanel key={selected.id} memory={selected} peers={memories} />}

                        {selected.attachments && selected.attachments.some((a) => a.type !== 'image') && (
                          <AttachmentPreviewGrid
                            attachments={selected.attachments.filter((a) => a.type !== 'image')}
                            sessionId={selected.id}
                          />
                        )}

                        {selected.tags && selected.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {selected.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full border border-violet-400/25 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-200"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between border-t border-white/5 pt-3 text-xs text-slate-400">
                          <span>📅 {new Date(selected.timestamp).toLocaleDateString('pt-PT')}</span>
                          <span>Gravidade: {Math.round(selected.importance * 100)}%</span>
                        </div>

                        <button
                          type="button"
                          onClick={()=>void editor.begin()}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
                        >
                          <Edit3 className="h-3.5 w-3.5 text-violet-300" /> Editar Memória
                        </button>
                      </div>
                    )}

                    <MemoryEditorStatus message={editor.message} busy={editor.busy} retryOpening={editor.canRetryOpening} onReopen={editor.discardAndReopen}/>
                    {/* Conexões */}
                    {connectedMemories.length > 0 && (
                      <div className="border-t border-white/[0.08] pt-4">
                        <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                          <Link2 className="h-3.5 w-3.5 text-indigo-300" />
                          Corpos Conectados ({connectedMemories.length})
                        </p>
                        <div className="space-y-1.5">
                          {connectedMemories.map((mem) => (
                            <button
                              key={mem.id}
                              type="button"
                              onClick={() => selectMemory(mem.id)}
                              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-left transition hover:border-indigo-400/30 hover:bg-indigo-500/10"
                            >
                              <div className="flex items-center gap-2 overflow-hidden">
                                <span style={{ color: TYPE_COLORS[mem.celestialType] }}>
                                  {TYPE_ICONS[mem.celestialType]}
                                </span>
                                <span className="truncate text-xs text-slate-200">
                                  {mem.title || mem.text.slice(0, 36)}
                                </span>
                              </div>
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="mb-4 rounded-2xl border border-indigo-400/20 bg-indigo-500/10 p-4">
                      <Orbit className="h-8 w-8 animate-[spin_10s_linear_infinite] text-indigo-300" />
                    </div>
                    <h3 className="text-base font-semibold text-white">Nenhum corpo celeste selecionado</h3>
                    <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-400">
                      Clica em qualquer estrela, planeta ou nebulosa no espaço 3D para inspecionar, editar e navegar pelas suas conexões.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 2. INSIGHTS TAB */}
            {currentTab === 'insights' && (
              <div className="space-y-4">
                <InsightsPanel
                  sessions={sessionDataList}
                  onMemoryClick={(session) => {
                    selectMemory(session.id);
                    setTab('memory');
                  }}
                  onClose={() => undefined}
                />
              </div>
            )}

            {/* 3. WEB RESEARCH TAB */}
            {currentTab === 'web' && (
              <div className="space-y-4">
                <WebResearchPanel
                  isOpen={true}
                  onClose={() => setTab('memory')}
                  sessions={sessionDataList}
                  initialQuery=""
                  onMemoryCreated={(memoryId) => {
                    selectMemory(memoryId);
                    setTab('memory');
                    toast.success('Pesquisa assimilada no cosmos.');
                  }}
                />
              </div>
            )}

            {/* 4. COMMS TAB */}
            {currentTab === 'comms' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-4">
                  <div className="flex items-center gap-2 pb-2 text-xs font-semibold uppercase tracking-wider text-fuchsia-200">
                    <Radio className="h-4 w-4" /> Comms E2E
                  </div>
                  <p className="text-xs leading-relaxed text-slate-300">
                    Envia e recebe cápsulas cifradas, gere contactos e importa packs no teu Universo. O servidor só vê ciphertext.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenTransmission?.(null, 'compose')}
                    className="rounded-xl border border-fuchsia-400/25 bg-fuchsia-500/15 px-3 py-3 text-left transition hover:bg-fuchsia-500/25"
                  >
                    <Send className="mb-1.5 h-4 w-4 text-fuchsia-200" />
                    <p className="text-xs font-semibold text-white">Enviar</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">Compor cápsula</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenTransmission?.(null, 'inbox')}
                    className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-3 text-left transition hover:bg-emerald-500/20"
                  >
                    <Radio className="mb-1.5 h-4 w-4 text-emerald-200" />
                    <p className="text-xs font-semibold text-white">Receber</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">Inbox & importar</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenTransmission?.(null, 'contacts')}
                    className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-3 text-left transition hover:bg-cyan-500/20"
                  >
                    <Users className="mb-1.5 h-4 w-4 text-cyan-200" />
                    <p className="text-xs font-semibold text-white">Contactos</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">Pedidos & amigos</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenTransmission?.(null, 'sent')}
                    className="rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 py-3 text-left transition hover:bg-violet-500/20"
                  >
                    <Activity className="mb-1.5 h-4 w-4 text-violet-200" />
                    <p className="text-xs font-semibold text-white">Enviadas</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">Histórico outbox</p>
                  </button>
                </div>

                {selected ? (
                  <button
                    type="button"
                    onClick={handleTransmitClick}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 py-3 text-xs font-semibold text-white shadow-lg hover:from-fuchsia-500 hover:to-indigo-500"
                  >
                    <Send className="h-3.5 w-3.5" /> Transmitir memória em foco
                  </button>
                ) : (
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Seleciona um corpo no Universo para transmitir essa memória, ou abre Enviar / Receber acima.
                  </p>
                )}
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
