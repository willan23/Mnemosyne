import { onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth } from '../firebase';
import { attachmentActorIdValid } from '../../../functions/src/attachmentEnvelope';
import { clearTeamKeyCache } from './teamVault';
import { TEAM_DELETION_ENABLED } from '../config/releaseGates';
export interface TeamDeletionStatus { uid: string; teamId: string; status: 'unknown' | 'pending' | 'complete'; retryAt: number | null }
export interface PendingTeamDeletions { uid: string; requests: TeamDeletionStatus[]; nextAfterTeamId: string | null }
interface Checkpoint { v: 1; uid: string; teamId: string; phase: 'pending' | 'remote-complete' }
export interface TeamDeletionClientDeps {
  currentUid: () => string | null; observeAuth: (changed: () => void) => () => void;
  storage: Storage; call: (name: 'deleteTeam' | 'getTeamDeletionStatus' | 'getPendingTeamDeletions',
    input: { teamId: string; expectedUid: string } | { expectedUid: string; afterTeamId: string | null }) => Promise<unknown>;
  cleanup: (uid: string, teamId: string) => void; isCurrent: () => boolean;
}
const key = (uid: string) => `mnemosyne:team-deletion:v1:${encodeURIComponent(uid)}`;
const EVENT = 'mnemosyne:team-deletion-changed';
const changed = () => window.dispatchEvent(new Event(EVENT));
const failure = () => new Error('Não foi possível confirmar a eliminação da equipa. O pedido fica disponível para retomar.');
function readCheckpoint(uid: string, storage: Storage): Checkpoint | null {
  const raw = storage.getItem(key(uid)); if (raw === null) return null;
  const data = JSON.parse(raw) as Checkpoint;
  if (!data || Object.keys(data).sort().join(',') !== 'phase,teamId,uid,v' || data.v !== 1 || data.uid !== uid ||
      !attachmentActorIdValid(data.teamId) || !['pending', 'remote-complete'].includes(data.phase)) throw failure();
  return data;
}
function saveCheckpoint(uid: string, teamId: string, phase: Checkpoint['phase'], storage: Storage) {
  const value = JSON.stringify({ v: 1, uid, teamId, phase }); storage.setItem(key(uid), value);
  if (storage.getItem(key(uid)) !== value) throw failure(); changed();
}
export function localTeamDeletion(uid: string, storage: Storage = localStorage): { teamId: string } | null {
  const checkpoint = readCheckpoint(uid, storage); return checkpoint ? { teamId: checkpoint.teamId } : null;
}
export function observeTeamDeletion(callback: () => void) {
  window.addEventListener(EVENT, callback); window.addEventListener('storage', callback);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', callback); };
}
function parseStatus(value: unknown, uid: string, teamId: string, allowUnknown = false): TeamDeletionStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'retryAt,status,teamId,uid' || data.uid !== uid || data.teamId !== teamId ||
      !['pending', 'complete', ...(allowUnknown ? ['unknown'] : [])].includes(data.status as string) ||
      (data.status === 'pending' ? !Number.isSafeInteger(data.retryAt) || (data.retryAt as number) < 0 : data.retryAt !== null)) throw failure();
  return data as unknown as TeamDeletionStatus;
}
const defaults = (): TeamDeletionClientDeps => ({ currentUid: () => auth.currentUser?.uid ?? null,
  observeAuth: callback => onAuthStateChanged(auth, callback), storage: localStorage, isCurrent: () => true,
  call: async (name, input) => (await httpsCallable(getFunctions(app, 'europe-west1'), name)(input)).data,
  cleanup: (uid, teamId) => {
    clearTeamKeyCache(teamId);
    for (const prefix of ['team-rotation-recovery', 'team-history']) {
      localStorage.removeItem(`mnemosyne:${prefix}:v1:${encodeURIComponent(uid)}:${encodeURIComponent(teamId)}`);
    }
  },
});
/** Explicit discovery returns only this owner's durable requests; it never starts deletion. */
export async function discoverTeamDeletions(uid: string, afterTeamId: string | null = null, injected?: TeamDeletionClientDeps,
  isCurrent: () => boolean = () => true): Promise<PendingTeamDeletions> {
  if (!attachmentActorIdValid(uid) || (afterTeamId !== null && !attachmentActorIdValid(afterTeamId))) throw failure();
  const deps = injected ?? defaults(); let contextChanged = false;
  const guard = () => { if (contextChanged || deps.currentUid() !== uid || !deps.isCurrent() || !isCurrent()) throw failure(); };
  guard(); const stop = deps.observeAuth(() => { if (deps.currentUid() !== uid) contextChanged = true; });
  try {
    const value = await deps.call('getPendingTeamDeletions', { expectedUid: uid, afterTeamId }); guard();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
    const data = value as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'nextAfterTeamId,requests,uid' || data.uid !== uid ||
        !Array.isArray(data.requests) || data.requests.length > 25 ||
        (data.nextAfterTeamId !== null && !attachmentActorIdValid(data.nextAfterTeamId))) throw failure();
    const requests = data.requests.map(request => {
      if (!request || !attachmentActorIdValid(request.teamId)) throw failure();
      const parsed = parseStatus(request, uid, request.teamId);
      if (parsed.status !== 'pending') throw failure(); return parsed;
    });
    if (new Set(requests.map(request => request.teamId)).size !== requests.length ||
        (data.nextAfterTeamId !== null && (requests.length !== 25 || data.nextAfterTeamId !== requests[24].teamId))) throw failure();
    return { uid, requests, nextAfterTeamId: data.nextAfterTeamId as string | null };
  } finally { stop(); }
}
/** Explicit start confirmation precedes this call; recovery always checks server status before another request. */
export async function requestTeamDeletion(uid: string, teamId: string, mode: 'start' | 'resume', injected?: TeamDeletionClientDeps,
  isCurrent: () => boolean = () => true) {
  if (!attachmentActorIdValid(uid) || !attachmentActorIdValid(teamId) || !['start', 'resume'].includes(mode)) throw failure();
  const deps = injected ?? defaults(); let contextChanged = false;
  const guard = () => { if (contextChanged || deps.currentUid() !== uid || !deps.isCurrent() || !isCurrent()) throw failure(); };
  guard(); const stop = deps.observeAuth(() => { if (deps.currentUid() !== uid) contextChanged = true; });
  try {
    let checkpoint = readCheckpoint(uid, deps.storage); guard();
    if (checkpoint && checkpoint.teamId !== teamId) throw failure();
    if (!injected && mode === 'start' && !checkpoint && !TEAM_DELETION_ENABLED) {
      throw new Error('A eliminação de equipas está em validação.');
    }
    const input = { teamId, expectedUid: uid };
    if ((mode === 'resume' || checkpoint) && checkpoint?.phase !== 'remote-complete') {
      const status = parseStatus(await deps.call('getTeamDeletionStatus', input), uid, teamId, true); guard();
      if (status.status === 'unknown' && !checkpoint) throw failure();
      if (status.status === 'complete') { saveCheckpoint(uid, teamId, 'remote-complete', deps.storage); checkpoint = readCheckpoint(uid, deps.storage); }
    }
    if (checkpoint?.phase !== 'remote-complete') {
      saveCheckpoint(uid, teamId, 'pending', deps.storage); guard();
      const result = parseStatus(await deps.call('deleteTeam', input), uid, teamId); guard();
      if (result.status === 'pending') return result;
      saveCheckpoint(uid, teamId, 'remote-complete', deps.storage); guard();
    }
    guard(); deps.cleanup(uid, teamId); guard();
    deps.storage.removeItem(key(uid)); if (deps.storage.getItem(key(uid)) !== null) throw failure(); changed();
    return { uid, teamId, status: 'complete' as const, retryAt: null };
  } finally { stop(); }
}
