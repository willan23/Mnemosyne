/**
 * API keys for the public HTTP v1 / MCP surface.
 *
 * The plaintext `mne_live_…` secret is shown once at creation. Firestore stores
 * only SHA-256(hex) as the document id, plus metadata. Clients cannot write
 * this collection (see firestore.rules).
 */

import { createHash, randomBytes } from 'crypto';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { liveAccountInTransaction } from './accountAccess';
import type { AgentVaultAdmission } from './agentVaultContract';

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.warn('firebase-admin initializeApp deferred (unit tests / missing ADC)');
  }
}

const regionalFunctions = functions.region('europe-west1');

export const API_KEY_PREFIX = 'mne_live_';
export const API_KEYS_COLLECTION = 'apiKeys';
export const MAX_ACTIVE_API_KEYS = 10;

export const API_SCOPES = ['memories:read', 'memories:write', 'memories:search'] as const;
/** Reviewed agent mutation admission. Direct v1 writes remain retired even when this opens. */
export const API_MEMORY_WRITES_ENABLED = false;
export type ApiScope = typeof API_SCOPES[number];

export interface ApiKeyRecord {
  credentialKind?: 'agent-grant';
  /** Internal OAuth admission metadata, never accepted from an API payload. */
  agentSessionId?: string;
  agentSessionExpiresAt?: number;
  clientId?: string;
  grantVersion?: number;
  accessEpoch?: number;
  /** Present on OAuth grants; permanent API keys remain personal. */
  vault?: AgentVaultAdmission;
  id: string;
  uid: string;
  name: string;
  scopes: ApiScope[];
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
  keyPrefix: string;
}

export interface CreatedApiKey extends ApiKeyRecord {
  /** Plaintext secret — returned only from createApiKey. */
  secret: string;
}

const getDb = (): FirebaseFirestore.Firestore => {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
};

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function generateApiKey(now = Date.now()): {
  secret: string;
  keyHash: string;
  keyPrefix: string;
  createdAt: number;
} {
  const secret = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  return {
    secret,
    keyHash: hashApiKey(secret),
    keyPrefix: secret.slice(0, 16),
    createdAt: now,
  };
}

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

export function parseAndValidateScopes(raw: unknown): ApiScope[] {
  if (raw == null) return ['memories:read', 'memories:search'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('scopes must be a non-empty array of memories:read|write|search');
  }
  const scopes: ApiScope[] = [];
  for (const item of raw) {
    if (!isApiScope(item)) {
      throw new Error('unknown scope');
    }
    if (item === 'memories:write') {
      throw new Error('Direct memory writes are paused; use reviewed agent consent');
    }
    if (!scopes.includes(item)) scopes.push(item);
  }
  return scopes;
}

export function keyHasScope(key: Pick<ApiKeyRecord, 'scopes'>, scope: ApiScope): boolean {
  return key.scopes.includes(scope);
}

export function extractBearerToken(req: { headers?: Record<string, unknown> }): string | null {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

export function readKeyDoc(id: string, data: FirebaseFirestore.DocumentData | undefined): ApiKeyRecord | null {
  if (!data) return null;
  const uid = typeof data.uid === 'string' ? data.uid : '';
  const name = typeof data.name === 'string' ? data.name : '';
  if (!uid) return null;
  const scopes = Array.isArray(data.scopes)
    ? data.scopes.filter(isApiScope)
    : ['memories:read', 'memories:search'] as ApiScope[];
  return {
    id,
    uid,
    name,
    scopes,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    lastUsedAt: typeof data.lastUsedAt === 'number' ? data.lastUsedAt : null,
    revoked: data.revoked === true,
    keyPrefix: typeof data.keyPrefix === 'string' ? data.keyPrefix : API_KEY_PREFIX,
  };
}

export async function verifyApiKeySecret(secret: string, db: FirebaseFirestore.Firestore = getDb()): Promise<ApiKeyRecord | null> {
  if (!secret.startsWith(API_KEY_PREFIX) || secret.length < 20) return null;
  const keyHash = hashApiKey(secret);
  return db.runTransaction(async tx => {
    const snap = await tx.get(db.collection(API_KEYS_COLLECTION).doc(keyHash));
    const record = readKeyDoc(snap.id, snap.data());
    if (!record || record.revoked || !await liveAccountInTransaction(tx, db, record.uid)) return null;
    const profile = await tx.get(db.collection('users').doc(record.uid));
    return profile.data()?.agentAccessDisabled === true ? null : record;
  });
}

export async function touchApiKeyLastUsed(keyId: string, lastUsedAt: number | null, now = Date.now()): Promise<void> {
  if (lastUsedAt && now - lastUsedAt < 60_000) return;
  try {
    const db = getDb();
    await db.runTransaction(async tx => {
      const ref = db.collection(API_KEYS_COLLECTION).doc(keyId); const snap = await tx.get(ref);
      const record = readKeyDoc(snap.id, snap.data());
      if (!record || record.revoked || !await liveAccountInTransaction(tx, db, record.uid)) return;
      tx.update(ref, { lastUsedAt: now });
    });
  } catch {
    console.warn('touchApiKeyLastUsed failed');
  }
}

const sanitizeName = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, 64);
};

const publicKeyView = (record: ApiKeyRecord) => ({
  id: record.id,
  keyPrefix: record.keyPrefix,
  name: record.name,
  scopes: record.scopes,
  createdAt: record.createdAt,
  lastUsedAt: record.lastUsedAt,
  revoked: record.revoked,
});

export async function executeCreateApiKey(
  uid: string,
  data: unknown,
  db: FirebaseFirestore.Firestore = getDb(),
  now = Date.now(),
): Promise<CreatedApiKey> {
  const payload = asRecord(data);
  const name = sanitizeName(payload.name);
  if (!name) {
    throw new functions.https.HttpsError('invalid-argument', 'name is required (1–64 characters)');
  }

  let scopes: ApiScope[];
  try {
    scopes = parseAndValidateScopes(payload.scopes);
  } catch (error) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      error instanceof Error ? error.message : 'invalid scopes',
    );
  }

  const generated = generateApiKey(now);
  const record: ApiKeyRecord = {
    id: generated.keyHash,
    uid,
    name,
    scopes,
    createdAt: generated.createdAt,
    lastUsedAt: null,
    revoked: false,
    keyPrefix: generated.keyPrefix,
  };

  await db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw new functions.https.HttpsError('failed-precondition', 'Account unavailable');
    const profileRef = db.doc(`users/${uid}`); const profile = (await tx.get(profileRef)).data()!;
    const existing = await tx.get(db.collection(API_KEYS_COLLECTION).where('uid', '==', uid).limit(50));
    const activeCount = existing.docs.filter(docSnap => docSnap.data()?.revoked !== true).length;
    if (activeCount >= MAX_ACTIVE_API_KEYS || existing.size === 50) {
      throw new functions.https.HttpsError('resource-exhausted', 'API key limit reached; revoke active keys or review the key inventory.');
    }
    const revision = profile.apiKeyRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new functions.https.HttpsError('failed-precondition', 'Account unavailable');
    // Serialize the per-account limit even when its first query is empty.
    tx.update(profileRef, { apiKeyRevision: revision + 1 });
    tx.create(db.collection(API_KEYS_COLLECTION).doc(generated.keyHash), { keyHash: generated.keyHash, ...record });
  });

  return { ...record, secret: generated.secret };
}

export async function executeListApiKeys(
  uid: string,
  db: FirebaseFirestore.Firestore = getDb(),
): Promise<{ keys: ReturnType<typeof publicKeyView>[] }> {
  const snapshot = await db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw new functions.https.HttpsError('failed-precondition', 'Account unavailable');
    return tx.get(db.collection(API_KEYS_COLLECTION).where('uid', '==', uid).limit(50));
  });
  const keys = snapshot.docs
    .map((docSnap) => readKeyDoc(docSnap.id, docSnap.data()))
    .filter((item): item is ApiKeyRecord => item !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicKeyView);
  return { keys };
}

export async function executeRevokeApiKey(
  uid: string,
  data: unknown,
  db: FirebaseFirestore.Firestore = getDb(),
  now = Date.now(),
): Promise<{ ok: true; id: string }> {
  const keyId = typeof asRecord(data).keyId === 'string' ? String(asRecord(data).keyId).trim() : '';
  if (!keyId || !/^[a-f0-9]{64}$/i.test(keyId)) {
    throw new functions.https.HttpsError('invalid-argument', 'keyId (SHA-256 hex) is required');
  }

  const ref = db.collection(API_KEYS_COLLECTION).doc(keyId);
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw new functions.https.HttpsError('failed-precondition', 'Account unavailable');
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'API key not found');
    }
    const record = readKeyDoc(snap.id, snap.data());
    if (!record || record.uid !== uid) {
      throw new functions.https.HttpsError('not-found', 'API key not found');
    }
    if (record.revoked) {
      return { ok: true, id: keyId };
    }

    tx.update(ref, { revoked: true, revokedAt: now });
    return { ok: true, id: keyId };
  });
}

export const createApiKey = regionalFunctions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  const created = await executeCreateApiKey(context.auth.uid, data);
  return {
    ...publicKeyView(created),
    secret: created.secret,
  };
});

export const listApiKeys = regionalFunctions.https.onCall(async (_data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  return executeListApiKeys(context.auth.uid);
});

export const revokeApiKey = regionalFunctions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  return executeRevokeApiKey(context.auth.uid, data);
});
