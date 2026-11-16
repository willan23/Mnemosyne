import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'node:crypto';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { liveAccountInTransaction } from './accountAccess';
import { consumeServerRateLimit } from './rateLimit';
import { memoriesUsedInCurrentPeriod, nextUsageAfterMemoryCreate } from './usage';
import { clippedMemoryRequestBytes, parseClippedMemoryInput, type ClippedMemoryInput, type ClippedMemoryOutcome } from './clippedMemoryContract';
if (!admin.apps.length) admin.initializeApp();
/** New captures remain closed until callable/rules/usage and device recovery pilots are verified. */
export const CLIP_CAPTURE_ENABLED = false;
export interface ClippedMemoryDeps { firestore: FirebaseFirestore.Firestore; now: () => number }
const defaults = (): ClippedMemoryDeps => ({firestore: admin.firestore(), now: Date.now});
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Clip operation unavailable');
const hash = (input: ClippedMemoryInput) => createHash('sha256').update(clippedMemoryRequestBytes(input)).digest('hex');
/** Uses the existing immutable creation/usage receipts, also covered by account cleanup and client-create denial. */
export async function executeClippedMemory(uid: string, value: unknown, mode: 'create' | 'status' | 'cancel', deps = defaults()): Promise<ClippedMemoryOutcome> {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  let input: ClippedMemoryInput; try { input = parseClippedMemoryInput(value); } catch { throw fail('invalid-argument'); }
  if (!['create','status','cancel'].includes(mode)) throw fail('invalid-argument');
  const db = deps.firestore; const digest = hash(input); const ref = db.doc(`memoryCreationReceipts/${input.sessionId}`);
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
    const [profile, receipt] = await tx.getAll(db.doc(`users/${uid}`), ref);
    if (!profile.exists || profile.data()?.deletionState === 'deleting') throw fail('permission-denied');
    if (receipt.exists) {
      const data = receipt.data()!;
      if (data.v !== 1 || data.kind !== 'clip' || data.uid !== uid || data.teamId !== null || data.sessionId !== input.sessionId || data.digest !== digest ||
          !['committed','cancelled'].includes(data.status) || !Number.isSafeInteger(data.createdAt) || data.createdAt < 1) throw fail('permission-denied');
      if (mode === 'create' && data.status === 'cancelled') throw fail();
      return {sessionId: input.sessionId, digest, status: data.status, createdAt: data.createdAt};
    }
    const unknown: ClippedMemoryOutcome = {sessionId: input.sessionId, digest, status: 'unknown', createdAt: null};
    if (mode === 'status') return unknown;
    const now = deps.now(); if (!Number.isSafeInteger(now) || now < 1) throw fail();
    const [session, counted] = await tx.getAll(db.doc(`sessions/${input.sessionId}`), db.doc(`memoryUsageReceipts/${input.sessionId}`));
    if (session.exists || counted.exists) throw fail('already-exists');
    const result: ClippedMemoryOutcome = {...unknown, status: mode === 'cancel' ? 'cancelled' : 'committed', createdAt: now};
    if (mode === 'create') {
      const [monetization, entitlement] = await tx.getAll(db.doc('config/monetization'), db.doc(`entitlements/${uid}`));
      if (monetization.data()?.mode === 'paid' && !['pro','sovereign'].includes(entitlement.data()?.effectiveTier) &&
          memoriesUsedInCurrentPeriod(profile.data()?.usage, new Date(now)) >= 30) throw fail('resource-exhausted');
      const usage = nextUsageAfterMemoryCreate(profile.data()?.usage, new Date(now));
      tx.create(db.doc(`sessions/${input.sessionId}`), {uid, teamId: null, text: '', title: null, enc: input.enc,
        timestamp: now, updatedAt: now, tags: ['clipped'], category: 'Clip', processingMethod: 'web-clipper',
        embedding: null, connections: [], nodes: null, links: null, creationReceiptId: input.sessionId});
      tx.update(profile.ref, {usage: {...usage, updatedAt: now}});
      tx.create(db.doc(`memoryUsageReceipts/${input.sessionId}`), {v: 1, uid, sessionId: input.sessionId, ...usage, createdAt: now});
    }
    tx.create(ref, {v: 1, kind: 'clip', uid, teamId: null, ...result}); return result;
  });
}
function callable(mode: 'create' | 'status' | 'cancel') {
  return functions.region('europe-west1').https.onCall(async (input, context) => {
    if (!context.auth?.uid) throw fail('unauthenticated');
    // Reject malformed/oversized payloads before spending rate-limit reads.
    try { parseClippedMemoryInput(input); } catch { throw fail('invalid-argument'); }
    if (mode === 'create' && !CLIP_CAPTURE_ENABLED) throw fail();
    try {
      if (!(await consumeServerRateLimit(`uid:${context.auth.uid}`, {bucket: `clip-${mode}`, max: 20, windowMs: 60000})).allowed) throw fail('resource-exhausted');
      return await executeClippedMemory(context.auth.uid, input, mode);
    } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
  });
}
export const createClippedMemory = callable('create');
export const getClippedMemoryStatus = callable('status');
export const cancelClippedMemory = callable('cancel');
