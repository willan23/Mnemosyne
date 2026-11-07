import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { TEAM_HISTORY_REENCRYPTION_ENABLED } from '../config/releaseGates';
import { roleOf, type TeamRecord } from '../services/teamsService';
import { cancelTeamHistoryReencryption, hasTeamHistoryCheckpoint, readTeamHistoryCheckpoint, runTeamHistoryReencryption,
  type TeamHistoryCheckpoint, type TeamHistoryControl } from '../services/teamHistoryReencryption';
import { useTranslation } from '../utils/translations';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {observeTeamHistoryChanges} from '../services/teamHistoryChangeRecovery';

interface Props { uid: string; team: TeamRecord; mnemonic: string[] | null; unlocked: boolean;
  askConfirm: (options: { title: string; message: string; confirmLabel: string }) => Promise<boolean> }
/** Mount with a UID/team key so account/team changes abandon the old view and pause its work. */
export function TeamHistoryReencryptionPanel({ uid, team, mnemonic, unlocked, askConfirm }: Props) {
  const { t } = useTranslation();
  const feedback = useSyncFeedback(unlocked);
  const scope = JSON.stringify([uid, team.id, team.activeKeyEpoch, team.activeKeyId, team.keyRotationStatus, unlocked]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const [revision, refresh] = useState(0);
  const [progress, setProgress] = useState<TeamHistoryCheckpoint | null>(null);
  const [running, setRunning] = useState(false); const [confirming, setConfirming] = useState(false);
  const [stored, setStored] = useState(() => hasTeamHistoryCheckpoint(uid, team.id));
  const mounted = useRef(true); const control = useRef<TeamHistoryControl>('run');
  const admin = team.memberUids.includes(uid) && ['owner', 'admin'].includes(roleOf(team, uid));
  useEffect(() => observeTeamHistoryChanges(() => refresh(value => value + 1)), []);
  useEffect(() => {control.current = 'pause'; setRunning(false); setConfirming(false);}, [scope, feedback.epoch]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (control.current !== 'cancel') control.current = 'pause'; }; }, []);
  useEffect(() => { if (team.keyRotationStatus !== 'active' || !admin || !unlocked) control.current = 'pause'; }, [team.keyRotationStatus, team.activeKeyEpoch, team.activeKeyId, admin, unlocked]);
  useEffect(() => {
    if (!unlocked) { setProgress(null); return; }
    let current = true;
    void readTeamHistoryCheckpoint(uid, team.id).then(job => { if (current) { setProgress(job); setStored(Boolean(job)); } })
      .catch(() => { if (current) setStored(hasTeamHistoryCheckpoint(uid, team.id)); });
    return () => { current = false; };
  }, [uid, team.id, unlocked, revision, feedback.epoch]);
  const start = async () => {
    if (running || confirming || !admin || !unlocked || !mnemonic || !TEAM_HISTORY_REENCRYPTION_ENABLED) return;
    const alive = feedback.capture(uid), current = () => mounted.current && alive() && currentScope.current === scope;
    if (!current()) return;
    setConfirming(true);
    const approved = await askConfirm({ title: t('teamHistoryTitle'), message: t('teamHistoryWarning'), confirmLabel: t('teamHistoryStart') });
    if (!current()) return; setConfirming(false); if (!approved) return;
    control.current = 'run'; setRunning(true);
    try {
      const job = await runTeamHistoryReencryption({ uid, teamId: team.id, mnemonic, confirmed: true,
        newScan: progress?.status === 'complete' || progress?.status === 'cancelled', control: () => control.current,
        onProgress: job => { if (current()) { setProgress(job); setStored(true); } } });
      if (current()) setProgress(job);
    } catch { if (current()) toast.error(t('teamHistoryFailed')); }
    finally { if (current()) { setRunning(false); setStored(hasTeamHistoryCheckpoint(uid, team.id)); } }
  };
  const cancel = async () => {
    if (confirming || !unlocked) return;
    const alive = feedback.capture(uid), current = () => mounted.current && alive() && currentScope.current === scope;
    if (!current()) return;
    setConfirming(true);
    const approved = await askConfirm({ title: t('teamHistoryCancel'), message: t('teamHistoryCancelWarning'), confirmLabel: t('teamHistoryCancel') });
    if (!current()) return; setConfirming(false); if (!approved) return;
    if (running) { control.current = 'cancel'; return; }
    setConfirming(true);
    try { const job = await cancelTeamHistoryReencryption(uid, team.id); if (current()) setProgress(job); }
    catch { if (current()) toast.error(t('teamHistoryFailed')); }
    finally { if (current()) setConfirming(false); }
  };
  const statusKey = progress?.status === 'complete' ? 'teamHistoryComplete' : progress?.status === 'cancelled' ? 'teamHistoryCancelled' : progress?.status === 'paused' || !running ? 'teamHistoryPaused' : 'teamHistoryRunning';
  return <section aria-label={t('teamHistoryTitle')} className="space-y-2 rounded-xl border border-white/15 p-3 text-sm text-slate-300">
    <h4 className="font-semibold">{t('teamHistoryTitle')}</h4>
    <p className="text-xs">{t('teamHistoryWarning')}</p>
    {!TEAM_HISTORY_REENCRYPTION_ENABLED && <p className="text-xs text-amber-200">{t('teamHistoryClosed')}</p>}
    {progress && <p role="status" aria-live="polite">{t(statusKey)} · {t('teamHistoryEpoch', { epoch: progress.targetEpoch })} · {t('teamHistoryCounts', { scanned: progress.scanned, rewritten: progress.rewritten, already: progress.alreadyTarget })}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void start()} disabled={running || confirming || !admin || !unlocked || team.keyRotationStatus !== 'active' || !TEAM_HISTORY_REENCRYPTION_ENABLED}
        className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">{t(progress?.status === 'complete' || progress?.status === 'cancelled' ? 'teamHistoryNewScan' : stored ? 'teamHistoryResume' : 'teamHistoryStart')}</button>
      {running && <button type="button" onClick={() => { control.current = 'pause'; }} disabled={confirming} className="rounded-lg border border-white/20 px-3 py-2">{t('teamHistoryPause')}</button>}
      {(running || stored) && progress?.status !== 'complete' && progress?.status !== 'cancelled' && <button type="button" onClick={() => void cancel()} disabled={confirming || !unlocked}
        className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">{t('teamHistoryCancel')}</button>}
    </div>
  </section>;
}
