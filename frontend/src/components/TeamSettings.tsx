import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { cancelPendingTeamCreation, createTeamWithActiveEpoch, hasTeamCreationCheckpoint, observeTeamCreationCheckpoint, TeamCreationError } from '../services/teamCreation';
import {
  clearTeamKeyCache,
  MAX_TEAM_MEMBERS,
} from '../services/teamVault';
import {
  canInviteMembers,
  leaveTeamRemote,
  removeTeamMemberRemote,
  requestTeamKeyRotationRemote,
  roleOf,
  setMemberRoleRemote,
  teamErrorMessage,
  watchMyTeams,
  watchPendingInvites,
  watchTeamInvites,
  type TeamInviteRecord,
  type TeamRecord,
  type TeamRole,
} from '../services/teamsService';
import { acceptWithCurrentVault, inviteWithCurrentTeamKey } from '../services/teamInvitation';
import { discoverTeamDeletions, localTeamDeletion, observeTeamDeletion, requestTeamDeletion, type TeamDeletionStatus } from '../services/teamDeletion';
import { completeTeamRotationWithRecovery, discardTeamRotationCheckpoint, hasTeamRotationCheckpoint,
  observeTeamRotationCheckpoint, TeamRotationRecoveryError } from '../services/teamRotationRecovery';
import { HTML_LANG, useTranslation } from '../utils/translations';
import { TEAM_DELETION_ENABLED, TEAM_READ_ONLY_MESSAGE, TEAM_WRITES_ENABLED } from '../config/releaseGates';
import { TeamHistoryReencryptionPanel } from './TeamHistoryReencryptionPanel';

type ConfirmFn = (opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}) => Promise<boolean>;

interface TeamSettingsProps {
  mnemonic: string[] | null;
  askConfirm: ConfirmFn;
}

const isMnemonicReady = (mnemonic: string[] | null): mnemonic is string[] =>
  Boolean(mnemonic && mnemonic.length === 12);

export const TeamSettings: React.FC<TeamSettingsProps> = ({ mnemonic, askConfirm }) => {
  const { t, language } = useTranslation();
  const user = auth.currentUser;
  const uid = user?.uid ?? '';
  const vaultUnlocked = isMnemonicReady(mnemonic);
  const roleLabel = (role: TeamRole) =>
    role === 'owner' ? t('roleOwner') : role === 'admin' ? t('roleAdmin') : t('roleMember');
  const dateLabel = (value: number) => new Date(value).toLocaleDateString(HTML_LANG[language]);

  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [pendingInvites, setPendingInvites] = useState<TeamInviteRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [teamInvites, setTeamInvites] = useState<TeamInviteRecord[]>([]);
  const [newName, setNewName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [hasRotationCheckpoint, setHasRotationCheckpoint] = useState(false);
  const [hasCreationCheckpoint, setHasCreationCheckpoint] = useState(false);
  const [pendingTeamDeletion, setPendingTeamDeletion] = useState<{ teamId: string } | null>(null);
  const [deletionJournalError, setDeletionJournalError] = useState(false);
  const [remoteDeletions, setRemoteDeletions] = useState<TeamDeletionStatus[]>([]);
  const [nextDeletionCursor, setNextDeletionCursor] = useState<string | null>(null);
  const [deletionDiscoveryError, setDeletionDiscoveryError] = useState(false);
  const [deletionDiscoveryDone, setDeletionDiscoveryDone] = useState(false);
  const deletionContext = useRef(0);
  useEffect(() => {
    const invalidate = () => { deletionContext.current++; };
    invalidate();
    setRemoteDeletions([]); setNextDeletionCursor(null); setDeletionDiscoveryDone(false); setDeletionDiscoveryError(false);
    const refresh = () => {
      try { setPendingTeamDeletion(uid ? localTeamDeletion(uid) : null); setDeletionJournalError(false); }
      catch { setDeletionJournalError(true); }
    };
    refresh(); const stop = observeTeamDeletion(refresh);
    const stopAuth = onAuthStateChanged(auth, () => { if (auth.currentUser?.uid !== uid) invalidate(); });
    return () => { invalidate(); stop(); stopAuth(); };
  }, [uid]);

  useEffect(() => {
    const refresh = () => setHasCreationCheckpoint(Boolean(uid && hasTeamCreationCheckpoint(uid)));
    refresh(); return observeTeamCreationCheckpoint(refresh);
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const stopTeams = watchMyTeams(uid, setTeams);
    const stopInvites = watchPendingInvites(uid, setPendingInvites);
    return () => {
      stopTeams();
      stopInvites();
    };
  }, [uid]);

  useEffect(() => {
    if (selectedId && teams.some((team) => team.id === selectedId)) return;
    setSelectedId(teams[0]?.id ?? null);
  }, [teams, selectedId]);

  const selected = useMemo(
    () => teams.find((team) => team.id === selectedId) ?? null,
    [teams, selectedId],
  );
  const invitationContext = useRef({ signature: '', generation: 0 });
  const invitationSignature = JSON.stringify([uid, vaultUnlocked, selected?.id, selected?.activeKeyEpoch,
    selected?.activeKeyId, selected?.keyRotationStatus, selected?.memberUids, selected?.roles]);
  useEffect(() => {
    invitationContext.current = { signature: invitationSignature, generation: invitationContext.current.generation + 1 };
    return () => { invitationContext.current.generation++; };
  }, [invitationSignature]);

  useEffect(() => {
    const refresh = () => setHasRotationCheckpoint(Boolean(uid && selectedId && hasTeamRotationCheckpoint(uid, selectedId)));
    refresh();
    return observeTeamRotationCheckpoint(refresh);
  }, [uid, selectedId]);

  useEffect(() => {
    if (!selected) {
      setTeamInvites([]);
      return undefined;
    }
    return watchTeamInvites(selected.id, setTeamInvites);
  }, [selected]);

  const requireVault = useCallback(() => {
    if (!user || !vaultUnlocked || !mnemonic) {
      throw new Error(t('teamNeedMnemonic'));
    }
    return { user, mnemonic };
  }, [mnemonic, user, vaultUnlocked, t]);

  const handleCreate = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!hasCreationCheckpoint && !newName.trim()) return;
    setBusy('create');
    try {
      const { user: current, mnemonic: words } = requireVault();
      const created = await createTeamWithActiveEpoch(current, words, hasCreationCheckpoint ? null : newName);
      if (auth.currentUser?.uid !== current.uid) return;
      setNewName('');
      setSelectedId(created.teamId);
      toast.success(t('teamCreated', { name: created.name }));
    } catch (error) {
      if (auth.currentUser?.uid === uid) toast.error(t(error instanceof TeamCreationError && error.reason === 'unsupported'
        ? 'teamCreationUnsupported' : 'teamCreateFail'));
    } finally {
      setBusy(null);
    }
  };

  const handleCancelCreation = async () => {
    const current = auth.currentUser;
    if (!current || current.uid !== uid || !vaultUnlocked) return;
    const ok = await askConfirm({ title: t('teamCreationCancel'), message: t('teamCreationCancelMessage'), confirmLabel: t('teamCreationCancel') });
    if (!ok || auth.currentUser?.uid !== current.uid) return;
    setBusy('create');
    try { await cancelPendingTeamCreation(current); }
    catch { if (auth.currentUser?.uid === current.uid) toast.error(t('teamCreateFail')); }
    finally { setBusy(null); }
  };

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !inviteEmail.trim()) return;
    setBusy('invite');
    const generation = invitationContext.current.generation;
    const isCurrent = () => invitationContext.current.generation === generation && auth.currentUser?.uid === uid;
    try {
      const { user: current, mnemonic: words } = requireVault();
      const invited = await inviteWithCurrentTeamKey(current.uid, words, selected, inviteEmail, isCurrent);
      setInviteEmail('');
      toast.success(t('teamInvited', { name: invited.displayName }));
    } catch (error) {
      if (isCurrent()) toast.error(teamErrorMessage(error, t('teamInviteFail')));
    } finally {
      if (auth.currentUser?.uid === uid) setBusy(null);
    }
  };

  const handleAccept = async (invite: TeamInviteRecord) => {
    setBusy(`accept-${invite.id}`);
    const generation = invitationContext.current.generation;
    try {
      const { user: current, mnemonic: words } = requireVault();
      await acceptWithCurrentVault(current.uid, words, invite, undefined, () => invitationContext.current.generation === generation);
      if (auth.currentUser?.uid !== current.uid) return;
      setSelectedId(invite.teamId);
      toast.success(t('teamJoined', { name: invite.teamName || t('tabTeams') }));
    } catch (error) {
      if (auth.currentUser?.uid === uid) toast.error(teamErrorMessage(error, t('teamAcceptFail')));
    } finally {
      setBusy(null);
    }
  };

  const handleLeave = async () => {
    if (!selected) return;
    const ok = await askConfirm({
      title: t('teamLeaveTitle'),
      message: t('teamLeaveMsg', { name: selected.name }),
      confirmLabel: t('teamLeave'),
      danger: true,
    });
    if (!ok) return;
    setBusy('leave');
    try {
      await leaveTeamRemote(selected.id);
      clearTeamKeyCache(selected.id);
      toast.success(t('teamLeft'));
    } catch (error) {
      toast.error(teamErrorMessage(error, t('teamLeaveFail')));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!selected || !uid || busy || auth.currentUser?.uid !== uid || selected.ownerUid !== uid || pendingTeamDeletion || deletionJournalError) return;
    const teamId = selected.id; const generation = deletionContext.current;
    const confirmationContext = invitationContext.current.generation;
    const isCurrent = () => deletionContext.current === generation && auth.currentUser?.uid === uid;
    const ok = await askConfirm({
      title: t('teamDeleteTitle'),
      message: t('teamDeleteMsg', { name: selected.name }),
      confirmLabel: t('teamDelete'),
      danger: true,
    });
    if (!ok || !isCurrent() || invitationContext.current.generation !== confirmationContext) return;
    setBusy('delete');
    try {
      const result = await requestTeamDeletion(uid, teamId, 'start', undefined, isCurrent);
      if (isCurrent() && result.status === 'complete') toast.success(t('teamDeleted'));
    } catch {
      if (isCurrent()) toast.error(t('teamDeleteFail'));
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };
  const handleResumeDeletion = async (teamId = pendingTeamDeletion?.teamId) => {
    if (!teamId || !uid || busy || auth.currentUser?.uid !== uid || deletionJournalError ||
        (pendingTeamDeletion && pendingTeamDeletion.teamId !== teamId)) return;
    const generation = deletionContext.current;
    const isCurrent = () => deletionContext.current === generation && auth.currentUser?.uid === uid;
    setBusy('delete');
    try {
      const result = await requestTeamDeletion(uid, teamId, 'resume', undefined, isCurrent);
      if (isCurrent() && result.status === 'complete') {
        setRemoteDeletions(previous => previous.filter(request => request.teamId !== teamId)); toast.success(t('teamDeleted'));
      }
    } catch { if (isCurrent()) toast.error(t('teamDeleteFail')); }
    finally { if (isCurrent()) setBusy(null); }
  };
  const handleFindDeletions = async (afterTeamId: string | null = null) => {
    if (!uid || auth.currentUser?.uid !== uid || busy) return;
    const generation = deletionContext.current;
    const isCurrent = () => deletionContext.current === generation && auth.currentUser?.uid === uid;
    setBusy('find-deletions'); setDeletionDiscoveryError(false);
    try {
      const result = await discoverTeamDeletions(uid, afterTeamId, undefined, isCurrent);
      if (!isCurrent()) return;
      setRemoteDeletions(previous => afterTeamId === null ? result.requests :
        [...new Map([...previous, ...result.requests].map(request => [request.teamId, request])).values()]);
      setNextDeletionCursor(result.nextAfterTeamId); setDeletionDiscoveryDone(true);
    } catch { if (isCurrent()) setDeletionDiscoveryError(true); }
    finally { if (isCurrent()) setBusy(null); }
  };

  const handleSetRole = async (targetUid: string, role: Exclude<TeamRole, 'owner'>) => {
    if (!selected) return;
    setBusy(`role-${targetUid}`);
    try {
      await setMemberRoleRemote(selected.id, targetUid, role);
      toast.success(role === 'admin' ? t('teamPromoted') : t('teamDemoted'));
    } catch (error) {
      toast.error(teamErrorMessage(error, t('teamRoleFail')));
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveMember = async (targetUid: string) => {
    if (!selected) return;
    const ok = await askConfirm({
      title: t('teamRemoveTitle'),
      message: t('teamRemoveWarning'),
      confirmLabel: t('teamRemoveAndRotate'), danger: true,
    });
    if (!ok) return;
    setBusy(`remove-${targetUid}`);
    try {
      await removeTeamMemberRemote(selected.id, targetUid);
      toast.success(t('teamRemovedPending'));
    } catch (error) {
      toast.error(teamErrorMessage(error, t('teamRemoveFail')));
    } finally { setBusy(null); }
  };

  const handleRequestRotation = async () => {
    if (!selected) return;
    const ok = await askConfirm({
      title: t('teamRotateTitle'),
      message: t('teamRotateWarning'),
      confirmLabel: t('teamRotateRequest'),
    });
    if (!ok) return;
    setBusy('request-rotation');
    try {
      await requestTeamKeyRotationRemote(selected.id);
      toast.success(t('teamRotateRequested'));
    } catch (error) {
      toast.error(teamErrorMessage(error, t('teamRotateRequestFail')));
    } finally { setBusy(null); }
  };

  const handleCommitRotation = async () => {
    if (!selected || !selected.activeKeyEpoch) return;
    setBusy('commit-rotation');
    try {
      const { user: current, mnemonic: words } = requireVault();
      await completeTeamRotationWithRecovery(current.uid, selected.id, words);
      if (auth.currentUser?.uid === current.uid) toast.success(t('teamRotateDone'));
    } catch (error) {
      toast.error(t(error instanceof TeamRotationRecoveryError && error.reason === 'unsupported' ? 'teamRotateUnsupported' : 'teamRotateCommitFail'));
    } finally { setBusy(null); }
  };

  const handleDiscardRotationCheckpoint = async () => {
    if (!selected || busy) return;
    const accountUid = uid;
    const teamId = selected.id;
    if (!await askConfirm({ title: t('teamRotateCheckpointDiscard'), message: t('teamRotateCheckpointDiscardWarning'),
      confirmLabel: t('teamRotateCheckpointDiscard') })) return;
    if (auth.currentUser?.uid !== accountUid) return;
    setBusy('discard-rotation-checkpoint');
    try { await discardTeamRotationCheckpoint(accountUid, teamId); }
    catch (error) { toast.error(t(error instanceof TeamRotationRecoveryError && error.reason === 'unsupported' ? 'teamRotateUnsupported' : 'teamRotateCommitFail')); }
    finally { setBusy(null); }
  };

  if (!uid) {
    return (
      <p className="text-sm text-slate-400">{t('teamNeedLogin')}</p>
    );
  }

  return (
    <div className="space-y-5">
      {!TEAM_WRITES_ENABLED && (
        <div role="status" className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          {TEAM_READ_ONLY_MESSAGE}
        </div>
      )}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="space-y-1 text-sm leading-relaxed text-slate-400">
            <p>
              {t('teamKeyBlurb1')}
            </p>
            <p>
              {t('teamKeyBlurb2')}
            </p>
            <p>{t('teamHistoryAccessHint')}</p>
            {!vaultUnlocked && (
              <p className="font-medium text-amber-200">
                {t('teamVaultLocked')}
              </p>
            )}
          </div>
        </div>
      </div>

      {pendingInvites.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-200">
            {t('teamPending')}
          </p>
          {pendingInvites.map((invite) => (
            <div key={invite.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{invite.teamName || t('tabTeams')}</p>
                <p className="text-[11px] text-slate-400">
                  {t('teamExpires', { date: dateLabel(invite.expiresAt) })}
                </p>
              </div>
              <button
                type="button"
                disabled={!TEAM_WRITES_ENABLED || !vaultUnlocked || busy === `accept-${invite.id}`}
                onClick={() => void handleAccept(invite)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40"
              >
                {busy === `accept-${invite.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {t('teamAccept')}
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingTeamDeletion && <div role="status" className="space-y-2 rounded-2xl border border-amber-400/20 p-4 text-sm">
        <p>{t('teamDeletionPending')}</p>
        <button type="button" disabled={Boolean(busy)} onClick={() => void handleResumeDeletion()}
          className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">{t('teamDeletionResume')}</button>
      </div>}
      {uid && <div className="space-y-2 text-sm">
        <button type="button" disabled={Boolean(busy)} onClick={() => void handleFindDeletions()}
          className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">{t('teamDeletionFind')}</button>
        {remoteDeletions.filter(request => request.teamId !== pendingTeamDeletion?.teamId).map(request =>
          <div key={request.teamId} className="space-y-2 rounded-2xl border border-amber-400/20 p-4">
            <p>{t('teamDeletionPending')} <span className="break-all font-mono">{request.teamId}</span></p>
            <button type="button" disabled={Boolean(busy) || Boolean(pendingTeamDeletion) || deletionJournalError}
              onClick={() => void handleResumeDeletion(request.teamId)} className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">
              {t('teamDeletionResume')}
            </button>
          </div>)}
        {nextDeletionCursor && <button type="button" disabled={Boolean(busy)} onClick={() => void handleFindDeletions(nextDeletionCursor)}
          className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">{t('teamDeletionMore')}</button>}
        {deletionDiscoveryDone && remoteDeletions.length === 0 && !pendingTeamDeletion && <p>{t('teamDeletionNone')}</p>}
        {deletionDiscoveryError && <p role="alert" className="text-amber-200">{t('teamDeletionFindFail')}</p>}
      </div>}
      {deletionJournalError && <p role="alert" className="text-sm text-amber-200">{t('teamDeletionJournalError')}</p>}
      {selected?.ownerUid === uid && !TEAM_DELETION_ENABLED && !pendingTeamDeletion &&
        <p className="text-xs text-slate-400">{t('teamDeletionUnavailable')}</p>}
      {hasCreationCheckpoint && <div role="status" className="space-y-2 rounded-2xl border border-amber-400/20 p-4 text-sm">
        <p>{t('teamCreationPending')}</p>
        <button type="button" disabled={!TEAM_WRITES_ENABLED || !vaultUnlocked || busy === 'create'}
          onClick={() => void handleCreate()} className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">
          {t('teamCreationResume')}
        </button>
        <button type="button" disabled={!vaultUnlocked || busy === 'create'} onClick={() => void handleCancelCreation()}
          className="ml-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">{t('teamCreationCancel')}</button>
      </div>}
      {TEAM_WRITES_ENABLED && !hasCreationCheckpoint && <form onSubmit={(event) => void handleCreate(event)} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('teamNew')}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('teamName')}</span>
            <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={80}
            placeholder={t('teamName')}
            className="min-w-0 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/25"
          />
          </label>
          <button
            type="submit"
            disabled={!vaultUnlocked || !newName.trim() || busy === 'create'}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-40"
          >
            {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
            {t('teamCreate')}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          {t('teamPreviewNote', { max: MAX_TEAM_MEMBERS })}
        </p>
      </form>}

      {teams.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {teams.map((team) => {
            const active = team.id === selected?.id;
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => setSelectedId(team.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                  active
                    ? 'border-purple-400/40 bg-purple-500/20 text-purple-100'
                    : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
                }`}
              >
                {team.name}
                <span className="ml-2 text-[10px] opacity-70">
                  {team.memberUids.length}/{MAX_TEAM_MEMBERS}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-white">{selected.name}</p>
              <p className="mt-1 text-[11px] text-slate-400">
                {t('teamSeats', {
                  role: roleLabel(roleOf(selected, uid)),
                  count: selected.memberUids.length,
                  max: MAX_TEAM_MEMBERS,
                })}
              </p>
            </div>
            <div className="flex gap-2">
              {selected.ownerUid === uid ? (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={Boolean(busy) || !TEAM_DELETION_ENABLED || Boolean(pendingTeamDeletion) || deletionJournalError}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/25 px-3 py-1.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" />
                  {t('teamDelete')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleLeave()}
                  disabled={busy === 'leave'}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-40"
                >
                  <LogOut className="h-3 w-3" />
                  {t('teamLeave')}
                </button>
              )}
            </div>
          </div>

          <TeamHistoryReencryptionPanel key={`${uid}:${selected.id}`} uid={uid} team={selected} mnemonic={mnemonic}
            unlocked={vaultUnlocked} askConfirm={askConfirm} />
          {(selected.keyRotationStatus === 'rotation_pending' || selected.keyRotationStatus === 'rotation_blocked') && (
            <div role="status" className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              <p className="font-semibold">{t('teamRotatePending')}</p>
              <p className="mt-1 text-xs">{t('teamRotatePendingHint')}</p>
              {canInviteMembers(selected, uid) && (
                <button type="button" onClick={() => void handleCommitRotation()}
                  disabled={!vaultUnlocked || busy !== null}
                  className="mt-3 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-slate-900 disabled:opacity-40">
                  {busy === 'commit-rotation' ? t('teamRotateCompleting') : vaultUnlocked ? t('teamRotateComplete') : t('teamRotateUnlock')}
                </button>
              )}
            </div>
          )}
          {selected.keyRotationStatus === 'active' && canInviteMembers(selected, uid) && (
            <button type="button" onClick={() => void handleRequestRotation()}
              disabled={busy !== null}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-300 disabled:opacity-40">
              {t('teamRotateRequestAction')}
            </button>
          )}

          {hasRotationCheckpoint && canInviteMembers(selected, uid) && <div className="space-y-2 rounded-xl border border-white/15 p-3 text-sm text-slate-300">
            <p>{t('teamRotateCheckpointHint')}</p>
            {selected.keyRotationStatus === 'active' && <button type="button" disabled={!vaultUnlocked || busy !== null}
              onClick={() => void handleCommitRotation()} className="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">
              {t('teamRotateCheckpointVerify')}
            </button>}
            <button type="button" disabled={busy !== null} onClick={() => void handleDiscardRotationCheckpoint()}
              className="ml-2 rounded-lg border border-white/20 px-3 py-2 disabled:opacity-40">{t('teamRotateCheckpointDiscard')}</button>
          </div>}

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{t('teamMembers')}</p>
            <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/8 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">{t('teamUid')}</th>
                    <th className="px-3 py-2 font-medium">{t('teamRole')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.memberUids.map((memberUid) => {
                    const memberRole = roleOf(selected, memberUid);
                    const isSelf = memberUid === uid;
                    return (
                    <tr key={memberUid} className="border-b border-white/[0.05] last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">
                        <span className="truncate">{memberUid}</span>
                        {isSelf ? <span className="ml-2 text-[10px] text-slate-500">{t('teamYou')}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        <span className={memberRole === 'owner' ? 'text-amber-200' : memberRole === 'admin' ? 'text-indigo-200' : ''}>
                          {roleLabel(memberRole)}
                        </span>
                        {TEAM_WRITES_ENABLED && selected.ownerUid === uid && memberRole !== 'owner' && (
                          <button
                            type="button"
                            disabled={busy === `role-${memberUid}`}
                            onClick={() => void handleSetRole(memberUid, memberRole === 'admin' ? 'member' : 'admin')}
                            className="ml-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:text-indigo-200 disabled:opacity-40"
                          >
                            {memberRole === 'admin' ? t('teamDemote') : t('teamPromote')}
                          </button>
                        )}
                        {canInviteMembers(selected, uid) && !isSelf && memberRole !== 'owner' && (
                          <button type="button" disabled={busy !== null}
                            onClick={() => void handleRemoveMember(memberUid)}
                            className="ml-3 text-[10px] font-semibold uppercase text-rose-300 disabled:opacity-40">
                            {t('remove')}
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {TEAM_WRITES_ENABLED && canInviteMembers(selected, uid) && (
            <form onSubmit={(event) => void handleInvite(event)} className="space-y-2">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('teamInviteEmail')}</span>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="membro@dominio.com"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/25"
                />
                <button
                  type="submit"
                  disabled={!vaultUnlocked || !inviteEmail.trim() || busy === 'invite' || selected.memberUids.length >= MAX_TEAM_MEMBERS}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-40"
                >
                  {busy === 'invite' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  {t('teamInvite')}
                </button>
              </div>
              </label>
              <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
                <Mail className="mt-0.5 h-3 w-3 shrink-0" />
                {t('teamInviteHint')}
              </p>
            </form>
          )}

          {canInviteMembers(selected, uid) && teamInvites.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{t('teamWaiting')}</p>
              {teamInvites.map((invite) => (
                <p key={invite.id} className="rounded-lg bg-black/20 px-3 py-1.5 font-mono text-[11px] text-slate-400">
                  {invite.uid.slice(0, 12)}… · {t('teamUntil', { date: dateLabel(invite.expiresAt) })}
                </p>
              ))}
            </div>
          )}

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" />
            {t('teamDestHint')}
          </p>
        </div>
      )}

      {teams.length === 0 && pendingInvites.length === 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-xs text-slate-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          {t('teamEmpty')}
        </div>
      )}
    </div>
  );
};
