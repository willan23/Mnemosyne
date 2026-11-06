import * as functions from 'firebase-functions/v1';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { attachmentSessionRevision } from './attachmentMutationContract';
import type { AttachmentUploadDeps, UploadRecord } from './attachmentUploads';
const fail = () => new functions.https.HttpsError('failed-precondition', 'Attachment reference cleanup unavailable');
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** A revoked uploader can erase its canonical references without changing another author's encrypted content. */
export async function purgeAccountAttachmentReferences(record: UploadRecord, descriptor: Record<string, unknown>, deps: AttachmentUploadDeps) {
  const db = deps.firestore; const uid = record.uid; const id = record.header.id;
  if (!attachmentActorIdValid(uid) || descriptor.url !== `mnemosyne-attachment:v1:${id}` || record.referenceSchemaVersion !== 1) throw fail();
  const registry = db.doc(`attachmentUploads/${id}`);
  const authorize = async (tx: FirebaseFirestore.Transaction) => {
    const [profile, marker, upload] = await tx.getAll(db.doc(`users/${uid}`), db.doc(`accountDeletions/${uid}`), registry);
    const current = upload.data();
    if (profile.data()?.deletionState !== 'deleting' || marker.data()?.v !== 1 || marker.data()?.status !== 'deleting' || marker.data()?.phase !== 'objects' ||
        !current || current.uid !== uid || current.header?.uid !== uid || current.header?.id !== id ||
        current.digest !== record.digest || !same(current.header.scope, record.header.scope) || current.referenceSchemaVersion !== 1 ||
        current.status !== 'ready' || !['pending', 'deleted'].includes(current.purgeState) || current.purgeReason !== 'account') throw fail();
  };
  const sessions = () => db.collection('sessions').where('attachments', 'array-contains', descriptor);
  const versions = () => db.collectionGroup('versions').where('attachments', 'array-contains', descriptor);
  let currentRemoved = 0; let historyRemoved = 0;
  for (const [history, query] of [[false, sessions], [true, versions]] as const) {
    for (let page = 0; page < 20; page++) {
      const rows = await query().limit(50).get(); if (rows.empty) break;
      for (const row of rows.docs) {
        const parts = row.ref.path.split('/');
        if (parts[0] !== 'sessions' || !attachmentActorIdValid(parts[1]) ||
            (history ? parts.length !== 4 || parts[2] !== 'versions' || !attachmentActorIdValid(parts[3]) : parts.length !== 2)) throw fail();
        const count = await db.runTransaction(async tx => {
          await authorize(tx);
          const target = await tx.get(row.ref); if (!target.exists) return 0;
          const parent = history ? await tx.get(db.doc(`sessions/${parts[1]}`)) : target;
          const data = target.data()!; const owner = parent.data(); const scope = record.header.scope;
          if (!owner || !attachmentActorIdValid(owner.uid) ||
              (scope.kind === 'team' ? owner.teamId !== scope.teamId || (history && data.teamId !== scope.teamId) : owner.uid !== uid || owner.teamId !== null) ||
              !Array.isArray(data.attachments)) throw fail();
          const remaining = data.attachments.filter(item => item?.url !== descriptor.url);
          const matches = data.attachments.filter(item => item?.url === descriptor.url);
          // The indexed canonical entry cannot authorize altering a malformed duplicate for the same object.
          if (matches.some(item => Object.keys(item).sort().join(',') !== Object.keys(descriptor).sort().join(',') ||
              Object.keys(descriptor).some(key => item[key] !== descriptor[key]))) throw fail();
          if (!matches.length) return 0;
          if (history) tx.update(row.ref, { attachments: remaining });
          else {
            const updatedAt = Math.max(deps.now(), attachmentSessionRevision(data) + 1);
            if (!Number.isSafeInteger(updatedAt)) throw fail();
            tx.update(row.ref, { attachments: remaining, updatedAt });
          }
          return matches.length;
        });
        if (history) historyRemoved += count; else currentRemoved += count;
      }
    }
  }
  const complete = await db.runTransaction(async tx => {
    await authorize(tx); const [current, history] = await Promise.all([tx.get(sessions().limit(1)), tx.get(versions().limit(1))]);
    return current.empty && history.empty;
  });
  return { complete, currentRemoved, historyRemoved };
}
