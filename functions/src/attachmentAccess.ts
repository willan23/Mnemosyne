/** Legacy attachment reads are session-bound, short-lived and fail closed. */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { consumeServerRateLimit } from './rateLimit';
import { liveAccountInTransaction } from './accountAccess';
if (!admin.apps.length) admin.initializeApp();
export const ATTACHMENT_READ_TTL_MS = 2 * 60 * 1000;
const idOk = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  !/[\\/\u0000-\u001f\u007f]/.test(value) && value !== '.' && value !== '..';

export function ownerUidFromAttachmentPath(objectPath: string): string | null {
  if (typeof objectPath !== 'string' || Buffer.byteLength(objectPath, 'utf8') > 1024 || /[\\\u0000-\u001f\u007f]/.test(objectPath)) return null;
  const parts = objectPath.split('/');
  return parts[0] === 'attachments' && idOk(parts[1]) && parts.length >= 3 &&
    parts.slice(2).every(part => part.length > 0 && part !== '.' && part !== '..') ? parts[1] : null;
}
export function parseStorageObjectPathFromUrl(value: string, expectedBucket?: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password || url.hash) return null;
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
    if (!match || (expectedBucket && decodeURIComponent(match[1]) !== expectedBucket)) return null;
    const path = decodeURIComponent(match[2]);
    return ownerUidFromAttachmentPath(path) ? path : null;
  } catch { return null; }
}
export function sessionAllowsAttachmentRead(data: Record<string, unknown>, uid: string, members?: unknown): boolean {
  if (data.deletedAt != null) return false;
  if (typeof data.teamId === 'string' && data.teamId.length > 0) return Array.isArray(members) && members.includes(uid);
  if (data.teamId != null) return false;
  return data.uid === uid || (Array.isArray(data.sharedWithIds) && data.sharedWithIds.includes(uid));
}
const denied = () => new functions.https.HttpsError('permission-denied', 'Attachment access denied');

/** One consistent authorization snapshot; object ownership never overrides team membership. */
export async function authorizeAttachmentRead(uid: string, objectPath: string, sessionId: string,
  firestore = admin.firestore(), bucket = admin.storage().bucket().name): Promise<void> {
  const namespaceUid = ownerUidFromAttachmentPath(objectPath);
  if (!idOk(uid) || !idOk(sessionId) || !namespaceUid) throw denied();
  await firestore.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, firestore, uid)) throw denied();
    // The path is not ownership proof, but a revoked namespace must never mint new access.
    if (!await liveAccountInTransaction(tx, firestore, namespaceUid, false)) throw denied();
    const [user, session] = await tx.getAll(firestore.doc(`users/${uid}`), firestore.doc(`sessions/${sessionId}`));
    const data = session.data();
    if (!user.exists || user.data()?.deletionState === 'deleting' || !data) throw denied();
    if (!await liveAccountInTransaction(tx, firestore, data.uid, false)) throw denied();
    let members: unknown;
    if (typeof data.teamId === 'string') {
      if (!idOk(data.teamId)) throw denied();
      const [team, deletion] = await tx.getAll(firestore.doc(`teams/${data.teamId}`), firestore.doc(`teamDeletions/${data.teamId}`));
      const value = team.data();
      if (!value || deletion.exists || value.deletionState === 'deleting' || !idOk(value.ownerUid) ||
          !await liveAccountInTransaction(tx, firestore, value.ownerUid, false)) throw denied();
      members = value.memberUids;
    }
    if (!sessionAllowsAttachmentRead(data, uid, members) || !Array.isArray(data.attachments) ||
        !data.attachments.some(item => item && typeof item.url === 'string' && parseStorageObjectPathFromUrl(item.url, bucket) === objectPath)) throw denied();
  });
}
interface AttachmentReadDeps {
  bucket: string;
  now: () => number;
  consumeRate: (uid: string) => Promise<boolean>;
  authorize: (uid: string, path: string, sessionId: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  sign: (path: string, options: { action: 'read'; version: 'v4'; expires: number; responseDisposition: string; responseType: string }) => Promise<string>;
}
const defaultDeps = (): AttachmentReadDeps => {
  const bucket = admin.storage().bucket();
  return { bucket: bucket.name, now: Date.now, authorize: (uid, path, sessionId) => authorizeAttachmentRead(uid, path, sessionId),
    consumeRate: async uid => (await consumeServerRateLimit(`uid:${uid}`, { bucket: 'attachment-read', max: 60, windowMs: 60_000 })).allowed,
    exists: async path => (await bucket.file(path).exists())[0],
    sign: async (path, options) => (await bucket.file(path).getSignedUrl(options))[0] };
};
export async function mintAttachmentReadForUid(input: unknown, uid: string, deps = defaultDeps()) {
  if (!idOk(uid)) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw denied();
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !['sessionId', 'objectPath', 'url'].includes(key)) || !idOk(data.sessionId)) throw denied();
  const path = typeof data.objectPath === 'string' ? data.objectPath :
    parseStorageObjectPathFromUrl(typeof data.url === 'string' ? data.url : '', deps.bucket);
  if (!path || !ownerUidFromAttachmentPath(path)) throw denied();
  try {
    if (!await deps.consumeRate(uid)) throw new functions.https.HttpsError('resource-exhausted', 'Attachment read limit reached');
    await deps.authorize(uid, path, data.sessionId);
    if (!await deps.exists(path)) throw denied();
    const expiresAt = deps.now() + ATTACHMENT_READ_TTL_MS;
    // Legacy bytes have not been content-validated: never open active content as an inline document.
    const url = await deps.sign(path, { action: 'read', version: 'v4', expires: expiresAt,
      responseDisposition: 'attachment; filename="attachment"', responseType: 'application/octet-stream' });
    await deps.authorize(uid, path, data.sessionId);
    return { url, expiresAt, objectPath: path };
  } catch (error) {
    if (error instanceof functions.https.HttpsError && ['permission-denied', 'resource-exhausted'].includes(error.code)) throw error;
    throw new functions.https.HttpsError('unavailable', 'Attachment read unavailable');
  }
}
export const mintAttachmentReadUrl = functions.region('europe-west1').https.onCall(async (data, context) => {
  if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  return mintAttachmentReadForUid(data, context.auth.uid);
});
