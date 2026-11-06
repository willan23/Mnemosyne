/**
 * Desktop (Tauri) Google/email login bridge.
 *
 * Google OAuth inside the WebView is blocked (disallowed_useragent / no popup).
 * Flow:
 * 1) Desktop opens the system browser to /desktop-auth?bridge=<uuid>
 * 2) User signs in on the web (authorized domain)
 * 3) sealDesktopAuthBridge stores a short-lived custom token (Admin SDK only)
 * 4) Desktop polls redeemDesktopAuthBridge and calls signInWithCustomToken
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { clientKeyFromRequest, consumeServerRateLimit } from './rateLimit';
import { liveAccountInTransaction } from './accountAccess';
import { attachmentActorIdValid } from './attachmentEnvelope';
if (!admin.apps.length) admin.initializeApp();

const BRIDGE_TTL_MS = 3 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const assertBridgeId = (raw: unknown): string => {
  if (typeof raw !== 'string' || !UUID_RE.test(raw.trim())) {
    throw new functions.https.HttpsError('invalid-argument', 'bridgeId inválido.');
  }
  return raw.trim().toLowerCase();
};
const unavailable = () => new functions.https.HttpsError('failed-precondition', 'Login desktop indisponível. Inicia um novo pedido de login.');
export interface DesktopAuthDeps {
  firestore: FirebaseFirestore.Firestore; now: () => number;
  verifyUser: (uid: string) => Promise<void>; mint: (uid: string) => Promise<string>;
}
const defaults = (): DesktopAuthDeps => ({ firestore: admin.firestore(), now: Date.now,
  verifyUser: async uid => { if ((await admin.auth().getUser(uid)).disabled) throw unavailable(); },
  mint: uid => admin.auth().createCustomToken(uid) });
function parseRequest(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'bridgeId') throw unavailable();
  return assertBridgeId((input as { bridgeId: unknown }).bridgeId);
}
async function readBridgeAccount(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, uid: string) {
  // A newly registered Auth account may still be initializing its profile. Auth existence is checked independently below.
  if (!await liveAccountInTransaction(tx, db, uid, false)) throw unavailable();
}
function validStoredBridge(data: FirebaseFirestore.DocumentData | undefined) {
  return data && attachmentActorIdValid(data.uid) && typeof data.customToken === 'string' && data.customToken.length > 0 && data.customToken.length <= 16384 &&
    Number.isSafeInteger(data.createdAt) && data.createdAt >= 0 && Number.isSafeInteger(data.expiresAt) && data.expiresAt > data.createdAt && data.expiresAt - data.createdAt <= BRIDGE_TTL_MS;
}
/** Recheck deletion after Auth/signing latency. Never replace another account's bridge or extend the original expiry on retry. */
export async function executeSealDesktopAuthBridge(uid: string, input: unknown, deps = defaults()) {
  if (!attachmentActorIdValid(uid)) throw unavailable(); const bridgeId = parseRequest(input); const db = deps.firestore;
  const ref = db.doc(`desktopAuthBridges/${bridgeId}`); const receipt = db.doc(`desktopAuthBridgeReceipts/${bridgeId}`);
  const existingExpiry = await db.runTransaction(async tx => {
    await readBridgeAccount(tx, db, uid); const [bridge, consumed] = await tx.getAll(ref, receipt);
    if (consumed.exists) throw unavailable();
    if (!bridge.exists) return null;
    const value = bridge.data(); if (!validStoredBridge(value) || value!.uid !== uid || value!.expiresAt <= deps.now()) throw unavailable();
    return value!.expiresAt as number;
  });
  await deps.verifyUser(uid);
  if (existingExpiry !== null) {
    await db.runTransaction(async tx => { await readBridgeAccount(tx, db, uid); const [bridge, consumed] = await tx.getAll(ref, receipt);
      if (consumed.exists || bridge.data()?.uid !== uid || bridge.data()?.expiresAt !== existingExpiry || existingExpiry <= deps.now()) throw unavailable(); });
    return { ok: true, expiresAt: existingExpiry };
  }
  const createdAt = deps.now(); const expiresAt = createdAt + BRIDGE_TTL_MS; const customToken = await deps.mint(uid);
  if (typeof customToken !== 'string' || !customToken || customToken.length > 16384 || deps.now() >= expiresAt) throw unavailable();
  return db.runTransaction(async tx => {
    await readBridgeAccount(tx, db, uid); const [bridge, consumed] = await tx.getAll(ref, receipt);
    if (consumed.exists || deps.now() >= expiresAt) throw unavailable();
    if (bridge.exists) {
      const value = bridge.data(); if (!validStoredBridge(value) || value!.uid !== uid || value!.expiresAt <= deps.now()) throw unavailable();
      return { ok: true, expiresAt: value!.expiresAt as number };
    }
    tx.create(ref, { uid, customToken, createdAt, expiresAt }); return { ok: true, expiresAt };
  });
}
/** Verify the Auth account and consume exactly once in a transaction that also observes the deletion marker. */
export async function executeRedeemDesktopAuthBridge(input: unknown, deps = defaults()) {
  const bridgeId = parseRequest(input); const db = deps.firestore; const ref = db.doc(`desktopAuthBridges/${bridgeId}`); const receipt = db.doc(`desktopAuthBridgeReceipts/${bridgeId}`);
  const initial = await db.runTransaction(async tx => {
    const [bridge, consumed] = await tx.getAll(ref, receipt); if (consumed.exists) throw unavailable();
    if (!bridge.exists) return null; const value = bridge.data();
    if (!validStoredBridge(value) || value!.expiresAt <= deps.now()) throw unavailable();
    await readBridgeAccount(tx, db, value!.uid); return value!;
  });
  if (!initial) return { pending: true as const };
  await deps.verifyUser(initial.uid);
  return db.runTransaction(async tx => {
    const [bridge, consumed] = await tx.getAll(ref, receipt); const value = bridge.data();
    if (consumed.exists || !validStoredBridge(value) || value!.uid !== initial.uid || value!.customToken !== initial.customToken ||
        value!.createdAt !== initial.createdAt || value!.expiresAt !== initial.expiresAt || value!.expiresAt <= deps.now()) throw unavailable();
    await readBridgeAccount(tx, db, initial.uid);
    tx.create(receipt, { v: 1, status: 'consumed', consumedAt: deps.now() }); tx.delete(ref);
    return { pending: false as const, token: initial.customToken as string };
  });
}

export const sealDesktopAuthBridge = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Inicia sessão na web primeiro.');
    }

    parseRequest(data);
    if (!(await consumeServerRateLimit(`uid:${context.auth.uid}`, { bucket: 'desktop-auth-seal', max: 10, windowMs: 60000 })).allowed) throw unavailable();
    try { return await executeSealDesktopAuthBridge(context.auth.uid, data); } catch { throw unavailable(); }
  });

export const redeemDesktopAuthBridge = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    // Unauthenticated on purpose — desktop is not signed in yet.
    const req = context.rawRequest;
    const clientKey = clientKeyFromRequest(req);
    const decision = await consumeServerRateLimit(clientKey, {
      bucket: 'desktop-auth-redeem',
      windowMs: 60_000,
      max: 30,
    });
    if (!decision.allowed) {
      throw new functions.https.HttpsError('resource-exhausted', 'Demasiadas tentativas. Aguarda.');
    }

    try { return await executeRedeemDesktopAuthBridge(data); } catch { throw unavailable(); }
  });
