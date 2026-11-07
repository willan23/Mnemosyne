import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import type { MemoryObject } from '../types/universe';
import { HTML_LANG, useTranslation } from '../utils/translations';
import {
  advanceReview, createReviewItem, loadReviewInbox, saveReviewInbox, previewReviewInboxLegacyOrigin, migrateLegacyReviewInbox, observeReviewInbox,
  exportReviewInboxBackup, prepareReviewInboxBackup, prepareRepeatedReviewInboxBackup, restoreReviewInboxBackup,
  type ReviewItem, type ReviewInboxView, type LegacyReviewPreview, type ReviewInboxBackupPreview,
} from '../services/reviewInbox';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady} from '../services/memoryCrypto';
import {reviewInboxCopy} from './reviewInboxCopy';
import {reviewInboxBackupCopy} from './reviewInboxBackupCopy';

interface Props {
  uid: string;
  memories: MemoryObject[];
  selectedMemoryId: string | null;
  onOpenSource: (id: string) => void;
  onClose: () => void;
}
interface State {scope: string; view: ReviewInboxView | null; error: string; busy: boolean; question: string; priority: 1 | 2 | 3;
  editingId: string | null; editQuestion: string; editBase: ReviewInboxView | null; preview: LegacyReviewPreview | null; confirmed: boolean;
  selectedLegacyDigest: string | null; backupPreview: ReviewInboxBackupPreview | null; backupConfirmed: boolean; backupMessage: string}
const empty = (scope: string): State => ({scope, view: null, error: '', busy: false, question: '', priority: 2, editingId: null, editQuestion: '', editBase: null, preview: null, confirmed: false,
  selectedLegacyDigest: null, backupPreview: null, backupConfirmed: false, backupMessage: ''});
function downloadBackup(text: string, filename: string, guard: () => void) {
  guard(); const url = URL.createObjectURL(new Blob([text], {type: 'application/json;charset=utf-8'}));
  try {const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; guard(); anchor.click(); guard();} finally {URL.revokeObjectURL(url);}
}
function containDialogKeys(event: KeyboardEvent<HTMLDialogElement>) {
  event.stopPropagation();
  if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]'))
    .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden],[inert]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
  const first = controls[0], last = controls[controls.length - 1], active = document.activeElement;
  if (!first || !last) {event.preventDefault(); return;}
  if (event.shiftKey ? active === first || !controls.includes(active as HTMLElement) : active === last || !controls.includes(active as HTMLElement)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  }
}

export function ReviewInboxPanel({ uid, memories, selectedMemoryId, onOpenSource, onClose }: Props) {
  const { t, language } = useTranslation();
  const copy = reviewInboxCopy[language], backupCopy = reviewInboxBackupCopy[language], {capture, epoch} = useSyncFeedback(), scope = JSON.stringify([uid, epoch]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const closed = useRef(false), operation = useRef<{scope: string; changes: Set<string | undefined>} | null>(null), known = useRef<{scope: string; revision: string | null}>({scope: '', revision: null});
  const queuedRevision = useRef<{scope: string; revision: string}>({scope: '', revision: ''});
  const readGeneration = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [revision, refresh] = useState(0), [stored, setStored] = useState<State>(() => empty(scope));
  const state = stored.scope === scope ? stored : empty(scope), {view, error, busy, question, priority, editingId, editQuestion} = state;
  const items = view?.items ?? [], unlocked = isMemoryCryptoReady(), ready = view !== null && unlocked;
  const update = (patch: Partial<State>) => setStored(current => ({...(current.scope === scope ? current : empty(scope)), ...patch}));
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {dialog?.close();};
  }, []);
  useEffect(() => {closed.current = false; return () => {closed.current = true;};}, []);
  useEffect(() => observeReviewInbox(revision => {
    if (revision && known.current.scope === scopeRef.current && known.current.revision === revision) return;
    if (revision && queuedRevision.current.scope === scopeRef.current && queuedRevision.current.revision === revision) return;
    if (revision) queuedRevision.current = {scope: scopeRef.current, revision};
    if (operation.current?.scope === scopeRef.current) {operation.current.changes.add(revision); return;}
    refresh(value => value + 1);
  }), []);
  useEffect(() => {
    if (operation.current?.scope === scope) {operation.current.changes.add(undefined); return;}
    const generation = ++readGeneration.current;
    let active = true; const captured = capture(uid), current = () => active && generation === readGeneration.current && !closed.current && scopeRef.current === scope && captured();
    const guard = () => {if (!current()) throw Error('Retired review view');};
    setStored(previous => ({...(previous.scope === scope ? previous : empty(scope)), view: null, preview: null, confirmed: false, selectedLegacyDigest: null, backupPreview: null, backupConfirmed: false}));
    if (unlocked && current()) void loadReviewInbox(uid, guard).then(view => {
      if (current()) {known.current = {scope, revision: view.revision}; setStored(previous => ({...(previous.scope === scope ? previous : empty(scope)), view}));}
    }).catch(() => {if (current()) setStored(previous => ({...(previous.scope === scope ? previous : empty(scope)), error: copy.loadError}));});
    return () => {active = false;};
  }, [uid, scope, revision, unlocked, capture, copy.loadError]);

  const available = useMemo(() => new Map(memories
    .filter((memory) => memory.uid === uid && !memory.teamId && !memory.teamScopeAmbiguous &&
      !memory.encLocked && (memory.sharedWithIds == null ||
        (Array.isArray(memory.sharedWithIds) && memory.sharedWithIds.length === 0)))
    .map((memory) => [memory.id, memory])), [memories, uid]);
  const selected = selectedMemoryId ? available.get(selectedMemoryId) : null;
  const availableRef = useRef(available); availableRef.current = available;
  const sorted = [...items].sort((a, b) => a.dueAt - b.dueAt || b.priority - a.priority);
  async function run<T>(work: (guard: () => void) => Promise<T>, commit: (value: T) => Partial<State>, sourceId?: string) {
    if (!ready || operation.current?.scope === scope) return false;
    const captured = capture(uid), current = () => !closed.current && scopeRef.current === scope && captured();
    const guard = () => {if (!current() || sourceId && !availableRef.current.has(sourceId)) throw Error('Retired review view');};
    if (!current()) return false;
    const token = {scope, changes: new Set<string | undefined>()}; let confirmedRevision: string | null = null; operation.current = token; update({busy: true, error: ''});
    readGeneration.current++;
    try {
      guard(); const result = await work(guard); guard(); const patch = commit(result);
      if (patch.view) {confirmedRevision = patch.view.revision; known.current = {scope, revision: confirmedRevision};}
      update({...patch, busy: false, error: ''});
      return true;
    } catch {
      if (current()) update({busy: false, error: copy.saveError});
      return false;
    } finally {
      if (operation.current === token) {operation.current = null; if ([...token.changes].some(revision => revision === undefined || revision !== confirmedRevision) && current()) refresh(value => value + 1);}
    }
  }
  const persist = (base: ReviewInboxView, next: ReviewItem[], patch: Partial<State> = {}, sourceId?: string) => run(guard => saveReviewInbox(uid, base, next, guard),
    view => ({...patch, view, preview: null, confirmed: false, selectedLegacyDigest: null, backupPreview: null, backupConfirmed: false}), sourceId);
  const close = () => {closed.current = true; onClose();};

  return (
    <dialog ref={dialogRef} aria-modal="true" aria-label={t('reviewInbox')}
      onCancel={event => {event.preventDefault(); event.stopPropagation(); close();}}
      onKeyDown={containDialogKeys}
      className="pointer-events-auto fixed inset-x-3 bottom-24 top-20 z-50 mx-auto my-0 flex h-auto max-h-none w-auto max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#050514] text-white shadow-2xl backdrop:bg-black/50 [&:not([open])]:hidden sm:inset-x-6">
      <header className="flex items-center justify-between border-b border-white/10 p-4">
        <div>
          <h2 className="text-lg font-semibold">{t('reviewInbox')}</h2>
          <p className="text-xs text-slate-400">{t('reviewInboxPrivate')}</p>
        </div>
        <button type="button" onClick={close} aria-label={t('close')} className="rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {error && <p role="alert" className="rounded-lg border border-rose-400/30 p-3 text-sm text-rose-200">{error}</p>}
        {!unlocked && <p>{copy.unlock}</p>}
        <button type="button" disabled={busy || !unlocked} onClick={() => {update({error: ''}); refresh(value => value + 1);}} className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-40">{copy.refresh}</button>
        <section aria-label={backupCopy.title} className="space-y-3 rounded-xl border border-white/15 p-4">
          <h3 className="font-semibold">{backupCopy.title}</h3>
          <button type="button" disabled={!ready || busy} onClick={() => {if (view) void run(async guard => {const backup = await exportReviewInboxBackup(uid, view, guard); guard(); downloadBackup(backup.text, backup.filename, guard); return backup;}, () => ({backupMessage: backupCopy.exportPrepared}));}} className="rounded-lg border border-white/15 px-3 py-2 disabled:opacity-40">{backupCopy.export}</button>
          <label className="block">{backupCopy.choose}<input type="file" accept=".json,application/json" disabled={!ready || busy} onChange={event => {
            const source = event.currentTarget.files?.[0]; event.currentTarget.value = '';
            if (source && view) void run(guard => prepareReviewInboxBackup(uid, view, source, guard), backupPreview => ({backupPreview, backupConfirmed: false, backupMessage: ''}));
          }}/></label>
          {state.backupPreview && <div className="space-y-3" aria-label={backupCopy.preview}>
            <p>{backupCopy.metadata(new Date(state.backupPreview.exportedAt).toLocaleString(HTML_LANG[language]), state.backupPreview.sourceQuestions)}</p>
            <p>{state.backupPreview.alreadyApplied ? backupCopy.previous(new Date(state.backupPreview.appliedAt!).toLocaleString(HTML_LANG[language])) : backupCopy.plan(state.backupPreview.added, state.backupPreview.copied, state.backupPreview.afterCount)}</p>
            <p>{backupCopy.pending(state.backupPreview.pendingSources)}</p>{!state.backupPreview.alreadyApplied && <p>{backupCopy.copyWarning}</p>}
            {!!state.backupPreview.changes.length && <ul className="max-h-60 space-y-2 overflow-y-auto">{state.backupPreview.changes.map(change => <li key={change.incoming.id} className="rounded border border-white/10 p-2">
              <strong>{backupCopy.actions[change.action]}</strong><p>{backupCopy.incoming}: {change.incoming.question}</p>
              <p>{new Date(change.incoming.dueAt).toLocaleString(HTML_LANG[language])} · {t('reviewInboxPriority')}: {change.incoming.priority}</p>
              {change.action === 'copy' && change.current && <><p>{backupCopy.current}: {change.current.question}</p><p>{new Date(change.current.dueAt).toLocaleString(HTML_LANG[language])} · {t('reviewInboxPriority')}: {change.current.priority}</p></>}
            </li>)}</ul>}
            <label className="flex items-start gap-2"><input type="checkbox" checked={state.backupConfirmed} disabled={busy} onChange={event => update({backupConfirmed: event.target.checked})}/><span>{backupCopy.confirm} <strong>{uid}</strong></span></label>
            <button type="button" disabled={!ready || busy || !state.backupConfirmed} onClick={() => {const preview = state.backupPreview; if (preview && state.backupConfirmed) void run(guard => restoreReviewInboxBackup(uid, preview, {ownerUid: uid, digest: preview.digest, confirmed: true}, guard), result => ({view: result.view, backupPreview: null, backupConfirmed: false, preview: null, confirmed: false, selectedLegacyDigest: null, backupMessage: result.confirmed ? backupCopy.confirmed(new Date(result.receipt.at).toLocaleString(HTML_LANG[language])) : backupCopy.restored(result.receipt.added)}));}}>{state.backupPreview.alreadyApplied ? backupCopy.confirmPrevious : backupCopy.restore}</button>
            {state.backupPreview.alreadyApplied && <button type="button" disabled={!ready || busy} onClick={() => {const previous = state.backupPreview; if (previous && view) void run(guard => prepareRepeatedReviewInboxBackup(uid, view, previous, guard), backupPreview => ({backupPreview, backupConfirmed: false, backupMessage: ''}));}}>{backupCopy.repeat}</button>}
          </div>}
          {state.backupMessage && <p role="status" aria-live="polite">{state.backupMessage}</p>}
        </section>
        {view?.legacy && <section aria-label={copy.legacyTitle} className="space-y-3 rounded-xl border border-amber-300/30 p-4">
          <h3 className="font-semibold">{copy.legacyTitle}</h3><p>{copy.legacyWarning}</p>
          {view.legacyOrigins.length > 1 && <label className="block">{backupCopy.originLabel}<select disabled={busy} value={state.selectedLegacyDigest ?? view.legacy.digest} onChange={event => update({selectedLegacyDigest: event.target.value, preview: null, confirmed: false})}>{view.legacyOrigins.map((origin, index) => <option key={origin.digest} value={origin.digest}>{origin.local ? backupCopy.localOrigin : backupCopy.recoveredOrigin(index + 1)}</option>)}</select></label>}
          {!state.preview && <button type="button" disabled={busy || !ready} onClick={() => void run(guard => previewReviewInboxLegacyOrigin(uid, view, state.selectedLegacyDigest ?? view.legacy!.digest, guard), preview => ({preview, confirmed: false}))}>{copy.preview}</button>}
          {state.preview && <>
            <p>{copy.previewCount(state.preview.items.length)}</p><ol className="max-h-60 overflow-y-auto">{state.preview.items.map(item => <li key={item.id}>{item.question}</li>)}</ol>
            <p>{copy.copies}</p><label className="flex items-start gap-2"><input type="checkbox" checked={state.confirmed} disabled={busy} onChange={event => update({confirmed: event.target.checked})}/><span>{copy.consent} <strong>{uid}</strong></span></label>
            <button type="button" disabled={busy || !ready || !state.confirmed} onClick={() => {const preview = state.preview; if (preview && state.confirmed) void run(guard => migrateLegacyReviewInbox(uid, preview, {ownerUid: uid, digest: preview.digest, confirmed: true}, guard), view => ({view, preview: null, confirmed: false, selectedLegacyDigest: null, backupPreview: null, backupConfirmed: false}));}}>{copy.import}</button>
          </>}
        </section>}
        <section className="space-y-3 rounded-xl border border-white/10 p-4">
          <h3 className="font-semibold">{t('reviewInboxNew')}</h3>
          <p className="text-xs text-slate-400">{selected ? selected.title || selected.text.slice(0, 80) : t('reviewInboxNeedSource')}</p>
          <label className="block text-xs text-slate-300">{t('reviewInboxQuestion')}
            <textarea value={question} onChange={(event) => update({question: event.target.value})} maxLength={500}
              className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 p-2 text-sm text-white" rows={2} />
          </label>
          <label className="block text-xs text-slate-300">{t('reviewInboxPriority')}
            <select value={priority} onChange={(event) => update({priority: Number(event.target.value) as 1 | 2 | 3})}
              className="ml-2 rounded-lg border border-white/15 bg-[#101024] p-1 text-sm text-white">
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
            </select>
          </label>
          <button type="button" disabled={!ready || busy || !selected || !question.trim() || items.length >= 500}
            onClick={() => {
              if (!selected || !view || !availableRef.current.has(selected.id)) return;
              void persist(view, [...items, createReviewItem(selected.id, question, priority)], {question: ''}, selected.id);
            }} className="rounded-lg bg-violet-600 px-3 py-2 text-sm disabled:opacity-40">{t('reviewInboxAdd')}</button>
        </section>
        {!ready ? (error || !unlocked ? null : <p className="text-sm text-slate-400">{t('loading')}</p>) : sorted.length === 0 ? (
          <p className="text-sm text-slate-400">{t('reviewInboxEmpty')}</p>
        ) : <ul className="space-y-3">
          {sorted.map((item) => {
            const source = available.get(item.sourceId);
            const due = item.dueAt <= Date.now();
            return <li key={item.id} className="rounded-xl border border-white/10 p-4">
              {editingId === item.id ? (
                <div className="flex gap-2">
                  <input aria-label={t('reviewInboxEdit')} value={editQuestion} maxLength={500}
                    onChange={(event) => update({editQuestion: event.target.value})}
                    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 p-2 text-sm" />
                  <button type="button" disabled={busy || !editQuestion.trim()}
                    onClick={() => {if (state.editBase) void persist(state.editBase, state.editBase.items.map(row => row.id === item.id
                      ? {...row, question: editQuestion.trim(), updatedAt: Date.now()} : row), {editingId: null, editBase: null});}}
                    className="rounded-lg border border-white/15 px-3 text-xs disabled:opacity-40">{t('save')}</button>
                  <button type="button" disabled={busy} onClick={() => update({editingId: null, editBase: null, editQuestion: ''})}>{t('dismiss')}</button>
                </div>
              ) : <button type="button" disabled={busy} onClick={() => update({editingId: item.id, editQuestion: item.question, editBase: view})}
                title={t('reviewInboxEdit')} className="text-left text-sm font-medium hover:underline">{item.question}</button>}
              <p className="mt-2 text-xs text-slate-400">{t('reviewInboxDue', {
                date: new Date(item.dueAt).toLocaleString(HTML_LANG[language]),
              })}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={!source} onClick={() => {const current = capture(uid); if (!closed.current && scopeRef.current === scope && current() && availableRef.current.has(item.sourceId)) {closed.current = true; onOpenSource(item.sourceId); onClose();}}}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40">
                  {source ? t('reviewInboxSource') : t('reviewInboxMissingSource')}
                </button>
                {due && (['again', 'good', 'easy'] as const).map((result) => (
                  <button key={result} type="button" disabled={busy}
                    onClick={() => {if (view) void persist(view, items.map(row => row.id === item.id ? advanceReview(row, result) : row));}}
                    className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs text-violet-100 disabled:opacity-40">
                    {t(result === 'again' ? 'reviewInboxAgain' : result === 'good' ? 'reviewInboxGood' : 'reviewInboxEasy')}
                  </button>
                ))}
                <button type="button" disabled={busy} onClick={() => {if (view) void persist(view, items.filter(row => row.id !== item.id));}}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40">{t('remove')}</button>
              </div>
            </li>;
          })}
        </ul>}
      </div>
    </dialog>
  );
}
