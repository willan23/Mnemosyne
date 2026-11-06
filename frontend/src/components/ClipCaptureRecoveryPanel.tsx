import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import { cancelPendingClipCapture, hasPendingClipCapture, observeClipCaptures, recoverPendingClipCapture } from '../services/clipCaptureService';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';

export function ClipCaptureRecoveryPanel({onMemoryCreated}: {onMemoryCreated?: (id: string) => void}) {
  const [uid, setUid] = useState(() => auth.currentUser?.uid ?? null);
  const [ready, setReady] = useState(isMemoryCryptoReady);
  const [pending, setPending] = useState(false); const [busy, setBusy] = useState(false);
  const epoch = useRef(0); const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {
    const refresh = () => setPending(Boolean(uid && hasPendingClipCapture(uid)));
    refresh(); return observeClipCaptures(refresh);
  }, [uid]);
  useEffect(() => {
    const invalidate = () => {epoch.current++; setReady(isMemoryCryptoReady());};
    const stopAuth = onAuthStateChanged(auth, user => {if (user?.uid !== uid) invalidate(); setUid(user?.uid ?? null);});
    const stopVault = onMemoryCryptoChanged(invalidate);
    const captured = epoch;
    return () => {captured.current++; stopAuth(); stopVault();};
  }, [uid]);
  if (!uid || !pending) return null;
  const run = async (cancel: boolean) => {
    if (!ready || running.current) return;
    if (cancel && !window.confirm('Cancelar o clip pendente? Se já tiver sido gravado, será confirmado. Se ainda não tiver sido gravado, o rascunho local será retirado.')) return;
    const actor = uid; const captured = epoch.current; running.current = true; setBusy(true);
    const valid = () => epoch.current === captured && auth.currentUser?.uid === actor && isMemoryCryptoReady();
    try {
      const result = cancel ? await cancelPendingClipCapture(actor) : await recoverPendingClipCapture(actor);
      if (!valid()) return;
      if (result.status === 'committed') {toast.success('Captura do clip confirmada.'); onMemoryCreated?.(result.sessionId);}
      else toast.success('Captura do clip cancelada.');
    } catch {if (valid()) toast.error('Não foi possível confirmar a captura. A operação pendente foi conservada.');}
    finally {running.current = false; if (mounted.current) setBusy(false); if (valid()) setPending(hasPendingClipCapture(actor));}
  };
  return <section aria-label="Recuperar clip" className="mb-3 rounded-xl border border-amber-300/30 bg-slate-950 p-3 text-sm text-white/80">
    <p role="status">Um clip aguarda confirmação. Recupera ou cancela esta captura antes de enviar outro clip.</p>
    <button type="button" disabled={!ready || busy} onClick={() => void run(false)} className="mt-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Recuperar clip</button>
    <button type="button" disabled={!ready || busy} onClick={() => void run(true)} className="ml-2 mt-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Cancelar clip pendente</button>
  </section>;
}
