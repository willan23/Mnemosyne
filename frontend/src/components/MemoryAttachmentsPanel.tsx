import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import { ATTACHMENT_WRITES_ENABLED, TEAM_WRITES_ENABLED } from '../config/releaseGates';
import { opaqueAttachmentId } from '../../../functions/src/attachmentMutationContract';
import { associateSessionAttachments, cancelPendingSessionAttachmentMutation, hasPendingAttachmentMutation, observeAttachmentMutations, recoverSessionAttachmentMutation } from '../services/attachmentMutationRecovery';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';
import { onTeamKeyChanged } from '../services/teamVault';
import type { MemoryObject } from '../types/universe';
import type { Attachment } from '../types/attachments';
import { AttachmentUploader } from './AttachmentUploader';
import { cancelRecoverableAttachmentUpload, listRecoverableAttachmentUploads, resumeEncryptedAttachmentUpload } from '../services/attachmentUploadClient';
import { observeAttachmentUploadCheckpoints } from '../services/attachmentUploadCheckpoint';
import { downloadRecoveredAttachmentDraft } from '../services/attachmentDraftRecovery';

export function MemoryAttachmentsPanel({ memory }: { memory: MemoryObject }) {
  const [uid, setUid] = useState(() => auth.currentUser?.uid ?? null);
  const [ready, setReady] = useState(isMemoryCryptoReady); const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<Attachment[]>([]); const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<Awaited<ReturnType<typeof listRecoverableAttachmentUploads>> | null>(null);
  const [uploadPage, setUploadPage] = useState<string | undefined>(); const [uploadInventoryFailed, setUploadInventoryFailed] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const mounted = useRef(true); const epoch = useRef(0);
  const identity = `${uid}:${memory.id}:${memory.teamId ?? ''}`; const current = useRef(identity); current.current = identity;
  useEffect(() => { const contextEpoch = epoch; mounted.current = true; return () => { mounted.current = false; contextEpoch.current++; }; }, []);
  useEffect(() => {
    const refresh = () => setPending(Boolean(uid && hasPendingAttachmentMutation(uid, memory.id)));
    refresh(); return observeAttachmentMutations(refresh);
  }, [uid, memory.id]);
  useEffect(() => {
    const invalidate = () => { epoch.current++; setDraft([]); setUploads(null); setBusy(false); setReady(isMemoryCryptoReady()); setContextRevision(previous => previous + 1); };
    const stopAuth = onAuthStateChanged(auth, user => { if ((user?.uid ?? null) !== uid) invalidate(); setUid(user?.uid ?? null); });
    const stopVault = onMemoryCryptoChanged(invalidate); const stopTeam = onTeamKeyChanged(invalidate);
    window.addEventListener('mnemosyne:local-ai-config', invalidate); window.addEventListener('storage', invalidate);
    return () => { stopAuth(); stopVault(); stopTeam(); window.removeEventListener('mnemosyne:local-ai-config', invalidate); window.removeEventListener('storage', invalidate); };
  }, [uid]);
  useEffect(() => { epoch.current++; setDraft([]); setUploads(null); setUploadPage(undefined); setBusy(false); }, [identity]);
  useEffect(() => {
    let cancelled = false; let refreshId = 0;
    const refresh = async () => {
      const scope = identity; const captured = epoch.current; const requestId = ++refreshId;
      const valid = () => !cancelled && requestId === refreshId && current.current === scope && epoch.current === captured && auth.currentUser?.uid === uid && isMemoryCryptoReady();
      if (!uid || !ready) { setUploads(null); return; }
      try {
        const next = await listRecoverableAttachmentUploads(uid, memory.teamId || undefined, undefined, uploadPage);
        if (valid()) { setUploads(next); setUploadInventoryFailed(false); }
      } catch { if (valid()) { setUploads(null); setUploadInventoryFailed(true); } }
    };
    void refresh(); const stop = observeAttachmentUploadCheckpoints(() => { void refresh(); });
    return () => { cancelled = true; stop(); };
  }, [identity, uid, ready, memory.teamId, uploadPage, contextRevision]);
  const permitted = Boolean(uid && ready && !memory.encLocked && !memory.teamScopeAmbiguous && (memory.teamId || memory.uid === uid));
  const canWrite = permitted && ATTACHMENT_WRITES_ENABLED && (!memory.teamId || TEAM_WRITES_ENABLED);
  const run = async (operation: 'add' | 'remove' | 'recover' | 'cancel', ids: string[] = []) => {
    if (!uid || busy || !permitted || ((operation === 'add' || operation === 'remove') && (!canWrite || pending))) return;
    if (operation === 'remove' && !window.confirm('Retirar este anexo da memória? O histórico é conservado.')) return;
    if (operation === 'cancel' && !window.confirm('Cancelar a associação pendente? Se a gravação já terminou, será confirmada.')) return;
    const scope = identity; const captured = epoch.current; const actor = uid;
    const valid = () => mounted.current && current.current === scope && epoch.current === captured && auth.currentUser?.uid === actor && isMemoryCryptoReady();
    setBusy(true);
    try {
      const result = operation === 'recover' ? await recoverSessionAttachmentMutation(actor, memory.id) :
        operation === 'cancel' ? await cancelPendingSessionAttachmentMutation(actor, memory.id) :
          await associateSessionAttachments({ uid: actor, sessionId: memory.id, action: operation, ids });
      if (!valid()) return;
      setDraft([]); toast.success(result.status === 'cancelled' ? 'Associação cancelada.' : 'Anexos confirmados na memória.');
    } catch { if (valid()) toast.error('Não foi possível confirmar. Podes recuperar a operação pendente.'); }
    finally { if (valid()) { setBusy(false); setPending(hasPendingAttachmentMutation(actor, memory.id)); } }
  };
  const recoverUpload = async (id: string, operation: 'recover' | 'cancel' | 'download') => {
    if (!uid || !permitted || busy || pending) return;
    if (operation === 'cancel' && !window.confirm('Cancelar este envio e apagar o rascunho cifrado deste dispositivo? Usa “Guardar ficheiro local” e verifica o ficheiro descarregado antes de cancelar. Um ficheiro já confirmado será conservado.')) return;
    const scope = identity; const captured = epoch.current; const actor = uid;
    const valid = () => mounted.current && current.current === scope && epoch.current === captured && auth.currentUser?.uid === actor && isMemoryCryptoReady();
    setBusy(true);
    try {
      if (operation === 'download') {
        await downloadRecoveredAttachmentDraft(actor, id);
        if (valid()) toast.success('Download local iniciado. Verifica o ficheiro antes de cancelar ou repetir o envio.'); return;
      }
      const result = operation === 'cancel' ? await cancelRecoverableAttachmentUpload(actor, id) : await resumeEncryptedAttachmentUpload(actor, id);
      if (!valid()) return;
      if (result.status === 'cancelled') toast.success('Envio cancelado.');
      else {
        setDraft(previous => previous.some(item => item.url === result.attachment.url) ? previous : [...previous, result.attachment]);
        toast.success('Envio confirmado. A associação a esta memória ainda precisa de confirmação.');
      }
    } catch (error) {
      if (valid()) toast.error(error instanceof Error && 'reason' in error && error.reason === 'verifying'
        ? 'O anexo ainda está a ser confirmado. Tenta recuperar dentro de alguns minutos.'
        : error instanceof Error && 'reason' in error && error.reason === 'expired'
          ? 'O prazo deste envio terminou. Guarda e verifica o ficheiro local antes de cancelar e repetir o envio.' : 'Não foi possível recuperar. O registo local foi conservado.');
    } finally { if (valid()) setBusy(false); }
  };
  if (!uid || (!ATTACHMENT_WRITES_ENABLED && !pending && !uploads?.items.length && !uploads?.unreadableCount && !uploads?.nextAfterId && !uploadPage && !uploadInventoryFailed)) return null;
  const encrypted = (memory.attachments ?? []).flatMap((item, index) => { const id = opaqueAttachmentId(item.url); return id ? [{ id, index }] : []; });
  return <section aria-label="Gerir anexos cifrados" className="space-y-2 rounded-xl border border-white/10 p-3 text-xs text-white/65">
    {ready && permitted && uploads?.items.length ? <div className="space-y-2">
      <p>Envios recuperáveis deste cofre. Escolhe um ficheiro antes de o associar à memória.</p>
      {uploads.items.map(item => <div key={item.id} className="rounded-lg border border-white/10 p-2">
        <p className="break-words">{item.name} — {item.phase === 'ready' ? 'enviado, por associar' : 'envio por confirmar'}</p>
        <button type="button" disabled={busy || !permitted || pending} onClick={() => void recoverUpload(item.id, 'recover')}
          className="mr-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Recuperar este envio</button>
        {item.phase !== 'ready' && <>
          <button type="button" disabled={busy || !permitted || pending} onClick={() => void recoverUpload(item.id, 'download')}
            className="mr-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Guardar ficheiro local</button>
          <button type="button" disabled={busy || !permitted || pending} onClick={() => void recoverUpload(item.id, 'cancel')}
            className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Cancelar este envio</button>
        </>}
      </div>)}
    </div> : null}
    {uploadInventoryFailed && <p role="status">Não foi possível ler os envios recuperáveis. O registo local foi conservado.</p>}
    {ready && permitted && Boolean(uploads?.unreadableCount) && <p role="status">{uploads!.unreadableCount} registo(s) local(is) não puderam ser verificados e foram conservados. Os restantes envios continuam recuperáveis.</p>}
    {uploads?.nextAfterId && <button type="button" disabled={busy} onClick={() => setUploadPage(uploads.nextAfterId!)} className="rounded-lg border border-white/20 px-3 py-2">Ver mais envios recuperáveis</button>}
    {uploadPage && <button type="button" disabled={busy} onClick={() => setUploadPage(undefined)} className="ml-2 rounded-lg border border-white/20 px-3 py-2">Voltar aos primeiros envios</button>}
    {pending ? <>
      <p role="status">A associação de anexos aguarda confirmação. Recupera ou cancela a operação antes de continuar.</p>
      <button type="button" disabled={busy || !permitted} onClick={() => void run('recover')} className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Recuperar associação</button>
      <button type="button" disabled={busy || !permitted} onClick={() => void run('cancel')} className="ml-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Cancelar associação pendente</button>
    </> : canWrite ? <>
      <AttachmentUploader attachments={draft} onChange={setDraft} teamId={memory.teamId || undefined} />
      {draft.length > 0 && <>
        <p role="status">{draft.length} anexo(s) cifrado(s) enviado(s), ainda por associar a esta memória.</p>
        <button type="button" disabled={busy} onClick={() => void run('add', draft.map(item => opaqueAttachmentId(item.url)!).filter(Boolean))}
          className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Confirmar anexos nesta memória</button>
      </>}
      {encrypted.map(item => <button key={item.id} type="button" disabled={busy} onClick={() => void run('remove', [item.id])}
        className="mr-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Retirar anexo {item.index + 1} desta memória</button>)}
    </> : <p>Desbloqueia o cofre para gerir os anexos. As alterações de equipa aguardam a validação do lançamento.</p>}
  </section>;
}
