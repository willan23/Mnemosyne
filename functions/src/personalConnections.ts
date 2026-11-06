import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {parseSyncCipher, syncIdValid, syncInteger} from './mobileSyncImportContract';
import {syncDocumentStateHash} from './mobileSyncImport';
import {MAX_PERSONAL_CONNECTIONS, parsePersonalConnectionPair, parsePersonalConnectionRequest, personalConnectionRequestBytes,
  type PersonalConnectionOutcome, type PersonalConnectionPreparation} from './personalConnectionContract';
if (!admin.apps.length) admin.initializeApp();
/** Opens with client recovery, admission rules and account/vault/device pilots. */
export const PERSONAL_CONNECTION_WRITES_ENABLED = false;
export interface PersonalConnectionDeps {firestore: FirebaseFirestore.Firestore; now: () => number}
const defaults = (): PersonalConnectionDeps => ({firestore:admin.firestore(),now:Date.now});
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code,'Connection operation unavailable');
export function personalConnectionDocument(snapshot: FirebaseFirestore.DocumentSnapshot, uid: string): Record<string,unknown> {
  const data = snapshot.data();
  if (!snapshot.exists || !data || data.uid !== uid || data.teamId !== null || data.teamScopeAmbiguous === true || data.deletedAt != null ||
      (data.sharedWithIds != null && (!Array.isArray(data.sharedWithIds) || data.sharedWithIds.length !== 0))) throw fail('permission-denied');
  if (data.text !== '' || data.title != null || !syncInteger(data.timestamp) || !syncInteger(data.updatedAt ?? data.timestamp)) throw fail();
  try {parseSyncCipher(data.enc);} catch {throw fail();}
  const connections = data.connections ?? [];
  if (!Array.isArray(connections) || connections.length > MAX_PERSONAL_CONNECTIONS || connections.some(id => !syncIdValid(id) || id === snapshot.id) || new Set(connections).size !== connections.length) throw fail();
  return {...data,connections};
}
export async function executePersonalConnectionPreparation(uid: string, value: unknown, deps = defaults()): Promise<PersonalConnectionPreparation> {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  let pair; try {pair = parsePersonalConnectionPair(value);} catch {throw fail('invalid-argument');}
  const db = deps.firestore;
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx,db,uid)) throw fail('permission-denied');
    const [source,target] = await tx.getAll(db.doc(`sessions/${pair.sourceId}`),db.doc(`sessions/${pair.targetId}`));
    personalConnectionDocument(source,uid); personalConnectionDocument(target,uid);
    return {...pair,sourceHash:syncDocumentStateHash(source),targetHash:syncDocumentStateHash(target)};
  });
}
/** The two endpoints, unchanged ciphertext history and immutable outcome share one transaction. */
export async function executePersonalConnection(uid: string, value: unknown, mode: 'apply'|'status'|'cancel', deps = defaults()): Promise<PersonalConnectionOutcome> {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  let input; try {input = parsePersonalConnectionRequest(value);} catch {throw fail('invalid-argument');}
  if (!['apply','status','cancel'].includes(mode)) throw fail('invalid-argument');
  const digest = createHash('sha256').update(personalConnectionRequestBytes(input)).digest('hex');
  const db = deps.firestore; const ref = db.doc(`personalConnectionChanges/${input.operationId}`);
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx,db,uid)) throw fail('permission-denied');
    const receipt = await tx.get(ref);
    if (receipt.exists) {
      const data = receipt.data()!;
      if (data.v !== 1 || data.uid !== uid || data.operationId !== input.operationId || data.digest !== digest ||
          !['committed','cancelled'].includes(data.status) || typeof data.changed !== 'boolean' || (data.status === 'cancelled' && data.changed) || !syncInteger(data.createdAt) || data.createdAt < 1) throw fail('permission-denied');
      if (mode === 'apply' && data.status === 'cancelled') throw fail();
      return {operationId:input.operationId,digest,status:data.status,changed:data.changed,createdAt:data.createdAt};
    }
    const result: PersonalConnectionOutcome = {operationId:input.operationId,digest,status:'unknown',changed:false,createdAt:null};
    if (mode === 'status') return result;
    const now = deps.now(); if (!syncInteger(now) || now < 1) throw fail();
    if (mode === 'cancel') {
      const outcome: PersonalConnectionOutcome = {...result,status:'cancelled',createdAt:now};
      tx.create(ref,{v:1,uid,...outcome}); return outcome;
    }
    const [source,target] = await tx.getAll(db.doc(`sessions/${input.sourceId}`),db.doc(`sessions/${input.targetId}`));
    const before = [personalConnectionDocument(source,uid),personalConnectionDocument(target,uid)];
    if (syncDocumentStateHash(source) !== input.expectedSourceHash || syncDocumentStateHash(target) !== input.expectedTargetHash) throw fail('aborted');
    const snapshots = [source,target]; const peers = [input.targetId,input.sourceId];
    const after = before.map((data,index) => {
      const connections = data.connections as string[]; const has = connections.includes(peers[index]);
      if (has === (input.operation === 'link')) return null;
      const updated = input.operation === 'link' ? [...connections,peers[index]] : connections.filter(id => id !== peers[index]);
      if (updated.length > MAX_PERSONAL_CONNECTIONS) throw fail('resource-exhausted');
      const revision = Math.max(now,Number(data.updatedAt ?? data.timestamp)+1); if (!syncInteger(revision)) throw fail();
      return {connections:updated,updatedAt:revision};
    });
    const historyId = 'connection-' + createHash('sha256').update(input.operationId).digest('hex');
    const historyRefs = snapshots.map(snapshot => snapshot.ref.collection('versions').doc(historyId));
    const histories = await tx.getAll(...historyRefs);
    if (histories.some((history,index) => after[index] && history.exists)) throw fail('already-exists');
    const outcome: PersonalConnectionOutcome = {...result,status:'committed',changed:after.some(Boolean),createdAt:now};
    for (let index=0;index<2;index++) {
      const changed = after[index]; if (!changed) continue;
      const old = snapshots[index].data()!;
      // Preserve the complete previous document, including encrypted attachments and imported metadata.
      tx.create(historyRefs[index],{...old,previousUpdatedAt:old.updatedAt ?? old.timestamp,createdAt:changed.updatedAt,editorUid:uid});
      tx.update(snapshots[index].ref,changed);
    }
    tx.create(ref,{v:1,uid,...outcome}); return outcome;
  });
}
function callable(mode: 'prepare'|'apply'|'status'|'cancel') {
  return functions.region('europe-west1').https.onCall(async (value,context) => {
    if (!context.auth?.uid) throw fail('unauthenticated');
    try {if (mode === 'prepare') parsePersonalConnectionPair(value); else parsePersonalConnectionRequest(value);} catch {throw fail('invalid-argument');}
    if (mode === 'apply' && !PERSONAL_CONNECTION_WRITES_ENABLED) throw fail();
    try {
      if (!(await consumeServerRateLimit(`uid:${context.auth.uid}`,{bucket:`personal-connection-${mode}`,max:60,windowMs:60000})).allowed) throw fail('resource-exhausted');
      return mode === 'prepare' ? await executePersonalConnectionPreparation(context.auth.uid,value) : await executePersonalConnection(context.auth.uid,value,mode);
    } catch (error) {if (error instanceof functions.https.HttpsError) throw error; throw fail();}
  });
}
export const preparePersonalConnection = callable('prepare');
export const applyPersonalConnection = callable('apply');
export const getPersonalConnectionStatus = callable('status');
export const cancelPersonalConnection = callable('cancel');
