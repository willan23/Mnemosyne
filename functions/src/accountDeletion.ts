import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import type { Bucket } from '@google-cloud/storage';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { createAttachmentObjectStore, purgeAccountAttachmentUploads, purgeOwnedTeamAttachmentUploads, type AttachmentUploadDeps } from './attachmentUploads';
import { cancelStripeBillingForUser } from './stripe';
import { stripeSecretKey } from './params';
import { purgeUserTeamMemberships } from './teams';
import { deleteAccountQuery, deleteAccountDocumentTree, purgeSessions, TEAM_BOUND_COLLECTIONS, cancelDeletedTeamCreationRequests } from './documentDeletion';
import { completeOwnedTeamDeletionMarker } from './teamDeletionContract';
import { accountDeletionRecoveryTokenValid } from './accountDeletionRecoveryContract';
import { clientKeyFromRequest, consumeServerRateLimit } from './rateLimit';
export { deleteAccountQuery, deleteAccountDocumentTree } from './documentDeletion';
if (!admin.apps.length) admin.initializeApp();
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Account deletion unavailable; retry retains the deletion request');
const LEASE_MS = 10 * 60_000; // Longer than the callable's maximum execution time.
/** Opening requires the remaining shared-write/legacy migration and retention gates to be verified. */
export const ACCOUNT_DELETION_ENABLED = false;
type Phase = 'freeze-teams' | 'objects' | 'documents' | 'auth' | 'complete';
export interface AccountDeletionResult { uid: string; status: 'pending' | 'complete'; retryAt: number | null }
export interface AccountDeletionDeps {
  firestore: FirebaseFirestore.Firestore; now: () => number; attachments: AttachmentUploadDeps;
  cancelBilling: (uid: string) => Promise<void>;
  purgeLegacyObjects: (uid: string) => Promise<boolean>;
  deleteAuth: (uid: string) => Promise<void>;
  purgeMemberships: (uid: string) => Promise<number>;
}
export function parseAccountDeletionInput(uid: string, input: unknown) {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['uid', 'recoveryToken,uid'].includes(Object.keys(input).sort().join(',')) ||
      !attachmentActorIdValid((input as { uid: unknown }).uid) ||
      ('recoveryToken' in input && !accountDeletionRecoveryTokenValid((input as { recoveryToken: unknown }).recoveryToken))) throw fail('invalid-argument');
  if ((input as { uid: string }).uid !== uid) throw fail('permission-denied');
  return uid;
}
export function accountDeletionRecoveryDigest(uid: string, token: string) {
  if (!attachmentActorIdValid(uid) || !accountDeletionRecoveryTokenValid(token)) throw fail('invalid-argument');
  return createHash('sha256').update(`mnemosyne:account-deletion-recovery:v1\0${uid}\0${token}`).digest('hex');
}
function readRecoveryHashes(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8 || value.some(hash => !accountDeletionRecoveryTokenValid(hash)) || new Set(value).size !== value.length) throw fail();
  return value;
}
function readPhase(data: FirebaseFirestore.DocumentData | undefined): Phase {
  if (!data || data.v !== 1 || !['freeze-teams', 'objects', 'documents', 'auth', 'complete'].includes(data.phase) ||
      (data.status !== 'deleting' && data.status !== 'complete') || (data.phase === 'complete') !== (data.status === 'complete')) throw fail();
  return data.phase;
}
/** Remove the deleted account's wraps from every valid historical epoch, including epochs older than the current removal rotation. */
export async function purgeHistoricalAccountWraps(uid: string, db: FirebaseFirestore.Firestore) {
  if (!attachmentActorIdValid(uid)) throw fail('invalid-argument');
  const query = () => db.collectionGroup('keyEpochs').where('memberUids', 'array-contains', uid);
  for (let page = 0; page < 20; page++) {
    const rows = await query().limit(50).get(); if (rows.empty) return;
    for (const row of rows.docs) await db.runTransaction(async tx => {
      const fresh = await tx.get(row.ref); const value = fresh.data();
      if (!value || !/^teams\/[^/]+\/keyEpochs\/[^/]+$/.test(row.ref.path) || !Array.isArray(value.memberUids) ||
          !value.wrappedKeys || typeof value.wrappedKeys !== 'object' || Array.isArray(value.wrappedKeys)) throw fail();
      if (!value.memberUids.includes(uid)) return;
      const wrappedKeys = { ...value.wrappedKeys }; delete wrappedKeys[uid];
      tx.update(row.ref, { memberUids: value.memberUids.filter((member: unknown) => member !== uid), wrappedKeys });
    });
  }
  if (!(await query().limit(1).get()).empty) throw fail('resource-exhausted');
}
const uidCollections = ['shares', 'capsulePublications', 'capsulePublicationBudgets', 'capsuleOwnerReadBudgets', 'notifications', 'apiKeys', 'agentSessions', 'agentGrants', 'agentAuthorizationCodes', 'teamCreationRequests', 'teamInviteInbox',
  'embeddingIndexRevisions', 'embeddingIndexBudgets',
  'commsIdentityRollovers', 'commsIdentityBudgets', 'memoryCreationReceipts', 'memoryUsageReceipts', 'personalRevisions', 'personalRevisionBudgets', 'teamRevisions', 'teamRevisionBudgets', 'memoryEdits', 'memoryEditEvents', 'memoryEditBudgets', 'personalConnectionChanges', 'semanticRelationChanges', 'semanticRelationEvents', 'semanticRelationBudgets', 'syncConflictDecisions', 'syncConflictEvents', 'syncConflictBudgets', 'personalMigrations', 'personalMigrationEvents', 'personalMigrationBudgets', 'personalMigrationArchives', 'teamHistoryChanges', 'teamHistoryEvents', 'teamHistoryCipherArchives', 'teamHistoryBudgets', 'obsidianImports', 'obsidianImportBudgets', 'documentImports', 'documentImportBudgets', 'mobileSyncImports', 'mobileSyncPublications', 'mobileSyncPublicationCancellations', 'mobileSyncBudgets', 'attachmentMutations', 'aiBudgets', 'aiPersonalBudgets', 'aiBudgetWindows', 'desktopAuthBridges'];
const ownedCollections = ['trustedDevices', 'mobileSyncEnvelopes', 'devicePairings', 'capsuleImportNotices'];
/** Strict UID binding and a permanent server marker prevent account switches or old JWTs from reopening a partially deleted account. */
export async function executeAccountDeletion(uid: string, input: unknown, deps: AccountDeletionDeps, authOnly = false): Promise<AccountDeletionResult> {
  parseAccountDeletionInput(uid, input); const db = deps.firestore; const marker = db.doc(`accountDeletions/${uid}`); const worker = randomUUID();
  const token = (input as { recoveryToken?: string }).recoveryToken;
  const receiptHash = token ? accountDeletionRecoveryDigest(uid, token) : null;
  const pending = (retryAt = deps.now() + 60_000): AccountDeletionResult => ({ uid, status: 'pending', retryAt });
  const acquired = await db.runTransaction(async tx => {
    const [request, profile] = await tx.getAll(marker, db.doc(`users/${uid}`));
    const phase = request.exists ? readPhase(request.data()) : 'freeze-teams';
    if (phase === 'complete') return 'complete';
    // A trusted repair worker can finish only a request that already passed the data phases.
    if (authOnly && (!request.exists || phase !== 'auth')) throw fail();
    const recoveryHashes = readRecoveryHashes(request.data()?.recoveryHashes);
    if (receiptHash && !recoveryHashes.includes(receiptHash)) {
      if (recoveryHashes.length >= 8) throw fail('resource-exhausted');
      recoveryHashes.push(receiptHash);
    }
    // Registration is atomic with the durable request, including when its current worker is busy.
    if (receiptHash) tx.set(marker, { recoveryHashes }, { merge: true });
    if (request.data()?.leaseUntil > deps.now()) return 'busy';
    if (phase !== 'auth' && !profile.exists) throw fail();
    if (profile.exists) tx.update(profile.ref, { deletionState: 'deleting' });
    tx.set(marker, { v: 1, status: 'deleting', phase, worker, leaseUntil: deps.now() + LEASE_MS,
      startedAt: request.data()?.startedAt ?? deps.now(), updatedAt: deps.now() }, { merge: true }); return 'acquired';
  });
  if (acquired === 'complete') return { uid, status: 'complete', retryAt: null };
  if (acquired === 'busy') return pending((await marker.get()).data()?.leaseUntil ?? deps.now() + LEASE_MS);
  const transition = async (phase: Phase, fields: Record<string, unknown> = {}) => db.runTransaction(async tx => {
    const current = await tx.get(marker); if (current.data()?.worker !== worker || current.data()?.leaseUntil <= deps.now()) throw fail();
    tx.update(marker, { phase, ...fields, updatedAt: deps.now() });
  });
  try {
    let phase = readPhase((await marker.get()).data());
    if (phase === 'freeze-teams') {
      let after = (await marker.get()).data()?.teamScanAfter;
      for (let page = 0; page < 20; page++) {
        const base = db.collection('teams').where('ownerUid', '==', uid).orderBy(admin.firestore.FieldPath.documentId());
        const rows = await (typeof after === 'string' ? base.startAfter(after) : base).limit(50).get();
        for (const row of rows.docs) await db.runTransaction(async tx => {
          const fresh = await tx.get(row.ref); if (fresh.data()?.ownerUid !== uid) throw fail();
          tx.set(marker.collection('teams').doc(row.id), { v: 1, teamId: row.id });
          tx.update(row.ref, { deletionState: 'deleting', memberUids: [], wrappedKeys: {}, keyRotationStatus: 'rotation_blocked', pendingRotationId: null });
        });
        if (rows.size < 50) { await transition('objects', { teamScanAfter: admin.firestore.FieldValue.delete() }); phase = 'objects'; break; }
        after = rows.docs[rows.docs.length - 1].id; await transition('freeze-teams', { teamScanAfter: after });
      }
      if (phase === 'freeze-teams') return pending();
    }
    if (phase === 'objects') {
      await deps.cancelBilling(uid); // Failures retain identifiers and the live Auth account for retry.
      const teams = await marker.collection('teams').limit(50).get();
      for (const row of teams.docs) {
        if (row.data().v !== 1 || row.data().teamId !== row.id) throw fail();
        const teamRef = db.doc(`teams/${row.id}`);
        if ((await teamRef.get()).exists) {
          const objects = await purgeOwnedTeamAttachmentUploads(uid, row.id, deps.attachments);
          if (!objects.complete) return pending(objects.retryAt ?? undefined);
          await row.ref.update({ objectsComplete: true });
        } else {
          // Parent deletion may have succeeded before its ACK or before this anchor was removed.
          if (row.data().objectsComplete !== true ||
              !(await db.collection('attachmentUploads').where('header.scope.teamId', '==', row.id).limit(1).get()).empty) throw fail();
        }
        await purgeSessions(db, () => db.collection('sessions').where('teamId', '==', row.id), true);
        await cancelDeletedTeamCreationRequests(db, row.id, deps.now());
        for (const collection of TEAM_BOUND_COLLECTIONS) await deleteAccountQuery(db, () => db.collection(collection).where('teamId', '==', row.id));
        await deleteAccountDocumentTree(db, teamRef);
        await completeOwnedTeamDeletionMarker(uid, row.id, db, deps.now());
        await row.ref.delete();
      }
      if (!(await marker.collection('teams').limit(1).get()).empty) return pending();
      const objects = await purgeAccountAttachmentUploads(uid, deps.attachments);
      if (!objects.complete) return pending(objects.retryAt ?? undefined);
      if (!await deps.purgeLegacyObjects(uid)) return pending();
      await transition('documents'); phase = 'documents';
    }
    if (phase === 'documents') {
      // Close remaining team writers through membership removal/rotation before enumerating session children.
      await deps.purgeMemberships(uid);
      await purgeSessions(db, () => db.collection('sessions').where('uid', '==', uid));
      await purgeHistoricalAccountWraps(uid, db);
      for (const collection of uidCollections) await deleteAccountQuery(db, () => db.collection(collection).where('uid', '==', uid), ['shares','mobileSyncImports','obsidianImports','documentImports','personalMigrationArchives'].includes(collection));
      for (const collection of ownedCollections) await deleteAccountQuery(db, () => db.collection(collection).where('ownerUid', '==', uid));
      for (const collection of ['agentMutationReceipts', 'agentMutationProposals', 'agentMutationBudgets', 'agentMutationReversals', 'agentReversalCancelBudgets']) await deleteAccountQuery(db, () => db.collection(collection).where('uid', '==', uid));
      for (const collection of ['agentMutationReceipts', 'agentMutationProposals', 'agentMutationReversals']) for (const field of ['authorUid', 'ownerUid']) await deleteAccountQuery(db, () => db.collection(collection).where(field, '==', uid));
      for (const field of ['authorUid','ownerUid']) await deleteAccountQuery(db, () => db.collection('teamRevisions').where(field, '==', uid));
      for(const collection of ['memoryEdits','memoryEditEvents'])for(const field of ['authorUid','ownerUid'])await deleteAccountQuery(db,()=>db.collection(collection).where(field,'==',uid));
      await deleteAccountQuery(db,()=>db.collection('semanticClusterBudgets').where('uid','==',uid));
      for(const collection of ['teamConnectionChanges','teamConnectionEvents','semanticClusterChanges','semanticClusterEvents']){
        for(const field of ['uid','ownerUid'])await deleteAccountQuery(db,()=>db.collection(collection).where(field,'==',uid));
        await deleteAccountQuery(db,()=>db.collection(collection).where('authorUids','array-contains',uid));
      }
      for (const [collection, field] of [['commsContactRemovals', 'actorUid'], ['commsContactRemovals', 'peerUid'], ['commsP2PLegacyReceipts', 'callerUid'], ['commsP2PLegacyReceipts', 'calleeUid'], ['commsP2PLegacyReceipts', 'ownerUid'], ['commsP2PContentReceipts', 'senderUid'], ['commsP2PContentReceipts', 'recipientUid'], ['commsP2PRequests', 'callerUid'], ['commsP2PRequests', 'calleeUid'], ['commsP2PBudgets', 'uid'], ['commsDeliveryRequests', 'senderId'], ['commsDeliveryRequests', 'recipientId'], ['commsDeliveryBudgets', 'uid'], ['commsContactPairs', 'fromUid'], ['commsContactPairs', 'toUid'], ['commsContactBudgets', 'uid'], ['friendRequests', 'fromUid'], ['friendRequests', 'toUid'], ['capsuleImportNotices', 'importerUid'],
        ['transmissions', 'senderId'], ['transmissions', 'recipientId'], ['teamAudit', 'actorUid'], ['teamAudit', 'targetUid'],
        ['rateLimits', 'clientKey']] as const) await deleteAccountQuery(db, () => db.collection(collection).where(field, '==', collection === 'rateLimits' ? `uid:${uid}` : uid));
      for (const field of ['callerId', 'calleeId']) await deleteAccountQuery(db, () => db.collection('p2pRooms').where(field, '==', uid), true);
      // Keep users/{uid} until every child is erased; it continues to close Admin entry points.
      for (const child of await db.doc(`users/${uid}`).listCollections()) await db.recursiveDelete(child);
      await db.doc(`publicProfiles/${uid}`).delete(); await db.doc(`entitlements/${uid}`).delete();
      await transition('auth'); phase = 'auth';
    }
    if (phase === 'auth') {
      // Lost Auth ACK is safe: auth/user-not-found confirms the same completed deletion.
      try { await deps.deleteAuth(uid); } catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }
      await deleteAccountDocumentTree(db, db.doc(`users/${uid}`));
      await transition('complete', { status: 'complete', completedAt: deps.now(), leaseUntil: 0, worker: admin.firestore.FieldValue.delete() });
    }
    return { uid, status: 'complete', retryAt: null };
  } finally {
    await db.runTransaction(async tx => {
      const current = await tx.get(marker);
      if (current.data()?.worker === worker) tx.update(marker, { worker: admin.firestore.FieldValue.delete(), leaseUntil: 0 });
    });
  }
}
export async function purgeLegacyAccountObjects(uid: string, bucket: Bucket = admin.storage().bucket()): Promise<boolean> {
  if (!attachmentActorIdValid(uid)) throw fail('invalid-argument');
  for (let page = 0; page < 10; page++) {
    const [files] = await bucket.getFiles({ prefix: `attachments/${uid}/`, maxResults: 100, autoPaginate: false });
    if (!files.length) return true;
    for (const file of files) {
      if (!file.name.startsWith(`attachments/${uid}/`)) throw fail();
      const generation = file.metadata.generation;
      if (!generation || !/^[1-9][0-9]*$/.test(String(generation))) throw fail();
      await file.delete({ ifGenerationMatch: generation, ignoreNotFound: true });
      await createAttachmentObjectStore(bucket).assertPathAbsent(file.name);
    }
  }
  return (await bucket.getFiles({ prefix: `attachments/${uid}/`, maxResults: 1, autoPaginate: false }))[0].length === 0;
}
const defaults = (): AccountDeletionDeps => {
  const firestore = admin.firestore(); return { firestore, now: Date.now,
    attachments: { firestore, now: Date.now, store: name => createAttachmentObjectStore(admin.storage().bucket(name)) },
    cancelBilling: cancelStripeBillingForUser, purgeLegacyObjects: purgeLegacyAccountObjects,
    deleteAuth: uid => admin.auth().deleteUser(uid), purgeMemberships: uid => purgeUserTeamMemberships(uid, firestore) };
};
export const deleteUserAccount = functions.region('europe-west1').runWith({ timeoutSeconds: 540, memory: '512MB', secrets: [stripeSecretKey] }).https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated');
  parseAccountDeletionInput(context.auth.uid, input);
  if (!ACCOUNT_DELETION_ENABLED) {
    const existing = await admin.firestore().doc(`accountDeletions/${context.auth.uid}`).get();
    if (!existing.exists) throw fail();
    readPhase(existing.data()); // Closing new requests must not strand an already authorized deletion.
  }
  try { return await executeAccountDeletion(context.auth.uid, input, defaults()); }
  catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
export const getAccountDeletionStatus = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated'); const uid = parseAccountDeletionInput(context.auth.uid, input);
  const marker = await admin.firestore().doc(`accountDeletions/${uid}`).get();
  if (!marker.exists) return { uid, status: 'unknown', retryAt: null };
  const phase = readPhase(marker.data()); return { uid, status: phase === 'complete' ? 'complete' : 'pending', retryAt: phase === 'complete' ? null : Math.max(Date.now(), marker.data()?.leaseUntil ?? 0) };
});

/** Anonymous and read-only: possession of a device receipt reveals only that same request's status. */
export async function inspectAccountDeletionRecovery(input: unknown, db: FirebaseFirestore.Firestore, now = Date.now()): Promise<AccountDeletionResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'recoveryToken,uid') throw fail('invalid-argument');
  const { uid, recoveryToken } = input as { uid: string; recoveryToken: string };
  if (!attachmentActorIdValid(uid) || !accountDeletionRecoveryTokenValid(recoveryToken)) throw fail('invalid-argument');
  const expected = Buffer.from(accountDeletionRecoveryDigest(uid, recoveryToken), 'hex');
  const request = await db.doc(`accountDeletions/${uid}`).get();
  // The same denial covers an absent request, an old request without a receipt and a wrong receipt.
  if (!request.exists) throw fail('permission-denied');
  const data = request.data(); let hashes: string[];
  try { hashes = readRecoveryHashes(data?.recoveryHashes); } catch { throw fail('permission-denied'); }
  let matches = false;
  for (const hash of hashes) matches = timingSafeEqual(expected, Buffer.from(hash, 'hex')) || matches;
  if (!matches) throw fail('permission-denied');
  const phase = readPhase(data);
  return { uid, status: phase === 'complete' ? 'complete' : 'pending', retryAt: phase === 'complete' ? null : Math.max(now, data?.leaseUntil ?? 0) };
}
export const getAccountDeletionRecoveryStatus = functions.region('europe-west1').https.onCall(async (input, context) => {
  // Hash the platform IP before persistence. A revoked UID cannot be the key for this endpoint.
  const ipKey = clientKeyFromRequest(context.rawRequest);
  const client = `recovery-ip:${createHash('sha256').update(ipKey).digest('hex')}`;
  const rate = await consumeServerRateLimit(client, { bucket: 'account-deletion-recovery', max: 20, windowMs: 60_000 });
  if (!rate.allowed) throw fail('resource-exhausted');
  try { return await inspectAccountDeletionRecovery(input, admin.firestore()); }
  catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});

/** No new deletion can be started here. Earlier data phases remain under authenticated recovery. */
export async function finishInterruptedAccountAuthDeletions(deps: AccountDeletionDeps) {
  const stateRef = deps.firestore.doc('maintenanceCursors/account-deletion-auth-v1'); const worker = randomUUID();
  const counts = { scanned: 0, completed: 0, busy: 0, failed: 0, exhausted: false, workerBusy: false };
  let after: string | null = null; let attempted = 0;
  const acquired = await deps.firestore.runTransaction(async tx => {
    const state = (await tx.get(stateRef)).data();
    if (state && (state.v !== 1 || !Number.isSafeInteger(state.leaseUntil) || state.leaseUntil < 0 ||
        (state.after !== null && (typeof state.after !== 'string' || !state.after || state.after.includes('/') || Buffer.byteLength(state.after, 'utf8') > 1500)))) throw fail();
    if (state?.leaseUntil > deps.now()) return false;
    after = state?.after ?? null;
    tx.set(stateRef, { v: 1, after, worker, leaseUntil: deps.now() + LEASE_MS }); return true;
  });
  if (!acquired) { counts.workerBusy = true; return counts; }
  const saveCursor = async (next: string | null) => deps.firestore.runTransaction(async tx => {
    const state = (await tx.get(stateRef)).data();
    if (state?.worker !== worker || state.leaseUntil <= deps.now()) throw fail();
    tx.update(stateRef, { after: next });
  });
  try {
    for (let page = 0; page < 4; page++) {
      // Single field equality plus document order needs no new composite index.
      const base = deps.firestore.collection('accountDeletions').where('phase', '==', 'auth').orderBy(admin.firestore.FieldPath.documentId());
      const rows = await (after ? base.startAfter(after) : base).limit(50).get();
      for (const row of rows.docs) {
        await saveCursor(row.id); after = row.id; counts.scanned++;
        if (!attachmentActorIdValid(row.id) || row.data().status !== 'deleting' || !Number.isSafeInteger(row.data().leaseUntil) || row.data().leaseUntil < 0) { counts.failed++; continue; }
        if (row.data().leaseUntil > deps.now()) { counts.busy++; continue; }
        attempted++;
        try {
          const result = await executeAccountDeletion(row.id, { uid: row.id }, deps, true);
          if (result.status === 'complete') counts.completed++; else counts.busy++;
        } catch { counts.failed++; } // Preserve the request; never log the UID, receipt or provider response.
        if (attempted >= 20) { counts.exhausted = true; return counts; }
      }
      if (rows.size < 50) { await saveCursor(null); return counts; }
    }
    counts.exhausted = true; return counts;
  } finally {
    await deps.firestore.runTransaction(async tx => {
      const state = (await tx.get(stateRef)).data();
      if (state?.worker === worker) tx.update(stateRef, { worker: admin.firestore.FieldValue.delete(), leaseUntil: 0 });
    });
  }
}
export const repairAccountDeletionAuth = functions.region('europe-west1').runWith({ timeoutSeconds: 540, memory: '512MB' }).pubsub.schedule('every 5 minutes').onRun(async () => {
  try { console.info('Account deletion final-phase repair', await finishInterruptedAccountAuthDeletions(defaults())); }
  catch { throw fail(); } // Scheduler diagnostics must not contain raw provider errors or a request cursor.
});
