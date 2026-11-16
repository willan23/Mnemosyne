import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { AuthPage } from '../components/landing/AuthPage';
import { MnemonicBackupModal } from '../components/MnemonicBackupModal';
import { useTranslation } from '../utils/translations';
import { authorizeAgentClient, navigateAgentCallback, parseAgentAuthorizationParams, previewAgentAuthorization,
  type AgentAuthorizationRequest, type AgentConsentPreview } from '../services/agentAuthorization';

function AgentConsent({ request, user }: { request: AgentAuthorizationRequest; user: User }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<AgentConsentPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    void previewAgentAuthorization(request, user.uid).then(value => { if (!cancelled) setPreview(value); }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; active.current = false; };
  }, [request, user.uid]);
  const decide = async (approve: boolean) => {
    if (!preview || pending.current || auth.currentUser?.uid !== user.uid) return;
    pending.current = true;
    setBusy(true);
    try {
      const callback = approve ? await authorizeAgentClient(request, user.uid, preview.consentDigest) : preview.denialUrl;
      if (active.current && auth.currentUser?.uid === user.uid) navigateAgentCallback(callback, request, preview.redirectUri);
    } catch { if (active.current) setFailed(true); }
    finally { if (active.current) { pending.current = false; setBusy(false); } }
  };
  return <section className="w-full max-w-lg space-y-4 rounded-xl border border-white/15 bg-slate-900 p-6" aria-labelledby="agent-consent-heading">
    <h1 id="agent-consent-heading" className="text-xl font-semibold">{t('agentConsentTitle')}</h1>
    <p>{t('agentConsentAccount')}: {user.email || user.uid}</p>
    {!preview && !failed && <p role="status">{t('loading')}</p>}
    {preview && <>
      <p className="font-semibold">{preview.clientName}</p>
      <p>{t('agentVaultTitle')}: {preview.vault?.startsWith('team:') ?
        <>{t('agentVaultTeam', { name: preview.vaultName || preview.vault.slice(5) })} <span className="break-all text-xs text-slate-400">({preview.vault.slice(5)})</span></> : t('agentVaultPersonal')}</p>
      <p>{t('agentConsentDescription')}</p>
      <ul className="list-disc pl-5">{preview.scopes.map(scope => <li key={scope}>{scope === 'memories:read' ? t('agentConsentRead') : scope === 'memories:write' ? t('agentConsentWrite') : t('agentConsentSearch')}</li>)}</ul>
      <p className="break-all text-sm">{t('agentConsentReturn')}: {preview.redirectUri}</p>
      <p className="text-sm text-slate-300">{t('agentConsentLifetime')}</p>
      <div className="flex gap-3">
        <button type="button" disabled={busy || failed} onClick={() => void decide(true)} className="rounded-lg bg-indigo-600 px-4 py-2 disabled:opacity-40">{t('agentConsentApprove')}</button>
        <button type="button" disabled={busy} onClick={() => void decide(false)} className="rounded-lg border border-white/30 px-4 py-2 disabled:opacity-40">{t('agentConsentDeny')}</button>
      </div>
    </>}
    {failed && <p role="alert" className="text-rose-300">{t('agentConsentFailed')}</p>}
  </section>;
}
export default function AgentAuthorizationPage() {
  const [params] = useSearchParams();
  const search = params.toString();
  const request = useMemo(() => parseAgentAuthorizationParams(search), [search]);
  const [session, setSession] = useState<{ user: User | null | undefined; epoch: number }>({ user: undefined, epoch: 0 });
  const user = session.user;
  const [backup, setBackup] = useState<string[] | null>(null);
  const { t } = useTranslation();
  useEffect(() => onAuthStateChanged(auth, user => setSession(previous => ({ user, epoch: previous.epoch + 1 }))), []);
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-white">
    <meta name="referrer" content="no-referrer" />
    {!request ? <p role="alert">{t('agentConsentFailed')}</p> : user === undefined ? <p role="status">{t('loading')}</p> :
      user ? <AgentConsent key={`${user.uid}:${session.epoch}:${search}`} request={request} user={user} /> :
        <AuthPage initialMode="login" onBack={() => window.location.replace('/')} onMnemonicComplete={() => undefined} onGeneratedMnemonic={setBackup} />}
    <MnemonicBackupModal mnemonic={backup} onClose={() => setBackup(null)} />
  </main>;
}
