import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { randomUUID } from 'node:crypto';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { liveAccountInTransaction } from './accountAccess';
import { consumeServerRateLimit } from './rateLimit';
import { createAttachmentObjectStore, purgeOwnedTeamAttachmentUploads, type AttachmentUploadDeps } from './attachmentUploads';
import { deleteAccountDocumentTree, deleteAccountQuery, purgeSessions, TEAM_BOUND_COLLECTIONS, cancelDeletedTeamCreationRequests } from './documentDeletion';
import { TEAM_DELETIONS_COLLECTION, teamDeletionOwnerDigest, validTeamDeletionMarker } from './teamDeletionContract';
if (!admin.apps.length) admin.initializeApp();
export const TEAM_DELETION_ENABLED = false;
const LEASE_MS = 10 * 60_000;
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') =>
  new functions.https.HttpsError(code, 'Não foi possível confirmar a eliminação da equipa. O pedido fica disponível para retomar.');
export interface TeamDeletionResult { uid: string; teamId: string; status: 'pending' | 'complete'; retryAt: number | null }
export interface TeamDeletionDeps { firestore: FirebaseFirestore.Firestore; now: () => number; attachments: AttachmentUploadDeps }
export function parseTeamDeletionInput(uid: string, input: unknown): { teamId: string; expectedUid: string } {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid-argument');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'expectedUid,teamId' ||
      !attachmentActorIdValid(data.teamId) || !attachmentActorIdValid(data.expectedUid)) throw fail('invalid-argument');
  if (data.expectedUid !== uid) throw fail('permission-denied');
  return { teamId: data.teamId as string, expectedUid: uid };
}
function readMarker(data: FirebaseFirestore.DocumentData | undefined, uid: string, teamId: string): 'objects' | 'documents' | 'complete' {
  if (!data || data.v !== 1 || data.ownerDigest !== teamDeletionOwnerDigest(uid, teamId)) throw fail('permission-denied');
  if (!validTeamDeletionMarker(data, uid, teamId)) throw fail();
  return data.phase;
}
function frozenTeam(data: FirebaseFirestore.DocumentData | undefined, uid: string) {
  return data?.ownerUid === uid && data.deletionState === 'deleting' &&
    Array.isArray(data.memberUids) && data.memberUids.length === 0 &&
    data.wrappedKeys && typeof data.wrappedKeys === 'object' && Object.keys(data.wrappedKeys).length === 0;
}
const defaults = (): TeamDeletionDeps => {
  const firestore = admin.firestore();
  return { firestore, now: Date.now, attachments: { firestore, now: Date.now,
    store: bucket => createAttachmentObjectStore(admin.storage().bucket(bucket)) } };
};

/** Freeze membership before objects; preserve the team and session anchors until all children are erased. */
export async function executeDeleteTeam(uid: string, input: unknown, deps = defaults()): Promise<TeamDeletionResult> {
  const { teamId } = parseTeamDeletionInput(uid, input); const db = deps.firestore;
  if (deps.attachments.firestore !== db) throw fail();
  const teamRef = db.doc(`teams/${teamId}`); const marker = db.doc(`${TEAM_DELETIONS_COLLECTION}/${teamId}`);
  const worker = randomUUID(); const ownerDigest = teamDeletionOwnerDigest(uid, teamId);
  const pending = (retryAt: number): TeamDeletionResult => ({ uid, teamId, status: 'pending', retryAt });
  const acquired = await db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail();
    const [request, team] = await tx.getAll(marker, teamRef);
    const phase = request.exists ? readMarker(request.data(), uid, teamId) : 'objects';
    if (phase === 'complete') { if (team.exists) throw fail(); return { phase, acquired: false, retryAt: 0 }; }
    if (!team.exists && !(request.exists && phase === 'documents')) throw fail('permission-denied');
    if (team.exists && team.data()?.ownerUid !== uid) throw fail('permission-denied');
    if (request.exists && team.exists && !frozenTeam(team.data(), uid)) throw fail();
    if (!request.exists && team.data()?.deletionState === 'deleting') throw fail();
    const retryAt = Math.max(request.data()?.leaseUntil ?? 0, request.data()?.nextAttemptAt ?? 0);
    if (retryAt > deps.now()) return { phase, acquired: false, retryAt };
    tx.set(marker, { v: 1, ownerUid: uid, ownerDigest, phase, status: 'deleting', worker,
      leaseUntil: deps.now() + LEASE_MS, nextAttemptAt: 0,
      startedAt: request.data()?.startedAt ?? deps.now(), updatedAt: deps.now() });
    if (team.exists) tx.update(teamRef, { deletionState: 'deleting', memberUids: [], wrappedKeys: {}, roles: {},
      keyRotationStatus: 'rotation_blocked', pendingRotationId: null });
    return { phase, acquired: true, retryAt: 0 };
  });
  if (acquired.phase === 'complete') return { uid, teamId, status: 'complete', retryAt: null };
  if (!acquired.acquired) return pending(acquired.retryAt);
  const transition = async (phase: 'objects' | 'documents' | 'complete', nextAttemptAt = 0) => db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail();
    const current = await tx.get(marker); readMarker(current.data(), uid, teamId);
    if (current.data()?.worker !== worker || current.data()?.leaseUntil <= deps.now()) throw fail();
    if (phase === 'complete') {
      if ((await tx.get(teamRef)).exists) throw fail();
      tx.set(marker, { v: 1, ownerDigest, phase, status: 'complete', completedAt: deps.now(), leaseUntil: 0 });
    } else tx.update(marker, { phase, nextAttemptAt, updatedAt: deps.now() });
  });
  try {
    let phase = acquired.phase;
    if (phase === 'objects') {
      const objects = await purgeOwnedTeamAttachmentUploads(uid, teamId, deps.attachments, 'team-deletion');
      if (!objects.complete) { const retryAt = objects.retryAt ?? deps.now() + 60_000; await transition('objects', retryAt); return pending(retryAt); }
      await transition('documents'); phase = 'documents';
    }
    if (phase === 'documents') {
      await purgeSessions(db, () => db.collection('sessions').where('teamId', '==', teamId), true);
      await cancelDeletedTeamCreationRequests(db, teamId, deps.now());
      for (const collection of TEAM_BOUND_COLLECTIONS) await deleteAccountQuery(db, () => db.collection(collection).where('teamId', '==', teamId), true);
      await deleteAccountDocumentTree(db, teamRef);
      await transition('complete');
    }
    return { uid, teamId, status: 'complete', retryAt: null };
  } finally {
    await db.runTransaction(async tx => {
      const current = await tx.get(marker);
      if (current.data()?.worker === worker) tx.update(marker, { worker: admin.firestore.FieldValue.delete(), leaseUntil: 0 });
    });
  }
}
export async function inspectTeamDeletion(uid: string, input: unknown, db: FirebaseFirestore.Firestore = admin.firestore(), now = Date.now()) {
  const { teamId } = parseTeamDeletionInput(uid, input);
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail();
    const marker = await tx.get(db.doc(`${TEAM_DELETIONS_COLLECTION}/${teamId}`));
    if (!marker.exists) {
      const team = await tx.get(db.doc(`teams/${teamId}`));
      if (team.exists && team.data()?.ownerUid !== uid) throw fail('permission-denied');
      return { uid, teamId, status: 'unknown' as const, retryAt: null };
    }
    const phase = readMarker(marker.data(), uid, teamId);
    if (phase === 'complete' && (await tx.get(db.doc(`teams/${teamId}`))).exists) throw fail();
    return { uid, teamId, status: phase === 'complete' ? 'complete' as const : 'pending' as const,
      retryAt: phase === 'complete' ? null : Math.max(now, marker.data()!.leaseUntil, marker.data()?.nextAttemptAt ?? 0) };
  });
}
export function parsePendingTeamDeletionInput(uid: string, input: unknown) {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid-argument');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'afterTeamId,expectedUid' || !attachmentActorIdValid(data.expectedUid) ||
      (data.afterTeamId !== null && !attachmentActorIdValid(data.afterTeamId))) throw fail('invalid-argument');
  if (data.expectedUid !== uid) throw fail('permission-denied');
  return { afterTeamId: data.afterTeamId as string | null };
}
/** Owner-scoped recovery remains discoverable when membership and parent documents are gone. */
export async function listPendingTeamDeletions(uid: string, input: unknown, db: FirebaseFirestore.Firestore = admin.firestore(), now = Date.now()) {
  const { afterTeamId } = parsePendingTeamDeletionInput(uid, input);
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail();
    const base = db.collection(TEAM_DELETIONS_COLLECTION).where('ownerUid', '==', uid).orderBy(admin.firestore.FieldPath.documentId());
    const rows = await tx.get((afterTeamId ? base.startAfter(afterTeamId) : base).limit(25));
    const requests = rows.docs.map(row => {
      if (readMarker(row.data(), uid, row.id) === 'complete') throw fail();
      return { uid, teamId: row.id, status: 'pending' as const, retryAt: Math.max(now, row.data().leaseUntil, row.data().nextAttemptAt) };
    });
    return { uid, requests, nextAfterTeamId: rows.size === 25 ? rows.docs[24].id : null };
  });
}
async function callableUid(input: unknown, context: functions.https.CallableContext) {
  if (!context.auth?.uid) throw fail('unauthenticated');
  const uid = context.auth.uid; parseTeamDeletionInput(uid, input);
  const rate = await consumeServerRateLimit(`uid:${uid}`, { bucket: 'team-deletion', max: 20, windowMs: 60_000 });
  if (!rate.allowed) throw fail('resource-exhausted');
  return uid;
}
export const deleteTeam = functions.region('europe-west1').runWith({ timeoutSeconds: 540, memory: '512MB' }).https.onCall(async (input, context) => {
  const uid = await callableUid(input, context); const { teamId } = parseTeamDeletionInput(uid, input);
  if (!TEAM_DELETION_ENABLED && !(await admin.firestore().doc(`${TEAM_DELETIONS_COLLECTION}/${teamId}`).get()).exists) throw fail();
  try { return await executeDeleteTeam(uid, input); }
  catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
export const getTeamDeletionStatus = functions.region('europe-west1').https.onCall(async (input, context) => {
  const uid = await callableUid(input, context);
  try { return await inspectTeamDeletion(uid, input); }
  catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
export const getPendingTeamDeletions = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');
  const uid = context.auth.uid; parsePendingTeamDeletionInput(uid, input);
  const rate = await consumeServerRateLimit(`uid:${uid}`, { bucket: 'team-deletion', max: 20, windowMs: 60_000 });
  if (!rate.allowed) throw fail('resource-exhausted');
  try { return await listPendingTeamDeletions(uid, input); }
  catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
