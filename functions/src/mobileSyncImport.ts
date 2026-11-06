import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {memoriesUsedInCurrentPeriod, nextUsageAfterMemoryCreate} from './usage';
import {canonicalSyncState, normalizedSyncMetadata, SYNC_MEMORY_METADATA_FIELDS, parseSyncCipher, parseSyncImportBatch, parseSyncImportPreparation, parseSyncImportStatusInput, syncInteger, type SyncImportBatch, type SyncImportChange, type SyncImportStatus, type SyncImportPreparation} from './mobileSyncImportContract';
if (!admin.apps.length) admin.initializeApp();
/** Opens with the prepared client, quota/receipt rules and recovery/device pilot. */
export const MOBILE_SYNC_IMPORT_ENABLED = false;
export interface SyncImportDeps {firestore: FirebaseFirestore.Firestore; now: () => number}
const defaults = (): SyncImportDeps => ({firestore: admin.firestore(), now: Date.now});
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Encrypted sync operation unavailable');
export const syncStateHash = (value: unknown) => createHash('sha256').update(canonicalSyncState(value)).digest('hex');
/** Admin decodes a foreign reference using the local Firestore instance; the public server version stamp preserves CAS across that lossy decoding. */
export const syncDocumentStateHash = (snapshot: FirebaseFirestore.DocumentSnapshot) => {
  if (!snapshot.exists || !snapshot.updateTime) throw fail();
  return syncStateHash({v:1,state:snapshot.data(),updateTime:snapshot.updateTime});
};
export const syncConflictId = (envelopeId: string, index: number) => 'sync-' + createHash('sha256').update(`${envelopeId}:${index}`).digest('hex');
function revision(data: Record<string, unknown>): number {
  const value = data.updatedAt ?? data.timestamp;
  if (!syncInteger(value)) throw fail(); return value;
}
function personal(data: Record<string, unknown> | undefined, uid: string, allowDeleted = true) {
  if (!data || data.uid !== uid || data.teamId !== null || (data.sharedWithIds != null && (!Array.isArray(data.sharedWithIds) || data.sharedWithIds.length !== 0)) || (!allowDeleted && data.deletedAt != null)) throw fail('permission-denied');
}
function cipher(data: Record<string, unknown>) {
  if (data.text !== '' || data.title != null) throw fail();
  try {return parseSyncCipher(data.enc);} catch {throw fail();}
}
function binding(data: Record<string, unknown>, uid: string, input: Omit<SyncImportBatch,'cursor'|'changes'>) {
  if (data.ownerUid !== uid || data.deviceId !== input.deviceId || data.direction !== input.direction || !['memory-snapshot','memory-delta'].includes(String(data.payloadType)) || !syncInteger(data.memoryCount) || data.memoryCount > 2500 || syncStateHash(data.encryptedPayload) !== input.payloadDigest) throw fail('permission-denied');
  const payload = data.encryptedPayload as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object' || Object.keys(payload).sort().join(',') !== 'data,iv' || typeof payload.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(payload.iv) || typeof payload.data !== 'string' || payload.data.length < 24 || payload.data.length > 900_000 || payload.data.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(payload.data)) throw fail();
}
function status(receipt: Record<string, unknown>, uid: string, input: Omit<SyncImportBatch,'cursor'|'changes'>): SyncImportStatus {
  if (receipt.v !== 1 || receipt.uid !== uid || receipt.deviceId !== input.deviceId || receipt.direction !== input.direction || receipt.envelopeId !== input.envelopeId || receipt.payloadDigest !== input.payloadDigest || !syncInteger(receipt.cursor) || !syncInteger(receipt.memoryCount) || !syncInteger(receipt.imported) || !syncInteger(receipt.conflicts) || receipt.cursor > receipt.memoryCount || receipt.imported + receipt.conflicts > receipt.cursor || !['pending','complete'].includes(String(receipt.status)) || (receipt.status === 'complete') !== (receipt.cursor === receipt.memoryCount)) throw fail('permission-denied');
  return {envelopeId: input.envelopeId, payloadDigest: input.payloadDigest, cursor: receipt.cursor, memoryCount: receipt.memoryCount, imported: receipt.imported, conflicts: receipt.conflicts, status: receipt.status as 'pending'|'complete'};
}
export async function executeSyncImportStatus(uid: string, value: unknown, deps = defaults()): Promise<SyncImportStatus> {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  let input: ReturnType<typeof parseSyncImportStatusInput>; try {input = parseSyncImportStatusInput(value);} catch {throw fail('invalid-argument');}
  const db = deps.firestore;
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
    const receipt = await tx.get(db.doc(`mobileSyncImports/${input.envelopeId}`));
    if (receipt.exists) return status(receipt.data()!, uid, input);
    const env = await tx.get(db.doc(`mobileSyncEnvelopes/${input.envelopeId}`));
    if (!env.exists) throw fail('not-found'); binding(env.data()!, uid, input);
    return {envelopeId: input.envelopeId, payloadDigest: input.payloadDigest, cursor: 0, memoryCount: env.data()!.memoryCount, imported: 0, conflicts: 0, status: 'unknown'};
  });
}
/** Read projection excludes attachments, owner metadata, plaintext and provider credentials. */
export async function executeSyncImportPreparation(uid: string, value: unknown, deps = defaults()): Promise<SyncImportPreparation> {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  let input: ReturnType<typeof parseSyncImportPreparation>; try {input = parseSyncImportPreparation(value);} catch {throw fail('invalid-argument');}
  const db = deps.firestore;
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
    const receipt = await tx.get(db.doc(`mobileSyncImports/${input.envelopeId}`));
    const previous = receipt.exists ? status(receipt.data()!, uid, input) : null;
    if (previous?.status === 'complete') return {status: previous, targets: []};
    const [env, device] = await tx.getAll(db.doc(`mobileSyncEnvelopes/${input.envelopeId}`), db.doc(`trustedDevices/${input.deviceId}`));
    if (!env.exists || !device.exists || device.data()?.deviceId !== input.deviceId || device.data()?.ownerUid !== uid || device.data()?.status !== 'active') throw fail('permission-denied');
    binding(env.data()!, uid, input);
    const state: SyncImportStatus = previous || {envelopeId: input.envelopeId, payloadDigest: input.payloadDigest, cursor: 0, memoryCount: env.data()!.memoryCount, imported: 0, conflicts: 0, status: 'unknown'};
    if (state.cursor !== input.cursor || state.cursor + input.sessionIds.length > state.memoryCount || (input.sessionIds.length === 0 && state.memoryCount !== 0)) throw fail('aborted');
    const snapshots = input.sessionIds.length ? await tx.getAll(...input.sessionIds.map(id => db.doc(`sessions/${id}`))) : [];
    const targets = snapshots.map((snapshot, index) => {
      if (!snapshot.exists) return {sessionId: input.sessionIds[index], exists: false, stateHash: null, metadataHash: null, revision: null, timestamp: null, deleted: false, enc: null};
      const data = snapshot.data()!; personal(data, uid); const enc = cipher(data);
      if (!syncInteger(data.timestamp)) throw fail();
      return {sessionId: input.sessionIds[index], exists: true, stateHash: syncDocumentStateHash(snapshot), metadataHash: syncStateHash(normalizedSyncMetadata(data)), revision: revision(data), timestamp: data.timestamp, deleted: data.deletedAt != null, enc};
    });
    return {status: state, targets};
  });
}
/** Ciphertext only. Each batch, history, quota, immutable receipt and final ACK commit atomically. */
export async function executeSyncImportBatch(uid: string, value: unknown, deps = defaults()): Promise<SyncImportStatus> {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  let input: SyncImportBatch; try {input = parseSyncImportBatch(value);} catch {throw fail('invalid-argument');}
  const db = deps.firestore; const now = deps.now(); if (!syncInteger(now) || now < 1) throw fail();
  const digest = syncStateHash(input); const rootRef = db.doc(`mobileSyncImports/${input.envelopeId}`); const batchRef = rootRef.collection('batches').doc(String(input.cursor));
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
    const [prior, batch] = await tx.getAll(rootRef, batchRef);
    if (prior.exists) status(prior.data()!, uid, input);
    if (batch.exists) {
      const saved = batch.data()!;
      if (saved.uid !== uid || saved.digest !== digest || saved.cursor !== input.cursor || !saved.outcome) throw fail('permission-denied');
      return status(saved.outcome, uid, input);
    }
    const [env, device, profile] = await tx.getAll(db.doc(`mobileSyncEnvelopes/${input.envelopeId}`), db.doc(`trustedDevices/${input.deviceId}`), db.doc(`users/${uid}`));
    if (!env.exists || !profile.exists || profile.data()?.deletionState === 'deleting' || !device.exists || device.data()?.deviceId !== input.deviceId || device.data()?.ownerUid !== uid || device.data()?.status !== 'active') throw fail('permission-denied');
    const envelope = env.data()!; binding(envelope, uid, input);
    if (envelope.status !== 'queued' || !syncInteger(envelope.expiresAt) || (envelope.expiresAt <= now && (!prior.exists || !syncInteger(prior.data()?.startedAt) || now - prior.data()!.startedAt > 30 * 86400000))) throw fail();
    if (input.direction === 'mobile-to-desktop' && canonicalSyncState(envelope.senderPublicKeyJwk) !== canonicalSyncState(device.data()!.publicKeyJwk)) throw fail('permission-denied');
    const before = prior.exists ? status(prior.data()!, uid, input) : {envelopeId: input.envelopeId, payloadDigest: input.payloadDigest, cursor: 0, memoryCount: envelope.memoryCount, imported: 0, conflicts: 0, status: 'unknown' as const};
    if (input.cursor !== before.cursor || (input.changes.length === 0 && before.memoryCount !== 0) || input.cursor + input.changes.length > before.memoryCount || before.status === 'complete') throw fail('aborted');
    const targets = input.changes.length ? await tx.getAll(...input.changes.map(change => db.doc(`sessions/${change.sessionId}`))) : [];
    const writes: Array<{change: SyncImportChange; ref: FirebaseFirestore.DocumentReference; before: Record<string, unknown>|null; index: number; create: boolean}> = [];
    let imported = before.imported; let conflicts = before.conflicts;
    for (let index = 0; index < input.changes.length; index++) {
      const change = input.changes[index]; const snapshot = targets[index]; const data = snapshot.exists ? snapshot.data()! : null;
      if ((data ? syncDocumentStateHash(snapshot) : null) !== change.expectedStateHash) throw fail('aborted');
      if (data) {personal(data, uid); cipher(data); revision(data);}
      if (change.action === 'skip') {if (!data) throw fail(); continue;}
      if (change.action === 'create' || change.action === 'tombstone') {if (data) throw fail('already-exists');}
      else if (!data) throw fail('not-found');
      if (change.action === 'update' && (data!.deletedAt != null || change.incomingRevision <= revision(data!))) throw fail('aborted');
      if (change.action === 'delete' && (data!.deletedAt != null || change.incomingRevision < revision(data!))) throw fail('aborted');
      if (change.action === 'conflict' && data!.deletedAt != null) throw fail('permission-denied');
      const targetId = change.action === 'conflict' ? syncConflictId(input.envelopeId, input.cursor + index) : change.sessionId;
      const create = change.action === 'create' || change.action === 'tombstone' || change.action === 'conflict'; const ref = db.doc(`sessions/${targetId}`);
      if (create) {
        const [collision, created, counted] = await tx.getAll(ref, db.doc(`memoryCreationReceipts/${targetId}`), db.doc(`memoryUsageReceipts/${targetId}`));
        if (collision.exists || created.exists || counted.exists) throw fail('already-exists');
      }
      for (const target of (change.metadata?.connections || []) as string[]) {
        if (target === targetId) throw fail('invalid-argument');
        const peer = await tx.get(db.doc(`sessions/${target}`));
        if (peer.exists) personal(peer.data(), uid, false);
      }
      if (create) {if (change.action === 'conflict') conflicts++; else imported++;} else imported++;
      writes.push({change, ref, before: data, index: input.cursor + index, create});
    }
    const [monetization, entitlement] = await tx.getAll(db.doc('config/monetization'), db.doc(`entitlements/${uid}`));
    // Tombstones preserve deletion knowledge; they are not newly captured memories.
    const creates = writes.filter(write => write.create && write.change.action !== 'tombstone').length;
    if (monetization.data()?.mode === 'paid' && !['pro','sovereign'].includes(entitlement.data()?.effectiveTier) && memoriesUsedInCurrentPeriod(profile.data()?.usage, new Date(now)) + creates > 30) throw fail('resource-exhausted');
    const outcome: SyncImportStatus = {...before, cursor: input.cursor + input.changes.length, imported, conflicts, status: input.cursor + input.changes.length === before.memoryCount ? 'complete' : 'pending'};
    let usage = profile.data()?.usage;
    for (const write of writes) {
      const {change, ref, before: old, index, create} = write;
      const updatedAt = Math.max(now, change.incomingRevision, old ? revision(old) + 1 : 0); if (!syncInteger(updatedAt)) throw fail();
      const provenance = {syncedFromDeviceId: input.deviceId, syncedFromEnvelopeId: input.envelopeId, syncedAt: now, updatedAt};
      if (create) {
        const metadata = change.action === 'conflict' ? {...change.metadata, tags: Array.from(new Set([...(change.metadata?.tags as string[] || []), 'sync-conflict'])), originalMemoryId: change.sessionId, conflictReason: 'local-newer-or-same-revision'} : change.metadata;
        tx.create(ref, {...metadata, uid, teamId: null, text: '', title: null, enc: change.enc, timestamp: change.action === 'conflict' ? now : change.timestamp, ...provenance, creationReceiptId: ref.id,
          ...(change.action === 'tombstone' ? {deletedAt: updatedAt, deletedByDeviceId: input.deviceId} : {})});
        tx.create(db.doc(`memoryCreationReceipts/${ref.id}`), {v: 1, kind: 'mobile-sync', uid, teamId: null, sessionId: ref.id, envelopeId: input.envelopeId, index, digest, status: 'committed', createdAt: now});
        if (change.action !== 'tombstone') {
          usage = nextUsageAfterMemoryCreate(usage, new Date(now));
          tx.create(db.doc(`memoryUsageReceipts/${ref.id}`), {v: 1, uid, sessionId: ref.id, ...usage, createdAt: now});
        }
      } else {
        const metadata = Object.fromEntries(['tags','category','attachments','embedding','embeddingModel','connections','semanticClusterId','position','importance','celestialType','processingMethod'].filter(key => old![key] !== undefined).map(key => [key, old![key]]));
        const versionRef = ref.collection('versions').doc(syncConflictId(input.envelopeId, index));
        tx.create(versionRef, {...metadata, text: '', title: null, enc: old!.enc, attachments: old!.attachments ?? null, previousUpdatedAt: revision(old!), createdAt: updatedAt, editorUid: uid});
        tx.update(ref, change.action === 'delete' ? {deletedAt: updatedAt, deletedByDeviceId: input.deviceId, ...provenance}
          : {...Object.fromEntries(SYNC_MEMORY_METADATA_FIELDS.map(key => [key, change.metadata?.[key] ?? admin.firestore.FieldValue.delete()])),
            enc: change.enc, text: '', title: null, nodes: null, links: null, generatedPrompt: null, generatedImagePrompt: null, ...provenance});
      }
    }
    if (creates) tx.update(profile.ref, {usage: {...usage, updatedAt: now}});
    tx.set(rootRef, {v: 1, uid, deviceId: input.deviceId, direction: input.direction, ...outcome, startedAt: prior.exists ? prior.data()!.startedAt : now, updatedAt: now});
    tx.create(batchRef, {v: 1, uid, cursor: input.cursor, digest, outcome: {v: 1, uid, deviceId: input.deviceId, direction: input.direction, ...outcome}, createdAt: now});
    // No declarative client ACK; only the committed final batch can mark the envelope pulled.
    if (outcome.status === 'complete') tx.update(env.ref, {status: 'pulled', pulledAt: now, updatedAt: admin.firestore.Timestamp.fromMillis(now)});
    return outcome;
  });
}
function callable(mode: 'apply'|'status'|'prepare') {
  return functions.region('europe-west1').https.onCall(async (value, context) => {
    if (!context.auth?.uid) throw fail('unauthenticated');
    try {if (mode === 'apply') parseSyncImportBatch(value); else if (mode === 'prepare') parseSyncImportPreparation(value); else parseSyncImportStatusInput(value);} catch {throw fail('invalid-argument');}
    if (mode === 'apply' && !MOBILE_SYNC_IMPORT_ENABLED) throw fail();
    try {
      if (!(await consumeServerRateLimit(`uid:${context.auth.uid}`, {bucket: `mobile-sync-${mode}`, max: 60, windowMs: 60000})).allowed) throw fail('resource-exhausted');
      return mode === 'apply' ? await executeSyncImportBatch(context.auth.uid, value) : mode === 'prepare' ? await executeSyncImportPreparation(context.auth.uid, value) : await executeSyncImportStatus(context.auth.uid, value);
    } catch (error) {if (error instanceof functions.https.HttpsError) throw error; throw fail();}
  });
}
export const applyMobileSyncImportBatch = callable('apply');
export const getMobileSyncImportStatus = callable('status');
export const prepareMobileSyncImportBatch = callable('prepare');
