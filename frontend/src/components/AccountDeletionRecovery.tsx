import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { completedLocalAccountDeletionUids, finishCompletedLocalAccountDeletion, hasLocalAccountDeletion, inspectAccountDeletion,
  recoverableLocalAccountDeletionUids, recoverAccountDeletionWithoutAuth, requestAccountDeletion, type AccountDeletionStatus } from '../services/accountDeletion';

export function AccountDeletionRecovery() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const [completed, setCompleted] = useState(() => completedLocalAccountDeletionUids()); const generation = useRef(0);
  const [recoverable, setRecoverable] = useState(() => recoverableLocalAccountDeletionUids());
  const [waiting, setWaiting] = useState(false);
  const account = useRef(uid); const [finished, setFinished] = useState(false);
  const lifetime = useRef({ active: true });
  useEffect(() => {
    const state = lifetime.current; state.active = true;
    const stop = onAuthStateChanged(auth, user => {
      const next = user?.uid ?? null; if (next === account.current) return;
      account.current = next; generation.current++; setUid(next); setStatus(null); setBusy(false); setError(false);
      setCompleted(completedLocalAccountDeletionUids()); setRecoverable(recoverableLocalAccountDeletionUids()); setWaiting(false);
      if (next) setFinished(false);
    });
    return () => { state.active = false; stop(); };
  }, []);
  useEffect(() => {
    const token = ++generation.current; let active = true;
    if (uid) void inspectAccountDeletion(uid).then(result => {
      if (active && token === generation.current) setStatus(result);
    }).catch(() => { if (active && token === generation.current) setError(true); });
    return () => { active = false; };
  }, [uid]);
  const resume = async () => {
    if (!uid || busy) return; const token = generation.current; setBusy(true); setError(false);
    try {
      const result = await requestAccountDeletion(uid, 'resume');
      if (!lifetime.current.active || token !== generation.current || auth.currentUser?.uid !== uid) return;
      setStatus(result); setCompleted(completedLocalAccountDeletionUids());
      if (result.status === 'complete') { setFinished(true); await signOut(auth); }
    } catch { if (lifetime.current.active && token === generation.current) { setError(true); setCompleted(completedLocalAccountDeletionUids()); } }
    finally { if (lifetime.current.active && token === generation.current) setBusy(false); }
  };
  const finishLocal = async () => {
    if (busy || auth.currentUser) return; const token = generation.current; setBusy(true); setError(false);
    try {
      for (const account of completed) await finishCompletedLocalAccountDeletion(account);
      if (lifetime.current.active && token === generation.current && !auth.currentUser) { setCompleted(completedLocalAccountDeletionUids()); setFinished(true); }
    } catch { if (lifetime.current.active && token === generation.current) setError(true); }
    finally { if (lifetime.current.active && token === generation.current) setBusy(false); }
  };
  const recover = async () => {
    if (busy || auth.currentUser) return; const token = generation.current; setBusy(true); setError(false); setWaiting(false);
    try {
      let pending = false;
      for (const account of recoverable) {
        const result = await recoverAccountDeletionWithoutAuth(account);
        if (!lifetime.current.active || token !== generation.current || auth.currentUser) return;
        pending ||= result.status !== 'complete';
      }
      setCompleted(completedLocalAccountDeletionUids()); setRecoverable(recoverableLocalAccountDeletionUids());
      setWaiting(pending); if (!pending && recoverable.length > 0) setFinished(true);
    } catch { if (lifetime.current.active && token === generation.current) { setError(true); setCompleted(completedLocalAccountDeletionUids()); setRecoverable(recoverableLocalAccountDeletionUids()); } }
    finally { if (lifetime.current.active && token === generation.current) setBusy(false); }
  };
  const pending = !finished && uid && (status?.status === 'pending' || status?.status === 'complete' || hasLocalAccountDeletion(uid));
  if (!pending && !error && !finished && (uid || (!completed.length && !recoverable.length))) return null;
  return <section className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-5" aria-label="Estado do pedido de eliminação">
    <h2 className="mb-2 text-lg font-semibold text-white">Concluir um pedido de eliminação</h2>
    {finished && <p role="status">A conta e os dados ativos foram eliminados. Os registos locais de recuperação desta conta foram limpos.</p>}
    {pending && <>
      <p>{status?.status === 'pending' ? 'O pedido está em curso. O acesso aos dados fica bloqueado enquanto se conclui a eliminação. Podes retomar nesta sessão ou consultar a conclusão neste dispositivo se a sessão terminar.' : status?.status === 'complete' ? 'A eliminação remota foi confirmada. Falta concluir a limpeza neste dispositivo.' : 'Existe um pedido neste dispositivo que ainda não foi confirmado pelo servidor. Podes tentar retomar ou contactar o suporte.'}</p>
      {status?.retryAt != null && status.retryAt > Date.now() && <p className="mt-2">Há uma operação em curso ou acessos temporários a expirar. Tenta novamente depois de {new Date(status.retryAt).toLocaleTimeString()}.</p>}
      <button type="button" disabled={busy} onClick={() => void resume()} className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'A concluir…' : 'Retomar eliminação'}</button>
    </>}
    {!uid && completed.length > 0 && <>
      <p>A eliminação remota foi confirmada. Falta concluir a limpeza dos dados dessas contas neste dispositivo.</p>
      <button type="button" disabled={busy} onClick={() => void finishLocal()} className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-white disabled:opacity-50">Concluir limpeza local</button>
    </>}
    {!uid && recoverable.length > 0 && <>
      <p>A sessão terminou durante um pedido. Este dispositivo guardou um comprovativo para verificar a conclusão e limpar os dados locais da conta correspondente.</p>
      <button type="button" disabled={busy} onClick={() => void recover()} className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-white disabled:opacity-50">Verificar conclusão do pedido</button>
    </>}
    {waiting && <p role="status" className="mt-3">O servidor ainda não confirmou a conclusão. O comprovativo e os dados locais foram conservados. Tenta verificar novamente mais tarde.</p>}
    {error && <p role="alert" className="mt-3">Não foi possível confirmar a conclusão. O pedido foi conservado. Tenta retomar ou contacta o suporte pelo email abaixo.</p>}
  </section>;
}
