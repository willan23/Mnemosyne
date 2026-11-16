import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') =>
  new functions.https.HttpsError(code, 'Deletion unavailable; retry retains the deletion request');

/** Bounded cleanup proves exhaustion before reporting success. */
export async function deleteAccountQuery(db: FirebaseFirestore.Firestore, query: () => FirebaseFirestore.Query, recursive = false) {
  for (let page = 0; page < 20; page++) {
    const rows = await query().limit(100).get(); if (rows.empty) return;
    if (recursive) for (const row of rows.docs) await deleteAccountDocumentTree(db, row.ref);
    else { const batch = db.batch(); rows.docs.forEach(row => batch.delete(row.ref)); await batch.commit(); }
  }
  if (!(await query().limit(1).get()).empty) throw fail('resource-exhausted');
}
/** Preserve the parent query anchor until every child collection is confirmed deleted. */
export async function deleteAccountDocumentTree(db: FirebaseFirestore.Firestore, ref: FirebaseFirestore.DocumentReference) {
  for (const child of await ref.listCollections()) await db.recursiveDelete(child);
  await ref.delete();
}
export const TEAM_BOUND_COLLECTIONS = ['teamInvites', 'teamInviteInbox', 'teamAudit', 'teamKeyRotations', 'teamRotationRequests', 'agentMutationReceipts', 'agentMutationProposals', 'agentMutationTeamBudgets', 'agentMutationReversals',
  'memoryCreationReceipts', 'attachmentMutations', 'notifications', 'teamAiBudgets', 'teamAiBudgetWindows', 'teamRevisions', 'teamRevisionBudgets', 'teamRevisionTeamBudgets', 'memoryEdits', 'memoryEditEvents', 'memoryEditBudgets', 'memoryEditTeamBudgets', 'teamConnectionChanges', 'teamConnectionEvents', 'semanticClusterChanges', 'semanticClusterEvents', 'semanticClusterBudgets', 'semanticClusterTeamBudgets', 'teamHistoryChanges', 'teamHistoryEvents', 'teamHistoryCipherArchives', 'teamHistoryBudgets', 'teamHistoryTeamBudgets'];
/** Cancel original creation receipts so a lost creation ACK cannot recreate the deleted team/key. */
export async function cancelDeletedTeamCreationRequests(db: FirebaseFirestore.Firestore, teamId: string, now: number) {
  const query = () => db.collection('teamCreationRequests').where('teamId', '==', teamId);
  for (let page = 0; page < 20; page++) {
    const rows = await query().limit(100).get(); if (rows.empty) return;
    for (const row of rows.docs) await db.runTransaction(async tx => {
      const fresh = await tx.get(row.ref); if (!fresh.exists || fresh.data()?.teamId !== teamId) return;
      tx.update(row.ref, { status: 'cancelled', cancelledAt: now, teamId: admin.firestore.FieldValue.delete() });
    });
  }
  if (!(await query().limit(1).get()).empty) throw fail('resource-exhausted');
}

/** Legacy URLs lack trusted ownership; keep their query anchors until migration can prove it. */
export async function purgeSessions(db: FirebaseFirestore.Firestore, query: () => FirebaseFirestore.Query, team = false) {
  for (let page = 0; page < 20; page++) {
    const rows = await query().limit(50).get(); if (rows.empty) return;
    for (const row of rows.docs) {
      if (team) {
        const legacy = (data: FirebaseFirestore.DocumentData) => Array.isArray(data.attachments) && data.attachments.some(item =>
          !item || typeof item.url !== 'string' || !/^mnemosyne-attachment:v1:[0-9a-f-]{36}$/.test(item.url));
        if (legacy(row.data())) throw fail();
        let cursor: FirebaseFirestore.DocumentSnapshot | undefined;
        for (;;) {
          const base = row.ref.collection('versions').orderBy(admin.firestore.FieldPath.documentId());
          const versions = await (cursor ? base.startAfter(cursor) : base).limit(100).get();
          if (versions.docs.some(version => legacy(version.data()))) throw fail();
          if (versions.size < 100) break; cursor = versions.docs[versions.docs.length - 1];
        }
      }
      await deleteAccountQuery(db, () => db.collection('shares').where('sessionId', '==', row.id), true);
      await deleteAccountQuery(db, () => db.collection('shares').where('sourceIds', 'array-contains', row.id), true);
      for (const collection of ['attachmentMutations', 'memoryCreationReceipts', 'memoryUsageReceipts']) {
        await deleteAccountQuery(db, () => db.collection(collection).where('sessionId', '==', row.id), true);
      }
      await deleteAccountDocumentTree(db, row.ref);
    }
  }
  if (!(await query().limit(1).get()).empty) throw fail('resource-exhausted');
}
