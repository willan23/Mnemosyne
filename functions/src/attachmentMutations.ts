import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'node:crypto';
import { attachmentActorIdValid, attachmentIdValid } from './attachmentEnvelope';
import { attachmentSessionRevision, attachmentSessionStateBytes, opaqueAttachmentId, parseAttachmentMutationInput, type AttachmentMutationInput } from './attachmentMutationContract';
import { attachmentDescriptor, readAttachmentUploadRecord, touchAttachmentReference, type UploadRecord } from './attachmentUploads';
import { consumeServerRateLimit } from './rateLimit';
import { TEAM_WRITES_ENABLED } from './teams';
import { liveAccountInTransaction } from './accountAccess';
if (!admin.apps.length) admin.initializeApp();
export const ATTACHMENT_ASSOCIATIONS_ENABLED = false;
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Attachment mutation unavailable');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const versionFields = ['tags', 'category', 'attachments', 'embedding', 'embeddingModel', 'connections', 'semanticClusterId', 'position', 'importance', 'celestialType', 'processingMethod', 'connectionChange'];
export interface AttachmentMutationDeps { firestore: FirebaseFirestore.Firestore; now: () => number; teamWritesEnabled: boolean }
const defaults = (): AttachmentMutationDeps => ({ firestore: admin.firestore(), now: Date.now, teamWritesEnabled: TEAM_WRITES_ENABLED });
interface MutationResult { operationId: string; sessionId: string; status: 'committed'; updatedAt: number; versionId: string | null; changed: boolean }
interface CancelledResult { operationId: string; sessionId: string; status: 'cancelled' }
type Receipt = (MutationResult | CancelledResult) & { requestDigest: string };
async function readAccess(tx: FirebaseFirestore.Transaction, uid: string, sessionId: string, deps: AttachmentMutationDeps) {
  const db = deps.firestore;
  if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
  const [user, session, config] = await tx.getAll(db.doc(`users/${uid}`), db.doc(`sessions/${sessionId}`), db.doc('config/attachmentSecurity'));
  const data = session.data();
  if (!user.exists || user.data()?.deletionState === 'deleting' || !data || data.deletedAt != null || !attachmentActorIdValid(data.uid)) throw fail('permission-denied');
  if (!await liveAccountInTransaction(tx, db, data.uid, false)) throw fail('permission-denied');
  let team: FirebaseFirestore.DocumentData | undefined;
  if (data.teamId === null) { if (data.uid !== uid) throw fail('permission-denied'); }
  else {
    if (!attachmentActorIdValid(data.teamId)) throw fail('permission-denied');
    team = (await tx.get(db.doc(`teams/${data.teamId}`))).data();
    if (!team || !Array.isArray(team.memberUids) || !team.memberUids.includes(uid) || !team.wrappedKeys?.[uid]) throw fail('permission-denied');
  }
  return { data, team, config: config.data(), session: session.ref };
}
function readReceipt(value: FirebaseFirestore.DocumentData | undefined, uid: string, operationId: string): Receipt {
  if (!value || value.v !== 1 || value.uid !== uid || value.operationId !== operationId || !['committed', 'cancelled'].includes(value.status) ||
      !attachmentActorIdValid(value.sessionId) || !/^[a-f0-9]{64}$/.test(value.requestDigest)) throw fail('permission-denied');
  if (value.status === 'committed' && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 1 || typeof value.changed !== 'boolean' ||
      value.versionId !== (value.changed ? operationId : null))) throw fail('permission-denied');
  return value as Receipt;
}
function result(receipt: MutationResult): MutationResult;
function result(receipt: CancelledResult): CancelledResult;
function result(receipt: MutationResult | CancelledResult): MutationResult | CancelledResult;
function result(receipt: MutationResult | CancelledResult): MutationResult | CancelledResult {
  if (receipt.status === 'cancelled') return { operationId: receipt.operationId, sessionId: receipt.sessionId, status: 'cancelled' };
  return { operationId: receipt.operationId, sessionId: receipt.sessionId, status: 'committed', updatedAt: receipt.updatedAt, versionId: receipt.versionId, changed: receipt.changed };
}
/** A permanent receipt serializes cancellation against a delayed commit, including when release gates are closed. */
export async function cancelAttachmentMutation(uid: string, value: unknown, deps = defaults()): Promise<MutationResult | CancelledResult> {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  let input: AttachmentMutationInput;
  try { input = parseAttachmentMutationInput(value); } catch { throw fail('invalid-argument'); }
  const requestDigest = hash(JSON.stringify(input)); const ref = deps.firestore.doc(`attachmentMutations/${input.operationId}`);
  return deps.firestore.runTransaction(async tx => {
    await readAccess(tx, uid, input.sessionId, deps); const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      const receipt = readReceipt(snapshot.data(), uid, input.operationId);
      if (receipt.sessionId !== input.sessionId || receipt.requestDigest !== requestDigest) throw fail(); return result(receipt);
    }
    const cancelled: CancelledResult = { operationId: input.operationId, sessionId: input.sessionId, status: 'cancelled' };
    tx.create(ref, { v: 1, uid, requestDigest, ...cancelled, createdAt: deps.now() }); return cancelled;
  });
}
export async function attachmentMutationStatus(uid: string, operationId: string, deps = defaults()) {
  if (!attachmentActorIdValid(uid) || !attachmentIdValid(operationId)) throw fail('invalid-argument');
  return deps.firestore.runTransaction(async tx => {
    const snapshot = await tx.get(deps.firestore.doc(`attachmentMutations/${operationId}`));
    if (!snapshot.exists) {
      const user = await tx.get(deps.firestore.doc(`users/${uid}`));
      if (!user.exists || user.data()?.deletionState === 'deleting') throw fail('permission-denied');
      return { operationId, status: 'unknown' as const };
    }
    const receipt = readReceipt(snapshot.data(), uid, operationId); await readAccess(tx, uid, receipt.sessionId, deps); return result(receipt);
  });
}
/** One transaction binds scope/ready registry, CAS, exact archive, pointers and durable receipt. */
export async function executeAttachmentMutation(uid: string, value: unknown, deps = defaults()): Promise<MutationResult> {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  let input: AttachmentMutationInput;
  try { input = parseAttachmentMutationInput(value); } catch { throw fail('invalid-argument'); }
  const db = deps.firestore; const receiptRef = db.doc(`attachmentMutations/${input.operationId}`); const requestDigest = hash(JSON.stringify(input));
  return db.runTransaction(async tx => {
    const access = await readAccess(tx, uid, input.sessionId, deps); const { data, team, config } = access;
    const oldReceipt = await tx.get(receiptRef);
    if (oldReceipt.exists) {
      const receipt = readReceipt(oldReceipt.data(), uid, input.operationId);
      if (receipt.sessionId !== input.sessionId || receipt.requestDigest !== requestDigest || receipt.status !== 'committed') throw fail(); return result(receipt);
    }
    if (config?.writesEnabled !== true || typeof config.bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(config.bucket)) throw fail('permission-denied');
    if (attachmentSessionRevision(data) !== input.expectedRevision || hash(attachmentSessionStateBytes(input.sessionId, data)) !== input.expectedStateDigest) throw fail('aborted');
    const old = data.attachments ?? [];
    if (!Array.isArray(old) || old.length > 20 || old.some(item => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.url !== 'string')) throw fail();
    if (team) {
      if (!Number.isSafeInteger(team.activeKeyEpoch) || team.activeKeyEpoch < 1 || !attachmentIdValid(team.activeKeyId)) throw fail('permission-denied');
      const [gateDoc, epochDoc] = await tx.getAll(db.doc('config/teamSecurity'), db.doc(`teams/${data.teamId}/keyEpochs/${team.activeKeyEpoch}`));
      const epoch = epochDoc.data();
      if (!deps.teamWritesEnabled || gateDoc.data()?.writesEnabled !== true || team.keyRotationStatus !== 'active' || team.pendingRotationId != null ||
          data.enc?.v !== 2 || data.keyEpoch !== team.activeKeyEpoch || data.keyId !== team.activeKeyId || !epoch || epoch.status !== 'active' ||
          epoch.epoch !== team.activeKeyEpoch || epoch.keyId !== team.activeKeyId || !Array.isArray(epoch.memberUids) || !epoch.memberUids.includes(uid) || !epoch.wrappedKeys?.[uid]) throw fail('permission-denied');
    } else if (data.enc?.v !== 1) throw fail();
    const oldIds = old.map(item => opaqueAttachmentId(item.url)).filter((id): id is string => id !== null);
    if (new Set(oldIds).size !== oldIds.length) throw fail();
    const registryIds = [...new Set([...oldIds, ...input.ids])];
    const snapshots = await tx.getAll(...registryIds.map(id => db.doc(`attachmentUploads/${id}`)));
    const records = new Map<string, UploadRecord>();
    snapshots.forEach((snapshot, index) => {
      const record = readAttachmentUploadRecord(snapshot.data(), registryIds[index]); const scope = record.header.scope;
      if (record.status !== 'ready' || record.bucket !== config.bucket ||
          (data.teamId === null ? scope.kind !== 'personal' || scope.uid !== uid : scope.kind !== 'team' || scope.teamId !== data.teamId)) throw fail('permission-denied');
      records.set(registryIds[index], record);
    });
    if (input.action === 'remove' && input.ids.some(id => !oldIds.includes(id))) throw fail('aborted');
    const additions = input.action === 'add' ? input.ids.filter(id => !oldIds.includes(id)) : [];
    for (const uploader of new Set(additions.map(id => records.get(id)!.uid))) {
      if (!await liveAccountInTransaction(tx, db, uploader, false)) throw fail('permission-denied');
    }
    if (additions.length) {
      const [monetization, entitlement] = await tx.getAll(db.doc('config/monetization'), db.doc(`entitlements/${uid}`));
      if (monetization.data()?.mode === 'paid' && entitlement.data()?.canUploadAttachments !== true) throw fail('permission-denied');
    }
    for (const id of additions) {
      const scope = records.get(id)!.header.scope;
      if (scope.kind === 'team' && (scope.keyEpoch !== data.keyEpoch || scope.keyId !== data.keyId)) throw fail('permission-denied');
    }
    const next = input.action === 'remove' ? old.filter(item => !input.ids.includes(opaqueAttachmentId(item.url) ?? '')) : [...old,
      ...additions.map(id => attachmentDescriptor(records.get(id)!))];
    if (next.length > 20) throw fail('resource-exhausted');
    const changed = input.action === 'add' ? additions.length > 0 : next.length !== old.length;
    const updatedAt = changed ? Math.max(deps.now(), input.expectedRevision + 1) : input.expectedRevision;
    if (!Number.isSafeInteger(updatedAt)) throw fail();
    const versionId = changed ? input.operationId : null;
    const committed: MutationResult = { operationId: input.operationId, sessionId: input.sessionId, status: 'committed', updatedAt, versionId, changed };
    if (changed) {
      records.forEach(record => touchAttachmentReference(tx, db, record, updatedAt));
      const version: FirebaseFirestore.DocumentData = { text: '', title: null, enc: data.enc, previousUpdatedAt: data.updatedAt ?? data.timestamp, createdAt: updatedAt, editorUid: uid,
        ...(team ? { teamId: data.teamId, keyEpoch: data.keyEpoch, keyId: data.keyId } : {}) };
      versionFields.forEach(key => { if (data[key] !== undefined) version[key] = data[key]; });
      tx.create(access.session.collection('versions').doc(versionId!), version);
      tx.update(access.session, { attachments: next, updatedAt, lastVersionId: versionId, lastAttachmentMutationId: input.operationId });
    }
    tx.create(receiptRef, { v: 1, uid, requestDigest, ...committed, createdAt: deps.now() }); return committed;
  });
}
export const mutateSessionAttachments = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated'); if (!ATTACHMENT_ASSOCIATIONS_ENABLED) throw fail();
  try {
    if (!(await consumeServerRateLimit(`uid:${context.auth.uid}`, { bucket: 'attachment-mutate', max: 20, windowMs: 60_000 })).allowed) throw fail('resource-exhausted');
    return await executeAttachmentMutation(context.auth.uid, input);
  } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
export const getAttachmentMutationStatus = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'operationId') throw fail('invalid-argument');
  try {
    if (!(await consumeServerRateLimit(`uid:${context.auth.uid}`, { bucket: 'attachment-status', max: 60, windowMs: 60_000 })).allowed) throw fail('resource-exhausted');
    return await attachmentMutationStatus(context.auth.uid, input.operationId);
  } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
export const cancelSessionAttachmentMutation = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');
  try {
    if (!(await consumeServerRateLimit(`uid:${context.auth.uid}`, { bucket: 'attachment-cancel-mutation', max: 20, windowMs: 60_000 })).allowed) throw fail('resource-exhausted');
    return await cancelAttachmentMutation(context.auth.uid, input);
  } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
