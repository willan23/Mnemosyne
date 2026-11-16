import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'node:crypto';
import { capsuleNoticeIdValid, capsuleNoticeDigestValid, capsuleNoticeSourceBytes } from './capsuleNoticeContract';
import { liveAccountInTransaction } from './accountAccess';
import { consumeServerRateLimit } from './rateLimit';

if (!admin.apps.length) admin.initializeApp();
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Capsule notice unavailable');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const capsuleNoticeSourceDigest = (id: string, value: unknown) => createHash('sha256').update(capsuleNoticeSourceBytes(id, value)).digest('hex');
interface NoticeAcknowledgement { v: 1; actorUid: string; noticeId: string; sourceDigest: string }
export interface CapsuleNoticeDeps {
  firestore: FirebaseFirestore.Firestore;
  auth: Pick<admin.auth.Auth, 'getUser'>;
  now: () => number;
  admit: (uid: string) => Promise<boolean>;
}
const defaults = (): CapsuleNoticeDeps => ({ firestore: admin.firestore(), auth: admin.auth(), now: Date.now,
  admit: async uid => (await consumeServerRateLimit(`uid:${uid}`, { bucket: 'capsule-notice-ack', max: 120, windowMs: 60000 })).allowed });
function commandFor(uid: string, value: unknown): NoticeAcknowledgement {
  if (!capsuleNoticeIdValid(uid)) throw fail('unauthenticated');
  if (!record(value) || Object.keys(value).sort().join(',') !== 'actorUid,noticeId,sourceDigest,v' || value.v !== 1 ||
    !capsuleNoticeIdValid(value.actorUid) || !capsuleNoticeIdValid(value.noticeId) || !capsuleNoticeDigestValid(value.sourceDigest)) throw fail('invalid-argument');
  if (value.actorUid !== uid) throw fail('permission-denied');
  return { v: 1, actorUid: uid, noticeId: value.noticeId, sourceDigest: value.sourceDigest };
}

/** A delivery acknowledgement, not proof that the human read the toast. */
export async function executeCapsuleNoticeAcknowledgement(uid: string, value: unknown, deps = defaults()) {
  const input = commandFor(uid, value);
  try { const user = await deps.auth.getUser(uid); if (user.uid !== uid || user.disabled) throw Error(); }
  catch { throw fail('permission-denied'); }
  if (!await deps.admit(uid)) throw fail('resource-exhausted');
  return deps.firestore.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, deps.firestore, uid)) throw fail('permission-denied');
    const ref = deps.firestore.doc(`capsuleImportNotices/${input.noticeId}`), snapshot = await tx.get(ref), data = snapshot.data();
    if (!data || data.ownerUid !== uid) throw fail('not-found');
    let sourceDigest: string; try { sourceDigest = capsuleNoticeSourceDigest(input.noticeId, data); } catch { throw fail(); }
    if (sourceDigest !== input.sourceDigest) throw fail('failed-precondition');
    const changed = data.read === false;
    if (changed) {
      const now = deps.now(); if (!Number.isSafeInteger(now) || now < data.createdAt) throw fail();
      tx.update(ref, { read: true, readAt: now });
    }
    return { ...input, acknowledged: true, changed };
  });
}

export const acknowledgeCapsuleNotice = functions.runWith({ maxInstances: 3, timeoutSeconds: 30, memory: '128MB' }).region('europe-west1').https.onCall(async (data, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');
  return executeCapsuleNoticeAcknowledgement(context.auth.uid, data);
});
