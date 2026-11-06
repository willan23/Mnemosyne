import { createHash } from 'crypto';
import { firestore } from 'firebase-admin';
import { https } from 'firebase-functions/v1';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { liveAccountInTransaction } from './accountAccess';

type Row = Record<string, unknown>;
export type InboxMigrationReason = 'valid' | 'inactive' | 'reissue' | 'unavailable' | 'malformed' | 'conflict';
export interface InboxMigrationAuth {
  getUser(uid: string): Promise<{ uid: string; disabled?: boolean }>;
}
const record = (raw: unknown): Row => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Row : {};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const validWrap = (raw: unknown): boolean => {
  const value = record(raw);
  if (Object.keys(value).sort().join(',') !== 'alg,ct,v' || value.v !== 1 || value.alg !== 'RSA-OAEP' || typeof value.ct !== 'string') return false;
  const bytes = Buffer.from(value.ct, 'base64');
  return bytes.length >= 256 && bytes.length <= 512 && bytes.toString('base64') === value.ct;
};
const validWraps = (raw: unknown, members: string[]): boolean => {
  const wraps = record(raw);
  return Object.keys(wraps).length === members.length && members.every(uid => validWrap(wraps[uid]));
};

/** Metadata classification only: never manufactures an identity proof or changes a key envelope. */
export function classifyInviteForInbox(input: {
  invite: unknown; team: unknown; profile: unknown; epoch: unknown; accountsLive: boolean; now: number;
}): InboxMigrationReason {
  const invite = record(input.invite); const team = record(input.team); const profile = record(input.profile);
  if (!attachmentActorIdValid(invite.uid) || !attachmentActorIdValid(invite.fromUid) || !attachmentActorIdValid(invite.teamId) ||
      !['pending', 'accepted', 'revoked', 'expired'].includes(invite.status as string) ||
      !Number.isSafeInteger(invite.expiresAt) || !Number.isSafeInteger(invite.createdAt) ||
      (invite.createdAt as number) < 0 || (invite.expiresAt as number) <= (invite.createdAt as number)) return 'malformed';
  if (invite.status !== 'pending' || (invite.expiresAt as number) <= input.now) return 'inactive';
  if (!input.accountsLive || !attachmentActorIdValid(team.ownerUid) || team.deletionState === 'deleting') return 'unavailable';
  const members = team.memberUids;
  if (!Array.isArray(members) || members.length < 1 || members.length > 10 || new Set(members).size !== members.length ||
      members.some(uid => !attachmentActorIdValid(uid)) || !members.includes(team.ownerUid) ||
      !members.includes(invite.fromUid) || !validWraps(team.wrappedKeys, members)) return 'unavailable';
  if (invite.fromUid !== team.ownerUid && record(team.roles)[invite.fromUid as string] !== 'admin') return 'unavailable';
  if ((team.keyRotationStatus !== undefined && team.keyRotationStatus !== 'active') || members.includes(invite.uid) || members.length >= 10) return 'unavailable';
  if (!Number.isSafeInteger(invite.keyEpoch) || (invite.keyEpoch as number) < 1 ||
      (invite.keyId !== null && !attachmentActorIdValid(invite.keyId)) ||
      typeof invite.publicKeyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(invite.publicKeyFingerprint) ||
      !validWrap(invite.wrappedKey)) return 'reissue';
  const activeEpoch = team.activeKeyEpoch ?? 1; const activeKeyId = team.activeKeyId ?? null;
  if (!Number.isSafeInteger(activeEpoch) || (activeEpoch as number) < 1 ||
      (team.activeKeyEpoch !== undefined && !attachmentActorIdValid(activeKeyId))) return 'unavailable';
  if (invite.keyEpoch !== activeEpoch || invite.keyId !== activeKeyId) return 'reissue';
  if (team.activeKeyEpoch !== undefined) {
    const epoch = record(input.epoch);
    if (epoch.status !== 'active' || epoch.keyId !== activeKeyId || epoch.epoch !== activeEpoch ||
        !same(epoch.memberUids, members) || !validWraps(epoch.wrappedKeys, members) ||
        members.some(uid => record(record(epoch.wrappedKeys)[uid]).ct !== record(record(team.wrappedKeys)[uid]).ct)) return 'unavailable';
  }
  const pem = profile.publicKeyPem;
  if (profile.uid !== invite.uid || typeof pem !== 'string' || !pem.trim() ||
      typeof invite.emailHash !== 'string' || !/^[a-f0-9]{64}$/.test(invite.emailHash) || profile.emailHash !== invite.emailHash ||
      createHash('sha256').update(pem.trim().replace(/\r\n/g, '\n')).digest('hex') !== invite.publicKeyFingerprint) return 'reissue';
  return 'valid';
}

function exactPointer(raw: unknown, id: string, invite?: Row): boolean {
  const value = record(raw);
  return Object.keys(value).sort().join(',') === 'inviteId,teamId,uid,v' && value.v === 1 && value.inviteId === id &&
    attachmentActorIdValid(value.uid) && attachmentActorIdValid(value.teamId) &&
    (!invite || (value.uid === invite.uid && value.teamId === invite.teamId));
}

/** Private Admin maintenance API, absent from deployed callable exports. Re-running starts safely from any page. */
export async function migrateTeamInviteInboxPage(input: {
  collection: 'teamInvites' | 'teamInviteInbox'; afterId: string | null; limit: number; apply: boolean; now: number;
}, db: FirebaseFirestore.Firestore, auth: InboxMigrationAuth): Promise<{
  scanned: number; reasons: Record<InboxMigrationReason, number>; created: number; removed: number;
  changesNeeded: number; unresolved: number; nextAfterId: string | null; exhausted: boolean;
}> {
  if (!input || !['teamInvites', 'teamInviteInbox'].includes(input.collection) || typeof input.apply !== 'boolean' ||
      (input.afterId !== null && (typeof input.afterId !== 'string' || !input.afterId || input.afterId.includes('/') || Buffer.byteLength(input.afterId) > 1500)) ||
      !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 ||
      !Number.isSafeInteger(input.now) || input.now < 0) throw new https.HttpsError('invalid-argument', 'Contexto de migração inválido.');
  let query = db.collection(input.collection).orderBy(firestore.FieldPath.documentId()).limit(input.limit);
  if (input.afterId) query = query.startAfter(input.afterId);
  const page = await query.get();
  const result = { scanned: 0, reasons: { valid: 0, inactive: 0, reissue: 0, unavailable: 0, malformed: 0, conflict: 0 },
    created: 0, removed: 0, changesNeeded: 0, unresolved: 0,
    nextAfterId: page.empty ? null : page.docs[page.size - 1].id, exhausted: page.size < input.limit };
  for (const snapshot of page.docs) {
    const id = snapshot.id;
    if (!attachmentActorIdValid(id)) { result.scanned++; result.reasons.malformed++; result.unresolved++; continue; }
    // Auth is a separate service: this check does not claim an atomic cross-service snapshot.
    const initial = input.collection === 'teamInvites' ? snapshot : await db.doc(`teamInvites/${id}`).get();
    const initialInvite = record(initial.data());
    const initialTeam = attachmentActorIdValid(initialInvite.teamId) ? await db.doc(`teams/${initialInvite.teamId}`).get() : null;
    const identities = [initialInvite.uid, initialInvite.fromUid, initialTeam?.data()?.ownerUid];
    let authLive = true;
    for (const uid of new Set(identities)) {
      if (!attachmentActorIdValid(uid)) { authLive = false; continue; }
      try { const user = await auth.getUser(uid); if (user.uid !== uid || user.disabled) authLive = false; }
      catch { authLive = false; }
    }
    const outcome = await db.runTransaction(async tx => {
      const [inviteSnap, pointer] = await tx.getAll(db.doc(`teamInvites/${id}`), db.doc(`teamInviteInbox/${id}`));
      const invite = record(inviteSnap.data());
      let reason: InboxMigrationReason = 'inactive';
      if (inviteSnap.exists) {
        let team: Row = {}; let profile: Row = {}; let epoch: Row = {}; let live = authLive;
        if (attachmentActorIdValid(invite.teamId) && attachmentActorIdValid(invite.uid) && attachmentActorIdValid(invite.fromUid)) {
          const teamSnap = await tx.get(db.doc(`teams/${invite.teamId}`)); team = record(teamSnap.data());
          if (!same(identities, [invite.uid, invite.fromUid, team.ownerUid])) live = false;
          for (const uid of new Set([invite.uid, invite.fromUid, team.ownerUid])) {
            if (!attachmentActorIdValid(uid) || !await liveAccountInTransaction(tx, db, uid)) live = false;
          }
          profile = record((await tx.get(db.doc(`publicProfiles/${invite.uid}`))).data());
          if (Number.isSafeInteger(team.activeKeyEpoch) && (team.activeKeyEpoch as number) >= 1) {
            epoch = record((await tx.get(teamSnap.ref.collection('keyEpochs').doc(String(team.activeKeyEpoch)))).data());
          }
        }
        reason = classifyInviteForInbox({ invite, team, profile, epoch, accountsLive: live, now: input.now });
      }
      if (pointer.exists && !exactPointer(pointer.data(), id, inviteSnap.exists ? invite : undefined)) {
        return { reason: 'conflict' as const, action: 'none' as const };
      }
      // Existing invitations are handled by the first scan; the second scan accounts for orphan pointers.
      const action = input.collection === 'teamInviteInbox' && inviteSnap.exists ? 'none' :
        reason === 'valid' ? (pointer.exists ? 'none' : 'create') : (pointer.exists ? 'remove' : 'none');
      if (input.apply && action === 'create') tx.create(pointer.ref, { v: 1, uid: invite.uid, inviteId: id, teamId: invite.teamId });
      if (input.apply && action === 'remove') tx.delete(pointer.ref);
      return { reason, action };
    });
    result.scanned++; result.reasons[outcome.reason]++;
    if (['reissue', 'unavailable', 'malformed', 'conflict'].includes(outcome.reason)) result.unresolved++;
    if (outcome.action !== 'none') {
      if (!input.apply) result.changesNeeded++;
      else if (outcome.action === 'create') result.created++;
      else result.removed++;
    }
  }
  return result;
}
