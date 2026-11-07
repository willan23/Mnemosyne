import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import { cancelPendingAttachedMemoryCreation, hasPendingAttachedMemoryCreation, observeAttachedMemoryCreations, recoverAttachedMemoryCreation } from '../services/attachedMemoryRecovery';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';
import { onTeamKeyChanged } from '../services/teamVault';
export function AttachedMemoryRecoveryPanel({ onMemoryCreated }: { onMemoryCreated?: (id: string) => void }) {
  const [uid, setUid] = useState(() => auth.currentUser?.uid ?? null); const [ready, setReady] = useState(isMemoryCryptoReady);
  const [pending, setPending] = useState(false); const [busy, setBusy] = useState(false); const epoch = useRef(0);
  useEffect(() => {
    const refresh = () => setPending(Boolean(uid && hasPendingAttachedMemoryCreation(uid)));
    refresh(); return observeAttachedMemoryCreations(refresh);
  }, [uid]);
  useEffect(() => {
    const invalidate = () => { epoch.current++; setReady(isMemoryCryptoReady()); setBusy(false); };
    const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) invalidate(); setUid(user?.uid ?? null); });
    const stopVault = onMemoryCryptoChanged(invalidate); const stopTeam = onTeamKeyChanged(invalidate);
    window.addEventListener('mnemosyne:local-ai-config', invalidate); window.addEventListener('storage', invalidate);
    const captured = epoch;
    return () => { captured.current++; stopAuth(); stopVault(); stopTeam(); window.removeEventListener('mnemosyne:local-ai-config', invalidate); window.removeEventListener('storage', invalidate); };
  }, [uid]);
  if (!uid || !pending) return null;
  const run = async (cancel: boolean) => {
    if (!ready || busy) return;
    if (cancel && !window.confirm('Cancelar a criação pendente? Se a memória já tiver sido gravada, será confirmada. Os ficheiros enviados ficam disponíveis para recuperação.')) return;
    const actor = uid; const captured = epoch.current;
    const valid = () => epoch.current === captured && auth.currentUser?.uid === actor && isMemoryCryptoReady(); setBusy(true);
    try {
      const result = cancel ? await cancelPendingAttachedMemoryCreation(actor) : await recoverAttachedMemoryCreation(actor);
      if (!valid()) return;
      if (result.status === 'committed') { toast.success('Criação da memória confirmada.'); onMemoryCreated?.(result.sessionId); }
      else if (result.status === 'revoked') toast('O acesso à equipa já não está disponível. O pedido local foi encerrado; os ficheiros e rascunhos foram conservados.');
      else toast.success('Criação cancelada. Os ficheiros enviados foram conservados.');
    } catch { if (valid()) toast.error('Não foi possível confirmar a criação. A operação pendente foi conservada.'); }
    finally { if (valid()) { setBusy(false); setPending(hasPendingAttachedMemoryCreation(actor)); } }
  };
  return <section aria-label="Recuperar criação de memória" className="mb-3 rounded-xl border border-amber-300/30 bg-slate-950 p-3 text-sm text-white/80">
    <p role="status">A criação de uma memória aguarda confirmação. Recupera ou cancela esta operação antes de repetir.</p>
    <button type="button" disabled={!ready || busy} onClick={() => void run(false)} className="mt-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Recuperar criação de memória</button>
    <button type="button" disabled={!ready || busy} onClick={() => void run(true)} className="ml-2 mt-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">Cancelar criação pendente</button>
  </section>;
}
