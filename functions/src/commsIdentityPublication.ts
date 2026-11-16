import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import {createHash, createPublicKey} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {parseCommsIdentityPublication, type CommsIdentityPublicationOutcome} from './commsIdentityPublicationContract';

if (!admin.apps.length) admin.initializeApp();
export const COMMS_IDENTITY_PUBLICATION_ENABLED = false;
export interface CommsIdentityPublicationDeps {firestore: FirebaseFirestore.Firestore; auth: Pick<admin.auth.Auth, 'getUser'>; enabled: () => boolean}
const defaults = (): CommsIdentityPublicationDeps => ({firestore: admin.firestore(), auth: admin.auth(), enabled: () => COMMS_IDENTITY_PUBLICATION_ENABLED});
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Comms identity publication unavailable');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function keyFingerprint(pem: string) {
  try {
    const key = createPublicKey(pem), bits = key.asymmetricKeyDetails?.modulusLength;
    if (key.asymmetricKeyType !== 'rsa' || !bits || bits < 2048 || bits > 4096 || key.asymmetricKeyDetails?.publicExponent !== BigInt(65537) ||
      pem !== `-----BEGIN PUBLIC KEY-----\n${key.export({type: 'spki', format: 'der'}).toString('base64')}\n-----END PUBLIC KEY-----`) throw Error();
  } catch {throw fail('invalid-argument');}
  return hash(pem);
}
function commandFor(uid: string, value: unknown) {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  let input; try {input = parseCommsIdentityPublication(value);} catch {throw fail('invalid-argument');}
  if (input.actorUid !== uid) throw fail('permission-denied');
  return input;
}
/** Public identity metadata only. A current pair can be confirmed while publication gates remain closed. */
export async function executeCommsIdentityPublication(uid: string, value: unknown, deps = defaults()): Promise<CommsIdentityPublicationOutcome> {
  const input = commandFor(uid, value), fingerprint = keyFingerprint(input.publicKeyPem);
  let user: admin.auth.UserRecord;
  try {user = await deps.auth.getUser(uid); if (user.uid !== uid || user.disabled) throw Error();} catch {throw fail('permission-denied');}
  const displayName = (user.displayName || user.email?.split('@')[0] || `mnemosyne-${uid.slice(0, 8)}`).slice(0, 120), emailHash = user.email ? hash(user.email.trim().toLowerCase()) : null;
  const db = deps.firestore;
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid, false)) throw fail('permission-denied');
    const userRef = db.doc(`users/${uid}`), profileRef = db.doc(`publicProfiles/${uid}`), [privateRow, publicRow] = await tx.getAll(userRef, profileRef);
    const privateData = privateRow.data(), publicData = publicRow.data();
    for (const data of [privateData, publicData]) {
      if (data?.uid != null && data.uid !== uid) throw fail('permission-denied');
      if (data?.publicKeyPem != null && data.publicKeyPem !== input.publicKeyPem) throw fail('already-exists');
    }
    const current = privateRow.exists && publicRow.exists && privateData?.publicKeyPem === input.publicKeyPem && publicData?.uid === uid && publicData?.publicKeyPem === input.publicKeyPem;
    const result: CommsIdentityPublicationOutcome = {v: 1, uid, fingerprint, status: current ? 'current' : 'unpublished', changed: false};
    if (input.mode === 'check' || !deps.enabled()) return result;
    const repairIdentity = !current || privateData?.uid !== uid || !privateData?.publicKeyUpdatedAt || !publicData?.publicKeyUpdatedAt;
    const refreshMetadata = publicData?.displayName !== displayName || publicData?.emailHash !== emailHash;
    if (!repairIdentity && !refreshMetadata) return result;
    if (repairIdentity) {
      const publicKeyUpdatedAt = FieldValue.serverTimestamp();
      tx.set(userRef, {uid, publicKeyPem: input.publicKeyPem, publicKeyUpdatedAt}, {merge: true});
      tx.set(profileRef, {uid, publicKeyPem: input.publicKeyPem, publicKeyUpdatedAt, displayName, emailHash}, {merge: true});
    } else tx.set(profileRef, {displayName, emailHash}, {merge: true});
    return {...result, status: 'current', changed: true};
  });
}
export const publishCommsIdentityKey = functions.region('europe-west1').https.onCall(async (value, context) => {
  const uid = context.auth?.uid; if (!uid) throw fail('unauthenticated');
  const input = commandFor(uid, value);
  try {
    if (!(await consumeServerRateLimit(`uid:${uid}`, {bucket: 'comms-identity-publication', max: 30, windowMs: 60000})).allowed) throw fail('resource-exhausted');
    return await executeCommsIdentityPublication(uid, input);
  } catch (error) {if (error instanceof functions.https.HttpsError) throw error; throw fail();}
});
