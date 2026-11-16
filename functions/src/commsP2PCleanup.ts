import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {randomUUID} from 'node:crypto';
import {parseCommsP2PBinding,COMMS_P2P_SESSION_MS,COMMS_P2P_MAX_CANDIDATES} from './commsP2PContract';

if (!admin.apps.length) admin.initializeApp();
export const COMMS_P2P_CLEANUP_ENABLED = false;
export const COMMS_P2P_CLEANUP_PAGE_SIZE = 50;
export interface CommsP2PCleanupDeps {
  firestore: FirebaseFirestore.Firestore;
  now: () => number;
  id: () => string;
}
interface CleanupCursor {expiresAt: number; roomId: string}
interface CleanupState {v: 1; after: CleanupCursor | null; updatedAt: number; revision: string}
const defaults = (): CommsP2PCleanupDeps => ({firestore: admin.firestore(), now: Date.now, id: randomUUID});
const unavailable = () => new Error('P2P cleanup unavailable');
function time(value: unknown): value is number {return Number.isSafeInteger(value) && Number(value) > 0;}
function cursor(value: unknown): CleanupCursor | null {
  if (value === null) return null;
  const row = value as CleanupCursor;
  if (!row || Object.keys(row).sort().join(',') !== 'expiresAt,roomId' || typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt) || row.expiresAt <= 0 ||
      typeof row.roomId !== 'string' || !row.roomId || Buffer.byteLength(row.roomId, 'utf8') > 1500 ||
      row.roomId.includes('/') || ['.', '..'].includes(row.roomId)) throw unavailable();
  return {...row};
}
function state(value: FirebaseFirestore.DocumentData | undefined): CleanupState | null {
  if (value === undefined) return null;
  if (Object.keys(value).sort().join(',') !== 'after,revision,updatedAt,v' || value.v !== 1 ||
      !time(value.updatedAt) || typeof value.revision !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(value.revision)) throw unavailable();
  return {v: 1, after: cursor(value.after), revision: value.revision, updatedAt: value.updatedAt};
}

/** Delete only a validated, expired v2 room and its two bounded candidate collections.
 * Receipts and budgets remain historical; no authority, account or quota is recreated. */
export async function cleanupExpiredCommsP2PRoom(roomId: string, deps = defaults()): Promise<boolean> {
  if (typeof roomId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(roomId)) return false;
  const now = deps.now(); if (!time(now)) throw unavailable();
  const ref = deps.firestore.doc(`p2pRooms/${roomId}`);
  return deps.firestore.runTransaction(async tx => {
    const snapshot = await tx.get(ref), data = snapshot.data();
    if (!snapshot.exists || data?.v !== 2) return false;
    parseCommsP2PBinding({roomId, actorUid: data.callerId, callerUid: data.callerId, calleeUid: data.calleeId,
      callerFingerprint: data.callerFingerprint, calleeFingerprint: data.calleeFingerprint, offerDigest: data.offerDigest});
    if (!time(data.createdAt) || !time(data.updatedAt) || data.updatedAt < data.createdAt || data.updatedAt > now ||
        !time(data.expiresAt) || data.expiresAt !== data.createdAt + COMMS_P2P_SESSION_MS ||
        !['offer', 'active', 'closed'].includes(data.status) ||
        ['callerCandidateCount', 'calleeCandidateCount'].some(key => !Number.isSafeInteger(data[key]) ||
          data[key] < 0 || data[key] > COMMS_P2P_MAX_CANDIDATES)) throw unavailable();
    if (data.expiresAt > now) return false;
    const pages = await Promise.all(['callerCandidates', 'calleeCandidates'].map(name =>
      tx.get(ref.collection(name).limit(COMMS_P2P_MAX_CANDIDATES + 1))));
    if (pages.some(page => page.size > COMMS_P2P_MAX_CANDIDATES)) throw unavailable();
    for (const page of pages) for (const item of page.docs) tx.delete(item.ref);
    tx.delete(ref);
    return true;
  });
}

/** A durable cursor advances past retained/malformed rows so they cannot starve
 * later rooms. Overlapping runs can repeat work; CAS prevents regressing progress. */
export async function runCommsP2PExpiryCleanup(deps = defaults()) {
  const now = deps.now(); if (!time(now)) throw unavailable();
  const db = deps.firestore, stateRef = db.doc('commsP2PCleanup/state');
  const previous = state((await stateRef.get()).data());
  if (previous && previous.updatedAt > now) throw unavailable();
  let query = db.collection('p2pRooms').where('expiresAt', '>', 0).where('expiresAt', '<=', now).orderBy('expiresAt')
    .orderBy(admin.firestore.FieldPath.documentId()).select('expiresAt').limit(COMMS_P2P_CLEANUP_PAGE_SIZE + 1);
  if (previous?.after) query = query.startAfter(previous.after.expiresAt, previous.after.roomId);
  const page = await query.get(), rows = page.docs.slice(0, COMMS_P2P_CLEANUP_PAGE_SIZE);
  let deleted = 0, retained = 0, failed = 0;
  for (const row of rows) {
    try {if (await cleanupExpiredCommsP2PRoom(row.id, deps)) deleted++; else retained++;}
    catch {failed++;}
  }
  const last = rows.at(-1), after = page.size > COMMS_P2P_CLEANUP_PAGE_SIZE && last ?
    cursor({expiresAt: last.data().expiresAt, roomId: last.id}) : null;
  const revision = deps.id(); if (!/^[a-f0-9-]{36}$/.test(revision)) throw unavailable();
  const cursorAdvanced = await db.runTransaction(async tx => {
    const observed = state((await tx.get(stateRef)).data());
    if (JSON.stringify(observed) !== JSON.stringify(previous)) return false;
    tx.set(stateRef, {v: 1, after, updatedAt: now, revision});
    return true;
  });
  return {scanned: rows.length, deleted, retained, failed, cursorAdvanced, more: after !== null};
}

export const cleanupCommsP2PExpiry = functions.region('europe-west1')
  .runWith({timeoutSeconds: 120, memory: '256MB'})
  .pubsub.schedule('every 5 minutes').timeZone('Europe/Lisbon').onRun(async () => {
    if (!COMMS_P2P_CLEANUP_ENABLED) return;
    const result = await runCommsP2PExpiryCleanup();
    // Only aggregate counters; no room IDs, SDP, candidates, users or payloads.
    if (result.failed) console.warn('P2P expiry cleanup requires retry', {failed: result.failed});
  });
