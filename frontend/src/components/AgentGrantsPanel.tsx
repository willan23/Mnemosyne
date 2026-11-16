import { useEffect, useRef, useState } from 'react';
import { listAgentGrants, revokeAgentGrant, type AgentGrant } from '../services/agentAuthorization';
import { auth } from '../firebase';
import { useTranslation } from '../utils/translations';
import { useAgentAccountView } from '../hooks/useAgentAccountView';

export function AgentGrantsPanel({ uid }: { uid: string }) {
  const scope = useAgentAccountView(uid);
  return <AgentGrantStatePanel key={scope ?? `inactive:${uid}`} uid={uid} current={scope !== null} />;
}

function AgentGrantStatePanel({ uid, current }: { uid: string; current: boolean }) {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<AgentGrant[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    if (current) void listAgentGrants(uid).then(value => { if (!cancelled && auth.currentUser?.uid === uid) setGrants(value); }, () => { if (!cancelled && auth.currentUser?.uid === uid) setFailed(true); });
    return () => { cancelled = true; active.current = false; };
  }, [uid, current]);
  const revoke = async (id: string) => {
    if (!current || pending.current || auth.currentUser?.uid !== uid) return;
    pending.current = true;
    setBusy(id);
    try {
      await revokeAgentGrant(id, uid);
      if (active.current && auth.currentUser?.uid === uid) setGrants(previous => previous?.filter(grant => grant.id !== id) ?? null);
    } catch { if (active.current && auth.currentUser?.uid === uid) setFailed(true); }
    finally { if (active.current) { pending.current = false; setBusy(null); } }
  };
  return <section className="space-y-2 rounded-lg border border-white/10 p-3" aria-label={t('agentGrantsTitle')}>
    <h3 className="text-sm font-medium text-white">{t('agentGrantsTitle')}</h3>
    {failed && <p role="alert" className="text-sm text-rose-300">{t('agentConsentFailed')}</p>}
    {grants === null ? !failed && <p role="status">{t('loading')}</p> : grants.length === 0 ? <p className="text-sm text-slate-400">{t('agentGrantsEmpty')}</p> :
        <ul className="space-y-2">{grants.map(grant => <li key={grant.id} className="flex items-center justify-between gap-3 text-sm text-white">
          <span id={`agent-grant-${grant.id}`}>{grant.name} <span className="text-slate-400">({grant.clientId})</span>
            <span className="block text-xs text-slate-400">{grant.vault?.startsWith('team:') ? <>{t('agentVaultTeam', { name: grant.vaultName || grant.vault.slice(5) })} <span>({grant.vault.slice(5)})</span></> : t('agentVaultPersonal')}</span>
          </span>
          <button type="button" aria-describedby={`agent-grant-${grant.id}`} disabled={busy !== null} onClick={() => void revoke(grant.id)} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40">{t('agentGrantsRevoke')}</button>
        </li>)}</ul>}
  </section>;
}
