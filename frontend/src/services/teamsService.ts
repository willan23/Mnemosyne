/**
 * Cliente das callables P2 de equipas + listeners Firestore (read-only).
 * Writes de teams/teamInvites passam sempre pelo Admin SDK.
 */

import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import app, { auth, db } from '../firebase';
import { attachmentActorIdValid } from '../../../functions/src/attachmentEnvelope';
import { MAX_TEAM_MEMBERS, type WrappedTeamKeyEnvelope } from './teamVault';

export interface TeamRecord {
  id: string;
  name: string;
  ownerUid: string;
  createdAt: number;
  memberUids: string[];
  wrappedKeys: Record<string, WrappedTeamKeyEnvelope>;
  roles: Record<string, TeamRole>;
  activeKeyEpoch?: number;
  activeKeyId?: string;
  keyRotationStatus?: 'active' | 'rotation_pending' | 'rotation_blocked';
  pendingRotationId?: string | null;
}

export interface TeamKeyEpochRecord {
  epoch: number;
  keyId: string;
  status: 'active' | 'retired';
  memberUids: string[];
  wrappedKeys: Record<string, WrappedTeamKeyEnvelope>;
}

export interface TeamKeyRotationRecord {
  id: string;
  teamId: string;
  oldEpoch: number;
  newEpoch: number;
  status: 'pending' | 'committed' | 'blocked' | 'cancelled';
  reason: 'member_left' | 'member_removed' | 'scheduled' | 'manual' | 'key_compromise';
  targetUid: string | null;
  requestedByUid: string;
}

export type TeamRole = 'owner' | 'admin' | 'member';

export interface TeamInviteRecord {
  id: string;
  teamId: string;
  teamName: string;
  fromUid: string;
  uid: string;
  emailHash: string;
  wrappedKey: WrappedTeamKeyEnvelope;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: number;
  expiresAt: number;
  keyEpoch?: number;
  keyId?: string | null;
  publicKeyFingerprint?: string;
}

export interface InviteeProfile {
  uid: string;
  displayName: string;
  publicKeyPem: string;
  emailHash: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseWrapped(value: unknown): WrappedTeamKeyEnvelope | null {
  const rec = asRecord(value);
  if (rec.v !== 1 || rec.alg !== 'RSA-OAEP' || typeof rec.ct !== 'string') return null;
  return { v: 1, alg: 'RSA-OAEP', ct: rec.ct };
}

export function parseTeam(id: string, data: Record<string, unknown>): TeamRecord | null {
  if (typeof data.name !== 'string' || typeof data.ownerUid !== 'string') return null;
  const memberUids = Array.isArray(data.memberUids)
    ? data.memberUids.filter((uid): uid is string => typeof uid === 'string')
    : [];
  const wrappedKeys: Record<string, WrappedTeamKeyEnvelope> = {};
  const rawWraps = asRecord(data.wrappedKeys);
  for (const [uid, envelope] of Object.entries(rawWraps)) {
    const parsed = parseWrapped(envelope);
    if (parsed) wrappedKeys[uid] = parsed;
  }
  return {
    id,
    name: data.name,
    ownerUid: data.ownerUid,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    memberUids,
    wrappedKeys,
    roles: backfillRoles(data.ownerUid, memberUids, data.roles),
    activeKeyEpoch: typeof data.activeKeyEpoch === 'number' && Number.isSafeInteger(data.activeKeyEpoch) &&
      data.activeKeyEpoch >= 1 ? data.activeKeyEpoch : undefined,
    activeKeyId: typeof data.activeKeyId === 'string' ? data.activeKeyId : undefined,
    keyRotationStatus: data.keyRotationStatus === 'active' || data.keyRotationStatus === 'rotation_pending' ||
      data.keyRotationStatus === 'rotation_blocked' ? data.keyRotationStatus : undefined,
    pendingRotationId: typeof data.pendingRotationId === 'string' ? data.pendingRotationId : null,
  };
}

function backfillRoles(ownerUid: string, memberUids: string[], raw: unknown): Record<string, TeamRole> {
  const rec = asRecord(raw);
  const roles: Record<string, TeamRole> = {};
  for (const uid of memberUids) {
    const mapped = rec[uid];
    roles[uid] = mapped === 'owner' || mapped === 'admin' || mapped === 'member' ? mapped : 'member';
  }
  roles[ownerUid] = 'owner';
  return roles;
}

export function roleOf(team: TeamRecord, uid: string): TeamRole {
  if (uid === team.ownerUid) return 'owner';
  const mapped = team.roles[uid];
  if (mapped === 'admin' || mapped === 'member') return mapped;
  return 'member';
}

export function canInviteMembers(team: TeamRecord, uid: string): boolean {
  const role = roleOf(team, uid);
  return role === 'owner' || role === 'admin';
}

export const ROLE_LABEL: Record<TeamRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Membro',
};

function parseInvite(id: string, data: Record<string, unknown>): TeamInviteRecord | null {
  const wrappedKey = parseWrapped(data.wrappedKey);
  if (!wrappedKey) return null;
  if (typeof data.teamId !== 'string' || typeof data.uid !== 'string') return null;
  const status = data.status;
  if (status !== 'pending' && status !== 'accepted' && status !== 'revoked' && status !== 'expired') {
    return null;
  }
  return {
    id,
    teamId: data.teamId,
    teamName: typeof data.teamName === 'string' ? data.teamName : '',
    fromUid: typeof data.fromUid === 'string' ? data.fromUid : '',
    uid: data.uid,
    emailHash: typeof data.emailHash === 'string' ? data.emailHash : '',
    wrappedKey,
    status,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0,
    keyEpoch: Number.isSafeInteger(data.keyEpoch) && (data.keyEpoch as number) >= 1 ? data.keyEpoch as number : undefined,
    keyId: typeof data.keyId === 'string' ? data.keyId : null,
    publicKeyFingerprint: typeof data.publicKeyFingerprint === 'string' ? data.publicKeyFingerprint : undefined,
  };
}

function teamFunctions() {
  return getFunctions(app, 'europe-west1');
}

export function teamErrorMessage(error: unknown, fallback: string): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: string }).code || '')
    : '';
  if (code.includes('unauthenticated')) return 'Inicia sessão para gerir equipas.';
  if (code.includes('resource-exhausted')) {
    return `Sovereign: máximo de ${MAX_TEAM_MEMBERS} membros por equipa.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function lookupTeamInvitee(email: string): Promise<InviteeProfile> {
  const callable = httpsCallable(teamFunctions(), 'lookupTeamInvitee');
  const result = await callable({ email: email.trim().toLowerCase() });
  const data = asRecord(result.data);
  if (typeof data.uid !== 'string' || typeof data.publicKeyPem !== 'string') {
    throw new Error('Perfil público incompleto — o convite exige chave RSA de Comms.');
  }
  return {
    uid: data.uid,
    displayName: typeof data.displayName === 'string' ? data.displayName : data.uid.slice(0, 8),
    publicKeyPem: data.publicKeyPem,
    emailHash: typeof data.emailHash === 'string' ? data.emailHash : '',
  };
}

export async function createTeamRemote(name: string, wrappedKey: WrappedTeamKeyEnvelope, expectedUid: string, publicKeyFingerprint: string, requestId: string): Promise<{
  teamId: string;
  name: string;
  activeKeyEpoch: number;
  activeKeyId: string;
  alreadyCreated: boolean;
}> {
  const callable = httpsCallable(teamFunctions(), 'createTeam');
  const result = await callable({ name: name.trim(), wrappedKey, expectedUid, publicKeyFingerprint, requestId });
  const data = asRecord(result.data);
  if (typeof data.teamId !== 'string' || !data.teamId || data.teamId.includes('/') || !Number.isSafeInteger(data.activeKeyEpoch) ||
      (data.activeKeyEpoch as number) < 1 || typeof data.alreadyCreated !== 'boolean' ||
      typeof data.activeKeyId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.activeKeyId)) {
    throw new Error('Resposta inválida ao criar a equipa.');
  }
  return { teamId: data.teamId, name: typeof data.name === 'string' ? data.name : name.trim(),
    activeKeyEpoch: data.activeKeyEpoch as number, activeKeyId: data.activeKeyId, alreadyCreated: data.alreadyCreated };
}

export async function cancelTeamCreationRemote(requestId: string, expectedUid: string): Promise<void> {
  const callable = httpsCallable(teamFunctions(), 'cancelTeamCreation');
  const result = await callable({ requestId, expectedUid, confirmed: true });
  if (asRecord(result.data).ok !== true) throw new Error('Resposta inválida ao cancelar a criação.');
}

export async function inviteMemberRemote(input: {
  teamId: string;
  email: string;
  wrappedKey: WrappedTeamKeyEnvelope;
  expectedUid: string;
  inviteeUid: string;
  expectedKeyEpoch: number;
  expectedKeyId: string | null;
  publicKeyFingerprint: string;
}): Promise<{ inviteId: string; displayName: string }> {
  const callable = httpsCallable(teamFunctions(), 'inviteMember');
  const result = await callable(input);
  const data = asRecord(result.data);
  if (typeof data.inviteId !== 'string' || !data.inviteId || data.inviteId.includes('/') || data.inviteeUid !== input.inviteeUid) {
    throw new Error('Não foi possível confirmar o convite.');
  }
  return {
    inviteId: typeof data.inviteId === 'string' ? data.inviteId : '',
    displayName: typeof data.displayName === 'string' ? data.displayName : input.email,
  };
}

export async function acceptInviteRemote(inviteId: string): Promise<{ teamId: string; name: string }> {
  const callable = httpsCallable(teamFunctions(), 'acceptInvite');
  const result = await callable({ inviteId });
  const data = asRecord(result.data);
  return {
    teamId: typeof data.teamId === 'string' ? data.teamId : '',
    name: typeof data.name === 'string' ? data.name : '',
  };
}

const rotationRequestKeys = new Map<string, string>();

async function sendRotationRequest(
  callableName: 'leaveTeam' | 'removeTeamMember' | 'requestTeamKeyRotation',
  identity: string,
  payload: Record<string, string>,
): Promise<void> {
  let idempotencyKey = rotationRequestKeys.get(identity);
  if (!idempotencyKey) {
    idempotencyKey = crypto.randomUUID();
    rotationRequestKeys.set(identity, idempotencyKey);
  }
  const callable = httpsCallable(teamFunctions(), callableName);
  try {
    await callable({ ...payload, idempotencyKey });
    rotationRequestKeys.delete(identity);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code && !['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal',
      'functions/unknown', 'functions/cancelled'].includes(code)) {
      rotationRequestKeys.delete(identity);
    }
    throw error;
  }
}

export async function leaveTeamRemote(teamId: string): Promise<void> {
  await sendRotationRequest('leaveTeam', `leave:${teamId}`, { teamId });
}

export async function removeTeamMemberRemote(teamId: string, targetUid: string): Promise<void> {
  await sendRotationRequest('removeTeamMember', `remove:${teamId}:${targetUid}`, { teamId, targetUid });
}

export async function requestTeamKeyRotationRemote(teamId: string): Promise<void> {
  await sendRotationRequest('requestTeamKeyRotation', `manual:${teamId}`, { teamId, reason: 'manual' });
}

export async function loadPendingTeamRotation(team: TeamRecord): Promise<TeamKeyRotationRecord> {
  if (!team.pendingRotationId) throw new Error('A equipa não tem rotação pendente.');
  const snapshot = await getDoc(doc(db, 'teamKeyRotations', team.pendingRotationId));
  const data = asRecord(snapshot.data());
  if (!snapshot.exists() || data.teamId !== team.id ||
      data.oldEpoch !== team.activeKeyEpoch || data.newEpoch !== (team.activeKeyEpoch ?? 0) + 1 ||
      (data.status !== 'pending' && data.status !== 'blocked') ||
      (team.keyRotationStatus !== 'rotation_pending' && team.keyRotationStatus !== 'rotation_blocked')) {
    throw new Error('Pedido de rotação inconsistente ou concluído.');
  }
  return {
    id: snapshot.id, teamId: team.id, oldEpoch: data.oldEpoch as number,
    newEpoch: data.newEpoch as number, status: data.status,
    reason: data.reason as TeamKeyRotationRecord['reason'],
    targetUid: typeof data.targetUid === 'string' ? data.targetUid : null,
    requestedByUid: typeof data.requestedByUid === 'string' ? data.requestedByUid : '',
  };
}

/** Recovery decisions require a fresh server acknowledgement, never an offline team snapshot. */
export async function loadTeamForRotationRecovery(teamId: string): Promise<TeamRecord> {
  const snapshot = await getDocFromServer(doc(db, 'teams', teamId));
  const team = snapshot.exists() ? parseTeam(snapshot.id, asRecord(snapshot.data())) : null;
  if (!team) throw new Error('Equipa indisponível para recuperar a rotação.');
  return team;
}

export async function loadTeamMemberPublicKeys(memberUids: string[]): Promise<Record<string, string>> {
  if (memberUids.length < 1 || memberUids.length > MAX_TEAM_MEMBERS ||
      new Set(memberUids).size !== memberUids.length) throw new Error('Membros da equipa inválidos.');
  const entries = await Promise.all(memberUids.map(async (uid) => {
    const snapshot = await getDocFromServer(doc(db, 'publicProfiles', uid));
    const pem = snapshot.data()?.publicKeyPem;
    if (!snapshot.exists() || typeof pem !== 'string' || !pem.includes('BEGIN PUBLIC KEY')) {
      throw new Error(`Falta a chave pública de ${uid}.`);
    }
    return [uid, pem] as const;
  }));
  return Object.fromEntries(entries);
}

export async function commitTeamKeyRotationRemote(input: {
  rotationId: string;
  expectedOldEpoch: number;
  newKeyId: string;
  wrappedKeys: Record<string, WrappedTeamKeyEnvelope>;
  publicKeyFingerprints: Record<string, string>;
}): Promise<{ newEpoch: number; alreadyCommitted: boolean }> {
  const callable = httpsCallable(teamFunctions(), 'commitTeamKeyRotation');
  const result = await callable(input);
  const data = asRecord(result.data);
  if (data.ok !== true || !Number.isSafeInteger(data.newEpoch)) {
    throw new Error('Resposta de rotação inválida.');
  }
  return { newEpoch: data.newEpoch as number, alreadyCommitted: data.alreadyCommitted === true };
}

export async function setMemberRoleRemote(
  teamId: string,
  targetUid: string,
  role: Exclude<TeamRole, 'owner'>,
): Promise<void> {
  const callable = httpsCallable(teamFunctions(), 'setMemberRole');
  await callable({ teamId, targetUid, role });
}

export function watchMyTeams(uid: string, onChange: (teams: TeamRecord[]) => void): Unsubscribe {
  const q = query(collection(db, 'teams'), where('memberUids', 'array-contains', uid));
  return onSnapshot(q, (snapshot) => {
    const teams = snapshot.docs
      .map((docSnap) => parseTeam(docSnap.id, docSnap.data() as Record<string, unknown>))
      .filter((item): item is TeamRecord => item !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
    onChange(teams);
  }, (error) => {
    console.warn('watchMyTeams', error);
    onChange([]);
  });
}

export function watchPendingInvites(uid: string, onChange: (invites: TeamInviteRecord[]) => void): Unsubscribe {
  if (!attachmentActorIdValid(uid) || auth.currentUser?.uid !== uid) { onChange([]); return () => undefined; }
  let active = true; let generation = 0;
  let inFlight = 0;
  let work: { generation: number; rows: { id: string; teamId: string }[]; offset: number; remaining: number; invites: TeamInviteRecord[] } | undefined;
  const pump = () => {
    const job = work;
    if (!job || !active || auth.currentUser?.uid !== uid || job.generation !== generation) return;
    while (inFlight < 4 && job.offset < job.rows.length) {
      const row = job.rows[job.offset++]; inFlight++;
      void getDocFromServer(doc(db, 'teamInvites', row.id)).then(invite => {
        if (!active || job.generation !== generation || auth.currentUser?.uid !== uid || !invite.exists()) return;
        const parsed = parseInvite(invite.id, invite.data());
        if (parsed?.uid === uid && parsed.teamId === row.teamId && parsed.status === 'pending' && parsed.expiresAt > Date.now()) job.invites.push(parsed);
      }).catch(() => undefined).finally(() => {
        inFlight--; job.remaining--;
        if (active && job.generation === generation && auth.currentUser?.uid === uid && job.remaining === 0) {
          onChange(job.invites.sort((a, b) => b.createdAt - a.createdAt));
        }
        pump();
      });
    }
  };
  const stopAuth = onAuthStateChanged(auth, () => {
    if (auth.currentUser?.uid !== uid) { active = false; generation++; onChange([]); }
  });
  // Listing carries no wrapped key. Every key is fetched from the server under the current team ACL.
  const q = query(collection(db, 'teamInviteInbox'), where('uid', '==', uid));
  const stop = onSnapshot(q, snapshot => {
    if (!active || auth.currentUser?.uid !== uid) return;
    const current = ++generation; onChange([]);
    const pointers = snapshot.docs.filter(row => {
      const data = row.data(); return Object.keys(data).sort().join(',') === 'inviteId,teamId,uid,v' && data.v === 1 &&
        data.uid === uid && data.inviteId === row.id && attachmentActorIdValid(data.inviteId) && attachmentActorIdValid(data.teamId);
    });
    work = { generation: current, rows: pointers.map(row => ({ id: row.id, teamId: row.data().teamId as string })),
      offset: 0, remaining: pointers.length, invites: [] };
    pump();
  }, () => { generation++; if (active && auth.currentUser?.uid === uid) onChange([]); });
  return () => { active = false; generation++; stop(); stopAuth(); };
}

export function watchTeamInvites(teamId: string, onChange: (invites: TeamInviteRecord[]) => void): Unsubscribe {
  const q = query(collection(db, 'teamInvites'), where('teamId', '==', teamId));
  return onSnapshot(q, (snapshot) => {
    const invites = snapshot.docs
      .map((docSnap) => parseInvite(docSnap.id, docSnap.data() as Record<string, unknown>))
      .filter((item): item is TeamInviteRecord => item !== null && item.status === 'pending')
      .sort((a, b) => b.createdAt - a.createdAt);
    onChange(invites);
  }, (error) => {
    console.warn('watchTeamInvites', error);
    onChange([]);
  });
}
