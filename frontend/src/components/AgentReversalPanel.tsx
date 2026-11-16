import { useEffect, useRef, useState } from 'react';
import { auth } from '../firebase';
import { PERSONAL_REVISION_WRITES_ENABLED, TEAM_WRITES_ENABLED } from '../config/releaseGates';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';
import { onTeamKeyChanged } from '../services/teamVault';
import { cancelAgentReversal, confirmAgentReversal, hasPendingAgentReversal, observeAgentReversals, previewAgentReversal, recoverAgentReversal,
  type AgentReversalPreview } from '../services/agentReversalRecovery';
import type { AgentReversalOutcome } from '../../../functions/src/agentReversalContract';
import { AgentChangeContent } from './AgentChangeContent';
import { useTranslation } from '../utils/translations';
const isLimit = (error: unknown) => Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'functions/resource-exhausted');

export function AgentReversalPanel({ uid, proposalId, onChanged, onClose }: { uid: string; proposalId: string | null; onChanged: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<AgentReversalPreview | null>(null), [pending, setPending] = useState(() => hasPendingAgentReversal(uid));
  const [ready, setReady] = useState(isMemoryCryptoReady), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [limited, setLimited] = useState(false);
  const [message, setMessage] = useState<'agentReversalDone' | 'agentReversalCancelled' | 'agentReversalRevoked' | null>(null);
  const active = useRef(false), running = useRef(false), generation = useRef(0), jobs = useRef(0), reviewGeneration = useRef(-1);
  const account = () => active.current && auth.currentUser?.uid === uid;
  const lease = (captured: number) => () => { if (!account() || generation.current !== captured || !isMemoryCryptoReady()) throw Error('Reversal review changed'); };
  useEffect(() => {
    active.current = true; const epochRef = generation, jobsRef = jobs;
    const changed = () => { generation.current++; setPreview(null); setReady(isMemoryCryptoReady()); };
    const stopVault = onMemoryCryptoChanged(changed), stopTeam = onTeamKeyChanged(changed), stopPending = observeAgentReversals(() => { if (account()) setPending(hasPendingAgentReversal(uid)); }, () => uid);
    if (proposalId && isMemoryCryptoReady() && !hasPendingAgentReversal(uid)) {
      const captured = generation.current, job = ++jobs.current, guard = lease(captured); running.current = true; setBusy(true);
      void previewAgentReversal(uid, proposalId, guard).then(value => { guard(); reviewGeneration.current = captured; setPreview(value); })
        .catch(error => { if (account() && jobs.current === job) { setFailed(true); setLimited(isLimit(error)); } }).finally(() => { if (active.current && jobs.current === job) { running.current = false; setBusy(false); } });
    }
    return () => { active.current = false; epochRef.current++; jobsRef.current++; stopVault(); stopTeam(); stopPending(); };
    // The parent remounts this panel on account/selection changes; each async job carries its lease.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, proposalId]);
  const work = async (operation: (guard: () => void) => Promise<void>) => {
    if (!account() || running.current || !isMemoryCryptoReady()) return;
    const captured = generation.current, job = ++jobs.current, guard = lease(captured); running.current = true; setBusy(true); setFailed(false); setLimited(false); setMessage(null);
    try { await operation(guard); } catch (error) { if (account() && jobs.current === job) { generation.current++; setPreview(null); setFailed(true); setLimited(isLimit(error)); } }
    finally { if (active.current && jobs.current === job) { running.current = false; setBusy(false); setPending(hasPendingAgentReversal(uid)); } }
  };
  const finish = (result: AgentReversalOutcome) => {
    setPreview(null); setPending(hasPendingAgentReversal(uid));
    setMessage(result.status === 'committed' ? 'agentReversalDone' : result.status === 'cancelled' ? 'agentReversalCancelled' : 'agentReversalRevoked');
    onChanged();
  };
  const recover = () => work(async guard => {
    const result = await recoverAgentReversal(uid, guard); guard();
    if (result.state === 'terminal') finish(result.outcome);
    else { reviewGeneration.current = generation.current; setPreview(result.preview); }
  });
  const confirm = () => work(async guard => {
    if (!preview || reviewGeneration.current !== generation.current) throw Error('Reversal review changed');
    const result = await confirmAgentReversal(uid, preview, guard); guard(); finish(result);
  });
  const cancel = () => work(async guard => { const result = await cancelAgentReversal(uid, guard); guard(); finish(result); });
  const inspect = () => work(async guard => {
    if (!proposalId || hasPendingAgentReversal(uid)) throw Error('Pending reversal');
    const result = await previewAgentReversal(uid, proposalId, guard); guard(); reviewGeneration.current = generation.current; setPreview(result);
  });
  const enabled = preview ? preview.request.baseline.teamId === null ? PERSONAL_REVISION_WRITES_ENABLED : TEAM_WRITES_ENABLED : false;
  if (!proposalId && !pending && !message) return null;
  return <section aria-label={t('agentReversalTitle')} className="space-y-3 rounded border border-white/20 p-3">
    <h4 className="font-medium">{t('agentReversalTitle')}</h4>
    <p>{t('agentReversalHint')}</p>
    {!ready && <p>{t('agentReversalLocked')}</p>}
    {busy && <p role="status">{t('loading')}</p>}
    {failed && <p role="alert" className="text-rose-300">{t(limited ? 'agentReversalLimited' : 'agentReversalFailed')}</p>}
    {message && <p role="status">{t(message)}</p>}
    {pending && <div className="space-y-2">
      <p>{t('agentReversalPending')}</p>
      <button type="button" disabled={busy || !ready} onClick={() => void recover()}>{t('agentReversalRecover')}</button>
      <button type="button" disabled={busy || !ready} onClick={() => void cancel()}>{t('agentReversalCancel')}</button>
    </div>}
    {!preview && proposalId && !pending && <button type="button" disabled={busy || !ready} onClick={() => void inspect()}>{t('agentReversalReview')}</button>}
    {preview && <div className="space-y-3">
      <p>{preview.request.baseline.teamId === null ? t('agentVaultPersonal') : t('agentVaultTeam', { name: preview.request.baseline.teamId })} · {preview.request.baseline.sessionId}</p>
      {preview.deleted && <p>{t('agentReversalDeleted')}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div><h5 className="mb-2 font-semibold">{t('agentChangeBefore')}</h5><AgentChangeContent value={preview.before} /></div>
        <div><h5 className="mb-2 font-semibold">{t('agentReversalAfter')}</h5><AgentChangeContent value={preview.after} /></div>
      </div>
      <p>{t('agentChangeConfirmHint')}</p>
      {!enabled && <p>{t('agentReversalClosed')}</p>}
      <button type="button" disabled={busy || !ready || !enabled} onClick={() => void confirm()}>{t('agentReversalConfirm')}</button>
    </div>}
    <button type="button" disabled={busy} onClick={onClose}>{t('agentReversalClose')}</button>
  </section>;
}
