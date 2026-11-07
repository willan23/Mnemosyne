import { firestore } from 'firebase-admin';
import { https } from 'firebase-functions/v1';
import { AttachmentPolicyError, attachmentActorIdValid, attachmentIdValid } from './attachmentEnvelope';
import { opaqueAttachmentId } from './attachmentMutationContract';
import { attachmentDescriptor, readAttachmentUploadRecord, type UploadRecord } from './attachmentUploads';

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
export type AttachmentInventorySource = 'sessions' | 'versions' | 'memories' | 'attachmentUploads';
export const ATTACHMENT_INVENTORY_REASONS = [
  'unknownNamespace', 'invalidDocumentId', 'legacyMemoryNamespace', 'legacyOwnerMismatch', 'orphanVersion', 'historyAuthorMismatch', 'invalidAuthor', 'invalidDocumentScope',
  'malformedList', 'oversizedList', 'malformedEntry', 'legacyReference', 'inlineReference', 'tokenizedReference',
  'invalidOpaqueId', 'duplicateObject', 'missingRegistry', 'invalidRegistry', 'objectNotReady', 'objectPurged',
  'missingReferenceSchema', 'descriptorMismatch', 'scopeMismatch', 'missingUploader', 'uploaderUnavailable',
  'missingTeam', 'missingEpoch', 'epochKeyMismatch',
] as const;
export type AttachmentInventoryReason = typeof ATTACHMENT_INVENTORY_REASONS[number];
const DOCUMENT_FIELDS = ['uid', 'teamId', 'keyEpoch', 'keyId', 'attachments'];
const UPLOAD_FIELDS = ['v', 'uid', 'header', 'digest', 'bytes', 'bucket', 'quarantinePath', 'publishedPath', 'status',
  'expiresAt', 'postExpiresAt', 'quotaChargeBytes', 'quotaReserved', 'storageGeneration', 'verificationUntil', 'verificationId',
  'referenceSchemaVersion', 'referenceRevision', 'purgeState', 'purgeId', 'purgeAfter', 'purgeReason',
  'storedQuotaReleased', 'purgedAt', 'cleanupPending'];
const exactDescriptor = (value: unknown, record: UploadRecord) => {
  const expected = attachmentDescriptor(record); const actual = row(value);
  return Object.keys(actual).sort().join(',') === Object.keys(expected).sort().join(',') &&
    Object.entries(expected).every(([key, item]) => actual[key] === item);
};

/** Returns categories and opaque IDs for internal lookup; never returns original legacy URLs/content. */
export function classifyAttachmentList(input: unknown): { reasons: AttachmentInventoryReason[]; ids: string[]; count: number } {
  const reasons = new Set<AttachmentInventoryReason>(); const ids = new Set<string>();
  if (input == null) return { reasons: [], ids: [], count: 0 };
  if (!Array.isArray(input)) return { reasons: ['malformedList'], ids: [], count: 0 };
  if (input.length > 200) return { reasons: ['oversizedList'], ids: [], count: input.length };
  for (const value of input) {
    const entry = row(value); const url = entry.url;
    if (typeof url !== 'string' || !url) { reasons.add('malformedEntry'); continue; }
    if (Buffer.byteLength(url) > 16 * 1024) reasons.add('malformedEntry');
    if (url.startsWith('mnemosyne-attachment:')) {
      const id = opaqueAttachmentId(url);
      if (!id) reasons.add('invalidOpaqueId');
      else { if (ids.has(id)) reasons.add('duplicateObject'); ids.add(id); }
    } else {
      reasons.add('legacyReference');
      if (/^(data:|blob:)/i.test(url)) reasons.add('inlineReference');
      // Categorization only; no request is made to this URL and it never authorizes ownership.
      if (/[?&](token|firebaseStorageDownloadTokens|x-goog-signature|x-amz-signature)=/i.test(url)) reasons.add('tokenizedReference');
    }
  }
  return { reasons: [...reasons], ids: [...ids], count: input.length };
}

export function referenceScopeMatches(record: UploadRecord, parent: unknown, document: unknown, history: boolean): boolean {
  const owner = row(parent); const target = row(document); const scope = record.header.scope;
  if (!attachmentActorIdValid(owner.uid)) return false;
  return scope.kind === 'personal' ? owner.uid === record.uid && owner.teamId === null && (!history || target.teamId === null) :
    owner.teamId === scope.teamId && (!history || target.teamId === scope.teamId);
}

function cursorValid(path: unknown, source: AttachmentInventorySource): path is string {
  if (typeof path !== 'string' || Buffer.byteLength(path) > 6144) return false;
  const parts = path.split('/');
  return parts.length % 2 === 0 && parts.every(part => part.length > 0 && part !== '.' && part !== '..') &&
    (source === 'sessions' || source === 'attachmentUploads' ? parts.length === 2 && parts[0] === source : parts[parts.length - 2] === source);
}

/** Read-only Admin API, not exported by the deployed entrypoint. Projection omits memory ciphers/text. */
export async function inventoryAttachmentReferencesPage(input: {
  source: AttachmentInventorySource; afterPath: string | null; limit: number;
}, db: FirebaseFirestore.Firestore): Promise<{
  scanned: number; affectedDocuments: number; references: number; canonicalReferences: number;
  reasons: Record<AttachmentInventoryReason, number>; uploadStates: Record<string, number>;
  nextAfterPath: string | null; exhausted: boolean;
}> {
  if (!input || !['sessions', 'versions', 'memories', 'attachmentUploads'].includes(input.source) ||
      (input.afterPath !== null && !cursorValid(input.afterPath, input.source)) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new https.HttpsError('invalid-argument', 'Contexto de inventário inválido.');
  }
  const source = input.source;
  const collection = source === 'versions' || source === 'memories' ? db.collectionGroup(source) : db.collection(source);
  let query = collection.orderBy(firestore.FieldPath.documentId()).limit(input.limit)
    .select(...(source === 'attachmentUploads' ? UPLOAD_FIELDS : DOCUMENT_FIELDS));
  if (input.afterPath) query = query.startAfter(db.doc(input.afterPath));
  const page = await query.get();
  const result = { scanned: 0, affectedDocuments: 0, references: 0, canonicalReferences: 0,
    reasons: Object.fromEntries(ATTACHMENT_INVENTORY_REASONS.map(reason => [reason, 0])) as Record<AttachmentInventoryReason, number>,
    uploadStates: { reserved: 0, verifying: 0, ready: 0, cancelled: 0, purgePending: 0, purgeDeleted: 0 },
    nextAfterPath: page.empty ? null : page.docs[page.size - 1].ref.path, exhausted: page.size < input.limit };
  const checkRegistryContext = async (record: UploadRecord, issues: Set<AttachmentInventoryReason>) => {
    const [uploader, marker] = await db.getAll(db.doc(`users/${record.uid}`), db.doc(`accountDeletions/${record.uid}`),
      { fieldMask: ['deletionState', 'v', 'status'] });
    if (!uploader.exists) issues.add('missingUploader');
    if (marker.exists || uploader.data()?.deletionState === 'deleting') issues.add('uploaderUnavailable');
    if (record.header.scope.kind === 'team') {
      const scope = record.header.scope;
      const [team, epoch] = await db.getAll(db.doc(`teams/${scope.teamId}`), db.doc(`teams/${scope.teamId}/keyEpochs/${scope.keyEpoch}`),
        { fieldMask: ['keyId', 'epoch', 'ownerUid'] });
      if (!team.exists) issues.add('missingTeam');
      if (!epoch.exists) issues.add('missingEpoch');
      else if (epoch.data()?.keyId !== scope.keyId || epoch.data()?.epoch !== scope.keyEpoch) issues.add('epochKeyMismatch');
    }
  };
  for (const snapshot of page.docs) {
    result.scanned++; const data = snapshot.data(); const issues = new Set<AttachmentInventoryReason>();
    if (source === 'attachmentUploads') {
      let record: UploadRecord | undefined;
      try {
        if (!attachmentIdValid(snapshot.id)) issues.add('invalidRegistry');
        else record = readAttachmentUploadRecord(data, snapshot.id, true);
      } catch (error) {
        if (!(error instanceof https.HttpsError) && !(error instanceof AttachmentPolicyError)) throw error;
        issues.add('invalidRegistry');
      }
      if (record) {
        result.uploadStates[record.status]++;
        if (record.purgeState === 'pending') result.uploadStates.purgePending++;
        if (record.purgeState === 'deleted') result.uploadStates.purgeDeleted++;
        if (record.status === 'ready' && record.referenceSchemaVersion !== 1) issues.add('missingReferenceSchema');
        await checkRegistryContext(record, issues);
      }
    } else {
      const parsed = classifyAttachmentList(data.attachments);
      parsed.reasons.forEach(reason => issues.add(reason)); result.references += parsed.count;
      const parts = snapshot.ref.path.split('/'); let parent: Row = data;
      const history = source === 'versions';
      const expected = source === 'sessions' ? parts.length === 2 && parts[0] === 'sessions' :
        parts.length === 4 && parts[0] === (history ? 'sessions' : 'users') && parts[2] === source;
      if (!expected) issues.add('unknownNamespace');
      if (expected && parts.filter((_, index) => index % 2 === 1).some(id => !attachmentActorIdValid(id))) issues.add('invalidDocumentId');
      if (source === 'memories') issues.add('legacyMemoryNamespace');
      if (source === 'memories' && expected && data.uid !== parts[1]) issues.add('legacyOwnerMismatch');
      if (history && expected) {
        const [found] = await db.getAll(db.doc(`sessions/${parts[1]}`), { fieldMask: DOCUMENT_FIELDS.filter(key => key !== 'attachments') });
        if (!found.exists) issues.add('orphanVersion');
        parent = row(found.data());
      }
      if (parsed.count > 0) {
        if (!attachmentActorIdValid(parent.uid)) issues.add('invalidAuthor');
        if (parent.teamId !== null && !attachmentActorIdValid(parent.teamId)) issues.add('invalidDocumentScope');
        if (history && data.uid !== parent.uid) issues.add('historyAuthorMismatch');
      }
      if (parsed.ids.length) {
        const registries = await db.getAll(...parsed.ids.map(id => db.doc(`attachmentUploads/${id}`)), { fieldMask: UPLOAD_FIELDS });
        for (const registry of registries) {
          if (!registry.exists) { issues.add('missingRegistry'); continue; }
          let record: UploadRecord;
          try { record = readAttachmentUploadRecord(registry.data(), registry.id, true); }
          catch (error) {
            if (!(error instanceof https.HttpsError) && !(error instanceof AttachmentPolicyError)) throw error;
            issues.add('invalidRegistry'); continue;
          }
          if (record.status !== 'ready') issues.add('objectNotReady');
          if (record.purgeState) issues.add('objectPurged');
          if (record.referenceSchemaVersion !== 1) issues.add('missingReferenceSchema');
          const descriptors = (data.attachments as unknown[]).filter(value => row(value).url === `mnemosyne-attachment:v1:${registry.id}`);
          if (descriptors.some(value => !exactDescriptor(value, record))) issues.add('descriptorMismatch');
          else result.canonicalReferences += descriptors.length;
          if (!referenceScopeMatches(record, parent, data, history)) issues.add('scopeMismatch');
          await checkRegistryContext(record, issues);
        }
      }
    }
    if (issues.size) result.affectedDocuments++;
    issues.forEach(reason => result.reasons[reason]++);
  }
  return result;
}
