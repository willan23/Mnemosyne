import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'node:crypto';
import { attachmentActorIdValid, encodeAttachmentHeader, parseAttachmentHeader, type AttachmentEnvelopeHeader } from './attachmentEnvelope';
import { readAttachmentUploadRecord } from './attachmentUploads';
import { consumeServerRateLimit } from './rateLimit';
import { liveAccountInTransaction } from './accountAccess';
if (!admin.apps.length) admin.initializeApp();
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Attachment recovery unavailable');
const digestOf = (header: AttachmentEnvelopeHeader) => createHash('sha256').update(encodeAttachmentHeader(header)).digest('hex');
export interface AttachmentUploadRecoveryDeps { firestore: FirebaseFirestore.Firestore; now: () => number }
const defaults = (): AttachmentUploadRecoveryDeps => ({ firestore: admin.firestore(), now: Date.now });
function request(uid: string, input: unknown) {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'header') throw fail('invalid-argument');
    const header = parseAttachmentHeader((input as { header: unknown }).header);
    if (header.uid !== uid) throw fail('permission-denied'); return header;
  } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail('invalid-argument'); }
}
async function access(tx: FirebaseFirestore.Transaction, uid: string, header: AttachmentEnvelopeHeader, db: FirebaseFirestore.Firestore) {
  if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
  const user = await tx.get(db.doc(`users/${uid}`));
  if (!user.exists || user.data()?.deletionState === 'deleting') throw fail('permission-denied');
  if (header.scope.kind === 'team') {
    const scope = header.scope;
    const [team, epoch] = await tx.getAll(db.doc(`teams/${scope.teamId}`), db.doc(`teams/${scope.teamId}/keyEpochs/${scope.keyEpoch}`));
    const data = team.data(); const historical = epoch.data();
    if (!data || !Array.isArray(data.memberUids) || !data.memberUids.includes(uid) || !data.wrappedKeys?.[uid] || !historical ||
        historical.epoch !== scope.keyEpoch || historical.keyId !== scope.keyId || !Array.isArray(historical.memberUids) || !historical.memberUids.includes(uid) || !historical.wrappedKeys?.[uid]) throw fail('permission-denied');
  }
}
function cancellationMatches(data: FirebaseFirestore.DocumentData | undefined, uid: string, id: string, digest: string) {
  if (!data || data.v !== 1 || data.uid !== uid || data.id !== id || data.digest !== digest || data.status !== 'cancelled') throw fail('permission-denied');
}
/** Reads only metadata bound to the caller's exact encrypted header, without relying on write gates or entitlements. */
export async function inspectAttachmentUpload(uid: string, input: unknown, deps = defaults()) {
  const header = request(uid, input); const digest = digestOf(header); const db = deps.firestore;
  return db.runTransaction(async tx => {
    await access(tx, uid, header, db);
    const [snapshot, cancellation, tombstone] = await tx.getAll(db.doc(`attachmentUploads/${header.id}`), db.doc(`attachmentUploadCancellations/${header.id}`), db.doc(`attachmentObjectTombstones/${header.id}`));
    if (tombstone.exists && (tombstone.data()?.v !== 1 || tombstone.data()?.digest !== digest)) throw fail('permission-denied');
    if (cancellation.exists) cancellationMatches(cancellation.data(), uid, header.id, digest);
    if (!snapshot.exists) return { id: header.id, digest, status: cancellation.exists || tombstone.exists ? 'cancelled' as const : 'unknown' as const,
      bytes: encodeAttachmentHeader(header).length + header.cipherBytes, expiresAt: null, postExpiresAt: null, retryAt: null };
    const record = readAttachmentUploadRecord(snapshot.data(), header.id, true);
    if (record.uid !== uid || record.digest !== digest) throw fail('permission-denied');
    if (cancellation.exists && record.status !== 'cancelled') throw fail();
    return { id: header.id, digest, status: record.purgeState ? 'cancelled' as const : ['ready', 'cancelled'].includes(record.status) ? record.status : record.expiresAt <= deps.now() ? 'expired' as const : record.status,
      bytes: record.bytes, expiresAt: record.expiresAt, postExpiresAt: record.postExpiresAt,
      retryAt: record.status === 'verifying' ? record.verificationUntil ?? null : null };
  });
}
/** Serializes cancellation against reserve/finalize; unknown is cancelled permanently, and a ready object is preserved. */
export async function cancelPendingAttachmentUpload(uid: string, input: unknown, deps = defaults()) {
  const header = request(uid, input); const digest = digestOf(header); const db = deps.firestore;
  return db.runTransaction(async tx => {
    await access(tx, uid, header, db);
    const ref = db.doc(`attachmentUploads/${header.id}`); const tombstone = db.doc(`attachmentUploadCancellations/${header.id}`);
    const [snapshot, cancellation, deleted] = await tx.getAll(ref, tombstone, db.doc(`attachmentObjectTombstones/${header.id}`));
    if (deleted.exists) {
      if (deleted.data()?.v !== 1 || deleted.data()?.digest !== digest || deleted.data()?.status !== 'deleted' || snapshot.exists) throw fail('permission-denied');
      return { id: header.id, digest, status: 'cancelled' as const };
    }
    if (cancellation.exists) cancellationMatches(cancellation.data(), uid, header.id, digest);
    const record = snapshot.exists ? readAttachmentUploadRecord(snapshot.data(), header.id, true) : null;
    if (record && (record.uid !== uid || record.digest !== digest)) throw fail('permission-denied');
    if (record?.purgeState) return { id: header.id, digest, status: 'cancelled' as const };
    if (record?.status === 'ready') {
      if (cancellation.exists) throw fail(); return { id: header.id, digest, status: 'ready' as const };
    }
    if (record && record.status !== 'cancelled') tx.update(ref, { status: 'cancelled', cleanupPending: true,
      cleanupAfter: Math.max(deps.now(), record.postExpiresAt, record.verificationUntil ?? 0) + 60_000, updatedAt: deps.now() });
    if (!cancellation.exists) tx.create(tombstone, { v: 1, uid, id: header.id, digest, status: 'cancelled', createdAt: deps.now() });
    return { id: header.id, digest, status: 'cancelled' as const };
  });
}
function callable(operation: 'status' | 'cancel') {
  return functions.region('europe-west1').https.onCall(async (input, context) => {
    if (!context.auth?.uid) throw fail('unauthenticated');
    try {
      if (!(await consumeServerRateLimit(`uid:${context.auth.uid}`, { bucket: `attachment-recovery-${operation}`, max: operation === 'status' ? 60 : 20, windowMs: 60_000 })).allowed) throw fail('resource-exhausted');
      return operation === 'status' ? await inspectAttachmentUpload(context.auth.uid, input) : await cancelPendingAttachmentUpload(context.auth.uid, input);
    } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
  });
}
export const getAttachmentUploadStatus = callable('status');
export const cancelUnconfirmedAttachmentUpload = callable('cancel');
