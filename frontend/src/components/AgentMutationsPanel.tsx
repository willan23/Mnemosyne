import { useEffect, useRef, useState } from 'react';
import { auth } from '../firebase';
import { AgentChangeContent } from './AgentChangeContent';
import { AgentReversalPanel } from './AgentReversalPanel';
import { useAgentAccountView } from '../hooks/useAgentAccountView';
import { AGENT_MUTATION_WRITES_ENABLED } from '../config/releaseGates';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';
import { onTeamKeyChanged } from '../services/teamVault';
import { listAgentMutations, previewAgentMutation, approveAgentMutation, rejectAgentMutation,
  type AgentMutationPreview } from '../services/agentMutations';
import type { AgentMutationReceipt } from '../../../functions/src/agentMutationContract';
import { useTranslation } from '../utils/translations';

const statusKeys = { pending: 'agentChangePending', applied: 'agentChangeApplied', rejected: 'agentChangeRejected', expired: 'agentChangeExpired', reverted: 'agentChangeReverted' } as const;

export function AgentMutationsPanel({ uid }: { uid: string }) {
  const scope = useAgentAccountView(uid);
  return <AgentMutationStatePanel key={scope ?? `inactive:${uid}`} uid={uid} current={scope !== null} />;
}
function AgentMutationStatePanel({ uid, current }: { uid: string; current: boolean }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AgentMutationReceipt[]>([]);
  const [mode, setMode] = useState<'pending' | 'history'>('pending');
  const [cursor, setCursor] = useState<string | null>(null);
  const [preview, setPreview] = useState<AgentMutationPreview | null>(null);
  const [reversalProposalId, setReversalProposalId] = useState<string | null>(null);
  const [ready, setReady] = useState(isMemoryCryptoReady);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const active = useRef(false), pending = useRef(false), generation = useRef(0), previewGeneration = useRef(-1);
  const account = () => active.current && current && auth.currentUser?.uid === uid;
  const retire = () => { generation.current++; setPreview(null); };
  const load = async (selected: 'pending' | 'history', after: string | null = null) => {
    const value = await listAgentMutations(uid, selected, after);
    if (!account()) return;
    setRows(previous => after ? [...previous, ...value.receipts.filter(row => !previous.some(old => old.proposalId === row.proposalId))] : value.receipts);
    setCursor(value.nextCursor);
  };
  useEffect(() => {
    active.current = true;
    const viewLease = generation;
    const changed = () => { generation.current++; setPreview(null); setReady(isMemoryCryptoReady()); };
    const stopVault = onMemoryCryptoChanged(changed), stopTeam = onTeamKeyChanged(changed);
    if (current) {
      pending.current = true; setBusy(true);
      void load('pending').catch(() => { if (account()) setFailed(true); }).finally(() => { if (active.current) { pending.current = false; setBusy(false); } });
    }
    return () => { active.current = false; viewLease.current++; stopVault(); stopTeam(); };
    // Account changes remount this state panel, including logout/login to the same UID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, current]);
  const work = async (operation: () => Promise<void>) => {
    if (!account() || pending.current) return;
    pending.current = true; setBusy(true); setFailed(false);
    try { await operation(); } catch { if (account()) { retire(); setFailed(true); } }
    finally { if (active.current) { pending.current = false; setBusy(false); } }
  };
  const refresh = (selected = mode, after: string | null = null) => work(async () => { retire(); setMode(selected); await load(selected, after); });
  const inspect = (id: string) => work(async () => {
    retire(); const captured = generation.current;
    const guard = () => { if (!account() || captured !== generation.current || !isMemoryCryptoReady()) throw Error('Review changed'); };
    guard(); const value = await previewAgentMutation(uid, id, guard); guard();
    previewGeneration.current = captured; setPreview(value);
  });
  const approve = () => work(async () => {
    if (!preview || !AGENT_MUTATION_WRITES_ENABLED) return;
    const captured = previewGeneration.current;
    const guard = () => { if (!account() || captured !== generation.current || !isMemoryCryptoReady()) throw Error('Review changed'); };
    guard(); await approveAgentMutation(uid, preview, guard); guard(); retire(); await load(mode);
  });
  const reject = (row: AgentMutationReceipt) => work(async () => { await rejectAgentMutation(uid, row); if (account()) { retire(); await load(mode); } });
  const content = (value: AgentMutationPreview['before']) => <AgentChangeContent value={value} />;
  return <section aria-label={t('agentChangeTitle')} className="space-y-3 rounded-lg border border-white/10 p-3 text-sm text-white">
    <h3 className="font-medium">{t('agentChangeTitle')}</h3>
    <p className="text-slate-400">{t('agentChangeHint')}</p>
    {!AGENT_MUTATION_WRITES_ENABLED && <p role="status">{t('agentChangeClosed')}</p>}
    {!ready && <p>{t('agentChangeLocked')}</p>}
    {failed && <p role="alert" className="text-rose-300">{t('agentChangeFailed')}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !current} aria-pressed={mode === 'pending'} onClick={() => void refresh('pending')}>{t('agentChangePending')}</button>
      <button type="button" disabled={busy || !current} aria-pressed={mode === 'history'} onClick={() => void refresh('history')}>{t('agentChangeHistory')}</button>
      <button type="button" disabled={busy || !current} onClick={() => void refresh()}>{t('agentChangeRefresh')}</button>
    </div>
    {busy && <p role="status">{t('loading')}</p>}
    {!busy && rows.length === 0 && <p>{t('agentChangeEmpty')}</p>}
    <ul className="space-y-3">{rows.map(row => <li key={row.proposalId} className="space-y-1 rounded border border-white/10 p-2">
      <p>{row.clientName} <span className="text-slate-400">({row.clientId})</span></p>
      <p>{row.teamId === null ? t('agentVaultPersonal') : t('agentVaultTeam', { name: row.teamId })} · {row.sessionId}</p>
      <p>{t(row.operation === 'edit' ? 'agentChangeEdit' : 'agentChangeDelete')} · {t(statusKeys[row.status])}</p>
      <p className="text-xs text-slate-400">{t('agentChangeExpiry', { time: new Date(row.expiresAt).toLocaleString() })}</p>
      {row.status === 'applied' && <button type="button" disabled={busy} onClick={() => setReversalProposalId(row.proposalId)}>{t('agentReversalReview')}</button>}
      {row.status === 'pending' && <div className="flex gap-3">
        <button type="button" disabled={busy || !ready} onClick={() => void inspect(row.proposalId)}>{t('agentChangeReview')}</button>
        <button type="button" disabled={busy} onClick={() => void reject(row)}>{t('agentChangeReject')}</button>
      </div>}
    </li>)}</ul>
    {mode === 'history' && cursor && <button type="button" disabled={busy} onClick={() => void refresh(mode, cursor)}>{t('agentChangeMore')}</button>}
    {current && <AgentReversalPanel key={reversalProposalId ?? 'pending-reversal'} uid={uid} proposalId={reversalProposalId} onClose={() => setReversalProposalId(null)} onChanged={() => { void refresh(); }} />}
    {preview && <section aria-label={t('agentChangeReview')} className="space-y-3 border-t border-white/20 pt-3">
      <p>{preview.receipt.clientName} · {preview.receipt.sessionId}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div><h4 className="mb-2 font-semibold">{t('agentChangeBefore')}</h4>{content(preview.before)}</div>
        <div><h4 className="mb-2 font-semibold">{t('agentChangeAfter')}</h4>{preview.after ? content(preview.after) : <p>{t('agentChangeDeleteHint')}</p>}</div>
      </div>
      <p>{t('agentChangeConfirmHint')}</p>
      <button type="button" className="rounded border border-white/30 px-3 py-2 disabled:opacity-40" disabled={busy || !ready || !AGENT_MUTATION_WRITES_ENABLED} onClick={() => void approve()}>{t('agentChangeConfirm')}</button>
      <button type="button" disabled={busy} onClick={() => void reject(preview.receipt)}>{t('agentChangeReject')}</button>
    </section>}
  </section>;
}
