import * as admin from 'firebase-admin';
import { liveAccountInTransaction } from './accountAccess';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'node:crypto';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { canonicalAttachedMemoryJson, parseAttachedMemoryInput, parseAttachedMemoryCommand, type AttachedMemoryInput } from './attachedMemoryContract';
import { attachmentDescriptor, readAttachmentUploadRecord, touchAttachmentReference } from './attachmentUploads';
import { consumeServerRateLimit } from './rateLimit';
import { TEAM_WRITES_ENABLED } from './teams';
import { memoriesUsedInCurrentPeriod, nextUsageAfterMemoryCreate } from './usage';
if (!admin.apps.length) admin.initializeApp();
export const ATTACHED_MEMORY_CREATION_ENABLED = false;
export const PERSONAL_MEMORY_CREATION_ENABLED = false;
export interface AttachedMemoryDeps { firestore: FirebaseFirestore.Firestore; now: () => number; teamWritesEnabled: boolean }
const defaults = (): AttachedMemoryDeps => ({ firestore: admin.firestore(), now: Date.now, teamWritesEnabled: TEAM_WRITES_ENABLED });
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Attached memory creation unavailable');
interface Outcome { sessionId: string; digest: string; status: 'committed' | 'cancelled' | 'unknown' | 'revoked'; createdAt: number | null }
function parsed(value: unknown): AttachedMemoryInput { try { return parseAttachedMemoryInput(value); } catch { throw fail('invalid-argument'); } }
const digest = (input: AttachedMemoryInput) => createHash('sha256').update(canonicalAttachedMemoryJson(input)).digest('hex');
async function actorAccess(tx: FirebaseFirestore.Transaction, uid: string, deps: AttachedMemoryDeps) {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  const db = deps.firestore;
  if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
  const profile = await tx.get(db.doc(`users/${uid}`));
  if (!profile.exists || profile.data()?.deletionState === 'deleting') throw fail('permission-denied');
  return profile;
}
async function teamAccess(tx: FirebaseFirestore.Transaction, uid: string, input: AttachedMemoryInput, deps: AttachedMemoryDeps) {
  if (input.teamId === null) return { revoked: false as const, team: undefined };
  const [marker, snapshot] = await tx.getAll(deps.firestore.doc(`teamDeletions/${input.teamId}`), deps.firestore.doc(`teams/${input.teamId}`));
  const team = snapshot.data();
  if (marker.exists || team?.status === 'deleting' || team?.deletedAt != null) return { revoked: true as const, team: undefined };
  if (!team || !Array.isArray(team.memberUids) || !attachmentActorIdValid(team.ownerUid) || !team.memberUids.includes(team.ownerUid)) throw fail('permission-denied');
  if (!team.memberUids.includes(uid) || !await liveAccountInTransaction(tx, deps.firestore, team.ownerUid, false)) return { revoked: true as const, team: undefined };
  return { revoked: false as const, team };
}
function outcome(data: FirebaseFirestore.DocumentData | undefined, uid: string, input: AttachedMemoryInput): Outcome {
  const hash = digest(input);
  if (!data) return { sessionId: input.sessionId, digest: hash, status: 'unknown', createdAt: null };
  if (data.v !== 1 || data.uid !== uid || data.sessionId !== input.sessionId || data.digest !== hash || data.teamId !== input.teamId ||
      !['committed', 'cancelled'].includes(data.status) || !Number.isSafeInteger(data.createdAt) || data.createdAt < 1) throw fail('permission-denied');
  return { sessionId: input.sessionId, digest: hash, status: data.status, createdAt: data.createdAt };
}
/** Scope, every ready attachment, initial memory, usage and immutable receipt commit together. */
export async function executeCreateAttachedMemory(uid: string, value: unknown, deps = defaults()): Promise<Outcome> {
  const input = parsed(value); const db = deps.firestore; const receiptRef = db.doc(`memoryCreationReceipts/${input.sessionId}`);
  return db.runTransaction(async tx => {
    const profile = await actorAccess(tx, uid, deps);
    const previous = await tx.get(receiptRef); const known = outcome(previous.data(), uid, input);
    if (known.status !== 'unknown') { if (known.status !== 'committed') throw fail(); return known; }
    const access = await teamAccess(tx, uid, input, deps);
    if (access.revoked) throw fail('permission-denied');
    const team = access.team;
    const [session, config, monetization, entitlement, counted] = await tx.getAll(db.doc(`sessions/${input.sessionId}`), db.doc('config/attachmentSecurity'),
      db.doc('config/monetization'), db.doc(`entitlements/${uid}`), db.doc(`memoryUsageReceipts/${input.sessionId}`));
    if (session.exists || counted.exists) throw fail('already-exists');
    const security = config.data();
    if (input.attachmentIds.length && (security?.writesEnabled !== true || typeof security.bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(security.bucket))) throw fail('permission-denied');
    if (team) {
      const [gate, epoch] = await tx.getAll(db.doc('config/teamSecurity'), db.doc(`teams/${input.teamId}/keyEpochs/${input.keyEpoch}`)); const epochData = epoch.data();
      if (!deps.teamWritesEnabled || gate.data()?.writesEnabled !== true || !team.wrappedKeys?.[uid] || team.keyRotationStatus !== 'active' || team.pendingRotationId != null ||
          team.activeKeyEpoch !== input.keyEpoch || team.activeKeyId !== input.keyId || epochData?.status !== 'active' || epochData?.epoch !== input.keyEpoch ||
          epochData?.keyId !== input.keyId || !Array.isArray(epochData?.memberUids) || !epochData.memberUids.includes(uid) || !epochData.wrappedKeys?.[uid]) throw fail('permission-denied');
    }
    const now = deps.now(); if (!Number.isSafeInteger(now) || now < 1) throw fail();
    if (monetization.data()?.mode === 'paid') {
      if (input.attachmentIds.length && entitlement.data()?.canUploadAttachments !== true) throw fail('permission-denied');
      if (!['pro', 'sovereign'].includes(entitlement.data()?.effectiveTier) && memoriesUsedInCurrentPeriod(profile.data()?.usage, new Date(now)) >= 30) throw fail('resource-exhausted');
    }
    const snapshots = input.attachmentIds.length ? await tx.getAll(...input.attachmentIds.map(id => db.doc(`attachmentUploads/${id}`))) : [];
    const records = snapshots.map((snapshot, i) => {
      const record = readAttachmentUploadRecord(snapshot.data(), input.attachmentIds[i]); const scope = record.header.scope;
      if (record.status !== 'ready' || record.bucket !== security?.bucket || (input.teamId === null ? scope.kind !== 'personal' || scope.uid !== uid :
          scope.kind !== 'team' || scope.teamId !== input.teamId || scope.keyEpoch !== input.keyEpoch || scope.keyId !== input.keyId)) throw fail('permission-denied');
      return record;
    });
    for (const uploader of new Set(records.map(record => record.uid))) {
      if (!await liveAccountInTransaction(tx, db, uploader, false)) throw fail('permission-denied');
    }
    const related = [...new Set([...(input.metadata.connections as string[] | null ?? []), ...(typeof input.metadata.parentId === 'string' ? [input.metadata.parentId] : [])])];
    if (related.length) {
      const parents = await tx.getAll(...related.map(id => db.doc(`sessions/${id}`)));
      if (parents.some(parent => !parent.exists || parent.data()?.deletedAt != null || parent.data()?.teamId !== null || parent.data()?.uid !== uid)) throw fail('permission-denied');
    }
    const usage = nextUsageAfterMemoryCreate(profile.data()?.usage, new Date(now));
    const result: Outcome = { sessionId: input.sessionId, digest: digest(input), status: 'committed', createdAt: now };
    records.forEach(record => touchAttachmentReference(tx, db, record, now));
    tx.create(db.doc(`sessions/${input.sessionId}`), { ...input.metadata, uid, teamId: input.teamId, ...(team ? { keyEpoch: input.keyEpoch, keyId: input.keyId } : {}),
      text: '', title: null, enc: input.enc, timestamp: now, updatedAt: now, attachments: records.map(attachmentDescriptor), creationReceiptId: input.sessionId });
    tx.update(profile.ref, { usage: { ...usage, updatedAt: now } });
    tx.create(db.doc(`memoryUsageReceipts/${input.sessionId}`), { v: 1, uid, sessionId: input.sessionId, ...usage, createdAt: now });
    tx.create(receiptRef, { v: 1, uid, teamId: input.teamId, ...result }); return result;
  });
}
/** Recovery/cancellation works with closed create gates. Receipts remain bound to the exact request. */
export async function inspectOrCancelAttachedMemory(uid: string, value: unknown, cancel: boolean, deps = defaults()): Promise<Outcome> {
  const input = parsed(value); const ref = deps.firestore.doc(`memoryCreationReceipts/${input.sessionId}`);
  return deps.firestore.runTransaction(async tx => {
    await actorAccess(tx, uid, deps); const known = outcome((await tx.get(ref)).data(), uid, input);
    if (known.status !== 'unknown') return known;
    const access = await teamAccess(tx, uid, input, deps);
    // Permanent revocation can end a local request even after its receipt was purged. No receipt or content is created.
    if (access.revoked) return { ...known, status: 'revoked' };
    if (!cancel) return known;
    const now = deps.now(); if (!Number.isSafeInteger(now) || now < 1) throw fail();
    const result: Outcome = { ...known, status: 'cancelled', createdAt: now };
    tx.create(ref, { v: 1, uid, teamId: input.teamId, ...result }); return result;
  });
}
function boundCommand(uid:string,value:unknown){if(!attachmentActorIdValid(uid))throw fail('unauthenticated');let command:ReturnType<typeof parseAttachedMemoryCommand>;try{command=parseAttachedMemoryCommand(value);}catch{throw fail('invalid-argument');}if(command.actorUid!==uid)throw fail('permission-denied');return command.request;}
export async function executeAttachedMemoryCall(uid:string,mode:'attached-create'|'personal-create'|'team-create'|'status'|'cancel',value:unknown,deps=defaults()){
  const request=boundCommand(uid,value);if(!['attached-create','personal-create','team-create','status','cancel'].includes(mode))throw fail('invalid-argument');if(mode==='attached-create'&&request.attachmentIds.length===0||mode==='personal-create'&&(request.teamId!==null||request.attachmentIds.length!==0||Array.isArray(request.metadata.connections)&&request.metadata.connections.length!==0)||mode==='team-create'&&(request.teamId===null||request.attachmentIds.length!==0))throw fail('invalid-argument');return mode==='status'||mode==='cancel'?inspectOrCancelAttachedMemory(uid,request,mode==='cancel',deps):executeCreateAttachedMemory(uid,request,deps);
}
export const createAttachedMemory = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated'); const uid=context.auth.uid,request=boundCommand(uid,input);if (!ATTACHED_MEMORY_CREATION_ENABLED) throw fail();
  try {
    if (request.attachmentIds.length === 0) throw fail('invalid-argument');
    if (!(await consumeServerRateLimit(`uid:${uid}`, { bucket: 'attached-memory-create', max: 20, windowMs: 60000 })).allowed) throw fail('resource-exhausted');
    return await executeCreateAttachedMemory(uid, request);
  } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
/** Text-only personal creation uses its own rollout switch and the same immutable receipt namespace. */
export const createPersonalMemory = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');const uid=context.auth.uid,request=boundCommand(uid,input);if (!PERSONAL_MEMORY_CREATION_ENABLED) throw fail();
  try {
    if (request.teamId !== null || request.attachmentIds.length !== 0 ||
        (Array.isArray(request.metadata.connections) && request.metadata.connections.length)) throw fail('invalid-argument');
    if (!(await consumeServerRateLimit(`uid:${uid}`, { bucket: 'personal-memory-create', max: 20, windowMs: 60000 })).allowed) throw fail('resource-exhausted');
    return await executeCreateAttachedMemory(uid, request);
  } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
/** Text-only team creation shares the existing team switch and immutable creation receipts. */
export const createTeamMemory = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');const uid=context.auth.uid,request=boundCommand(uid,input);
  if (!TEAM_WRITES_ENABLED) throw fail();
  try {
    if (request.teamId===null||request.attachmentIds.length!==0) throw fail('invalid-argument');
    if (!(await consumeServerRateLimit(`uid:${uid}`,{bucket:'team-memory-create',max:20,windowMs:60000})).allowed) throw fail('resource-exhausted');
    return await executeCreateAttachedMemory(uid,request);
  } catch(error) {if(error instanceof functions.https.HttpsError)throw error;throw fail();}
});
export const getAttachedMemoryCreationStatus = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');const uid=context.auth.uid,request=boundCommand(uid,input);
  try {
    if (!(await consumeServerRateLimit(`uid:${uid}`, { bucket: 'attached-memory-status', max: 60, windowMs: 60000 })).allowed) throw fail('resource-exhausted');
    return await inspectOrCancelAttachedMemory(uid, request, false);
  } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
export const cancelAttachedMemoryCreation = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');const uid=context.auth.uid,request=boundCommand(uid,input);
  try {
    if (!(await consumeServerRateLimit(`uid:${uid}`, { bucket: 'attached-memory-cancel', max: 20, windowMs: 60000 })).allowed) throw fail('resource-exhausted');
    return await inspectOrCancelAttachedMemory(uid, request, true);
  } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
