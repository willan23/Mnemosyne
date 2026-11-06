import {useEffect, useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady, onMemoryCryptoChanged} from '../services/memoryCrypto';
import {hasPendingPersonalMigration, observePersonalMigration, recoverPersonalMigration, cancelPersonalMigration} from '../services/personalMigrationRecovery';

export function PersonalMigrationRecoveryPanel() {
  const [uid, setUid] = useState(() => auth.currentUser?.uid ?? null);
  const [revision, refresh] = useState(0), feedback = useSyncFeedback();
  const scope = JSON.stringify([uid, feedback.epoch]);
  const [pending, setPending] = useState<{scope: string; value: boolean}>({scope, value: false});
  const [state, setState] = useState<{scope: string; busy: boolean; message: string | null}>({scope, busy: false, message: null});
  const busy = state.scope === scope && state.busy, message = state.scope === scope ? state.message : null;
  const ready = isMemoryCryptoReady(), visible = pending.scope === scope && pending.value;
  useEffect(() => {const change = () => refresh(value => value + 1);
    const a = onAuthStateChanged(auth, user => setUid(user?.uid ?? null)), b = onMemoryCryptoChanged(change), c = observePersonalMigration(change);
    return () => {a(); b(); c();};}, []);
  useEffect(() => {let active = true; if (uid) void hasPendingPersonalMigration(uid).then(value => {if (active) setPending({scope, value});});
    return () => {active = false;};}, [uid, scope, revision]);
  async function operate(cancel: boolean) {
    if (!uid || !ready || busy) return;
    const current = feedback.capture(uid), guard = () => {if (!current()) throw Error('O contexto mudou.');};
    if (!current()) return;
    if (cancel && !window.confirm('Cancelar a migração pendente? Um registo já gravado será confirmado e o arquivo verificado.')) return;
    if (!current()) return;
    setState({scope, busy: true, message: null});
    try {
      const result = cancel ? await cancelPersonalMigration(uid, guard) : await recoverPersonalMigration(uid, guard);
      if (!current()) return;
      setState({scope, busy: false, message: result.status === 'committed' ? 'Migração do registo e arquivo confirmados. Continua a migração nas Definições.' : result.status === 'revoked' ? 'O acesso deixou de estar disponível. O pedido local foi encerrado.' : 'Migração pendente cancelada.'});
    } catch {if (current()) setState({scope, busy: false, message: 'Não foi possível confirmar a migração. O pedido cifrado foi conservado.'});}
    if (current()) refresh(value => value + 1);
  }
  if (!visible && !message) return null;
  return <section aria-label="Recuperação de migração" className="rounded-xl border border-amber-300/30 bg-slate-950/95 p-3 text-sm text-white/80">
    {visible && <p>Um registo da migração aguarda confirmação.</p>}
    {visible && !ready && <p>Desbloqueia o cofre desta conta para continuar.</p>}
    {visible && <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={busy || !ready} onClick={() => void operate(false)} className="rounded border px-3 py-2 disabled:opacity-40">Recuperar migração</button>
      <button type="button" disabled={busy || !ready} onClick={() => void operate(true)} className="rounded border px-3 py-2 disabled:opacity-40">Cancelar migração pendente</button>
    </div>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>;
}
