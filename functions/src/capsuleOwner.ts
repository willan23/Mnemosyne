import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { liveAccountInTransaction } from './accountAccess';
import { consumeServerRateLimit } from './rateLimit';
import { capsuleOwnerSourceToken } from './publicCapsules';
import { captureCapsuleOwnerQuery, captureOwnedCapsule } from './capsuleOwnerContract';
import { publicCapsuleCountValid, publicCapsuleTimeValid } from './publicCapsuleContract';
if (!admin.apps.length) admin.initializeApp();
export const CAPSULE_OWNER_READS_PER_DAY = 200;
interface OwnerDeps { firestore: FirebaseFirestore.Firestore; auth: Pick<admin.auth.Auth, 'getUser'>; now: () => number }
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Capsule management unavailable');
const fields = ['uid','createdAt','expiresAt','revokedAt','views','importCount','itemCount'];
const nullableTime = (value: unknown) => publicCapsuleTimeValid(value) ? value : null;
const nullableCount = (value: unknown) => publicCapsuleCountValid(value) ? value : null;
export async function executeGetOwnedCapsules(uid: string, value: unknown, deps: OwnerDeps) {
  let input; try { input = captureCapsuleOwnerQuery(value); } catch { throw fail('invalid-argument'); }
  if (input.actorUid !== uid) throw fail('permission-denied');
  try { const actor = await deps.auth.getUser(uid); if (actor.uid !== uid || actor.disabled) throw Error(); } catch { throw fail('permission-denied'); }
  const db = deps.firestore;
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid, false)) throw fail('permission-denied');
    const now = deps.now(); if (!publicCapsuleTimeValid(now)) throw fail();
    const day = Math.floor(now / 86400000), ref = db.doc(`capsuleOwnerReadBudgets/${uid}_${day}`), budget = (await tx.get(ref)).data();
    if (budget && (budget.v !== 1 || budget.uid !== uid || budget.day !== day || !Number.isSafeInteger(budget.reads) || budget.reads < 0 || budget.reads >= CAPSULE_OWNER_READS_PER_DAY)) throw fail('resource-exhausted');
    let snapshots: FirebaseFirestore.DocumentSnapshot[];
    if (input.shareId) snapshots = [await tx.get(db.doc(`shares/${input.shareId}`))];
    else {
      const query = db.collection('shares').where('uid', '==', uid).orderBy(admin.firestore.FieldPath.documentId()).select(...fields);
      snapshots = (await tx.get((input.after ? query.startAfter(input.after) : query).limit(41))).docs;
    }
    const visible = snapshots.filter(snapshot => snapshot.exists && snapshot.data()?.uid === uid), page = visible.slice(0,40);
    const rows = page.map(snapshot => {
      const row = snapshot.data()!;
      return captureOwnedCapsule({ shareId: snapshot.id, sourceToken: capsuleOwnerSourceToken(snapshot.id, snapshot), createdAt: nullableTime(row.createdAt), expiresAt: nullableTime(row.expiresAt),
        revoked: row.revokedAt != null, revokedAt: nullableTime(row.revokedAt), views: nullableCount(row.views), importCount: nullableCount(row.importCount),
        itemCount: Number.isSafeInteger(row.itemCount) && row.itemCount >= 1 && row.itemCount <= 300 ? row.itemCount : null });
    });
    tx.set(ref, {v:1,uid,day,reads:(budget?.reads ?? 0)+1,expiresAt:admin.firestore.Timestamp.fromMillis((day+3)*86400000)});
    return { v:1, actorUid:uid, rows, nextAfter: visible.length>40 ? page[page.length-1].id : null };
  });
}
export const getOwnedCapsules = functions.runWith({maxInstances:3,timeoutSeconds:30,memory:'256MB'}).region('europe-west1').https.onCall(async(value,context)=>{
  const uid=context.auth?.uid;if(!uid)throw fail('unauthenticated');
  let input;try{input=captureCapsuleOwnerQuery(value);}catch{throw fail('invalid-argument');}if(input.actorUid!==uid)throw fail('permission-denied');
  if(!(await consumeServerRateLimit(`uid:${uid}`,{bucket:'capsule-owner-reads',max:60,windowMs:60000})).allowed)throw fail('resource-exhausted');
  return executeGetOwnedCapsules(uid,input,{firestore:admin.firestore(),auth:admin.auth(),now:Date.now});
});
