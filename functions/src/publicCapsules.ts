import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'node:crypto';
import { liveAccountInTransaction } from './accountAccess';
import { consumeServerRateLimit } from './rateLimit';
import { publicCapsuleIdValid, publicCapsuleTimeValid, publicCapsuleCountValid, publicCapsuleRecord, capturePublicCapsuleCipher,
  publicCapsuleSourceBytes, capturePublicCapsuleOpening, PUBLIC_CAPSULE_VIEW_WINDOW_MS, type PublicCapsuleSource } from './publicCapsuleContract';

if (!admin.apps.length) admin.initializeApp();
/** New public transport stays closed until budgets, retention and platform pilots are applied. */
export const CAPSULE_PUBLIC_ACCESS_ENABLED = false;
const DAY = 86400000;
export const PUBLIC_CAPSULE_DAILY_REQUESTS = 10000;
export const PUBLIC_CAPSULE_NETWORK_DAILY_REQUESTS = 200;
const fail = (code: functions.https.FunctionsErrorCode = 'not-found') => new functions.https.HttpsError(code, 'Capsule unavailable');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
/** Owner actions bind document creation, so old screens cannot withdraw a replacement. */
export function capsuleOwnerSourceToken(shareId: string, snapshot: FirebaseFirestore.DocumentSnapshot): string {
  const row = snapshot.data(), time = snapshot.createTime;
  if (!row || !publicCapsuleIdValid(shareId) || !publicCapsuleIdValid(row.uid) || !time || !Number.isSafeInteger(time.seconds) || !Number.isSafeInteger(time.nanoseconds)) throw fail();
  return sha(JSON.stringify(['capsule-owner-v1', shareId, row.uid, time.seconds, time.nanoseconds]));
}
export interface PublicCapsuleDeps { firestore: FirebaseFirestore.Firestore; auth: Pick<admin.auth.Auth, 'getUser'>; now: () => number; enabled: () => boolean; admit: () => Promise<boolean>; admitRevoke: (uid: string) => Promise<boolean> }

/** Hard global budget; the network grouping is a heuristic, never an authorization source. */
export async function consumePublicCapsuleBudget(db: FirebaseFirestore.Firestore, networkHint: string, now: number): Promise<boolean> {
  if (!publicCapsuleTimeValid(now)) return false;
  const day = Math.floor(now / DAY), group = typeof networkHint === 'string' && networkHint.length <= 256 ? networkHint : 'unavailable';
  const globalRef = db.doc(`publicCapsuleBudgets/${day}-global`), groupRef = db.doc(`publicCapsuleBudgets/${day}-${sha(`${day}:${group}`)}`);
  try {
    return await db.runTransaction(async tx => {
      const [global, network] = await tx.getAll(globalRef, groupRef);
      const valid = (data: FirebaseFirestore.DocumentData | undefined, scope: string, max: number) => data === undefined ||
        data.v === 1 && data.day === day && data.scope === scope && Number.isSafeInteger(data.requests) && data.requests >= 0 && data.requests <= max;
      const a = global.data(), b = network.data();
      if (!valid(a, 'global', PUBLIC_CAPSULE_DAILY_REQUESTS) || !valid(b, 'network', PUBLIC_CAPSULE_NETWORK_DAILY_REQUESTS) ||
        (a?.requests ?? 0) >= PUBLIC_CAPSULE_DAILY_REQUESTS || (b?.requests ?? 0) >= PUBLIC_CAPSULE_NETWORK_DAILY_REQUESTS) return false;
      const expiresAt = admin.firestore.Timestamp.fromMillis((day + 3) * DAY);
      tx.set(globalRef, { v: 1, day, scope: 'global', requests: (a?.requests ?? 0) + 1, expiresAt });
      tx.set(groupRef, { v: 1, day, scope: 'network', requests: (b?.requests ?? 0) + 1, expiresAt });
      return true;
    });
  } catch { return false; }
}
const defaults = (networkHint: string): PublicCapsuleDeps => ({ firestore: admin.firestore(), auth: admin.auth(), now: Date.now,
  enabled: () => CAPSULE_PUBLIC_ACCESS_ENABLED, admit: () => consumePublicCapsuleBudget(admin.firestore(), networkHint, Date.now()),
  admitRevoke: async uid => (await consumeServerRateLimit(`uid:${uid}`, { bucket: 'capsule-revoke', max: 120, windowMs: 60000 })).allowed });

function source(shareId: string, snapshot: FirebaseFirestore.DocumentSnapshot, now: number): { ownerUid: string; public: PublicCapsuleSource } {
  const data = snapshot.data(), created = snapshot.createTime;
  if (!data || data.encrypted !== true || !publicCapsuleIdValid(data.uid) || data.revokedAt != null || !created ||
    !Number.isSafeInteger(created.seconds) || !Number.isSafeInteger(created.nanoseconds) ||
    data.expiresAt != null && (!publicCapsuleTimeValid(data.expiresAt) || data.expiresAt <= now)) throw fail();
  let ciphertext; try { ciphertext = capturePublicCapsuleCipher(data.ciphertext); } catch { throw fail(); }
  const generation = sha(JSON.stringify(['mnemosyne-capsule-generation-v1', shareId, data.uid,
    publicCapsuleIdValid(data.sessionId) ? data.sessionId : null, created.seconds, created.nanoseconds]));
  const output: PublicCapsuleSource = { v: 1, shareId, generation, ciphertext, createdAt: publicCapsuleTimeValid(data.createdAt) ? data.createdAt : null,
    expiresAt: data.expiresAt ?? null, views: publicCapsuleCountValid(data.views) ? data.views : null,
    viewDeadline: now + PUBLIC_CAPSULE_VIEW_WINDOW_MS, sourceDigest: '0'.repeat(64) };
  output.sourceDigest = sha(publicCapsuleSourceBytes(output));
  return { ownerUid: data.uid, public: output };
}
async function liveSource(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, shareId: string, now: number) {
  const value = source(shareId, await tx.get(db.doc(`shares/${shareId}`)), now);
  if (!await liveAccountInTransaction(tx, db, value.ownerUid, false)) throw fail();
  return value;
}
async function ownerAuth(uid: string, deps: PublicCapsuleDeps) {
  try { const user = await deps.auth.getUser(uid); if (user.uid !== uid || user.disabled) throw Error(); } catch { throw fail(); }
}
async function admit(deps: PublicCapsuleDeps) {
  if (!deps.enabled()) throw fail('failed-precondition');
  if (!publicCapsuleTimeValid(deps.now()) || !await deps.admit()) throw fail('resource-exhausted');
}
function shareRequest(value: unknown): string {
  let row: Record<string, unknown>; try { row = publicCapsuleRecord(value, ['v', 'shareId']); } catch { throw fail('invalid-argument'); }
  if (row.v !== 1 || !publicCapsuleIdValid(row.shareId)) throw fail('invalid-argument'); return row.shareId;
}
export async function executeGetPublicCapsule(value: unknown, deps: PublicCapsuleDeps) {
  const shareId = shareRequest(value); await admit(deps);
  const initial = await deps.firestore.runTransaction(tx => liveSource(tx, deps.firestore, shareId, deps.now()));
  await ownerAuth(initial.ownerUid, deps);
  return deps.firestore.runTransaction(async tx => {
    const fresh = await liveSource(tx, deps.firestore, shareId, deps.now());
    if (fresh.ownerUid !== initial.ownerUid || fresh.public.sourceDigest !== initial.public.sourceDigest) throw fail();
    return fresh.public;
  });
}
export async function executeRecordCapsuleOpening(value: unknown, deps: PublicCapsuleDeps) {
  let input; try { input = capturePublicCapsuleOpening(value); } catch { throw fail('invalid-argument'); }
  await admit(deps);
  const initial = await deps.firestore.runTransaction(tx => liveSource(tx, deps.firestore, input.shareId, deps.now()));
  if (initial.public.sourceDigest !== input.sourceDigest) throw fail('failed-precondition'); await ownerAuth(initial.ownerUid, deps);
  return deps.firestore.runTransaction(async tx => {
    const now = deps.now(), current = await liveSource(tx, deps.firestore, input.shareId, now), publicSource = current.public;
    if (current.ownerUid !== initial.ownerUid || publicSource.sourceDigest !== input.sourceDigest) throw fail('failed-precondition');
    const receiptRef = deps.firestore.doc(`shares/${input.shareId}/capsuleOpenings/${sha(input.openingId)}`), receipt = (await tx.get(receiptRef)).data();
    const commandDigest = sha(JSON.stringify([input.v, input.shareId, input.openingId, input.sourceDigest, input.viewDeadline]));
    if (!publicCapsuleCountValid(publicSource.views)) throw fail('failed-precondition');
    const result = { ...input, counted: true, changed: false, currentViews: publicSource.views };
    if (receipt) {
      if (receipt.v !== 1 || receipt.commandDigest !== commandDigest || receipt.sourceDigest !== input.sourceDigest ||
        !publicCapsuleCountValid(receipt.viewCountAtCommit) || publicSource.views < receipt.viewCountAtCommit) throw fail('failed-precondition');
      return result;
    }
    if (input.viewDeadline <= now || input.viewDeadline > now + PUBLIC_CAPSULE_VIEW_WINDOW_MS || publicSource.views >= Number.MAX_SAFE_INTEGER) throw fail('failed-precondition');
    const next = publicSource.views + 1;
    tx.create(receiptRef, { v: 1, commandDigest, sourceDigest: input.sourceDigest, viewCountAtCommit: next, createdAt: now,
      expiresAt: admin.firestore.Timestamp.fromMillis(input.viewDeadline + DAY) });
    tx.update(deps.firestore.doc(`shares/${input.shareId}`), { views: next, lastViewedAt: now });
    return { ...result, changed: true, currentViews: next };
  });
}
export async function executeRevokePublicCapsule(uid: string, value: unknown, deps: PublicCapsuleDeps) {
  let row; try { row = publicCapsuleRecord(value, ['v', 'actorUid', 'shareId', 'sourceToken']); } catch { throw fail('invalid-argument'); }
  if (!publicCapsuleIdValid(uid) || row.v !== 2 || !publicCapsuleIdValid(row.shareId) || typeof row.sourceToken !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceToken)) throw fail('invalid-argument');
  const shareId = row.shareId, sourceToken = row.sourceToken;
  if (row.actorUid !== uid) throw fail('permission-denied'); await ownerAuth(uid, deps);
  if (!await deps.admitRevoke(uid)) throw fail('resource-exhausted');
  return deps.firestore.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, deps.firestore, uid, false)) throw fail();
    const ref = deps.firestore.doc(`shares/${shareId}`), snapshot = await tx.get(ref), data = snapshot.data(); if (!data || data.uid !== uid) throw fail();
    if (capsuleOwnerSourceToken(shareId, snapshot) !== sourceToken) throw fail('failed-precondition');
    if (data.revokedAt != null) return { v: 2, actorUid: uid, shareId, sourceToken, revoked: true, changed: false };
    const now = deps.now(); if (!publicCapsuleTimeValid(now)) throw fail();
    tx.update(ref, { revokedAt: now }); return { v: 2, actorUid: uid, shareId, sourceToken, revoked: true, changed: true };
  });
}
const regional = functions.runWith({ maxInstances: 3, timeoutSeconds: 30, memory: '256MB' }).region('europe-west1');
export const getPublicCapsule = regional.https.onCall((value, context) => executeGetPublicCapsule(value, defaults(context.rawRequest.ip || 'unavailable')));
export const recordCapsuleOpening = regional.https.onCall((value, context) => executeRecordCapsuleOpening(value, defaults(context.rawRequest.ip || 'unavailable')));
export const revokePublicCapsule = regional.https.onCall((value, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated'); return executeRevokePublicCapsule(context.auth.uid, value, defaults('unused'));
});
