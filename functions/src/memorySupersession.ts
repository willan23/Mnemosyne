import { createHash } from 'node:crypto';
import { syncIdValid, syncInteger } from './mobileSyncImportContract';
import { attachmentActorIdValid } from './attachmentEnvelope';

export interface MemorySupersession {
  operationId: string; memoryId: string; previousRevision: number; revision: number;
  versionId: string; source: 'memory-edit' | 'personal-revision' | 'team-revision' | 'sync-conflict' | 'agent-reversal';
}

/** Caller has checked the live actor/ACL and archives the previous revision in this transaction.
 * A supersession replaces a revision, never asserts that a different fact is true. */
export function recordMemorySupersession(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore,
  uid: string, input: MemorySupersession): void {
  const prefixes = { 'memory-edit': 'memory-edit-', 'personal-revision': 'revision-',
    'team-revision': 'team-revision-', 'sync-conflict': 'sync-conflict-', 'agent-reversal': 'agent-reversal-' };
  if (!attachmentActorIdValid(uid) || !syncIdValid(input.memoryId) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.operationId) ||
    !Object.prototype.hasOwnProperty.call(prefixes, input.source) || input.versionId !== prefixes[input.source] + input.operationId ||
    !syncInteger(input.previousRevision) || !syncInteger(input.revision) || input.revision <= input.previousRevision || input.revision > 8.64e15) {
    throw new Error('memory_supersession_invalid');
  }
  const id = createHash('sha256').update(JSON.stringify(['supersede-v1', input.source, input.operationId, input.memoryId])).digest('hex');
  // Receipt replay returns before this function; a collision aborts the complete mutation.
  tx.create(db.doc(`users/${uid}/memoryEvents/${id}`), {
    schemaVersion: 2, kind: 'supersede', memoryId: input.memoryId,
    previousRevision: input.previousRevision, revision: input.revision, versionId: input.versionId,
    occurredAt: new Date(input.revision).toISOString(), recordedAt: new Date().toISOString(), source: input.source,
  });
}
