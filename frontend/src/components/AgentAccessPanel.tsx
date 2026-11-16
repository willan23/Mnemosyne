import { useEffect, useRef, useState } from 'react';
import { observeAgentAccess, setAgentAccess, type AgentAccessState } from '../services/agentAccess';
import { useAgentAccountView } from '../hooks/useAgentAccountView';
import { useTranslation } from '../utils/translations';

export function AgentAccessPanel({ uid }: { uid: string }) {
  const scope = useAgentAccountView(uid);
  return <AgentAccessStatePanel key={scope ?? `inactive:${uid}`} uid={uid} current={scope !== null} />;
}

function AgentAccessStatePanel({ uid, current }: { uid: string; current: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<AgentAccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    const stop = current ? observeAgentAccess(uid, value => { if (active.current) setState(value); }) : () => {};
    return () => { active.current = false; stop(); };
  }, [uid, current]);

  const toggle = async () => {
    if (!current || state === null || pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try { await setAgentAccess(uid, state, !state.disabled); }
    catch { if (active.current) setFailed(true); }
    finally { if (active.current) { pending.current = false; setBusy(false); } }
  };

  return <section className="space-y-2 rounded-lg border border-white/10 p-3" aria-label={t('agentAccessTitle')}>
    <h3 className="text-sm font-medium text-white">{t('agentAccessTitle')}</h3>
    <p className="text-xs text-slate-400">{t('agentAccessDescription')}</p>
    <p className="text-sm text-slate-200" role="status">{state === null ? t('agentAccessUnknown') :
      state.disabled ? t('agentAccessStopped') : t('agentAccessEnabled')}</p>
    <button type="button" disabled={!current || state === null || busy} onClick={() => void toggle()}
      className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white disabled:opacity-40">
      {busy ? t('loading') : state?.disabled ? t('agentAccessResume') : t('agentAccessStop')}
    </button>
    {failed && <p role="alert" className="text-sm text-rose-300">{t('agentAccessFailed')}</p>}
  </section>;
}
