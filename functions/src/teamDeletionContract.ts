import { createHash } from 'node:crypto';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { liveAccountInTransaction } from './accountAccess';
export const TEAM_DELETIONS_COLLECTION = 'teamDeletions';
export function teamDeletionOwnerDigest(uid: string, teamId: string) {
  if (!attachmentActorIdValid(uid) || !attachmentActorIdValid(teamId)) throw Error('Invalid deletion binding');
  return createHash('sha256').update(JSON.stringify(['Mnemosyne-team-deletion-v1', uid, teamId])).digest('hex');
}
export function validTeamDeletionMarker(data: FirebaseFirestore.DocumentData | undefined, uid: string, teamId: string): boolean {
  if (!data || data.v !== 1 || data.ownerDigest !== teamDeletionOwnerDigest(uid, teamId)) return false;
  if (data.phase === 'complete') return data.status === 'complete' && data.leaseUntil === 0 &&
    Number.isSafeInteger(data.completedAt) && data.completedAt >= 0 &&
    Object.keys(data).sort().join(',') === 'completedAt,leaseUntil,ownerDigest,phase,status,v';
  return ['objects', 'documents'].includes(data.phase) && data.status === 'deleting' && data.ownerUid === uid &&
    Number.isSafeInteger(data.leaseUntil) && data.leaseUntil >= 0 &&
    Number.isSafeInteger(data.nextAttemptAt) && data.nextAttemptAt >= 0 &&
    Number.isSafeInteger(data.startedAt) && data.startedAt >= 0 && Number.isSafeInteger(data.updatedAt) && data.updatedAt >= 0 &&
    (data.worker === undefined ? data.leaseUntil === 0 : typeof data.worker === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.worker)) &&
    Object.keys(data).every(key => ['v', 'ownerUid', 'ownerDigest', 'phase', 'status', 'worker', 'leaseUntil', 'nextAttemptAt', 'startedAt', 'updatedAt'].includes(key));
}
export async function authorizedTeamObjectPurge(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, uid: string, teamId: string, now: number) {
  if (!await liveAccountInTransaction(tx, db, uid)) return false;
  const [team, marker] = await tx.getAll(db.doc(`teams/${teamId}`), db.doc(`${TEAM_DELETIONS_COLLECTION}/${teamId}`));
  return team.data()?.ownerUid === uid && team.data()?.deletionState === 'deleting' &&
    Array.isArray(team.data()?.memberUids) && team.data()!.memberUids.length === 0 &&
    team.data()?.wrappedKeys && typeof team.data()?.wrappedKeys === 'object' && !Array.isArray(team.data()?.wrappedKeys) &&
    Object.keys(team.data()!.wrappedKeys).length === 0 &&
    validTeamDeletionMarker(marker.data(), uid, teamId) &&
    marker.data()?.status === 'deleting' && marker.data()?.phase === 'objects' && marker.data()?.leaseUntil > now;
}
/** UID-free final marker remains authoritative after parent removal and during account cleanup. */
export async function completeOwnedTeamDeletionMarker(uid: string, teamId: string, db: FirebaseFirestore.Firestore, now: number) {
  const ref = db.doc(`${TEAM_DELETIONS_COLLECTION}/${teamId}`);
  await db.runTransaction(async tx => {
    const [marker, team] = await tx.getAll(ref, db.doc(`teams/${teamId}`));
    if (!marker.exists) return;
    if (team.exists || !validTeamDeletionMarker(marker.data(), uid, teamId)) {
      throw Error('Team deletion not complete');
    }
    tx.set(ref, { v: 1, ownerDigest: marker.data()!.ownerDigest, phase: 'complete', status: 'complete', completedAt: now, leaseUntil: 0 });
  });
}
