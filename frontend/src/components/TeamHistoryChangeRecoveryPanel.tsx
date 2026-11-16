import {useEffect, useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {isMemoryCryptoReady, onMemoryCryptoChanged} from '../services/memoryCrypto';
import {pendingTeamHistoryChangeTeams, observeTeamHistoryChanges, recoverTeamHistoryChange, cancelTeamHistoryChange} from '../services/teamHistoryChangeRecovery';

export function TeamHistoryChangeRecoveryPanel() {
  const [uid, setUid] = useState(() => auth.currentUser?.uid ?? null), feedback = useSyncFeedback();
  const [revision, refresh] = useState(0), [page, setPage] = useState<{scope: string; cursors: Array<string | undefined>}>({scope: '', cursors: [undefined]});
  const scope = JSON.stringify([uid, feedback.epoch]), cursors = page.scope === scope ? page.cursors : [undefined], after = cursors.at(-1);
  const [rows, setRows] = useState<{scope: string; after?: string; teams: string[]; error: boolean}>({scope: '', teams: [], error: false});
  const [state, setState] = useState<{scope: string; busy: boolean; message: string | null}>({scope: '', busy: false, message: null});
  const teams = rows.scope === scope && rows.after === after ? rows.teams : [], error = rows.scope === scope && rows.error;
  const busy = state.scope === scope && state.busy, message = state.scope === scope ? state.message : null, ready = isMemoryCryptoReady();
  useEffect(() => {const change = () => refresh(value => value + 1);
    const a = onAuthStateChanged(auth, user => setUid(user?.uid ?? null)), b = onMemoryCryptoChanged(change), c = observeTeamHistoryChanges(change);
    return () => {a(); b(); c();};}, []);
  useEffect(() => {let active = true;
    if (uid) void pendingTeamHistoryChangeTeams(uid, after).then(teams => {if (active) setRows({scope, after, teams, error: false});})
      .catch(() => {if (active) setRows({scope, after, teams: [], error: true});});
    return () => {active = false;};}, [uid, scope, after, revision]);
  async function operate(teamId: string, cancel: boolean) {
    if (!uid || !ready || busy) return;
    const current = feedback.capture(uid), guard = () => {if (!current()) throw Error('O contexto mudou.');};
    if (!current()) return;
    if (cancel && !window.confirm('Cancelar a recifra pendente desta equipa? Uma alteração já gravada será confirmada e contabilizada.')) return;
    if (!current()) return;
    setState({scope, busy: true, message: null});
    try {
      const result = cancel ? await cancelTeamHistoryChange(uid, teamId, guard) : await recoverTeamHistoryChange(uid, teamId, guard);
      if (!current()) return;
      setState({scope, busy: false, message: result.status === 'committed' ? 'Recifra confirmada. O progresso guardado foi reconciliado; podes continuar nas Definições da equipa.' : result.status === 'revoked' ? 'O acesso deixou de estar disponível. O pedido local foi encerrado.' : 'Pedido de recifra cancelado.'});
    } catch {if (current()) setState({scope, busy: false, message: 'Não foi possível confirmar a recifra. O pedido cifrado foi conservado.'});}
    if (current()) refresh(value => value + 1);
  }
  if (!teams.length && !message && !error && cursors.length === 1) return null;
  return <section aria-label="Recuperação do histórico de equipas" className="rounded-xl border border-amber-300/30 bg-slate-950/95 p-3 text-sm text-white/80">
    <p>Recifras do histórico que aguardam confirmação.</p>
    {!ready && <p>Desbloqueia o cofre desta conta para continuar.</p>}
    {error && <p role="alert">Não foi possível ler os pedidos locais. <button type="button" onClick={() => refresh(value => value + 1)}>Tentar novamente</button></p>}
    <ul>{teams.map(teamId => <li key={teamId} className="mt-2">
      <span>Equipa: {teamId}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !ready} onClick={() => void operate(teamId, false)} className="rounded border px-3 py-2 disabled:opacity-40">Recuperar recifra</button>
        <button type="button" disabled={busy || !ready} onClick={() => void operate(teamId, true)} className="rounded border px-3 py-2 disabled:opacity-40">Cancelar recifra pendente</button>
      </div>
    </li>)}</ul>
    {cursors.length > 1 && <button type="button" disabled={busy} onClick={() => setPage({scope, cursors: cursors.slice(0, -1)})}>Página anterior</button>}
    {teams.length === 20 && <button type="button" disabled={busy} onClick={() => setPage({scope, cursors: [...cursors, teams.at(-1)]})}>Página seguinte</button>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>;
}
