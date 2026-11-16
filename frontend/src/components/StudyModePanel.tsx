import React, { useEffect, useMemo, useRef } from 'react';
import { BookOpen, Link2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useUniverseStore } from '../store/universeStore';
import { AttachmentPreviewGrid } from './AttachmentPreviewGrid';
import { useTranslation } from '../utils/translations';
import {useMemoryEditor} from '../hooks/useMemoryEditor';
import {MemoryEditorStatus} from './MemoryEditorStatus';

interface StudyModePanelProps {
  onSave?: import('../types/universe').MemorySaveCallback;
}

/**
 * Thin study mode: anexo | nota | ligações — sem sair do Universo.
 */
export const StudyModePanel: React.FC<StudyModePanelProps> = ({ onSave }) => {
  const { t } = useTranslation();
  const {
    memories,
    studyMemoryId,
    setStudyMemoryId,
    selectMemory,
  } = useUniverseStore();

  const selected = memories.find((m) => m.id === studyMemoryId) || null;
  const editor=useMemoryEditor(selected,onSave),draft=editor.text,setDraft=editor.setText,isSaving=editor.busy;
  const beginRef=useRef(editor.begin);useEffect(()=>{beginRef.current=editor.begin;},[editor.begin]);
  const canPrepare=Boolean(selected&&!selected.encLocked&&!selected.teamScopeAmbiguous&&selected.persistedStateDigest&&selected.persistedTitle!==undefined);
  useEffect(()=>{if(canPrepare)void beginRef.current();},[editor.scope,canPrepare]);

  const attachments = selected?.attachments ?? [];
  const hasReadableAttachment = attachments.some((a) =>
    /\.(pdf|md|markdown|txt)$/i.test(a.name || '')
    || a.mimeType === 'application/pdf'
    || (a.mimeType || '').startsWith('text/'),
  );

  const connected = useMemo(() => {
    if (!selected) return [];
    return memories.filter((m) => selected.connections.includes(m.id)).slice(0, 12);
  }, [memories, selected]);

  if (!selected) return null;

  const handleSave = async () => {
    if (!onSave || !draft.trim() || isSaving) return;
    if(await editor.submit())toast.success(t('studySaved'));
  };

  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-28 top-24 z-40 mx-auto flex max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#050514]/94 shadow-2xl backdrop-blur-xl sm:inset-x-6">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0 text-amber-200" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
              {t('studyModeTitle')}
            </p>
            <h2 className="truncate text-sm font-semibold text-white">
              {selected.title || t('studyUntitled')}
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setStudyMemoryId(null)}
          className="rounded-full border border-white/10 p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label={t('studyClose')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1.1fr_1fr_0.7fr]">
        <section className="min-h-0 overflow-y-auto border-b border-white/10 p-4 md:border-b-0 md:border-r">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/35">
            {t('studyAttachment')}
          </p>
          {attachments.length > 0 ? (
            <AttachmentPreviewGrid attachments={attachments} sessionId={selected.id} />
          ) : (
            <p className="text-sm text-white/45">{t('studyNoAttachment')}</p>
          )}
          {!hasReadableAttachment && attachments.length > 0 && (
            <p className="mt-3 text-xs text-amber-200/70">{t('studyPreviewHint')}</p>
          )}
        </section>

        <section className="flex min-h-0 flex-col border-b border-white/10 p-4 md:border-b-0 md:border-r">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35">
              {t('studyNote')}
            </p>
            <button
              type="button"
              disabled={isSaving || !editor.canSubmit}
              onClick={() => void handleSave()}
              className="rounded-full border border-violet-400/30 bg-violet-500/20 px-3 py-1 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-40"
            >
              {isSaving ? t('studySaving') : t('studySave')}
            </button>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={Boolean(selected.encLocked)||isSaving||!editor.ready}
            className="min-h-[12rem] flex-1 resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-white/90 outline-none focus:border-violet-400/40"
            placeholder={t('studyNotePlaceholder')}
          />
          {!editor.editing&&<button type="button" disabled={isSaving||selected.encLocked||selected.teamScopeAmbiguous} onClick={()=>void editor.begin()} className="mt-2 rounded border border-white/20 px-3 py-2 text-xs text-white/80">Abrir edição da memória atual</button>}
          <MemoryEditorStatus message={editor.message} busy={editor.busy} retryOpening={editor.canRetryOpening} onReopen={editor.discardAndReopen}/>
        </section>

        <section className="min-h-0 overflow-y-auto p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/35">
            <Link2 className="h-3 w-3" />
            {t('studyLinks')}
          </p>
          {connected.length === 0 ? (
            <p className="text-sm text-white/45">{t('studyNoLinks')}</p>
          ) : (
            <ul className="space-y-1.5">
              {connected.map((mem) => (
                <li key={mem.id}>
                  <button
                    type="button"
                    onClick={() => {
                      selectMemory(mem.id);
                      setStudyMemoryId(mem.id);
                    }}
                    className="w-full rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/75 transition hover:border-violet-400/30 hover:bg-violet-500/10 hover:text-white"
                  >
                    {mem.title || mem.text.slice(0, 48) || mem.id.slice(0, 8)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
