import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { attachmentActorIdValid } from './attachmentEnvelope';

interface BootstrapDeps {
  firestore: FirebaseFirestore.Firestore;
  activeAuthUser: (uid: string) => Promise<boolean>;
  now: () => number;
}
const unavailable = () => new functions.https.HttpsError('permission-denied', 'Conta indisponível.');
const defaults = (): BootstrapDeps => ({
  firestore: admin.firestore(), now: Date.now,
  activeAuthUser: async uid => { try { return !(await admin.auth().getUser(uid)).disabled; } catch { return false; } },
});

/** Idempotent account admission. Existing quotas, entitlements and identities are never reset. */
export async function bootstrapAccount(uid: string, data: unknown, deps = defaults()): Promise<{ ready: true }> {
  if (!attachmentActorIdValid(uid)) throw unavailable();
  if (data === null || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Pedido de inicialização inválido.');
  }
  if (!await deps.activeAuthUser(uid)) throw unavailable();
  await deps.firestore.runTransaction(async tx => {
    const profile = deps.firestore.doc(`users/${uid}`), marker = deps.firestore.doc(`accountDeletions/${uid}`);
    const [existing, deletion] = await tx.getAll(profile, marker);
    // A deletion marker is permanent, including after the profile/Auth user has been removed.
    if (deletion.exists || existing.data()?.deletionState === 'deleting') throw unavailable();
    if (existing.exists) return;
    const now = deps.now();
    if (!Number.isSafeInteger(now) || now < 1) throw unavailable();
    // Absence of a paid entitlement already means free. No client-supplied account fields are accepted.
    tx.create(profile, { accountSchemaVersion: 1, createdAt: now });
  });
  return { ready: true };
}

export const initializeAccount = functions.region('europe-west1').https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
  return bootstrapAccount(context.auth.uid, data);
});
