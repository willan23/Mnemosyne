import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { liveAccountInTransaction } from './accountAccess';
import { parseAgentAccessCommand, readAgentAccessState } from './agentAccountContract';

/** Only the authenticated account owner can operate the gateway switch. */
export async function executeSetAgentAccess(uid: string, value: unknown,
    database?: FirebaseFirestore.Firestore) {
    let command;
    try { command = parseAgentAccessCommand(value); }
    catch { throw new functions.https.HttpsError('invalid-argument', 'Invalid agent control command'); }
    if (command.expectedUid !== uid) throw new functions.https.HttpsError('failed-precondition', 'Account changed');
    const db = database ?? admin.firestore();
    const { disabled, baseline } = command;
    const eventRef = db.collection('users').doc(uid).collection('agentEvents').doc();
    return db.runTransaction(async tx => {
        if (!await liveAccountInTransaction(tx, db, uid)) throw new functions.https.HttpsError('failed-precondition', 'Account unavailable');
        const ref = db.collection('users').doc(uid);
        const profile = await tx.get(ref);
        if (!profile.exists || profile.data()?.deletionState === 'deleting') {
            throw new functions.https.HttpsError('failed-precondition', 'Account unavailable');
        }
        const current = readAgentAccessState(profile.data());
        if (!current || current.epoch !== baseline.epoch || current.disabled !== baseline.disabled) {
            throw new functions.https.HttpsError('failed-precondition', 'Agent access state changed');
        }
        // Every stop invalidates previous short sessions, including after resume.
        const epoch = current.epoch + (disabled ? 1 : 0);
        if (!Number.isSafeInteger(epoch)) throw new functions.https.HttpsError('failed-precondition', 'Agent access state unavailable');
        tx.update(ref, { agentAccessDisabled: disabled, agentAccessEpoch: epoch,
            agentAccessUpdatedAt: admin.firestore.FieldValue.serverTimestamp() });
        tx.create(eventRef, { kind: disabled ? 'access-stopped' : 'access-resumed',
            source: 'account-owner', schemaVersion: 2, accessEpoch: epoch,
            occurredAt: admin.firestore.FieldValue.serverTimestamp() });
        return { disabled, epoch };
    });
}

export const setAgentAccess = functions.region('europe-west1').https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    return executeSetAgentAccess(context.auth.uid, data);
});
