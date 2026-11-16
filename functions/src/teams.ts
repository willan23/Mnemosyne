import {verifiedAuthEmail} from './authEmail';
/**
 * P2 · Espaços de equipa E2EE (Founder Preview, sem billing gate).
 *
 * O servidor NUNCA vê a teamKey em claro. Guarda apenas:
 *   teams/{id}.wrappedKeys[uid]  → envelope RSA-OAEP { v, alg, ct }
 *   teamInvites/{id}.wrappedKey  → o mesmo envelope, copiado para wrappedKeys no accept
 *
 * A teamKey (AES-GCM-256) é gerada no cliente do owner e usada para cifrar
 * memórias de equipa no schema `enc: { v, iv, ct }` — igual às memórias
 * pessoais, mas a chave NÃO é a mnemónica: é a teamKey.
 *
 * Writes em `teams`, `teamInvites` e `teamAudit` são Admin SDK only (ver firestore.rules).
 * Limite Sovereign: 10 membros. P3: papéis owner/admin/member + audit append-only.
 * Stripe/SSO/SOC2 certificado ficam fora deste esqueleto.
 */

import { createHash, randomUUID } from 'crypto';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { consumeServerRateLimit } from './rateLimit';
import { liveAccountInTransaction, withLiveAccount } from './accountAccess';
import { attachmentActorIdValid } from './attachmentEnvelope';

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.warn('firebase-admin initializeApp deferred (unit tests / missing ADC)');
  }
}

const regionalFunctions = functions.region('europe-west1');

/** Keep membership writes closed until migration, recovery and revocation gates are verified. */
export const TEAM_WRITES_ENABLED = false;

export function assertTeamWritesEnabled(): void {
  if (!TEAM_WRITES_ENABLED) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Equipas em modo de leitura até existir rotação segura de chaves.',
    );
  }
}

export const TEAMS_COLLECTION = 'teams';
export const TEAM_INVITES_COLLECTION = 'teamInvites';
export const TEAM_INVITE_INBOX_COLLECTION = 'teamInviteInbox';
export const TEAM_AUDIT_COLLECTION = 'teamAudit';
export const MAX_TEAM_MEMBERS = 10;
export const TEAM_ROLES = ['owner', 'admin', 'member'] as const;
export const TEAM_AUDIT_ACTIONS = [
  'created',
  'invited',
  'accepted',
  'left',
  'deleted',
  'role_changed',
  'rotation_requested',
  'rotation_committed',
  'member_removed',
  'rotation_blocked',
] as const;
export const TEAM_NAME_MAX = 80;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WRAPPED_KEY_ALG = 'RSA-OAEP' as const;
export const WRAPPED_KEY_VERSION = 1 as const;

const FORBIDDEN_WRAP_KEYS = ['teamKey', 'key', 'plaintext', 'raw', 'secret', 'mnemonic', 'privateKey'];

export interface WrappedKeyEnvelope {
  v: typeof WRAPPED_KEY_VERSION;
  alg: typeof WRAPPED_KEY_ALG;
  ct: string;
}

export type TeamRole = (typeof TEAM_ROLES)[number];
export type TeamAuditAction = (typeof TEAM_AUDIT_ACTIONS)[number];

export interface TeamDocument {
  name: string;
  ownerUid: string;
  createdAt: number;
  memberUids: string[];
  wrappedKeys: Record<string, WrappedKeyEnvelope>;
  roles: Record<string, TeamRole>;
  activeKeyEpoch?: number;
  activeKeyId?: string;
  keyRotationStatus?: 'active' | 'rotation_pending' | 'rotation_blocked';
  pendingRotationId?: string | null;
}

export interface TeamAuditEvent {
  teamId: string;
  at: number;
  actorUid: string;
  action: TeamAuditAction;
  targetUid: string;
}

export interface TeamInviteDocument {
  teamId: string;
  teamName: string;
  fromUid: string;
  uid: string;
  emailHash: string;
  wrappedKey: WrappedKeyEnvelope;
  keyEpoch?: number;
  keyId?: string | null;
  publicKeyFingerprint?: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: number;
  expiresAt: number;
}

export interface TeamAuthLookup {
  getUserByEmail(email: string): Promise<{ uid: string; disabled?: boolean; email?: string; emailVerified?: boolean }>;
}

export interface PublicProfileView {
  uid: string;
  displayName: string;
  publicKeyPem: string;
  emailHash: string;
}

const getDb = (): FirebaseFirestore.Firestore => {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
};

const defaultAuthLookup: TeamAuthLookup = {
  async getUserByEmail(email: string) {
    const user = await admin.auth().getUserByEmail(email);
    return { uid: user.uid, disabled: user.disabled, email: user.email, emailVerified: user.emailVerified };
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function httpsError(code: functions.https.FunctionsErrorCode, message: string): functions.https.HttpsError {
  return new functions.https.HttpsError(code, message);
}

function requireUid(context: functions.https.CallableContext): string {
  if (!context.auth?.uid) {
    throw httpsError('unauthenticated', 'Authentication required');
  }
  return context.auth.uid;
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

export function parseTeamName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw httpsError('invalid-argument', 'name is required');
  }
  const name = raw.trim().slice(0, TEAM_NAME_MAX);
  if (name.length < 1) {
    throw httpsError('invalid-argument', 'name is required (1–80 characters)');
  }
  return name;
}

export function parseWrappedKeyEnvelope(value: unknown): WrappedKeyEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpsError('invalid-argument', 'wrappedKey envelope is required');
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.some((key) => FORBIDDEN_WRAP_KEYS.includes(key))) {
    throw httpsError('invalid-argument', 'wrappedKey must not contain plaintext key material');
  }
  const unexpected = keys.filter((key) => !['v', 'alg', 'ct'].includes(key));
  if (unexpected.length > 0) {
    throw httpsError('invalid-argument', 'wrappedKey has unexpected fields');
  }
  if (rec.v !== WRAPPED_KEY_VERSION) {
    throw httpsError('invalid-argument', 'wrappedKey.v must be 1');
  }
  if (rec.alg !== WRAPPED_KEY_ALG) {
    throw httpsError('invalid-argument', 'wrappedKey.alg must be RSA-OAEP');
  }
  if (typeof rec.ct !== 'string' || rec.ct.trim().length < 16) {
    throw httpsError('invalid-argument', 'wrappedKey.ct is missing or too short');
  }
  return {
    v: WRAPPED_KEY_VERSION,
    alg: WRAPPED_KEY_ALG,
    ct: rec.ct.trim(),
  };
}

/** True if the stored envelope JSON contains the given plaintext teamKey. */
export function wrappedKeyLeaksPlaintext(envelope: WrappedKeyEnvelope, plaintext: string): boolean {
  if (!plaintext) return false;
  const blob = JSON.stringify(envelope);
  return blob.includes(plaintext);
}

export function assertWrappedKeyDoesNotLeak(envelope: WrappedKeyEnvelope, plaintext: string): void {
  if (wrappedKeyLeaksPlaintext(envelope, plaintext)) {
    throw httpsError('invalid-argument', 'wrappedKey must not leak the teamKey in plaintext');
  }
}

export function assertCanAddMember(memberUids: unknown, extra = 1): void {
  const members = Array.isArray(memberUids)
    ? memberUids.filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)
    : [];
  if (members.length + extra > MAX_TEAM_MEMBERS) {
    throw httpsError(
      'resource-exhausted',
      `Sovereign: máximo de ${MAX_TEAM_MEMBERS} membros por equipa.`,
    );
  }
}

function isTeamRole(value: unknown): value is TeamRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

function isTeamAuditAction(value: unknown): value is TeamAuditAction {
  return typeof value === 'string' && (TEAM_AUDIT_ACTIONS as readonly string[]).includes(value);
}

/** Backfill: owner is always owner; missing map entries become member. */
export function backfillTeamRoles(
  ownerUid: string,
  memberUids: string[],
  rawRoles: unknown,
): Record<string, TeamRole> {
  const rec = asRecord(rawRoles);
  const roles: Record<string, TeamRole> = {};
  for (const uid of memberUids) {
    const mapped = rec[uid];
    roles[uid] = isTeamRole(mapped) ? mapped : 'member';
  }
  roles[ownerUid] = 'owner';
  return roles;
}

export function resolveTeamRole(
  team: Pick<TeamDocument, 'ownerUid' | 'memberUids' | 'roles'>,
  uid: string,
): TeamRole | null {
  if (uid === team.ownerUid) return 'owner';
  if (!team.memberUids.includes(uid)) return null;
  const mapped = team.roles?.[uid];
  if (mapped === 'admin' || mapped === 'member') return mapped;
  return 'member';
}

export function canInviteMembers(
  team: Pick<TeamDocument, 'ownerUid' | 'memberUids' | 'roles'>,
  uid: string,
): boolean {
  const role = resolveTeamRole(team, uid);
  return role === 'owner' || role === 'admin';
}

export function buildTeamAuditEvent(input: {
  teamId: string;
  at: number;
  actorUid: string;
  action: TeamAuditAction;
  targetUid: string;
}): TeamAuditEvent {
  if (!input.teamId || !input.actorUid || !input.targetUid) {
    throw httpsError('invalid-argument', 'teamAudit requires teamId, actorUid and targetUid');
  }
  if (!isTeamAuditAction(input.action)) {
    throw httpsError('invalid-argument', 'teamAudit action is invalid');
  }
  return {
    teamId: input.teamId,
    at: input.at,
    actorUid: input.actorUid,
    action: input.action,
    targetUid: input.targetUid,
  };
}

export function parseCreateTeamInput(data: unknown): {
  name: string;
  wrappedKey: WrappedKeyEnvelope;
} {
  const payload = asRecord(data);
  return {
    name: parseTeamName(payload.name),
    wrappedKey: parseWrappedKeyEnvelope(payload.wrappedKey ?? payload.wrappedKeyForOwner),
  };
}

export function parseInviteMemberInput(data: unknown): {
  teamId: string;
  email: string;
  wrappedKey: WrappedKeyEnvelope;
  expectedUid: string;
  inviteeUid: string;
  expectedKeyEpoch: number;
  expectedKeyId: string | null;
  publicKeyFingerprint: string;
} {
  const payload = asRecord(data);
  const teamId = typeof payload.teamId === 'string' ? payload.teamId.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (Object.keys(payload).some(key => !['teamId', 'email', 'wrappedKey', 'expectedUid', 'inviteeUid',
    'expectedKeyEpoch', 'expectedKeyId', 'publicKeyFingerprint'].includes(key)) ||
      !attachmentActorIdValid(teamId) || !attachmentActorIdValid(payload.expectedUid) ||
      !attachmentActorIdValid(payload.inviteeUid) || !Number.isSafeInteger(payload.expectedKeyEpoch) ||
      (payload.expectedKeyEpoch as number) < 1 ||
      (payload.expectedKeyId !== null && !attachmentActorIdValid(payload.expectedKeyId)) ||
      typeof payload.publicKeyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.publicKeyFingerprint)) {
    throw httpsError('invalid-argument', 'Contexto do convite inválido.');
  }
  if (!email || email.length > 320 || !email.includes('@')) throw httpsError('invalid-argument', 'email is required');
  const wrappedKey = parseWrappedKeyEnvelope(payload.wrappedKey);
  const bytes = Buffer.from(wrappedKey.ct, 'base64');
  if (bytes.length < 256 || bytes.length > 512 || bytes.toString('base64') !== wrappedKey.ct) {
    throw httpsError('invalid-argument', 'Envelope RSA-OAEP inválido.');
  }
  return {
    teamId,
    email,
    wrappedKey,
    expectedUid: payload.expectedUid as string,
    inviteeUid: payload.inviteeUid as string,
    expectedKeyEpoch: payload.expectedKeyEpoch as number,
    expectedKeyId: payload.expectedKeyId as string | null,
    publicKeyFingerprint: payload.publicKeyFingerprint,
  };
}

export function buildTeamDocument(
  ownerUid: string,
  name: string,
  wrappedKeyForOwner: WrappedKeyEnvelope,
  now = Date.now(),
): TeamDocument {
  return {
    name,
    ownerUid,
    createdAt: now,
    memberUids: [ownerUid],
    wrappedKeys: { [ownerUid]: wrappedKeyForOwner },
    roles: { [ownerUid]: 'owner' },
  };
}

export function buildInviteDocument(input: {
  teamId: string;
  teamName: string;
  fromUid: string;
  uid: string;
  emailHash: string;
  wrappedKey: WrappedKeyEnvelope;
  keyEpoch?: number;
  keyId?: string | null;
  publicKeyFingerprint?: string;
  now?: number;
  ttlMs?: number;
}): TeamInviteDocument {
  const now = input.now ?? Date.now();
  return {
    teamId: input.teamId,
    teamName: input.teamName,
    fromUid: input.fromUid,
    uid: input.uid,
    emailHash: input.emailHash,
    wrappedKey: input.wrappedKey,
    keyEpoch: input.keyEpoch ?? 1,
    keyId: input.keyId ?? null,
    ...(input.publicKeyFingerprint ? { publicKeyFingerprint: input.publicKeyFingerprint } : {}),
    status: 'pending',
    createdAt: now,
    expiresAt: now + (input.ttlMs ?? INVITE_TTL_MS),
  };
}

function readTeamDoc(data: FirebaseFirestore.DocumentData | undefined): TeamDocument | null {
  if (!data) return null;
  if (typeof data.name !== 'string' || typeof data.ownerUid !== 'string') return null;
  const memberUids = Array.isArray(data.memberUids)
    ? data.memberUids.filter((uid): uid is string => typeof uid === 'string')
    : [];
  const wrappedKeys: Record<string, WrappedKeyEnvelope> = {};
  if (data.wrappedKeys && typeof data.wrappedKeys === 'object') {
    for (const [uid, envelope] of Object.entries(data.wrappedKeys as Record<string, unknown>)) {
      try {
        wrappedKeys[uid] = parseWrappedKeyEnvelope(envelope);
      } catch {
        // skip malformed wraps — never treat as plaintext
      }
    }
  }
  return {
    name: data.name,
    ownerUid: data.ownerUid,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    memberUids,
    wrappedKeys,
    roles: backfillTeamRoles(data.ownerUid, memberUids, data.roles),
    activeKeyEpoch: Number.isSafeInteger(data.activeKeyEpoch) && data.activeKeyEpoch >= 1
      ? data.activeKeyEpoch : undefined,
    activeKeyId: typeof data.activeKeyId === 'string' ? data.activeKeyId : undefined,
    keyRotationStatus: data.keyRotationStatus === 'active' || data.keyRotationStatus === 'rotation_pending' ||
      data.keyRotationStatus === 'rotation_blocked' ? data.keyRotationStatus : undefined,
    pendingRotationId: typeof data.pendingRotationId === 'string' ? data.pendingRotationId : null,
  };
}

async function loadProfileByUid(
  db: FirebaseFirestore.Firestore,
  uid: string,
  emailHash: string,
): Promise<PublicProfileView> {
  if (!attachmentActorIdValid(uid)) throw httpsError('failed-precondition', 'Conta indisponível.');
  const snap = await db.collection('publicProfiles').doc(uid).get();
  const data = snap.data() || {};
  const publicKeyPem = typeof data.publicKeyPem === 'string' ? data.publicKeyPem.trim() : '';
  if (!publicKeyPem) {
    throw httpsError(
      'failed-precondition',
      'Este utilizador ainda não publicou a chave RSA de Comms. Não é possível convidar até ter perfil público.',
    );
  }
  const displayName = typeof data.displayName === 'string' && data.displayName.trim()
    ? data.displayName.trim()
    : uid.slice(0, 8);
  return {
    uid,
    displayName,
    publicKeyPem,
    emailHash: typeof data.emailHash === 'string' ? data.emailHash : emailHash,
  };
}

export async function resolveInviteeProfile(
  email: string,
  db: FirebaseFirestore.Firestore = getDb(),
  authLookup: TeamAuthLookup = defaultAuthLookup,
): Promise<PublicProfileView> {
  const normalized = email.trim().toLowerCase();
  const emailHash = hashEmail(normalized);

  let authUser: Awaited<ReturnType<TeamAuthLookup['getUserByEmail']>>;
  try { authUser = await authLookup.getUserByEmail(normalized); }
  catch { throw httpsError('failed-precondition', 'Não foi possível confirmar a identidade do destinatário.'); }
  if (!verifiedAuthEmail(authUser, normalized)) {
    throw httpsError('failed-precondition', 'Conta indisponível.');
  }
  const profile = await loadProfileByUid(db, authUser.uid, emailHash);
  let current: Awaited<ReturnType<TeamAuthLookup['getUserByEmail']>>;
  try {current = await authLookup.getUserByEmail(normalized);} catch {throw httpsError('failed-precondition', 'Não foi possível confirmar a identidade do destinatário.');}
  if (!verifiedAuthEmail(current, normalized) || current.uid !== authUser.uid) throw httpsError('failed-precondition', 'A identidade do destinatário mudou.');
  return profile;
}

export async function executeCreateTeam(
  uid: string,
  data: unknown,
  db: FirebaseFirestore.Firestore = getDb(),
  now = Date.now(),
): Promise<{ teamId: string; name: string; memberUids: string[]; maxMembers: number; activeKeyEpoch: number; activeKeyId: string; alreadyCreated: boolean }> {
  const payload = asRecord(data);
  if (Object.keys(payload).some(key => !['name', 'wrappedKey', 'expectedUid', 'publicKeyFingerprint', 'requestId'].includes(key))) {
    throw httpsError('invalid-argument', 'O pedido contém campos não permitidos.');
  }
  if (payload.expectedUid !== uid) throw httpsError('permission-denied', 'A conta mudou durante a criação.');
  const requestId = payload.requestId;
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    throw httpsError('invalid-argument', 'Identificador de criação inválido.');
  }
  const input = parseCreateTeamInput(data);
  const fingerprint = payload.publicKeyFingerprint;
  const bytes = Buffer.from(input.wrappedKey.ct, 'base64');
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint) ||
      bytes.length < 256 || bytes.length > 512 || bytes.toString('base64') !== input.wrappedKey.ct) {
    throw httpsError('invalid-argument', 'Envelope e fingerprint RSA necessários.');
  }
  const activeKeyId = randomUUID();
  const team = { ...buildTeamDocument(uid, input.name, input.wrappedKey, now),
    activeKeyEpoch: 1, activeKeyId, keyRotationStatus: 'active', pendingRotationId: null,
    nextRotationDueAt: now + ROTATION_INTERVAL_MS, updatedAt: now };
  const ref = db.collection(TEAMS_COLLECTION).doc();
  const auditRef = db.collection(TEAM_AUDIT_COLLECTION).doc();
  const requestRef = db.collection('teamCreationRequests').doc(createHash('sha256').update(JSON.stringify([uid, requestId])).digest('hex'));
  const digest = createHash('sha256').update(JSON.stringify([input.name, input.wrappedKey, fingerprint])).digest('hex');
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw httpsError('failed-precondition', 'Conta indisponível.');
    const [account, profile, request] = await Promise.all([
      tx.get(db.collection('users').doc(uid)), tx.get(db.collection('publicProfiles').doc(uid)), tx.get(requestRef),
    ]);
    if (!account.exists || account.data()?.deletionState === 'deleting') {
      throw httpsError('failed-precondition', 'Conta indisponível.');
    }
    if (request.exists) {
      const saved = request.data();
      if (saved?.status === 'cancelled') throw httpsError('failed-precondition', 'Pedido de criação cancelado.');
      if (saved?.uid !== uid || saved?.digest !== digest || typeof saved?.teamId !== 'string' || !saved.teamId || saved.teamId.includes('/')) {
        throw httpsError('already-exists', 'Este pedido de criação já foi usado.');
      }
      const savedRef = db.collection(TEAMS_COLLECTION).doc(saved.teamId);
      const existing = readTeamDoc((await tx.get(savedRef)).data());
      if (!existing || existing.ownerUid !== uid || !existing.memberUids.includes(uid) ||
          !Number.isSafeInteger(existing.activeKeyEpoch) || !existing.activeKeyId) {
        throw httpsError('failed-precondition', 'A equipa criada deixou de estar disponível.');
      }
      const epoch = (await tx.get(savedRef.collection('keyEpochs').doc(String(existing.activeKeyEpoch)))).data();
      if (!epoch || epoch.status !== 'active' || epoch.keyId !== existing.activeKeyId || !epoch.wrappedKeys?.[uid]) {
        throw httpsError('failed-precondition', 'Época ativa inconsistente.');
      }
      return { teamId: saved.teamId, name: existing.name, memberUids: existing.memberUids,
        maxMembers: MAX_TEAM_MEMBERS, activeKeyEpoch: existing.activeKeyEpoch!, activeKeyId: existing.activeKeyId, alreadyCreated: true };
    }
    const pem = profile.data()?.publicKeyPem;
    if (!account.exists || account.data()?.deletionState === 'deleting' || !profile.exists ||
        typeof pem !== 'string' || !pem.trim() ||
        createHash('sha256').update(pem.trim().replace(/\r\n/g, '\n')).digest('hex') !== fingerprint) {
      throw httpsError('failed-precondition', 'A conta ou a identidade pública mudou durante a criação.');
    }
    if ((await tx.get(db.collection('teamDeletions').doc(ref.id))).exists) {
      throw httpsError('already-exists', 'Identificador de equipa já eliminado.');
    }
    tx.create(ref, team);
    tx.create(ref.collection('keyEpochs').doc('1'), {
      epoch: 1, keyId: activeKeyId, status: 'active', memberUids: [uid],
      wrappedKeys: team.wrappedKeys, publicKeyFingerprints: { [uid]: fingerprint },
      createdAt: now, activatedAt: now, retiredAt: null, reason: 'team_created', rotationId: `initial-${activeKeyId}`,
    });
    tx.create(auditRef, buildTeamAuditEvent({ teamId: ref.id, at: now, actorUid: uid, action: 'created', targetUid: uid }));
    tx.create(requestRef, { uid, teamId: ref.id, digest, createdAt: now });
    return { teamId: ref.id, name: team.name, memberUids: team.memberUids, maxMembers: MAX_TEAM_MEMBERS,
      activeKeyEpoch: 1, activeKeyId, alreadyCreated: false };
  });
}

/** Invalidate the request before clearing a client checkpoint; never delete an already-created team. */
export async function executeCancelTeamCreation(uid: string, data: unknown, db: FirebaseFirestore.Firestore = getDb(), now = Date.now()) {
  const payload = asRecord(data);
  if (payload.expectedUid !== uid || payload.confirmed !== true) throw httpsError('permission-denied', 'Confirmação da conta necessária.');
  if (Object.keys(payload).some(key => !['expectedUid', 'confirmed', 'requestId'].includes(key)) ||
      typeof payload.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.requestId)) {
    throw httpsError('invalid-argument', 'Pedido de cancelamento inválido.');
  }
  const ref = db.collection('teamCreationRequests').doc(createHash('sha256').update(JSON.stringify([uid, payload.requestId])).digest('hex'));
  await db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw httpsError('failed-precondition', 'Conta indisponível.');
    const [account, request] = await Promise.all([tx.get(db.collection('users').doc(uid)), tx.get(ref)]);
    if (!account.exists || account.data()?.deletionState === 'deleting') throw httpsError('failed-precondition', 'Conta indisponível.');
    if (request.exists) {
      if (request.data()?.uid !== uid) throw httpsError('permission-denied', 'Pedido indisponível.');
      if (request.data()?.status === 'cancelled') return;
      tx.update(ref, { status: 'cancelled', cancelledAt: now });
    } else tx.create(ref, { uid, status: 'cancelled', createdAt: now, cancelledAt: now });
  });
  return { ok: true as const };
}

export async function executeLookupTeamInvitee(
  emailRaw: unknown,
  db: FirebaseFirestore.Firestore = getDb(),
  authLookup: TeamAuthLookup = defaultAuthLookup,
): Promise<PublicProfileView> {
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    throw httpsError('invalid-argument', 'email is required');
  }
  const profile = await resolveInviteeProfile(email, db, authLookup);
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, profile.uid, false)) throw httpsError('failed-precondition', 'Conta indisponível.');
    const current = await tx.get(db.collection('publicProfiles').doc(profile.uid));
    if (!current.exists || current.data()?.publicKeyPem?.trim() !== profile.publicKeyPem) {
      throw httpsError('failed-precondition', 'A identidade pública mudou.');
    }
    return profile;
  });
}

export async function executeInviteMember(
  uid: string,
  data: unknown,
  db: FirebaseFirestore.Firestore = getDb(),
  authLookup: TeamAuthLookup = defaultAuthLookup,
  now = Date.now(),
): Promise<{ inviteId: string; inviteeUid: string; displayName: string; expiresAt: number }> {
  const input = parseInviteMemberInput(data);
  if (input.expectedUid !== uid) throw httpsError('permission-denied', 'A conta mudou durante o convite.');
  if (!await db.runTransaction(tx => liveAccountInTransaction(tx, db, uid))) {
    throw httpsError('failed-precondition', 'Conta indisponível.');
  }
  const profile = await resolveInviteeProfile(input.email, db, authLookup);
  if (profile.uid !== input.inviteeUid) throw httpsError('failed-precondition', 'O destinatário mudou durante o convite.');
  if (profile.uid === uid) {
    throw httpsError('invalid-argument', 'Não podes convidar-te a ti próprio.');
  }

  const teamRef = db.collection(TEAMS_COLLECTION).doc(input.teamId);
  const inviteRef = db.collection(TEAM_INVITES_COLLECTION).doc();
  const auditRef = db.collection(TEAM_AUDIT_COLLECTION).doc();
  const pendingQuery = db.collection(TEAM_INVITES_COLLECTION)
    .where('teamId', '==', input.teamId).where('uid', '==', profile.uid).limit(100);
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid) || !await liveAccountInTransaction(tx, db, profile.uid)) {
      throw httpsError('failed-precondition', 'Conta indisponível.');
    }
    const teamSnap = await tx.get(teamRef);
    const team = readTeamDoc(teamSnap.data());
    if (!teamSnap.exists || !team) {
      throw httpsError('not-found', 'Equipa não encontrada.');
    }
    if (!canInviteMembers(team, uid)) {
      throw httpsError('permission-denied', 'Só o owner ou um admin pode convidar membros.');
    }
    if (!team.memberUids.includes(uid) || teamSnap.data()?.deletionState === 'deleting' ||
        !await liveAccountInTransaction(tx, db, team.ownerUid, false)) {
      throw httpsError('failed-precondition', 'Equipa indisponível.');
    }
    if (team.keyRotationStatus && team.keyRotationStatus !== 'active') {
      throw httpsError('failed-precondition', 'A equipa está a rodar a chave.');
    }
    if (team.activeKeyEpoch !== undefined && !team.activeKeyId) {
      throw httpsError('failed-precondition', 'Época ativa sem identificador de chave.');
    }
    if ((team.activeKeyEpoch ?? 1) !== input.expectedKeyEpoch || (team.activeKeyId ?? null) !== input.expectedKeyId) {
      throw httpsError('failed-precondition', 'A época da chave mudou durante o convite.');
    }
    if (team.activeKeyEpoch !== undefined) {
      const epoch = await tx.get(teamRef.collection('keyEpochs').doc(String(team.activeKeyEpoch)));
      if (!epoch.exists || epoch.data()?.status !== 'active' || epoch.data()?.keyId !== input.expectedKeyId ||
          JSON.stringify(epoch.data()?.memberUids) !== JSON.stringify(team.memberUids)) {
        throw httpsError('failed-precondition', 'Época ativa inconsistente.');
      }
      exactWrappedKeys(epoch.data()?.wrappedKeys, team.memberUids);
    }
    const currentProfile = await tx.get(db.collection('publicProfiles').doc(profile.uid));
    const pem = currentProfile.data()?.publicKeyPem;
    if (!currentProfile.exists || typeof pem !== 'string' || !pem.trim() ||
        createHash('sha256').update(pem.trim().replace(/\r\n/g, '\n')).digest('hex') !== input.publicKeyFingerprint) {
      throw httpsError('failed-precondition', 'A chave pública do destinatário mudou durante o convite.');
    }
    if (team.memberUids.includes(profile.uid)) {
      throw httpsError('already-exists', 'Este utilizador já é membro da equipa.');
    }
    assertCanAddMember(team.memberUids);

    const pending = await tx.get(pendingQuery);
    if (pending.size === 100) {
      throw httpsError('resource-exhausted', 'Demasiados convites anteriores para esta conta.');
    }
    const hasPending = pending.docs.some((docSnap) => docSnap.data()?.status === 'pending'
      && typeof docSnap.data()?.expiresAt === 'number'
      && docSnap.data().expiresAt > now
      && (docSnap.data()?.keyEpoch ?? 1) === (team.activeKeyEpoch ?? 1)
      && (docSnap.data()?.keyId ?? null) === (team.activeKeyId ?? null)
      && docSnap.data()?.publicKeyFingerprint === input.publicKeyFingerprint);
    if (hasPending) {
      throw httpsError('already-exists', 'Já existe um convite pendente para este email.');
    }

    const invite = buildInviteDocument({
      teamId: input.teamId,
      teamName: team.name,
      fromUid: uid,
      uid: profile.uid,
      emailHash: profile.emailHash,
      wrappedKey: input.wrappedKey,
      keyEpoch: team.activeKeyEpoch ?? 1,
      keyId: team.activeKeyId ?? null,
      publicKeyFingerprint: input.publicKeyFingerprint,
      now,
    });
    const revision = teamSnap.data()?.inviteRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
      throw httpsError('failed-precondition', 'Revisão dos convites inválida.');
    }
    // Serialize invitations even when the pending query is initially empty.
    tx.update(teamRef, { inviteRevision: revision + 1 });
    tx.create(inviteRef, invite);
    tx.create(db.collection(TEAM_INVITE_INBOX_COLLECTION).doc(inviteRef.id), {
      v: 1, uid: profile.uid, inviteId: inviteRef.id, teamId: input.teamId,
    });
    tx.create(auditRef, buildTeamAuditEvent({
      teamId: input.teamId,
      at: now,
      actorUid: uid,
      action: 'invited',
      targetUid: profile.uid,
    }));
    return {
      inviteId: inviteRef.id,
      inviteeUid: profile.uid,
      displayName: typeof currentProfile.data()?.displayName === 'string' ? currentProfile.data()!.displayName : profile.uid.slice(0, 8),
      expiresAt: invite.expiresAt,
    };
  });
}

export async function executeAcceptInvite(
  uid: string,
  data: unknown,
  db: FirebaseFirestore.Firestore = getDb(),
  now = Date.now(),
): Promise<{ teamId: string; name: string }> {
  const payload = asRecord(data);
  const inviteId = typeof payload.inviteId === 'string' ? payload.inviteId.trim() : '';
  if (!attachmentActorIdValid(inviteId) || Object.keys(payload).some(key => key !== 'inviteId')) {
    throw httpsError('invalid-argument', 'inviteId is required');
  }

  const inviteRef = db.collection(TEAM_INVITES_COLLECTION).doc(inviteId);
  const auditRef = db.collection(TEAM_AUDIT_COLLECTION).doc();
  const outcome = await db.runTransaction(async (tx): Promise<
    { kind: 'accepted'; teamId: string; name: string } | { kind: 'expired' } | { kind: 'stale' }
  > => {
    if (!await liveAccountInTransaction(tx, db, uid, false)) throw httpsError('failed-precondition', 'Conta indisponível.');
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) {
      throw httpsError('not-found', 'Convite não encontrado.');
    }
    const invite = inviteSnap.data() as TeamInviteDocument;
    if (invite.uid !== uid) {
      throw httpsError('permission-denied', 'Este convite não é teu.');
    }
    if (!attachmentActorIdValid(invite.teamId) || !await liveAccountInTransaction(tx, db, invite.fromUid, false)) {
      throw httpsError('failed-precondition', 'Convite indisponível.');
    }
    if (invite.status !== 'pending') {
      throw httpsError('failed-precondition', 'Este convite já não está pendente.');
    }
    if (!Number.isSafeInteger(invite.expiresAt) || invite.expiresAt <= now) {
      tx.update(inviteRef, { status: 'expired' });
      tx.delete(db.collection(TEAM_INVITE_INBOX_COLLECTION).doc(inviteId));
      return { kind: 'expired' };
    }

    const wrappedKey = parseWrappedKeyEnvelope(invite.wrappedKey);
    const teamRef = db.collection(TEAMS_COLLECTION).doc(invite.teamId);
    const teamSnap = await tx.get(teamRef);
    const team = readTeamDoc(teamSnap.data());
    if (!teamSnap.exists || !team) {
      throw httpsError('not-found', 'Equipa não encontrada.');
    }
    if (teamSnap.data()?.deletionState === 'deleting' || !await liveAccountInTransaction(tx, db, team.ownerUid, false) ||
        !team.memberUids.includes(invite.fromUid) || !canInviteMembers(team, invite.fromUid)) {
      throw httpsError('failed-precondition', 'O convite deixou de estar autorizado.');
    }
    if (team.keyRotationStatus && team.keyRotationStatus !== 'active') {
      throw httpsError('failed-precondition', 'A equipa está a rodar a chave.');
    }
    const invitedEpoch = Number.isSafeInteger(invite.keyEpoch) && (invite.keyEpoch as number) >= 1
      ? invite.keyEpoch as number : 1;
    const activeEpoch = team.activeKeyEpoch ?? 1;
    if ((invite.publicKeyFingerprint !== undefined && (!Number.isSafeInteger(invite.keyEpoch) ||
          invite.keyId !== (team.activeKeyId ?? null))) || invitedEpoch !== activeEpoch ||
        (team.activeKeyId && invite.keyId && invite.keyId !== team.activeKeyId) ||
        (activeEpoch > 1 && invite.keyId !== team.activeKeyId)) {
      tx.update(inviteRef, { status: 'revoked', revokedAt: now, revokedReason: 'epoch_changed' });
      tx.delete(db.collection(TEAM_INVITE_INBOX_COLLECTION).doc(inviteId));
      return { kind: 'stale' };
    }
    const epochRef = team.activeKeyEpoch !== undefined
      ? teamRef.collection('keyEpochs').doc(String(activeEpoch)) : null;
    const epochSnap = epochRef ? await tx.get(epochRef) : null;
    if (epochRef && (!epochSnap?.exists || epochSnap.data()?.status !== 'active' ||
        epochSnap.data()?.keyId !== team.activeKeyId ||
        JSON.stringify(epochSnap.data()?.memberUids) !== JSON.stringify(team.memberUids))) {
      throw httpsError('failed-precondition', 'Época ativa inconsistente.');
    }
    const epochWraps = epochRef
      ? exactWrappedKeys(epochSnap!.data()?.wrappedKeys, team.memberUids) : null;
    if (invite.publicKeyFingerprint !== undefined) {
      const profile = await tx.get(db.collection('publicProfiles').doc(uid));
      const pem = profile.data()?.publicKeyPem;
      if (typeof invite.publicKeyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(invite.publicKeyFingerprint) ||
          !profile.exists || typeof pem !== 'string' || !pem.trim() ||
          createHash('sha256').update(pem.trim().replace(/\r\n/g, '\n')).digest('hex') !== invite.publicKeyFingerprint) {
        throw httpsError('failed-precondition', 'A identidade do convite mudou. Pede um novo convite.');
      }
    }
    if (team.memberUids.includes(uid)) {
      if (JSON.stringify((epochWraps ?? team.wrappedKeys)[uid]) !== JSON.stringify(wrappedKey)) {
        throw httpsError('failed-precondition', 'Envelope do convite desatualizado.');
      }
      tx.update(inviteRef, { status: 'accepted', acceptedAt: now });
      tx.delete(db.collection(TEAM_INVITE_INBOX_COLLECTION).doc(inviteId));
      return { kind: 'accepted', teamId: invite.teamId, name: team.name };
    }
    assertCanAddMember(team.memberUids);
    const wrappedKeys = { ...(epochWraps ?? team.wrappedKeys), [uid]: wrappedKey };
    const roles = { ...team.roles, [uid]: 'member' as const };
    tx.update(teamRef, {
      memberUids: [...team.memberUids, uid],
      wrappedKeys,
      roles,
    });
    if (epochRef && epochWraps) {
      tx.update(epochRef, {
        memberUids: [...team.memberUids, uid],
        wrappedKeys: { ...epochWraps, [uid]: wrappedKey },
        ...(invite.publicKeyFingerprint ? { publicKeyFingerprints: {
          ...asRecord(epochSnap!.data()?.publicKeyFingerprints), [uid]: invite.publicKeyFingerprint,
        } } : {}),
      });
    }
    tx.update(inviteRef, { status: 'accepted', acceptedAt: now });
    tx.delete(db.collection(TEAM_INVITE_INBOX_COLLECTION).doc(inviteId));
    tx.create(auditRef, {
      teamId: invite.teamId, at: now, actorUid: uid, action: 'accepted', targetUid: uid,
    });
    return { kind: 'accepted', teamId: invite.teamId, name: team.name };
  });
  if (outcome.kind === 'expired') throw httpsError('failed-precondition', 'Este convite expirou.');
  if (outcome.kind === 'stale') throw httpsError('failed-precondition', 'O convite pertence a uma época antiga da chave.');
  return { teamId: outcome.teamId, name: outcome.name };
}

export type TeamRotationReason = 'member_left' | 'member_removed' | 'scheduled' | 'manual' | 'key_compromise';
export const TEAM_ROTATIONS_COLLECTION = 'teamKeyRotations';
const ROTATION_SLA_MS = 24 * 60 * 60 * 1000;
const ROTATION_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

function exactWrappedKeys(raw: unknown, memberUids: string[]): Record<string, WrappedKeyEnvelope> {
  const record = asRecord(raw);
  if (!Array.isArray(memberUids) || memberUids.some((uid) => typeof uid !== 'string' || !uid) ||
      memberUids.length < 1 || memberUids.length > MAX_TEAM_MEMBERS ||
      new Set(memberUids).size !== memberUids.length ||
      Object.keys(record).length !== memberUids.length ||
      Object.keys(record).some((uid) => !memberUids.includes(uid))) {
    throw httpsError('failed-precondition', 'Os envelopes têm de coincidir com os membros ativos.');
  }
  const wraps: Record<string, WrappedKeyEnvelope> = {};
  for (const memberUid of memberUids) wraps[memberUid] = parseWrappedKeyEnvelope(record[memberUid]);
  return wraps;
}

/** Remove a member and freeze writes in one Firestore transaction. No AES key reaches this code. */
export async function executeRequestTeamKeyRotation(
  actorUid: string,
  input: { teamId: string; reason: TeamRotationReason; targetUid?: string | null; idempotencyKey?: unknown },
  db: FirebaseFirestore.Firestore = getDb(),
  now = Date.now(),
  authority: 'member' | 'account-cleanup' | 'scheduler' = 'member',
): Promise<{ rotationId: string; oldEpoch: number; newEpoch: number }> {
  const { teamId, reason } = input;
  const targetUid = input.targetUid || null;
  if (!attachmentActorIdValid(teamId) || !attachmentActorIdValid(actorUid) ||
      (targetUid !== null && !attachmentActorIdValid(targetUid)) ||
      !['member_left', 'member_removed', 'scheduled', 'manual', 'key_compromise'].includes(reason)) {
    throw httpsError('invalid-argument', 'Pedido de rotação inválido.');
  }
  if ((reason === 'member_left' || reason === 'member_removed') !== Boolean(targetUid)) {
    throw httpsError('invalid-argument', 'Membro alvo inválido.');
  }
  const idempotencyKey = input.idempotencyKey;
  if (!['member', 'account-cleanup', 'scheduler'].includes(authority) ||
      (authority === 'account-cleanup' && (reason !== 'member_left' || targetUid !== actorUid || idempotencyKey !== undefined)) ||
      (authority === 'scheduler' && (actorUid !== 'system' || reason !== 'scheduled')) ||
      (authority === 'member' && reason === 'scheduled')) {
    throw httpsError('permission-denied', 'Origem do pedido de rotação inválida.');
  }
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey))) {
    throw httpsError('invalid-argument', 'Chave de idempotência inválida.');
  }
  const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId);
  const requestRef = idempotencyKey
    ? db.collection('teamRotationRequests').doc(
      createHash('sha256').update(`${teamId}:${actorUid}:${idempotencyKey}`).digest('hex'))
    : null;
  const rotationRef = db.collection(TEAM_ROTATIONS_COLLECTION).doc();
  const auditRef = db.collection(TEAM_AUDIT_COLLECTION).doc();
  const legacyKeyId = randomUUID();
  return db.runTransaction(async (tx) => {
    if (authority === 'account-cleanup') {
      const deletion = await tx.get(db.doc(`accountDeletions/${actorUid}`));
      if (deletion.data()?.v !== 1 || deletion.data()?.status !== 'deleting' || deletion.data()?.phase !== 'documents') {
        throw httpsError('failed-precondition', 'Eliminação de conta ainda não admitida nesta fase.');
      }
    } else if (authority === 'member' && !await liveAccountInTransaction(tx, db, actorUid, false)) {
      throw httpsError('failed-precondition', 'Conta indisponível.');
    }
    const requestSnap = requestRef ? await tx.get(requestRef) : null;
    if (requestSnap?.exists) {
      const existing = requestSnap.data();
      if (idempotencyKey && existing?.teamId === teamId &&
          existing?.requestedByUid === actorUid && existing?.reason === reason &&
          existing?.targetUid === targetUid && existing?.idempotencyKey === idempotencyKey &&
          typeof existing?.rotationId === 'string' &&
          Number.isSafeInteger(existing?.oldEpoch) && Number.isSafeInteger(existing?.newEpoch)) {
        return { rotationId: existing.rotationId, oldEpoch: existing.oldEpoch, newEpoch: existing.newEpoch };
      }
      throw httpsError('already-exists', 'Esta chave de idempotência já foi usada.');
    }
    const teamSnap = await tx.get(teamRef);
    const team = readTeamDoc(teamSnap.data());
    if (!teamSnap.exists || !team) throw httpsError('not-found', 'Equipa não encontrada.');
    if (teamSnap.data()?.deletionState === 'deleting' || !await liveAccountInTransaction(tx, db, team.ownerUid, false)) {
      throw httpsError('failed-precondition', 'Equipa indisponível.');
    }
    const role = resolveTeamRole(team, actorUid);
    if (reason === 'scheduled') {
      if (actorUid !== 'system' || team.keyRotationStatus !== 'active' ||
          !Number.isFinite(teamSnap.data()?.nextRotationDueAt) ||
          teamSnap.data()!.nextRotationDueAt > now) {
        throw httpsError('failed-precondition', 'Rotação periódica ainda não é devida.');
      }
    } else if (reason === 'member_left') {
      if (actorUid !== targetUid || !role || role === 'owner') {
        throw httpsError('permission-denied', 'Saída de equipa não autorizada.');
      }
    } else if (!role || (role !== 'owner' && role !== 'admin')) {
      throw httpsError('permission-denied', 'Só owner/admin pode pedir esta rotação.');
    }
    if (targetUid && (!team.memberUids.includes(targetUid) || targetUid === team.ownerUid)) {
      throw httpsError('failed-precondition', 'Membro alvo inválido.');
    }
    if (authority === 'member' && targetUid && !await liveAccountInTransaction(tx, db, targetUid, false)) {
      throw httpsError('failed-precondition', 'Conta indisponível.');
    }
    const pending = team.keyRotationStatus === 'rotation_pending' || team.keyRotationStatus === 'rotation_blocked';
    if (pending && (!targetUid || !team.pendingRotationId)) {
      throw httpsError('failed-precondition', 'Já existe uma rotação pendente.');
    }
    if (!pending && team.keyRotationStatus && team.keyRotationStatus !== 'active') {
      throw httpsError('failed-precondition', 'Estado de rotação inválido.');
    }
    const oldEpoch = team.activeKeyEpoch ?? 1;
    if (!team.memberUids.includes(team.ownerUid) || !team.wrappedKeys[team.ownerUid]) {
      throw httpsError('failed-precondition', 'Equipa sem owner ou envelope válido.');
    }
    const oldEpochRef = teamRef.collection('keyEpochs').doc(String(oldEpoch));
    const oldEpochSnap = await tx.get(oldEpochRef);
    const existingRotationRef = pending ? db.collection(TEAM_ROTATIONS_COLLECTION).doc(team.pendingRotationId!) : null;
    const existingRotation = existingRotationRef ? await tx.get(existingRotationRef) : null;
    if (pending && (!oldEpochSnap.exists || !existingRotation?.exists ||
        existingRotation.data()?.teamId !== teamId || existingRotation.data()?.oldEpoch !== oldEpoch)) {
      throw httpsError('failed-precondition', 'Rotação pendente inconsistente.');
    }
    if (!pending && team.activeKeyEpoch !== undefined &&
        (!oldEpochSnap.exists || oldEpochSnap.data()?.keyId !== team.activeKeyId ||
         oldEpochSnap.data()?.status !== 'active' ||
         JSON.stringify(oldEpochSnap.data()?.memberUids) !== JSON.stringify(team.memberUids))) {
      throw httpsError('failed-precondition', 'Época ativa inconsistente.');
    }
    if (!pending && team.activeKeyEpoch === undefined && oldEpochSnap.exists) {
      throw httpsError('failed-precondition', 'Migração de época incompleta.');
    }
    const oldWraps = oldEpochSnap.exists
      ? exactWrappedKeys(oldEpochSnap.data()?.wrappedKeys, oldEpochSnap.data()?.memberUids)
      : exactWrappedKeys(team.wrappedKeys, team.memberUids);
    if (!oldWraps[team.ownerUid]) throw httpsError('failed-precondition', 'Época sem owner.');
    const activeKeyId = team.activeKeyId || oldEpochSnap.data()?.keyId || legacyKeyId;
    const pendingRotationId = existingRotationRef?.id ?? rotationRef.id;
    const memberUids = targetUid ? team.memberUids.filter((uid) => uid !== targetUid) : team.memberUids;
    const notificationRecipients: string[] = [];
    if (!pending) {
      for (const memberUid of memberUids) {
        if (canInviteMembers({ ...team, memberUids }, memberUid) && await liveAccountInTransaction(tx, db, memberUid, false)) {
          notificationRecipients.push(memberUid);
        }
      }
    }
    const wrappedKeys = { ...team.wrappedKeys };
    const roles = { ...team.roles };
    if (targetUid) { delete wrappedKeys[targetUid]; delete roles[targetUid]; }
    if (!oldEpochSnap.exists) {
      tx.create(oldEpochRef, {
        epoch: oldEpoch, keyId: activeKeyId, status: 'active', memberUids: team.memberUids,
        wrappedKeys: oldWraps, createdAt: now, activatedAt: now, retiredAt: null,
        reason: 'team_created', rotationId: `migration-${activeKeyId}`,
      });
    }
    tx.update(teamRef, {
      memberUids, roles, wrappedKeys,
      activeKeyEpoch: oldEpoch,
      activeKeyId,
      keyRotationStatus: 'rotation_pending', pendingRotationId, updatedAt: now,
    });
    if (!pending) {
      tx.create(rotationRef, {
        teamId, oldEpoch, newEpoch: oldEpoch + 1, status: 'pending', reason,
        targetUid, requestedByUid: actorUid, requestedAt: now,
        deadlineAt: now + ROTATION_SLA_MS, committedAt: null, committedByUid: null,
        idempotencyKey: idempotencyKey || rotationRef.id,
      });
      for (const memberUid of notificationRecipients) {
        const notificationId = createHash('sha256').update(`${pendingRotationId}:${memberUid}`).digest('hex');
        tx.create(db.collection('notifications').doc(`team-rotation-request-${notificationId}`), {
          uid: memberUid, type: 'team_rotation_pending',
          title: 'Rotação da chave de equipa necessária',
          message: 'Desbloqueia o cofre e conclui a rotação da chave nas definições da equipa.',
          teamId, rotationId: pendingRotationId, read: false, createdAt: now,
        });
      }
    }
    tx.create(auditRef, {
      teamId, at: now, actorUid, action: targetUid
        ? reason === 'member_left' ? 'left' : 'member_removed' : 'rotation_requested',
      targetUid: targetUid || actorUid, rotationId: pendingRotationId, oldEpoch, reason,
    });
    if (requestRef) {
      tx.create(requestRef, {
        teamId, requestedByUid: actorUid, reason, targetUid, idempotencyKey,
        rotationId: pendingRotationId, oldEpoch, newEpoch: oldEpoch + 1, requestedAt: now,
      });
    }
    return { rotationId: pendingRotationId, oldEpoch, newEpoch: oldEpoch + 1 };
  });
}

export async function executeLeaveTeam(
  uid: string,
  data: unknown,
  db: FirebaseFirestore.Firestore = getDb(),
): Promise<{ ok: true }> {
  const payload = asRecord(data);
  const teamId = typeof payload.teamId === 'string' ? payload.teamId.trim() : '';
  await executeRequestTeamKeyRotation(uid, {
    teamId, reason: 'member_left', targetUid: uid, idempotencyKey: payload.idempotencyKey,
  }, db);
  return { ok: true };
}

/** A retry succeeds only when the already committed epoch contains the identical wraps. */
export async function executeCommitTeamKeyRotation(
  actorUid: string,
  data: unknown,
  db: FirebaseFirestore.Firestore = getDb(),
  now = Date.now(),
): Promise<{ ok: true; teamId: string; newEpoch: number; alreadyCommitted: boolean }> {
  const payload = asRecord(data);
  if (Object.keys(payload).some((key) => !['rotationId', 'expectedOldEpoch', 'newKeyId', 'wrappedKeys', 'publicKeyFingerprints'].includes(key))) {
    throw httpsError('invalid-argument', 'O pedido contém campos não permitidos.');
  }
  const rotationId = typeof payload.rotationId === 'string' ? payload.rotationId.trim() : '';
  const expectedOldEpoch = payload.expectedOldEpoch;
  const newKeyId = typeof payload.newKeyId === 'string' ? payload.newKeyId.trim() : '';
  if (!rotationId || rotationId.includes('/') || !Number.isSafeInteger(expectedOldEpoch) ||
      (expectedOldEpoch as number) < 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(newKeyId)) {
    throw httpsError('invalid-argument', 'Identificadores de rotação inválidos.');
  }
  const rotationRef = db.collection(TEAM_ROTATIONS_COLLECTION).doc(rotationId);
  const lookup = await rotationRef.get();
  const teamId = lookup.data()?.teamId;
  if (!lookup.exists || typeof teamId !== 'string' || !teamId || teamId.includes('/')) {
    throw httpsError('not-found', 'Rotação não encontrada.');
  }
  const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId);
  const oldEpochRef = teamRef.collection('keyEpochs').doc(String(expectedOldEpoch));
  const newEpochRef = teamRef.collection('keyEpochs').doc(String((expectedOldEpoch as number) + 1));
  const auditRef = db.collection(TEAM_AUDIT_COLLECTION).doc();
  return db.runTransaction(async (tx) => {
    const [teamSnap, rotationSnap, oldEpochSnap, newEpochSnap] = await Promise.all([
      tx.get(teamRef), tx.get(rotationRef), tx.get(oldEpochRef), tx.get(newEpochRef),
    ]);
    const team = readTeamDoc(teamSnap.data());
    const rotation = rotationSnap.data();
    if (!teamSnap.exists || !team || !rotationSnap.exists || !rotation ||
        rotation.teamId !== teamId || rotation.oldEpoch !== expectedOldEpoch ||
        rotation.newEpoch !== (expectedOldEpoch as number) + 1 || !oldEpochSnap.exists) {
      throw httpsError('failed-precondition', 'Rotação ou época antiga inconsistente.');
    }
    if (!team.memberUids.includes(actorUid) || !canInviteMembers(team, actorUid)) {
      throw httpsError('permission-denied', 'Só owner/admin pode confirmar a rotação.');
    }
    if (teamSnap.data()?.deletionState === 'deleting' ||
        !(await Promise.all(team.memberUids.map(uid => liveAccountInTransaction(tx, db, uid, false)))).every(Boolean) ||
        !await liveAccountInTransaction(tx, db, team.ownerUid, false)) {
      throw httpsError('failed-precondition', 'Conta ou equipa indisponível.');
    }
    const wraps = exactWrappedKeys(payload.wrappedKeys, team.memberUids);
    const fingerprints = asRecord(payload.publicKeyFingerprints);
    if (Object.keys(fingerprints).length !== team.memberUids.length || team.memberUids.some(uid =>
      typeof fingerprints[uid] !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprints[uid] as string))) {
      throw httpsError('invalid-argument', 'Fingerprints atuais necessários para todos os membros.');
    }
    for (const envelope of Object.values(wraps)) {
      const bytes = Buffer.from(envelope.ct, 'base64');
      if (bytes.length < 256 || bytes.length > 512 ||
          bytes.toString('base64').replace(/=+$/, '') !== envelope.ct.replace(/=+$/, '')) {
        throw httpsError('invalid-argument', 'Envelope RSA-OAEP inválido.');
      }
    }
    if (rotation.status === 'committed') {
      const saved = newEpochSnap.data();
      if (newEpochSnap.exists && saved?.rotationId === rotationId && saved?.keyId === newKeyId &&
          JSON.stringify(saved.wrappedKeys) === JSON.stringify(wraps) &&
          team.memberUids.every(uid => saved?.publicKeyFingerprints?.[uid] === fingerprints[uid]) &&
          team.activeKeyEpoch === rotation.newEpoch && team.activeKeyId === newKeyId) {
        return { ok: true as const, teamId, newEpoch: rotation.newEpoch, alreadyCommitted: true };
      }
      throw httpsError('already-exists', 'Esta rotação já foi confirmada com outra chave.');
    }
    if (!['pending', 'blocked'].includes(rotation.status) || newEpochSnap.exists ||
        team.activeKeyEpoch !== expectedOldEpoch || team.pendingRotationId !== rotationId ||
        !['rotation_pending', 'rotation_blocked'].includes(team.keyRotationStatus || '') ||
        oldEpochSnap.data()?.keyId !== team.activeKeyId ||
        oldEpochSnap.data()?.status !== 'active') {
      throw httpsError('failed-precondition', 'A equipa mudou durante a rotação.');
    }
    const profiles = await Promise.all(team.memberUids.map(uid => tx.get(db.collection('publicProfiles').doc(uid))));
    for (let index = 0; index < team.memberUids.length; index++) {
      const pem = profiles[index].data()?.publicKeyPem;
      if (!profiles[index].exists || typeof pem !== 'string' || !pem.trim() ||
          createHash('sha256').update(pem.trim().replace(/\r\n/g, '\n')).digest('hex') !== fingerprints[team.memberUids[index]]) {
        throw httpsError('failed-precondition', 'A chave pública de um membro mudou durante a rotação.');
      }
    }
    tx.create(newEpochRef, {
      epoch: rotation.newEpoch, keyId: newKeyId, status: 'active',
      memberUids: team.memberUids, wrappedKeys: wraps, publicKeyFingerprints: fingerprints,
      createdAt: now, activatedAt: now, retiredAt: null,
      reason: rotation.reason, rotationId,
    });
    tx.update(oldEpochRef, { status: 'retired', retiredAt: now });
    tx.update(teamRef, {
      activeKeyEpoch: rotation.newEpoch, activeKeyId: newKeyId,
      keyRotationStatus: 'active', pendingRotationId: null,
      wrappedKeys: wraps, nextRotationDueAt: now + ROTATION_INTERVAL_MS, updatedAt: now,
    });
    tx.update(rotationRef, { status: 'committed', committedAt: now, committedByUid: actorUid });
    tx.create(auditRef, {
      teamId, at: now, actorUid, action: 'rotation_committed', targetUid: actorUid,
      rotationId, oldEpoch: expectedOldEpoch, newEpoch: rotation.newEpoch, reason: rotation.reason,
    });
    return { ok: true as const, teamId, newEpoch: rotation.newEpoch, alreadyCommitted: false };
  });
}

/** Escalates overdue rotations without ever generating or handling AES material. */
export async function supervisePendingTeamRotations(
  db: FirebaseFirestore.Firestore = getDb(),
  now = Date.now(),
  pageSize = 100,
): Promise<{ scanned: number; blocked: number }> {
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 100;
  let scanned = 0;
  let blocked = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    const base = db.collection(TEAM_ROTATIONS_COLLECTION).where('status', '==', 'pending')
      .orderBy(admin.firestore.FieldPath.documentId()).limit(size);
    const page: FirebaseFirestore.QuerySnapshot = await (cursor ? base.startAfter(cursor) : base).get();
    for (const rotationSnap of page.docs) {
      scanned += 1;
      const rotation = rotationSnap.data();
      if (!Number.isFinite(rotation.deadlineAt) || rotation.deadlineAt > now ||
          typeof rotation.teamId !== 'string' || !rotation.teamId) continue;
      const teamRef = db.collection(TEAMS_COLLECTION).doc(rotation.teamId);
      const auditRef = db.collection(TEAM_AUDIT_COLLECTION).doc();
      const didBlock = await db.runTransaction(async (tx) => {
        const [freshRotation, teamSnap] = await Promise.all([tx.get(rotationSnap.ref), tx.get(teamRef)]);
        const current = freshRotation.data();
        const team = readTeamDoc(teamSnap.data());
        if (!current || current.status !== 'pending' || current.deadlineAt > now ||
            !team || team.pendingRotationId !== rotationSnap.id ||
            team.keyRotationStatus !== 'rotation_pending') return false;
        if (teamSnap.data()?.deletionState === 'deleting' || !await liveAccountInTransaction(tx, db, team.ownerUid, false)) return false;
        const notificationRecipients: string[] = [];
        for (const memberUid of team.memberUids) {
          if (canInviteMembers(team, memberUid) && await liveAccountInTransaction(tx, db, memberUid, false)) {
            notificationRecipients.push(memberUid);
          }
        }
        tx.update(rotationSnap.ref, { status: 'blocked', blockedAt: now });
        tx.update(teamRef, { keyRotationStatus: 'rotation_blocked', updatedAt: now });
        tx.create(auditRef, {
          teamId: rotation.teamId, at: now, actorUid: 'system',
          action: 'rotation_blocked', targetUid: team.ownerUid,
          rotationId: rotationSnap.id, oldEpoch: current.oldEpoch,
        });
        for (const memberUid of notificationRecipients) {
          const notificationId = createHash('sha256').update(`${rotationSnap.id}:${memberUid}`).digest('hex');
          tx.set(db.collection('notifications').doc(`team-rotation-${notificationId}`), {
            uid: memberUid, type: 'team_rotation_blocked',
            title: 'Rotação da chave de equipa pendente',
            message: 'Desbloqueia o cofre e conclui a rotação da chave nas definições da equipa.',
            teamId: rotation.teamId, rotationId: rotationSnap.id,
            read: false, createdAt: now,
          });
        }
        return true;
      });
      if (didBlock) blocked += 1;
    }
    if (page.size < size) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return { scanned, blocked };
}

export const superviseTeamKeyRotations = regionalFunctions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .pubsub.schedule('every 15 minutes').timeZone('Etc/UTC')
  .onRun(async () => {
    const result = await supervisePendingTeamRotations();
    console.info('Team rotation supervision', result);
    return null;
  });

/** Find due active teams and freeze each through the same request transaction. */
export async function requestDueTeamKeyRotations(
  db: FirebaseFirestore.Firestore = getDb(),
  now = Date.now(),
  pageSize = 100,
): Promise<{ scanned: number; requested: number }> {
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 100;
  let scanned = 0;
  let requested = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    const base = db.collection(TEAMS_COLLECTION)
      .where('keyRotationStatus', '==', 'active')
      .where('nextRotationDueAt', '<=', now)
      .orderBy('nextRotationDueAt').limit(size);
    const page: FirebaseFirestore.QuerySnapshot = await (cursor ? base.startAfter(cursor) : base).get();
    for (const teamSnap of page.docs) {
      scanned += 1;
      try {
        await executeRequestTeamKeyRotation('system', {
          teamId: teamSnap.id, reason: 'scheduled',
        }, db, now, 'scheduler');
        requested += 1;
      } catch (error) {
        if (!(error instanceof functions.https.HttpsError) || error.code !== 'failed-precondition') throw error;
      }
    }
    if (page.size < size) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return { scanned, requested };
}

export const requestScheduledTeamKeyRotations = regionalFunctions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .pubsub.schedule('every 24 hours').timeZone('Etc/UTC')
  .onRun(async () => {
    const result = await requestDueTeamKeyRotations();
    console.info('Scheduled team rotations', result);
    return null;
  });

/**
 * Account deletion: owner → drop the team; member → strip membership + wrap.
 * Invites targeting or sent by the user are deleted.
 */
export async function purgeUserTeamMemberships(
  uid: string,
  db: FirebaseFirestore.Firestore = getDb(),
): Promise<number> {
  if (!attachmentActorIdValid(uid)) throw httpsError('invalid-argument', 'Conta inválida.');
  const deletion = await db.doc(`accountDeletions/${uid}`).get();
  if (deletion.data()?.v !== 1 || deletion.data()?.status !== 'deleting' || deletion.data()?.phase !== 'documents') {
    throw httpsError('failed-precondition', 'Eliminação de conta ainda não admitida nesta fase.');
  }
  if (!(await db.collection(TEAMS_COLLECTION).where('ownerUid', '==', uid).limit(1).get()).empty) {
    throw httpsError('failed-precondition', 'Equipa própria ainda por remover pelo protocolo de eliminação.');
  }
  let touched = 0;
  for (let page = 0; page < 500; page += 1) {
    const memberTeams = await db.collection(TEAMS_COLLECTION)
      .where('memberUids', 'array-contains', uid)
      .limit(50)
      .get();
    if (memberTeams.empty) break;
    for (const teamDoc of memberTeams.docs) {
      const team = readTeamDoc(teamDoc.data());
      if (!team) throw httpsError('failed-precondition', 'Equipa inválida durante apagamento de conta.');
      if (team.ownerUid === uid) {
        // Owned teams must have completed the anchored object/child purge in the earlier phase.
        throw httpsError('failed-precondition', 'Equipa própria ainda por remover pelo protocolo de eliminação.');
      } else {
        await executeRequestTeamKeyRotation(uid, {
          teamId: teamDoc.id, reason: 'member_left', targetUid: uid,
        }, db, Date.now(), 'account-cleanup');
      }
      touched += 1;
    }
    if (page === 499) throw httpsError('resource-exhausted', 'Demasiadas equipas para apagar numa operação.');
  }

  for (const field of ['uid', 'fromUid'] as const) {
    for (let page = 0; page < 20; page += 1) {
      const snapshot = await db.collection(TEAM_INVITES_COLLECTION)
        .where(field, '==', uid)
        .limit(200)
        .get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref); batch.delete(db.collection(TEAM_INVITE_INBOX_COLLECTION).doc(docSnap.id));
      });
      await batch.commit();
      touched += snapshot.size;
      if (snapshot.size < 200) break;
    }
    if (!(await db.collection(TEAM_INVITES_COLLECTION).where(field, '==', uid).limit(1).get()).empty) {
      throw httpsError('resource-exhausted', 'Convites ainda pendentes; repetir apagamento de conta.');
    }
  }
  return touched;
}

export function parseSetMemberRoleInput(data: unknown): {
  teamId: string;
  targetUid: string;
  role: Exclude<TeamRole, 'owner'>;
} {
  const payload = asRecord(data);
  const teamId = typeof payload.teamId === 'string' ? payload.teamId.trim() : '';
  const targetUid = typeof payload.targetUid === 'string' ? payload.targetUid.trim() : '';
  const role = payload.role;
  if (!attachmentActorIdValid(teamId)) throw httpsError('invalid-argument', 'teamId inválido');
  if (!attachmentActorIdValid(targetUid)) throw httpsError('invalid-argument', 'targetUid inválido');
  if (role !== 'admin' && role !== 'member') {
    throw httpsError('invalid-argument', 'role must be admin or member');
  }
  return { teamId, targetUid, role };
}

export async function executeSetMemberRole(
  uid: string,
  data: unknown,
  db: FirebaseFirestore.Firestore = getDb(),
  now = Date.now(),
): Promise<{ ok: true; role: Exclude<TeamRole, 'owner'> }> {
  const input = parseSetMemberRoleInput(data);
  const teamRef = db.collection(TEAMS_COLLECTION).doc(input.teamId);
  const auditRef = db.collection(TEAM_AUDIT_COLLECTION).doc();
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid, false) || !await liveAccountInTransaction(tx, db, input.targetUid, false)) {
      throw httpsError('failed-precondition', 'Conta indisponível.');
    }
    const teamSnap = await tx.get(teamRef);
    const team = readTeamDoc(teamSnap.data());
    if (!teamSnap.exists || !team || teamSnap.data()?.deletionState === 'deleting') {
      throw httpsError('not-found', 'Equipa não encontrada.');
    }
    if (team.ownerUid !== uid) {
      throw httpsError('permission-denied', 'Só o owner pode alterar papéis.');
    }
    if (input.targetUid === team.ownerUid) {
      throw httpsError('failed-precondition', 'O papel de owner não pode ser alterado.');
    }
    if (!team.memberUids.includes(input.targetUid)) {
      throw httpsError('failed-precondition', 'O alvo não é membro desta equipa.');
    }
    const roles = { ...team.roles, [input.targetUid]: input.role };
    tx.update(teamRef, { roles });
    tx.create(auditRef, buildTeamAuditEvent({
      teamId: input.teamId,
      at: now,
      actorUid: uid,
      action: 'role_changed',
      targetUid: input.targetUid,
    }));
    return { ok: true, role: input.role };
  });
}

export const createTeam = regionalFunctions.https.onCall(async (data, context) => {
  assertTeamWritesEnabled();
  return executeCreateTeam(await requireTeamCreationUid(context), data);
});

export const cancelTeamCreation = regionalFunctions.https.onCall(async (data, context) => {
  return executeCancelTeamCreation(await requireTeamCreationUid(context), data);
});

async function requireTeamCreationUid(context: functions.https.CallableContext): Promise<string> {
  const uid = requireUid(context);
  const rate = await consumeServerRateLimit(`uid:${uid}`, { bucket: 'team-creation', max: 20, windowMs: 60_000 });
  if (!rate.allowed) throw httpsError('resource-exhausted', 'Tenta novamente mais tarde.');
  return uid;
}

export const lookupTeamInvitee = regionalFunctions.https.onCall(async (data, context) => {
  assertTeamWritesEnabled();
  const uid = await requireTeamCreationUid(context);
  const payload = asRecord(data);
  return withLiveAccount(uid, () => executeLookupTeamInvitee(payload.email));
});

export const inviteMember = regionalFunctions.https.onCall(async (data, context) => {
  assertTeamWritesEnabled();
  return executeInviteMember(requireUid(context), data);
});

export const acceptInvite = regionalFunctions.https.onCall(async (data, context) => {
  assertTeamWritesEnabled();
  return executeAcceptInvite(requireUid(context), data);
});

export const leaveTeam = regionalFunctions.https.onCall(async (data, context) => {
  return executeLeaveTeam(requireUid(context), data);
});

export const requestTeamKeyRotation = regionalFunctions.https.onCall(async (data, context) => {
  const payload = asRecord(data);
  const teamId = typeof payload.teamId === 'string' ? payload.teamId.trim() : '';
  if (payload.reason !== undefined && payload.reason !== 'manual' && payload.reason !== 'key_compromise') {
    throw httpsError('invalid-argument', 'Motivo de rotação inválido.');
  }
  const reason = payload.reason === 'key_compromise' ? 'key_compromise' : 'manual';
  return executeRequestTeamKeyRotation(requireUid(context), {
    teamId, reason, idempotencyKey: payload.idempotencyKey,
  });
});

export const removeTeamMember = regionalFunctions.https.onCall(async (data, context) => {
  const payload = asRecord(data);
  const teamId = typeof payload.teamId === 'string' ? payload.teamId.trim() : '';
  const targetUid = typeof payload.targetUid === 'string' ? payload.targetUid.trim() : '';
  return executeRequestTeamKeyRotation(requireUid(context), {
    teamId, reason: 'member_removed', targetUid, idempotencyKey: payload.idempotencyKey,
  });
});

export const commitTeamKeyRotation = regionalFunctions.https.onCall(async (data, context) => {
  return executeCommitTeamKeyRotation(requireUid(context), data);
});

export { deleteTeam, getTeamDeletionStatus, getPendingTeamDeletions, executeDeleteTeam } from './teamDeletion';

export const setMemberRole = regionalFunctions.https.onCall(async (data, context) => {
  assertTeamWritesEnabled();
  return executeSetMemberRole(requireUid(context), data);
});
