/** Encrypted attachment reads are bound to a live session, current ACL and immutable object generation. */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { attachmentActorIdValid, attachmentIdValid, type AttachmentScope } from './attachmentEnvelope';
import { readAttachmentUploadRecord, type UploadRecord } from './attachmentUploads';
import { consumeServerRateLimit } from './rateLimit';
import { liveAccountInTransaction } from './accountAccess';
if (!admin.apps.length) admin.initializeApp();
const denied = () => new functions.https.HttpsError('permission-denied', 'Attachment access denied');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export async function authorizeEncryptedAttachmentRead(uid: string, id: string, sessionId: string,
  firestore = admin.firestore()): Promise<UploadRecord> {
  if (!attachmentActorIdValid(uid) || !attachmentIdValid(id) || !attachmentActorIdValid(sessionId)) throw denied();
  return firestore.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, firestore, uid)) throw denied();
    const [user, session, upload, config] = await tx.getAll(firestore.doc(`users/${uid}`), firestore.doc(`sessions/${sessionId}`),
      firestore.doc(`attachmentUploads/${id}`), firestore.doc('config/attachmentSecurity'));
    const data = session.data(); const security = config.data();
    if (!user.exists || user.data()?.deletionState === 'deleting' || !data || data.deletedAt != null || security?.readsEnabled !== true) throw denied();
    if (!await liveAccountInTransaction(tx, firestore, data.uid, false)) throw denied();
    const record = readAttachmentUploadRecord(upload.data(), id);
    if (!await liveAccountInTransaction(tx, firestore, record.uid, false)) throw denied();
    if (record.status !== 'ready' || security.bucket !== record.bucket || !Array.isArray(data.attachments) ||
        !data.attachments.some(item => item?.url === `mnemosyne-attachment:v1:${id}`)) throw denied();
    const scope = record.header.scope;
    if (scope.kind === 'personal') {
      // A personal file key is wrapped by its owner's vault. Sharing never substitutes a team/other user's key.
      if (data.teamId !== null || data.uid !== scope.uid || uid !== scope.uid) throw denied();
    } else {
      if (data.teamId !== scope.teamId) throw denied();
      const [teamDoc, epochDoc] = await tx.getAll(firestore.doc(`teams/${scope.teamId}`), firestore.doc(`teams/${scope.teamId}/keyEpochs/${scope.keyEpoch}`));
      const team = teamDoc.data(); const epoch = epochDoc.data();
      // Historical epochs are readable by remaining members only when their historical wrap exists.
      if (!team || !epoch || !Array.isArray(team.memberUids) || !team.memberUids.includes(uid) || !team.wrappedKeys?.[uid] ||
          epoch.keyId !== scope.keyId || epoch.epoch !== scope.keyEpoch || !Array.isArray(epoch.memberUids) ||
          !epoch.memberUids.includes(uid) || !epoch.wrappedKeys?.[uid]) throw denied();
    }
    return record;
  });
}
export interface EncryptedAttachmentReadDeps {
  now: () => number; consumeRate: (uid: string) => Promise<boolean>;
  authorize: (uid: string, id: string, sessionId: string) => Promise<UploadRecord>;
  sign: (record: UploadRecord, expiresAt: number) => Promise<string>;
}
const defaultDeps = (): EncryptedAttachmentReadDeps => ({ now: Date.now,
  consumeRate: async uid => (await consumeServerRateLimit(`uid:${uid}`, { bucket: 'encrypted-attachment-read', max: 60, windowMs: 60_000 })).allowed,
  authorize: authorizeEncryptedAttachmentRead,
  sign: async (record, expiresAt) => {
    const bucket = admin.storage().bucket(record.bucket); const [bucketMetadata] = await bucket.getMetadata();
    if (bucketMetadata.location?.toLowerCase() !== 'europe-west1' || bucketMetadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true ||
        bucketMetadata.iamConfiguration?.publicAccessPrevention !== 'enforced') throw denied();
    const file = bucket.file(record.publishedPath, { generation: record.storageGeneration }); const [metadata] = await file.getMetadata();
    if (String(metadata.generation) !== record.storageGeneration || Number(metadata.size) !== record.bytes || metadata.contentType !== 'application/octet-stream' ||
        metadata.metadata?.headerDigest !== record.digest || metadata.metadata?.firebaseStorageDownloadTokens || metadata.cacheControl !== 'private, no-store') throw denied();
    return (await file.getSignedUrl({ action: 'read', version: 'v4', expires: expiresAt, queryParams: { generation: record.storageGeneration },
      responseDisposition: 'attachment; filename="attachment.bin"', responseType: 'application/octet-stream' }))[0];
  },
});
export async function mintEncryptedAttachmentReadForUid(input: unknown, uid: string, deps = defaultDeps()) {
  if (!attachmentActorIdValid(uid)) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'id,sessionId') throw denied();
  const data = input as { id: string; sessionId: string };
  if (!attachmentIdValid(data.id) || !attachmentActorIdValid(data.sessionId)) throw denied();
  try {
    if (!await deps.consumeRate(uid)) throw new functions.https.HttpsError('resource-exhausted', 'Attachment read limit reached');
    const before = await deps.authorize(uid, data.id, data.sessionId); const expiresAt = deps.now() + 120_000;
    const url = await deps.sign(before, expiresAt); const after = await deps.authorize(uid, data.id, data.sessionId);
    if (deps.now() >= expiresAt || before.bucket !== after.bucket || before.digest !== after.digest || before.storageGeneration !== after.storageGeneration ||
        !same(before.header.scope, after.header.scope)) throw denied();
    return { id: data.id, uid: before.uid, scope: before.header.scope as AttachmentScope, bytes: before.bytes, bucket: before.bucket,
      generation: before.storageGeneration, url, expiresAt };
  } catch (error) {
    if (error instanceof functions.https.HttpsError && ['permission-denied', 'resource-exhausted'].includes(error.code)) throw error;
    throw new functions.https.HttpsError('unavailable', 'Attachment read unavailable');
  }
}
export const mintEncryptedAttachmentReadUrl = functions.region('europe-west1').runWith({ timeoutSeconds: 60, memory: '256MB' }).https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  return mintEncryptedAttachmentReadForUid(input, context.auth.uid);
});
