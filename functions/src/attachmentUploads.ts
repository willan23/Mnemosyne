import * as admin from 'firebase-admin';
import { liveAccountInTransaction } from './accountAccess';
import { authorizedTeamObjectPurge } from './teamDeletionContract';
import { purgeAccountAttachmentReferences } from './attachmentReferencePurge';
import * as functions from 'firebase-functions/v1';
import { createHash, randomUUID } from 'node:crypto';
import { attachmentActorIdValid, attachmentIdValid, decodeAttachmentHeader, encodeAttachmentHeader,
  MAX_ATTACHMENT_HEADER_BYTES, parseAttachmentHeader, type AttachmentEnvelopeHeader } from './attachmentEnvelope';
import { consumeServerRateLimit } from './rateLimit';
import type { Bucket } from '@google-cloud/storage';
if (!admin.apps.length) admin.initializeApp();
export const ATTACHMENT_UPLOADS_ENABLED = false;
export const ATTACHMENT_PURGES_ENABLED = false;
export const ATTACHMENT_RESERVATION_MS = 15 * 60_000;
export const ATTACHMENT_POST_MS = 2 * 60_000;
const GiB = 1024 * 1024 * 1024;
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Attachment operation unavailable');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export interface AttachmentObjectInspection { generation: string; size: number; contentType: string; prefix: Uint8Array }
export interface AttachmentObjectStore {
  signPost: (path: string, bytes: number, expiresAt: number) => Promise<{ url: string; fields: Record<string, string> }>;
  inspect: (path: string) => Promise<AttachmentObjectInspection>;
  promote: (source: string, sourceGeneration: string, destination: string, digest: string, bytes: number) => Promise<string>;
  removeQuarantine: (path: string, generation: string) => Promise<void>;
  removeExpiredPath: (path: string) => Promise<void>;
  assertPathAbsent: (path: string) => Promise<void>;
}
export interface AttachmentUploadDeps { firestore: FirebaseFirestore.Firestore; now: () => number; store: (bucket: string) => AttachmentObjectStore }
export interface UploadRecord {
  v: 1; uid: string; header: AttachmentEnvelopeHeader; digest: string; bytes: number; bucket: string;
  quarantinePath: string; publishedPath: string; status: 'reserved' | 'verifying' | 'ready' | 'cancelled';
  expiresAt: number; postExpiresAt: number; sourceGeneration?: string; storageGeneration?: string;
  quotaChargeBytes: number; quotaReserved: boolean; verificationUntil?: number; verificationId?: string;
  referenceSchemaVersion?: 1; referenceRevision?: number;
  purgeState?: 'pending' | 'deleted'; purgeId?: string; purgeAfter?: number;
  purgeReason?: 'unreferenced' | 'account' | 'team-account' | 'team-deletion'; storedQuotaReleased?: boolean; purgedAt?: number;
}
const uploadRef = (db: FirebaseFirestore.Firestore, id: string) => db.doc(`attachmentUploads/${id}`);
const quotaRefs = (db: FirebaseFirestore.Firestore, header: AttachmentEnvelopeHeader) => [db.doc(`attachmentQuotas/user_${hash(header.uid)}`),
  ...(header.scope.kind === 'team' ? [db.doc(`attachmentQuotas/team_${hash(header.scope.teamId)}`)] : [])];
const integer = (value: unknown, fallback = 0) => { const result = value ?? fallback; if (!Number.isSafeInteger(result) || (result as number) < 0) throw fail(); return result as number; };
const usage = (data: FirebaseFirestore.DocumentData = {}) => ({ reservedBytes: integer(data.reservedBytes), storedBytes: integer(data.storedBytes),
  reservedFiles: integer(data.reservedFiles), storedFiles: integer(data.storedFiles), cleanupBytes: integer(data.cleanupBytes), cleanupFiles: integer(data.cleanupFiles) });
export function readAttachmentUploadRecord(data: FirebaseFirestore.DocumentData | undefined, expectedId: string, allowPurged = false): UploadRecord {
  if (!data || data.v !== 1 || !attachmentActorIdValid(data.uid) || !['reserved', 'verifying', 'ready', 'cancelled'].includes(data.status) ||
      typeof data.bucket !== 'string' || !Number.isSafeInteger(data.expiresAt) || !Number.isSafeInteger(data.postExpiresAt) || typeof data.quotaReserved !== 'boolean') throw fail();
  const header = parseAttachmentHeader(data.header); const prefix = encodeAttachmentHeader(header);
  if (header.id !== expectedId || header.uid !== data.uid || data.digest !== hash(prefix) || data.bytes !== prefix.byteLength + header.cipherBytes ||
      data.quarantinePath !== `quarantine/${header.uid}/${header.id}` || data.publishedPath !== `encrypted/${header.id}` || data.quotaChargeBytes !== 2 * data.bytes ||
      (data.status === 'ready' && (data.quotaReserved || !/^[1-9][0-9]*$/.test(data.storageGeneration))) ||
      (data.verificationUntil != null && (!Number.isSafeInteger(data.verificationUntil) || !attachmentIdValid(data.verificationId)))) throw fail();
  if ((data.referenceSchemaVersion != null && data.referenceSchemaVersion !== 1) ||
      (data.referenceRevision != null && (!Number.isSafeInteger(data.referenceRevision) || data.referenceRevision < 0))) throw fail();
  if (data.purgeState != null) {
    if (!['pending', 'deleted'].includes(data.purgeState) || data.status !== 'ready' || !attachmentIdValid(data.purgeId) ||
        !Number.isSafeInteger(data.purgeAfter) || data.purgeAfter < 1 || !['unreferenced', 'account', 'team-account', 'team-deletion'].includes(data.purgeReason) ||
        data.storedQuotaReleased !== (data.purgeState === 'deleted') ||
        (data.purgeState === 'deleted' && (!Number.isSafeInteger(data.purgedAt) || data.purgedAt < 1 || data.cleanupPending !== false))) throw fail();
    if (!allowPurged) throw fail('permission-denied');
  }
  return data as UploadRecord;
}
export const attachmentDescriptor = (record: UploadRecord) => ({ type: record.header.category, url: `mnemosyne-attachment:v1:${record.header.id}`,
  name: 'Anexo cifrado', size: record.bytes, mimeType: 'application/octet-stream', source: 'upload' });
/** Writers touch the registry in the same transaction as a new reference, serializing against a purge decision. */
export function touchAttachmentReference(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, record: UploadRecord, now: number) {
  const revision = integer(record.referenceRevision);
  if (!Number.isSafeInteger(revision + 1)) throw fail();
  tx.update(uploadRef(db, record.header.id), { referenceRevision: revision + 1, referenceUpdatedAt: now });
}
/** All scope/epoch and entitlement reads happen before transaction writes. */
async function readContext(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, uid: string, header: AttachmentEnvelopeHeader) {
  if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
  const [config, user, monetization, entitlement] = await tx.getAll(db.doc('config/attachmentSecurity'), db.doc(`users/${uid}`), db.doc('config/monetization'), db.doc(`entitlements/${uid}`));
  const security = config.data();
  if (!security || security.writesEnabled !== true || typeof security.bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(security.bucket) ||
      !user.exists || user.data()?.deletionState === 'deleting' || header.uid !== uid ||
      (monetization.data()?.mode === 'paid' && entitlement.data()?.canUploadAttachments !== true)) throw fail('permission-denied');
  if (header.scope.kind === 'team') {
    const scope = header.scope;
    const [teamDoc, epochDoc] = await tx.getAll(db.doc(`teams/${scope.teamId}`), db.doc(`teams/${scope.teamId}/keyEpochs/${scope.keyEpoch}`));
    const team = teamDoc.data(); const epoch = epochDoc.data();
    if (!team || !epoch || !Array.isArray(team.memberUids) || !team.memberUids.includes(uid) || !team.wrappedKeys?.[uid] ||
        team.keyRotationStatus !== 'active' || team.pendingRotationId != null || team.activeKeyEpoch !== scope.keyEpoch || team.activeKeyId !== scope.keyId ||
        epoch.status !== 'active' || epoch.keyId !== scope.keyId || !Array.isArray(epoch.memberUids) || !epoch.memberUids.includes(uid) || !epoch.wrappedKeys?.[uid]) throw fail('permission-denied');
  }
  const userLimit = integer(security.userQuotaBytes, GiB); const teamLimit = integer(security.teamQuotaBytes, 4 * GiB);
  if (userLimit < 1 || teamLimit < 1 || userLimit > 20 * GiB || teamLimit > 20 * GiB) throw fail();
  return { bucket: security.bucket as string, limits: [userLimit, teamLimit] };
}
export async function reserveAttachmentUpload(uid: string, input: unknown, deps: AttachmentUploadDeps): Promise<UploadRecord> {
  if (!attachmentActorIdValid(uid)) throw fail('unauthenticated');
  const header = parseAttachmentHeader(input); const prefix = encodeAttachmentHeader(header); const digest = hash(prefix);
  const bytes = prefix.byteLength + header.cipherBytes; const now = deps.now(); const db = deps.firestore;
  return db.runTransaction(async tx => {
    const [cancellation, tombstone] = await tx.getAll(db.doc(`attachmentUploadCancellations/${header.id}`), db.doc(`attachmentObjectTombstones/${header.id}`));
    if (cancellation.exists || tombstone.exists) throw fail(); // Neither cancellation nor deletion permits reusing a UUID.
    const context = await readContext(tx, db, uid, header); const recordRef = uploadRef(db, header.id);
    const existing = await tx.get(recordRef);
    if (existing.exists) {
      const record = readAttachmentUploadRecord(existing.data(), header.id);
      if (record.uid !== uid || record.digest !== digest || record.bucket !== context.bucket || record.status === 'cancelled' ||
          (record.status !== 'ready' && record.expiresAt <= now)) throw fail();
      return record; // exact retry never reserves twice or extends expiry
    }
    const refs = quotaRefs(db, header); const quotas = await tx.getAll(...refs);
    const next = quotas.map((snapshot, index) => {
      const current = usage(snapshot.data());
      if (current.reservedBytes + current.storedBytes + current.cleanupBytes + 2 * bytes > context.limits[index] ||
          current.reservedFiles + current.cleanupFiles >= 10 || current.storedFiles >= 10_000) throw fail('resource-exhausted');
      return { ...current, reservedBytes: current.reservedBytes + 2 * bytes, reservedFiles: current.reservedFiles + 1, updatedAt: now };
    });
    const record: UploadRecord = { v: 1, uid, header, digest, bytes, bucket: context.bucket, quarantinePath: `quarantine/${uid}/${header.id}`,
      publishedPath: `encrypted/${header.id}`, status: 'reserved', expiresAt: now + ATTACHMENT_RESERVATION_MS, postExpiresAt: now + ATTACHMENT_POST_MS,
      quotaChargeBytes: 2 * bytes, quotaReserved: true, referenceSchemaVersion: 1, referenceRevision: 0 };
    refs.forEach((ref, index) => tx.set(ref, next[index])); tx.create(recordRef, { ...record, createdAt: now, updatedAt: now }); return record;
  });
}
export async function issueAttachmentPost(uid: string, header: unknown, deps: AttachmentUploadDeps) {
  const record = await reserveAttachmentUpload(uid, header, deps);
  if (record.status === 'ready') return { id: record.header.id, status: 'ready' as const };
  if (record.status !== 'reserved' || record.postExpiresAt <= deps.now()) throw fail();
  const post = await deps.store(record.bucket).signPost(record.quarantinePath, record.bytes, record.postExpiresAt);
  // Signer latency cannot return a grant after cancellation, removal, rotation or kill switch.
  await deps.firestore.runTransaction(async tx => {
    const context = await readContext(tx, deps.firestore, uid, record.header); const current = readAttachmentUploadRecord((await tx.get(uploadRef(deps.firestore, record.header.id))).data(), record.header.id);
    if (current.digest !== record.digest || current.bucket !== context.bucket || current.status !== 'reserved' || current.postExpiresAt <= deps.now()) throw fail();
  });
  return { id: record.header.id, status: 'reserved' as const, bytes: record.bytes, bucket: record.bucket, expiresAt: record.postExpiresAt, ...post };
}
/** Cancellation is available with writes closed; it leaves a durable tombstone and delayed object cleanup. */
export async function cancelAttachmentReservation(uid: string, id: string, deps: AttachmentUploadDeps) {
  if (!attachmentActorIdValid(uid) || !attachmentIdValid(id)) throw fail('invalid-argument');
  return deps.firestore.runTransaction(async tx => {
    const ref = uploadRef(deps.firestore, id); const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw fail('not-found'); const record = readAttachmentUploadRecord(snapshot.data(), id);
    if (record.uid !== uid) throw fail('permission-denied');
    if (record.status === 'ready') return { status: 'ready' as const }; // cancellation never deletes a confirmed object
    if (record.status === 'cancelled') return { status: 'cancelled' as const };
    // Keep the full reservation until POST and any bounded finalizer lease expired and objects were removed.
    tx.update(ref, { status: 'cancelled', cleanupPending: true,
      cleanupAfter: Math.max(deps.now(), record.postExpiresAt, record.verificationUntil ?? 0) + 60_000, updatedAt: deps.now() });
    return { status: 'cancelled' as const };
  });
}
export async function finalizeAttachmentUpload(uid: string, id: string, deps: AttachmentUploadDeps) {
  if (!attachmentActorIdValid(uid) || !attachmentIdValid(id)) throw fail('invalid-argument');
  const db = deps.firestore; const ref = uploadRef(db, id);
  const record = await db.runTransaction(async tx => {
    const current = readAttachmentUploadRecord((await tx.get(ref)).data(), id); const context = await readContext(tx, db, uid, current.header);
    if (current.bucket !== context.bucket || current.status === 'cancelled' || (current.status !== 'ready' && current.expiresAt <= deps.now())) throw fail(); return current;
  });
  if (record.status === 'ready') return { id, status: 'ready' as const };
  const store = deps.store(record.bucket); const inspection = await store.inspect(record.quarantinePath);
  const decoded = decodeAttachmentHeader(inspection.prefix, inspection.size);
  if (inspection.contentType !== 'application/octet-stream' || !/^[1-9][0-9]*$/.test(inspection.generation) || inspection.size !== record.bytes ||
      hash(decoded.aad) !== record.digest || !same(decoded.header, record.header)) throw fail();
  const verificationId = randomUUID();
  const claim = await db.runTransaction(async tx => {
    const current = readAttachmentUploadRecord((await tx.get(ref)).data(), id); const context = await readContext(tx, db, uid, current.header);
    if (current.digest !== record.digest || current.bucket !== context.bucket || current.status === 'cancelled' || current.expiresAt <= deps.now() ||
        (current.sourceGeneration && current.sourceGeneration !== inspection.generation)) throw fail();
    if (current.status === 'ready') return 'ready';
    if (current.status === 'verifying' && (current.verificationUntil ?? 0) > deps.now()) return 'verifying';
    tx.update(ref, { status: 'verifying', sourceGeneration: inspection.generation, verificationId,
      verificationUntil: deps.now() + 3 * 60_000, updatedAt: deps.now() });
    return 'claimed';
  });
  if (claim !== 'claimed') return { id, status: claim };
  const generation = await store.promote(record.quarantinePath, inspection.generation, record.publishedPath, record.digest, record.bytes);
  if (!/^[1-9][0-9]*$/.test(generation)) throw fail();
  await db.runTransaction(async tx => {
    const current = readAttachmentUploadRecord((await tx.get(ref)).data(), id); const context = await readContext(tx, db, uid, current.header);
    if (current.status === 'ready') { if (current.storageGeneration !== generation || current.digest !== record.digest) throw fail(); return; }
    if (current.status !== 'verifying' || current.sourceGeneration !== inspection.generation || current.digest !== record.digest ||
        current.bucket !== context.bucket || current.expiresAt <= deps.now() || current.verificationId !== verificationId || (current.verificationUntil ?? 0) <= deps.now()) throw fail();
    const refs = quotaRefs(db, current.header); const snapshots = await tx.getAll(...refs);
    snapshots.forEach((snapshot, index) => {
      const quota = usage(snapshot.data()); if (quota.reservedBytes < current.quotaChargeBytes || quota.reservedFiles < 1) throw fail();
      tx.set(refs[index], { ...quota, reservedBytes: quota.reservedBytes - current.quotaChargeBytes, reservedFiles: quota.reservedFiles - 1,
        storedBytes: quota.storedBytes + current.bytes, storedFiles: quota.storedFiles + 1,
        cleanupBytes: quota.cleanupBytes + current.bytes, cleanupFiles: quota.cleanupFiles + 1, updatedAt: deps.now() });
    });
    tx.update(ref, { status: 'ready', quotaReserved: false, storageGeneration: generation, validation: 'encrypted-envelope-only', cleanupPending: true,
      cleanupAfter: Math.max(deps.now(), current.postExpiresAt) + 60_000, updatedAt: deps.now() });
  });
  // Removing this generation is safe; replayed POSTs can recreate quarantine until post expiry and need the cleanup job.
  await store.removeQuarantine(record.quarantinePath, inspection.generation).catch(() => undefined);
  return { id, status: 'ready' as const };
}

/** Releases quota only after terminal state, grant/worker expiry and confirmed object removal. */
export async function cleanupAttachmentReservation(id: string, deps: AttachmentUploadDeps): Promise<boolean> {
  if (!attachmentIdValid(id)) throw fail();
  const db = deps.firestore; const ref = uploadRef(db, id); const snapshot = await ref.get();
  if (!snapshot.exists) return false; const record = readAttachmentUploadRecord(snapshot.data(), id, true);
  if (record.purgeState) return record.purgeState === 'pending' ? cleanupReadyAttachmentPurge(id, deps) : false;
  const cleanupAfter = snapshot.data()?.cleanupAfter;
  if (snapshot.data()?.cleanupPending !== true || !['ready', 'cancelled'].includes(record.status) ||
      !Number.isSafeInteger(cleanupAfter) || cleanupAfter > deps.now() || record.postExpiresAt + 60_000 > deps.now() ||
      (record.verificationUntil ?? 0) + 60_000 > deps.now()) return false;
  const store = deps.store(record.bucket);
  await store.removeExpiredPath(record.quarantinePath);
  await store.assertPathAbsent(record.quarantinePath);
  if (record.status === 'cancelled') {
    await store.removeExpiredPath(record.publishedPath);
    await store.assertPathAbsent(record.publishedPath);
  }
  return db.runTransaction(async tx => {
    const currentSnapshot = await tx.get(ref); const current = readAttachmentUploadRecord(currentSnapshot.data(), id);
    if (currentSnapshot.data()?.cleanupPending !== true) return false;
    if (current.digest !== record.digest || current.status !== record.status || currentSnapshot.data()?.cleanupAfter !== cleanupAfter) throw fail();
    const refs = quotaRefs(db, current.header); const snapshots = await tx.getAll(...refs);
    snapshots.forEach((snapshot, index) => {
      const quota = usage(snapshot.data());
      if (current.status === 'cancelled') {
        if (!current.quotaReserved || quota.reservedBytes < current.quotaChargeBytes || quota.reservedFiles < 1) throw fail();
        tx.set(refs[index], { ...quota, reservedBytes: quota.reservedBytes - current.quotaChargeBytes, reservedFiles: quota.reservedFiles - 1, updatedAt: deps.now() });
      } else {
        if (current.quotaReserved || quota.cleanupBytes < current.bytes || quota.cleanupFiles < 1) throw fail();
        tx.set(refs[index], { ...quota, cleanupBytes: quota.cleanupBytes - current.bytes, cleanupFiles: quota.cleanupFiles - 1, updatedAt: deps.now() });
      }
    });
    tx.update(ref, { quotaReserved: false, cleanupPending: false, cleanedAt: deps.now(), updatedAt: deps.now() }); return true;
  });
}
export async function sweepAttachmentReservations(deps: AttachmentUploadDeps) {
  const db = deps.firestore; let expired = 0; let cleaned = 0; let failed = 0;
  const records = await db.collection('attachmentUploads').where('status', 'in', ['reserved', 'verifying']).where('expiresAt', '<=', deps.now()).limit(50).get();
  for (const item of records.docs) {
    try {
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(item.ref); const current = readAttachmentUploadRecord(snapshot.data(), item.id);
        if (!['reserved', 'verifying'].includes(current.status) || current.expiresAt > deps.now()) return;
        tx.update(item.ref, { status: 'cancelled', cleanupPending: true,
          cleanupAfter: Math.max(deps.now(), current.postExpiresAt, current.verificationUntil ?? 0) + 60_000, updatedAt: deps.now() });
      }); expired++;
    } catch { failed++; }
  }
  const due = await db.collection('attachmentUploads').where('cleanupPending', '==', true).where('cleanupAfter', '<=', deps.now()).limit(50).get();
  for (const item of due.docs) { try { if (await cleanupAttachmentReservation(item.id, deps)) cleaned++; } catch { failed++; } }
  return { expired, cleaned, failed };
}

/** Only canonical references created by this protocol can prove that a ready file is unreferenced. */
export async function requestReadyAttachmentPurge(uid: string, id: string, reason: 'unreferenced' | 'account' | 'team-account' | 'team-deletion', deps: AttachmentUploadDeps) {
  if (!attachmentActorIdValid(uid) || !attachmentIdValid(id) || !['unreferenced', 'account', 'team-account', 'team-deletion'].includes(reason)) throw fail('invalid-argument');
  const db = deps.firestore; const ref = uploadRef(db, id);
  return db.runTransaction(async tx => {
    const [snapshot, profile, deletion] = await tx.getAll(ref, db.doc(`users/${uid}`), db.doc(`accountDeletions/${uid}`));
    const record = readAttachmentUploadRecord(snapshot.data(), id, true);
    if ((!['team-account', 'team-deletion'].includes(reason) && record.uid !== uid) || record.status !== 'ready' || !profile.exists) throw fail('permission-denied');
    if (reason === 'team-deletion') {
      if (record.header.scope.kind !== 'team' || !await authorizedTeamObjectPurge(tx, db, uid, record.header.scope.teamId, deps.now())) {
        throw fail('permission-denied');
      }
    } else if (reason !== 'unreferenced' ? profile.data()?.deletionState !== 'deleting' || !deletion.exists :
        profile.data()?.deletionState === 'deleting' || deletion.exists) throw fail('permission-denied');
    if (reason === 'team-account') {
      if (record.header.scope.kind !== 'team') throw fail('permission-denied');
      const team = (await tx.get(db.doc(`teams/${record.header.scope.teamId}`))).data();
      if (team?.ownerUid !== uid || team.deletionState !== 'deleting') throw fail('permission-denied');
    }
    if (reason === 'unreferenced' && record.header.scope.kind === 'team') {
        const team = (await tx.get(db.doc(`teams/${record.header.scope.teamId}`))).data();
        if (team?.deletionState === 'deleting' || !team?.memberUids?.includes(uid) || !team.wrappedKeys?.[uid]) throw fail('permission-denied');
    }
    if (record.purgeState) return { id, status: record.purgeState, retryAt: record.purgeAfter! };
    if (reason === 'unreferenced') {
      if (record.referenceSchemaVersion !== 1) throw fail(); // Older records need a verified reference migration, not a guessed absence.
      const descriptor = attachmentDescriptor(record);
      const [current, history] = await Promise.all([
        tx.get(db.collection('sessions').where('attachments', 'array-contains', descriptor).limit(1)),
        tx.get(db.collectionGroup('versions').where('attachments', 'array-contains', descriptor).limit(1)),
      ]);
      if (!current.empty || !history.empty) throw fail(); // Logical deletion or removal from the current version does not erase history.
    }
    const purgeAfter = Math.max(deps.now() + 120_000, record.postExpiresAt, record.verificationUntil ?? 0) + 60_000;
    tx.update(ref, { purgeState: 'pending', purgeId: randomUUID(), purgeReason: reason, purgeAfter, storedQuotaReleased: false,
      cleanupPending: true, cleanupAfter: purgeAfter, updatedAt: deps.now() });
    return { id, status: 'pending' as const, retryAt: purgeAfter };
  });
}
/** Revocation precedes object removal; generation/absence and quota commit are all required before reporting deletion. */
export async function cleanupReadyAttachmentPurge(id: string, deps: AttachmentUploadDeps): Promise<boolean> {
  if (!attachmentIdValid(id)) throw fail('invalid-argument');
  const db = deps.firestore; const ref = uploadRef(db, id); const before = await ref.get();
  const record = readAttachmentUploadRecord(before.data(), id, true);
  if (record.purgeState !== 'pending' || record.purgeAfter! > deps.now()) return false;
  if (record.purgeReason === 'account' && !(await purgeAccountAttachmentReferences(record, attachmentDescriptor(record), deps)).complete) return false;
  const store = deps.store(record.bucket);
  await store.removeQuarantine(record.publishedPath, record.storageGeneration!);
  await store.assertPathAbsent(record.publishedPath);
  await store.removeExpiredPath(record.quarantinePath);
  await store.assertPathAbsent(record.quarantinePath);
  return db.runTransaction(async tx => {
    const currentSnapshot = await tx.get(ref); const current = readAttachmentUploadRecord(currentSnapshot.data(), id, true);
    if (current.purgeState === 'deleted') return false;
    if (current.purgeState !== 'pending' || current.purgeId !== record.purgeId || current.digest !== record.digest ||
        current.storageGeneration !== record.storageGeneration || current.purgeAfter! > deps.now()) throw fail();
    if (current.purgeReason === 'account') {
      const descriptor = attachmentDescriptor(current);
      const [sessions, history] = await Promise.all([
        tx.get(db.collection('sessions').where('attachments', 'array-contains', descriptor).limit(1)),
        tx.get(db.collectionGroup('versions').where('attachments', 'array-contains', descriptor).limit(1)),
      ]);
      if (!sessions.empty || !history.empty) throw fail();
    }
    const refs = quotaRefs(db, current.header); const quotas = await tx.getAll(...refs);
    quotas.forEach((snapshot, i) => {
      const value = usage(snapshot.data()); const quarantineCharged = currentSnapshot.data()?.cleanedAt == null;
      if (value.storedBytes < current.bytes || value.storedFiles < 1 ||
          (quarantineCharged && (value.cleanupBytes < current.bytes || value.cleanupFiles < 1))) throw fail();
      tx.set(refs[i], { ...value, storedBytes: value.storedBytes - current.bytes, storedFiles: value.storedFiles - 1,
        cleanupBytes: value.cleanupBytes - (quarantineCharged ? current.bytes : 0), cleanupFiles: value.cleanupFiles - (quarantineCharged ? 1 : 0), updatedAt: deps.now() });
    });
    tx.update(ref, { purgeState: 'deleted', storedQuotaReleased: true, cleanupPending: false, purgedAt: deps.now(), updatedAt: deps.now() }); return true;
  });
}

/** Account deletion keeps Auth until every uploader-owned object and its quota charge is gone. Bounded, retryable pages. */
export async function purgeAccountAttachmentUploads(uid: string, deps: AttachmentUploadDeps) {
  if (!attachmentActorIdValid(uid)) throw fail('invalid-argument'); const db = deps.firestore;
  const [profile, marker] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`accountDeletions/${uid}`).get()]);
  if (profile.data()?.deletionState !== 'deleting' || !marker.exists) throw fail('permission-denied');
  let removed = 0; let pending = 0; let retryAt = 0; let cursor: FirebaseFirestore.DocumentSnapshot | undefined;
  for (let page = 0; page < 20; page++) {
    const base = db.collection('attachmentUploads').where('uid', '==', uid).orderBy(admin.firestore.FieldPath.documentId());
    const rows = await (cursor ? base.startAfter(cursor) : base).limit(50).get(); if (rows.empty) break;
    for (const row of rows.docs) {
      let record = readAttachmentUploadRecord(row.data(), row.id, true);
      if (record.status === 'ready') {
        const requested = await requestReadyAttachmentPurge(uid, row.id, 'account', deps);
        if (requested.status === 'pending' && requested.retryAt > deps.now()) { pending++; retryAt = Math.max(retryAt, requested.retryAt); continue; }
        if (requested.status !== 'deleted') {
          if (!await cleanupReadyAttachmentPurge(row.id, deps)) { pending++; continue; }
        } else if (record.purgeReason === 'account' && !(await purgeAccountAttachmentReferences(record, attachmentDescriptor(record), deps)).complete) {
          pending++; continue;
        }
      } else {
        if (record.status !== 'cancelled') await cancelAttachmentReservation(uid, row.id, deps);
        const current = await row.ref.get(); record = readAttachmentUploadRecord(current.data(), row.id, true);
        if (current.data()?.cleanupPending === true) {
          if (current.data()?.cleanupAfter > deps.now()) { pending++; retryAt = Math.max(retryAt, current.data()!.cleanupAfter); continue; }
          if (!await cleanupAttachmentReservation(row.id, deps)) { pending++; continue; }
        }
      }
      await db.runTransaction(async tx => {
        const current = await tx.get(row.ref); const value = readAttachmentUploadRecord(current.data(), row.id, true);
        const tombstone = db.doc(`attachmentObjectTombstones/${row.id}`); const old = await tx.get(tombstone);
        if (value.uid !== uid || (value.status === 'ready' ? value.purgeState !== 'deleted' : value.quotaReserved || current.data()?.cleanupPending !== false || !Number.isSafeInteger(current.data()?.cleanedAt))) throw fail();
        if (old.exists && (old.data()?.v !== 1 || old.data()?.digest !== value.digest)) throw fail();
        if (!old.exists) tx.create(tombstone, { v: 1, digest: value.digest, status: 'deleted', deletedAt: deps.now() });
        tx.delete(row.ref);
      }); removed++;
    }
    cursor = rows.docs[rows.docs.length - 1]; if (rows.size < 50) break;
  }
  const remaining = await db.collection('attachmentUploads').where('uid', '==', uid).limit(1).get();
  if (!remaining.empty) return { complete: false, removed, pending: Math.max(pending, 1), retryAt: retryAt || deps.now() + 60000 };
  // A pre-reservation cancellation has no objects, but its UUID must remain unusable after personal metadata is removed.
  for (let page = 0; page < 20; page++) {
    const rows = await db.collection('attachmentUploadCancellations').where('uid', '==', uid).limit(50).get(); if (rows.empty) break;
    for (const row of rows.docs) await db.runTransaction(async tx => {
      const fresh = await tx.get(row.ref); if (!fresh.exists) return;
      if (fresh.data()?.uid !== uid || fresh.data()?.v !== 1 || fresh.data()?.id !== row.id || !/^[a-f0-9]{64}$/.test(fresh.data()?.digest) || !attachmentIdValid(row.id)) throw fail();
      const ref = db.doc(`attachmentObjectTombstones/${row.id}`); const old = await tx.get(ref);
      if (old.exists && old.data()?.digest !== fresh.data()?.digest) throw fail();
      if (!old.exists) tx.create(ref, { v: 1, digest: fresh.data()!.digest, status: 'deleted', deletedAt: deps.now() }); tx.delete(row.ref);
    });
  }
  if (!(await db.collection('attachmentUploadCancellations').where('uid', '==', uid).limit(1).get()).empty) return { complete: false, removed, pending: 1, retryAt: deps.now() + 60000 };
  await db.runTransaction(async tx => {
    const ref = db.doc(`attachmentQuotas/user_${hash(uid)}`); const snapshot = await tx.get(ref);
    if (Object.values(usage(snapshot.data())).some(value => value !== 0)) throw fail(); tx.delete(ref);
  });
  return { complete: true, removed, pending: 0, retryAt: null };
}

/** The deleting owner has already frozen membership; remove all team objects, including uploads authored by other members. */
export async function purgeOwnedTeamAttachmentUploads(uid: string, teamId: string, deps: AttachmentUploadDeps, authority: 'account' | 'team-deletion' = 'account') {
  const db = deps.firestore;
  if (!attachmentActorIdValid(uid) || !attachmentActorIdValid(teamId)) throw fail('invalid-argument');
  if (authority === 'team-deletion') {
    if (!await db.runTransaction(tx => authorizedTeamObjectPurge(tx, db, uid, teamId, deps.now()))) throw fail('permission-denied');
  } else if (authority === 'account') {
    const [profile, marker, team] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`accountDeletions/${uid}`).get(), db.doc(`teams/${teamId}`).get()]);
    if (profile.data()?.deletionState !== 'deleting' || !marker.exists || team.data()?.ownerUid !== uid || team.data()?.deletionState !== 'deleting') throw fail('permission-denied');
  } else throw fail('permission-denied');
  let pending = 0; let retryAt = 0; let removed = 0; let cursor: FirebaseFirestore.DocumentSnapshot | undefined;
  const query = () => db.collection('attachmentUploads').where('header.scope.teamId', '==', teamId).orderBy(admin.firestore.FieldPath.documentId());
  for (let page = 0; page < 20; page++) {
    const base = query(); const rows = await (cursor ? base.startAfter(cursor) : base).limit(50).get(); if (rows.empty) break;
    for (const row of rows.docs) {
      const record = readAttachmentUploadRecord(row.data(), row.id, true);
      if (record.header.scope.kind !== 'team' || record.header.scope.teamId !== teamId) throw fail();
      if (record.status === 'ready') {
        const requested = await requestReadyAttachmentPurge(uid, row.id, authority === 'account' ? 'team-account' : 'team-deletion', deps);
        if (requested.status === 'pending' && requested.retryAt > deps.now()) { pending++; retryAt = Math.max(retryAt, requested.retryAt); continue; }
        if (requested.status !== 'deleted') await cleanupReadyAttachmentPurge(row.id, deps);
      } else {
        if (record.status !== 'cancelled') await cancelAttachmentReservation(record.uid, row.id, deps);
        const current = await row.ref.get();
        if (current.data()?.cleanupPending === true) {
          if (current.data()?.cleanupAfter > deps.now()) { pending++; retryAt = Math.max(retryAt, current.data()!.cleanupAfter); continue; }
          if (!await cleanupAttachmentReservation(row.id, deps)) { pending++; continue; }
        }
      }
      await db.runTransaction(async tx => {
        const current = await tx.get(row.ref); const value = readAttachmentUploadRecord(current.data(), row.id, true);
        const ref = db.doc(`attachmentObjectTombstones/${row.id}`); const old = await tx.get(ref);
        if (value.header.scope.kind !== 'team' || value.header.scope.teamId !== teamId ||
            (value.status === 'ready' ? value.purgeState !== 'deleted' : value.quotaReserved || current.data()?.cleanupPending !== false || !Number.isSafeInteger(current.data()?.cleanedAt))) throw fail();
        if (old.exists && (old.data()?.v !== 1 || old.data()?.digest !== value.digest)) throw fail();
        if (!old.exists) tx.create(ref, { v: 1, digest: value.digest, status: 'deleted', deletedAt: deps.now() }); tx.delete(row.ref);
      }); removed++;
    }
    cursor = rows.docs[rows.docs.length - 1]; if (rows.size < 50) break;
  }
  if (!(await query().limit(1).get()).empty) return { complete: false, removed, pending: Math.max(1, pending), retryAt: retryAt || deps.now() + 60000 };
  await db.runTransaction(async tx => {
    const ref = db.doc(`attachmentQuotas/team_${hash(teamId)}`); const snapshot = await tx.get(ref);
    if (Object.values(usage(snapshot.data())).some(value => value !== 0)) throw fail(); tx.delete(ref);
  });
  return { complete: true, removed, pending: 0, retryAt: null };
}

export function createAttachmentObjectStore(bucket: Bucket): AttachmentObjectStore {
  return {
    signPost: async (path, bytes, expires) => {
      const [metadata] = await bucket.getMetadata();
      if (metadata.location?.toLowerCase() !== 'europe-west1' || metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true ||
          metadata.iamConfiguration?.publicAccessPrevention !== 'enforced' || metadata.versioning?.enabled === true) throw fail();
      const [result] = await bucket.file(path).generateSignedPostPolicyV4({ expires,
        fields: { 'Content-Type': 'application/octet-stream' }, conditions: [['content-length-range', bytes, bytes]] });
      return result;
    },
    inspect: async path => {
      const [metadata] = await bucket.file(path).getMetadata();
      const [prefix] = await bucket.file(path, { generation: metadata.generation }).download({ start: 0, end: MAX_ATTACHMENT_HEADER_BYTES + 11 });
      return { generation: String(metadata.generation), size: Number(metadata.size), contentType: String(metadata.contentType), prefix };
    },
    promote: async (source, generation, destination, digest, bytes) => {
      const target = bucket.file(destination);
      try { await bucket.file(source, { generation }).copy(target, { preconditionOpts: { ifGenerationMatch: 0 },
        contentType: 'application/octet-stream', contentDisposition: 'attachment; filename="attachment.bin"', cacheControl: 'private, no-store',
        metadata: { format: 'mnemosyne-attachment-v1', headerDigest: digest } }); }
      catch (error) { if (![404, 412].includes((error as { code?: number }).code ?? 0)) throw error; }
      const [metadata] = await target.getMetadata();
      if (Number(metadata.size) !== bytes || metadata.contentType !== 'application/octet-stream' || metadata.metadata?.headerDigest !== digest ||
          metadata.metadata?.firebaseStorageDownloadTokens || metadata.cacheControl !== 'private, no-store') throw fail();
      return String(metadata.generation);
    },
    removeQuarantine: async (path, generation) => { await bucket.file(path, { generation }).delete({ ignoreNotFound: true, ifGenerationMatch: generation }); },
    removeExpiredPath: async path => {
      try {
        const [metadata] = await bucket.file(path).getMetadata();
        await bucket.file(path).delete({ ifGenerationMatch: metadata.generation });
      } catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
    },
    assertPathAbsent: async path => {
      try { await bucket.file(path).getMetadata(); } catch (error) { if ((error as { code?: number }).code === 404) return; throw error; }
      throw fail();
    },
  };
}
const defaultDeps = (): AttachmentUploadDeps => ({ firestore: admin.firestore(), now: Date.now,
  store: name => createAttachmentObjectStore(admin.storage().bucket(name)) });
function callable(operation: 'begin' | 'finalize' | 'cancel') {
  return functions.region('europe-west1').runWith({ timeoutSeconds: 120, memory: '256MB' }).https.onCall(async (input, context) => {
    if (!context.auth?.uid) throw fail('unauthenticated');
    if (operation !== 'cancel' && !ATTACHMENT_UPLOADS_ENABLED) throw fail();
    const uid = context.auth.uid;
    try {
      if (!(await consumeServerRateLimit(`uid:${uid}`, { bucket: `attachment-${operation}`, max: 20, windowMs: 60_000 })).allowed) throw fail('resource-exhausted');
      const deps = defaultDeps();
      if (operation === 'begin') return await issueAttachmentPost(uid, input, deps);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'id') throw fail('invalid-argument');
      return operation === 'finalize' ? await finalizeAttachmentUpload(uid, input.id, deps) : await cancelAttachmentReservation(uid, input.id, deps);
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      throw fail();
    }
  });
}
export const beginAttachmentUpload = callable('begin');
export const completeAttachmentUpload = callable('finalize');
export const cancelAttachmentUpload = callable('cancel');
export const purgeUnreferencedAttachment = functions.region('europe-west1').https.onCall(async (input, context) => {
  if (!context.auth?.uid) throw fail('unauthenticated'); if (!ATTACHMENT_PURGES_ENABLED) throw fail();
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'id') throw fail('invalid-argument');
  try {
    if (!(await consumeServerRateLimit(`uid:${context.auth.uid}`, { bucket: 'attachment-purge', max: 10, windowMs: 60000 })).allowed) throw fail('resource-exhausted');
    return await requestReadyAttachmentPurge(context.auth.uid, input.id, 'unreferenced', defaultDeps());
  } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
});
export const cleanupAttachmentQuarantine = functions.region('europe-west1').runWith({ timeoutSeconds: 120, memory: '256MB' })
  .pubsub.schedule('every 5 minutes').timeZone('Europe/Lisbon').onRun(async () => {
    const result = await sweepAttachmentReservations(defaultDeps());
    if (result.failed) console.warn('Attachment cleanup requires retry', { failed: result.failed });
    return null;
  });
