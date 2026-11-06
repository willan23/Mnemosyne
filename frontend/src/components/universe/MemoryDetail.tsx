import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Star, Sun, Circle, Orbit, Zap, Infinity as InfinityIcon, Cloud,
  Edit3, Save, Send, Shield, ChevronDown, ChevronUp, Link2, Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import { useUniverseStore } from '../../store/universeStore';
import type { CelestialType, MemoryObject } from '../../types/universe';
import { AttachmentPreviewGrid } from '../AttachmentPreviewGrid';
import { MemoryAttachmentsPanel } from '../MemoryAttachmentsPanel';
import { buildMemoryDeepLink } from '../../utils/deepLinks';
import { TEAM_WRITES_ENABLED, TEAM_READ_ONLY_MESSAGE } from '../../config/releaseGates';
import { TeamMemoryConnectionsPanel } from '../TeamMemoryConnectionsPanel';
import {useMemoryEditor} from '../../hooks/useMemoryEditor';
import {useSyncFeedback} from '../../hooks/useSyncFeedback';
import {MemoryEditorStatus} from '../MemoryEditorStatus';
import {prepareSemanticRelationReview,applySemanticRelationReview,semanticRelationWritesEnabled} from '../../services/semanticRelationRecovery';
import {memoryEditStateDigest} from '../../services/memoryEditRecovery';
import {ShareModal} from '../ShareModal';
import {isMemoryCryptoReady} from '../../services/memoryCrypto';

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
  onDelete?: import('../../types/universe').MemoryDeleteCallback;
  onSave?: import('../../types/universe').MemorySaveCallback;
  onTransmit?: (memory: MemoryObject) => void;
}

interface RelationSuggestion {
  targetId: string;
  score: number;
  embeddingModel: string;
  sourceUpdatedAt: number;
  targetUpdatedAt: number;
  proposedAt: number;
  status:'suggested'|'accepted';
  viewDigest:string;
}

function isPrivatePersonalMemory(memory: MemoryObject | undefined, uid: string): boolean {
  return Boolean(memory && memory.uid === uid && !memory.teamId &&
    !memory.teamScopeAmbiguous && !memory.encLocked &&
    (memory.sharedWithIds == null ||
      (Array.isArray(memory.sharedWithIds) && memory.sharedWithIds.length === 0)));
}

export const MemoryDetail: React.FC<MemoryDetailProps> = ({ onDelete, onSave, onTransmit }) => {
  const { memories, selectedMemoryId, selectMemory, startDeletion, removeMemory } = useUniverseStore();
  const selected = memories.find((m) => m.id === selectedMemoryId);
  const editor=useMemoryEditor(selected,onSave);
  const isEditing=editor.editing,draftText=editor.text,setDraftText=editor.setText,isSaving=editor.busy;
  const feedback=useSyncFeedback();
  const {epoch:feedbackEpoch,capture:captureFeedback}=feedback;
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [shareScope,setShareScope]=useState<string|null>(null);
  const sharingScope=JSON.stringify([auth.currentUser?.uid,selected?.id,selected?.persistedUpdatedAt??selected?.updatedAt,feedback.epoch]);
  const suggestionScope=JSON.stringify([auth.currentUser?.uid,selected?.id,feedbackEpoch]);
  const [suggestionState,setSuggestionState]=useState<{scope:string;rows:RelationSuggestion[]}>({scope:suggestionScope,rows:[]});
  const suggestions=suggestionState.scope===suggestionScope?suggestionState.rows:[];
  const reviewScope=JSON.stringify([selected?.id,selected?.persistedStateDigest,feedback.epoch]);
  const [reviewState,setReviewState]=useState<{scope:string;targetId:string|null}>({scope:reviewScope,targetId:null});
  const reviewingTargetId=reviewState.scope===reviewScope?reviewState.targetId:null;
  const selectedId = selected?.id;
  const canReadSuggestions = Boolean(selected && auth.currentUser &&
    isPrivatePersonalMemory(selected, auth.currentUser.uid));

  useEffect(() => {
    if (!selectedId || !canReadSuggestions) {
      setSuggestionState({scope:suggestionScope,rows:[]});
      return;
    }
    const uid=auth.currentUser?.uid;if(!uid)return;const current=captureFeedback(uid);let active=true,revision=0;
    const stop=onSnapshot(
      collection(db, 'sessions', selectedId, 'relationSuggestions'),
      (snapshot) => {const observed=++revision;void Promise.all(snapshot.docs.map(async(item):Promise<RelationSuggestion|null>=>{
        const data = item.data();
        return ['suggested','accepted'].includes(data.status) &&
          data.targetId === item.id &&
          typeof data.score === 'number' && Number.isFinite(data.score) &&
          data.score>=0&&data.score<=1&&data.algorithmVersion==='cosine-v1'&&data.evidence==='whole-memory-vector'&&
          typeof data.embeddingModel === 'string' &&
          typeof data.proposedAt === 'number' && Number.isFinite(data.proposedAt) &&
          typeof data.sourceUpdatedAt === 'number' &&
          typeof data.targetUpdatedAt === 'number'
          ? { targetId: item.id, score: data.score, embeddingModel: data.embeddingModel,
              sourceUpdatedAt: data.sourceUpdatedAt, targetUpdatedAt: data.targetUpdatedAt,
              proposedAt: data.proposedAt,status:data.status as 'suggested'|'accepted',viewDigest:await memoryEditStateDigest(data) }
          : null;
      })).then(rows=>{if(active&&observed===revision&&current())setSuggestionState({scope:suggestionScope,rows:rows.filter((row):row is RelationSuggestion=>row!==null).sort((a,b)=>b.score-a.score)});}).catch(()=>{if(active&&observed===revision&&current())setSuggestionState({scope:suggestionScope,rows:[]});});},
      () => {if(active&&current())setSuggestionState({scope:suggestionScope,rows:[]});},
    );
    return()=>{active=false;revision++;stop();};
  }, [selectedId, canReadSuggestions,feedbackEpoch,captureFeedback,suggestionScope]);

  const connectedMemories = selected
    ? memories.filter((m) => selected.connections.includes(m.id)).slice(0, 8)
    : [];
  const visibleSuggestions = selected
    ? suggestions.filter(row=>row.status==='suggested').flatMap((suggestion) => {
      const target = memories.find((memory) => memory.id === suggestion.targetId);
      return target && isPrivatePersonalMemory(target, selected.uid) &&
        suggestion.sourceUpdatedAt === selected.updatedAt &&
        suggestion.targetUpdatedAt === target.updatedAt &&
        !selected.connections.includes(target.id)
        ? [{ ...suggestion, target }]
        : [];
    }).slice(0, 7)
    : [];

  const reviewSuggestion = async (targetId: string, decision: 'accepted' | 'rejected') => {
    if (!selected || reviewingTargetId || !auth.currentUser ||
      !isPrivatePersonalMemory(selected, auth.currentUser.uid)) return;
    const actor=auth.currentUser.uid,source=structuredClone(selected),candidate=memories.find(row=>row.id===targetId),target=candidate?structuredClone(candidate):undefined,proposal=visibleSuggestions.find(row=>row.targetId===targetId);
    if(!target?.persistedStateDigest||!source.persistedStateDigest||!proposal||!semanticRelationWritesEnabled())return;
    const captured=feedback.capture(actor),current=()=>{const state=useUniverseStore.getState();return captured()&&state.selectedMemoryId===source.id&&state.memories.find(row=>row.id===source.id)?.persistedStateDigest===source.persistedStateDigest&&state.memories.find(row=>row.id===targetId)?.persistedStateDigest===target.persistedStateDigest;},guard=()=>{if(!current())throw Error('A vista da relação mudou.');};if(!current())return;
    setReviewState({scope:reviewScope,targetId});
    try {
      const baseline=await prepareSemanticRelationReview(actor,{sourceId:source.id,targetId,sourceViewDigest:source.persistedStateDigest,targetViewDigest:target.persistedStateDigest,suggestionViewDigest:proposal.viewDigest},guard);guard();
      if(decision==='accepted'&&!window.confirm(`Aceitar a ligação recíproca ${source.title||'Memória selecionada'} ↔ ${target.title||'Memória relacionada'}?`))return;guard();
      await applySemanticRelationReview(actor,baseline,decision,guard);if(current())toast.success(decision === 'accepted' ? 'Ligação aceite' : 'Sugestão rejeitada');
    } catch {
      if(current())toast.error('A revisão aguarda confirmação. O pedido cifrado foi conservado quando já preparado.');
    } finally {
      if(current())setReviewState({scope:reviewScope,targetId:null});
    }
  };

  const handleDelete = async () => {
    if (!selected || !onDelete || isDeleting || isSaving) return;
    if (!window.confirm('Apagar esta memória do universo? (animação de supernova)')) return;
    setIsDeleting(true);
    try {
      const captured=structuredClone(selected),actor=auth.currentUser?.uid;if(!actor)return;const current=feedback.capture(actor);if(!current())return;await onDelete(captured.id,captured,()=>{if(!current())throw Error('Deletion view changed');});if(!current()||useUniverseStore.getState().selectedMemoryId!==captured.id)return;
      startDeletion(selected.id, 'supernova');
      setTimeout(() => {
        if(!current())return;const state=useUniverseStore.getState(),present=state.memories.find(item=>item.id===captured.id);if(present&&present.persistedStateDigest!==captured.persistedStateDigest)return;removeMemory(captured.id);
        if (state.selectedMemoryId === captured.id) selectMemory(null);
      }, 800);
    } catch { /* Persistence reports the fixed error; keep the memory visible. */ }
    finally { setIsDeleting(false); }
  };

  const handleSave = async () => {
    if (!selected || !onSave || !draftText.trim() || isSaving || isDeleting || selected.encLocked || selected.teamScopeAmbiguous) return;
    if (selected.teamId && !TEAM_WRITES_ENABLED) return;
    await editor.submit();
  };

  return (
    <AnimatePresence>
      {selected && (
        <motion.div
          key="memory-detail"
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
                  disabled={isSaving||!editor.ready}
                  className="min-h-40 w-full resize-none rounded-xl border border-white/10 bg-white/[0.05] p-3 text-sm leading-relaxed text-white/85 outline-none transition focus:border-indigo-300/35 focus:ring-2 focus:ring-indigo-300/10"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/75">
                  {selected.text}
                </p>
              )}
              <MemoryEditorStatus message={editor.message} busy={editor.busy} retryOpening={editor.canRetryOpening} onReopen={editor.discardAndReopen}/>

              <AttachmentPreviewGrid attachments={selected.attachments} sessionId={selected.id} />
              <MemoryAttachmentsPanel key={`attachments:${selected.id}`} memory={selected} />
              {selected.teamId && <TeamMemoryConnectionsPanel key={selected.id} memory={selected} peers={memories} />}

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
                    Ligações existentes ({selected.connections.length})
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
                        {suggestions.some(row=>row.targetId===mem.id&&row.status==='accepted')&&<span className="text-[10px] text-indigo-300">Sugerida e aceite</span>}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-white/35">A origem das ligações antigas pode ser desconhecida.</p>
                </div>
              )}

              {visibleSuggestions.length > 0 && (
                <div className="space-y-2" aria-label="Sugestões de ligação semântica">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/50">
                    <Link2 size={12} /> Sugestões por similaridade
                  </p>
                  {visibleSuggestions.map(({ target, targetId, score, embeddingModel, proposedAt }) => (
                    <div key={targetId} className="rounded-lg border border-indigo-300/15 bg-indigo-300/5 p-2 text-xs text-white/70">
                      <button type="button" onClick={() => selectMemory(targetId)} className="block max-w-full truncate text-left text-indigo-200 hover:underline">
                        {target.title || target.text.slice(0, 40)}
                      </button>
                      <p className="mt-1 text-[10px] text-white/45">
                        Similaridade vetorial {(score * 100).toFixed(0)}%. Evidência: vetor da memória completa; sem excerto textual.
                      </p>
                      <p className="mt-1 break-all text-[10px] text-white/35">Modelo: {embeddingModel} · método: cosine-v1</p>
                      <p className="mt-1 text-[10px] text-white/35">Sugerida em {new Date(proposedAt).toLocaleDateString('pt-PT')} · por rever</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={Boolean(reviewingTargetId)||!semanticRelationWritesEnabled()||!selected.persistedStateDigest||!target.persistedStateDigest} onClick={() => void reviewSuggestion(targetId, 'accepted')} className="rounded bg-indigo-300/15 px-2 py-1 text-indigo-100 disabled:opacity-50">Aceitar</button>
                        <button type="button" disabled={Boolean(reviewingTargetId)||!semanticRelationWritesEnabled()||!selected.persistedStateDigest||!target.persistedStateDigest} onClick={() => void reviewSuggestion(targetId, 'rejected')} className="rounded bg-white/10 px-2 py-1 text-white/65 disabled:opacity-50">Rejeitar</button>
                      </div>
                    </div>
                  ))}
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
                  void editor.begin();
                }}
                disabled={isSaving || isDeleting || !onSave || selected.encLocked || selected.teamScopeAmbiguous || Boolean(selected.teamId && !TEAM_WRITES_ENABLED)||isEditing&&!editor.canSubmit}
                title={selected.teamId && !TEAM_WRITES_ENABLED ? TEAM_READ_ONLY_MESSAGE : undefined}
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
              <button type="button" disabled={selected.encLocked||selected.teamScopeAmbiguous||isSaving||isDeleting||!isMemoryCryptoReady()||!selected.teamId&&selected.uid!==auth.currentUser?.uid}
                className="rounded-xl border border-violet-300/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40" onClick={()=>setShareScope(sharingScope)}>Cápsula</button>
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
                disabled={isDeleting || isSaving || !onDelete || Boolean(selected.teamId && !TEAM_WRITES_ENABLED)}
                className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300 transition hover:bg-red-400/20"
              >
                Apagar
              </button>
            </div>
          </div>
        </motion.div>
      )}
      {selected&&shareScope===sharingScope&&<ShareModal key="share-dialog" session={{...selected,updatedAt:selected.persistedUpdatedAt??selected.updatedAt}}
        relatedSessions={memories.filter(row=>selected.connections.includes(row.id)).map(row=>({...row,updatedAt:row.persistedUpdatedAt??row.updatedAt}))}
        onClose={()=>setShareScope(null)} onOpenComms={onTransmit?()=>onTransmit(selected):undefined}/>}
    </AnimatePresence>
  );
};
