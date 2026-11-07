import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { liveAccountInTransaction, isLiveAccount } from './accountAccess';
import { API_MEMORY_WRITES_ENABLED, ApiKeyRecord, ApiScope, hashApiKey } from './apiKeys';
import { AGENT_TOKEN_LIFETIME_MS } from './agentCredentials';
import { consumeServerRateLimit } from './rateLimit';
import { agentUidValid, readAgentAccessState } from './agentAccountContract';
import { agentCodePrefix, agentTokenPrefix, parseAgentScopes, agentVaultAdmissionBytes, agentVaultSelector, parseAgentVaultAdmission, parseAgentVaultSelector, type AgentVaultAdmission, type AgentVaultTarget } from './agentVaultContract';
import { assertAgentVaultAdmission, inspectAgentVault } from './agentVaultAccess';

export const AGENT_AUTHORIZATION_LIFETIME_MS = 2 * 60_000;
export const MAX_ACTIVE_AGENT_GRANTS = 20;
export const AGENT_OAUTH_ISSUER = 'https://mnemosyne-one.web.app';
export interface AgentConsentPolicy { writesEnabled: boolean }
const consentPolicy = (): AgentConsentPolicy => ({ writesEnabled: API_MEMORY_WRITES_ENABLED });
type Data = Record<string, unknown>;
interface AuthorizationRequest {
    client_id: string; redirect_uri: string; scope: string; scopes: ApiScope[];
    vault: string;
    state: string; code_challenge: string; code_challenge_method: 'S256'; response_type: 'code';
}
interface RegisteredClient { name: string; redirectUris: string[]; scopes: ApiScope[]; vaultTypes: AgentVaultTarget['kind'][] }
const invalid = () => new functions.https.HttpsError('invalid-argument', 'Invalid agent authorization request');
const unavailable = () => new functions.https.HttpsError('failed-precondition', 'Agent authorization unavailable');
const record = (raw: unknown): Data => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Data : {};
const digest = (raw: string) => createHash('sha256').update(raw).digest('base64url');
const grantIdFor = (uid: string, client: string, vault: string) => hashApiKey(JSON.stringify(vault === 'personal' ? [uid, client] : [uid, client, vault]));

// Public clients must register exact HTTPS destinations. No wildcard, custom scheme or fragment.
function validRedirect(raw: unknown): raw is string {
    if (typeof raw !== 'string' || raw.length > 2048) return false;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
            !['code', 'state', 'error', 'iss'].some(key => url.searchParams.has(key));
    } catch { return false; }
}
function readClient(data: Data | undefined): RegisteredClient | null {
    if (!data || data.enabled !== true || typeof data.name !== 'string' || !data.name.trim() ||
        data.name.length > 100 || !Array.isArray(data.redirectUris) || !data.redirectUris.length ||
        data.redirectUris.length > 10 || !data.redirectUris.every(validRedirect) || !Array.isArray(data.scopes)) return null;
    try {
        const scopes = parseAgentScopes(data.scopes);
        const vaultTypes = data.vaultTypes === undefined ? ['personal'] : data.vaultTypes;
        if (!Array.isArray(vaultTypes) || !vaultTypes.length || vaultTypes.length > 2 ||
            new Set(vaultTypes).size !== vaultTypes.length || vaultTypes.some(kind => kind !== 'personal' && kind !== 'team')) return null;
        return { name: data.name, redirectUris: data.redirectUris, scopes, vaultTypes };
    } catch { return null; }
}
export function parseAgentAuthorization(raw: unknown): AuthorizationRequest {
    const data = record(raw);
    if (data.response_type !== 'code' || data.code_challenge_method !== 'S256' ||
        typeof data.client_id !== 'string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(data.client_id) ||
        !validRedirect(data.redirect_uri) || typeof data.state !== 'string' ||
        !/^[A-Za-z0-9._~-]{16,512}$/.test(data.state) || typeof data.code_challenge !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(data.code_challenge) ||
        Buffer.from(data.code_challenge, 'base64url').toString('base64url') !== data.code_challenge ||
        typeof data.scope !== 'string' || data.scope.length > 100) throw invalid();
    let scopes: ApiScope[], vault: string;
    try { scopes = parseAgentScopes(data.scope.split(' ')); vault = agentVaultSelector(parseAgentVaultSelector(data.vault)); } catch { throw invalid(); }
    return { client_id: data.client_id, redirect_uri: data.redirect_uri, scope: scopes.join(' '), scopes, vault,
        state: data.state, code_challenge: data.code_challenge, code_challenge_method: 'S256', response_type: 'code' };
}
function assertAvailable(client: RegisteredClient | null, request: AuthorizationRequest, profile: Data | undefined) {
    if (!client || !client.redirectUris.includes(request.redirect_uri) || request.scopes.some(s => !client.scopes.includes(s)) ||
        !client.vaultTypes.includes(parseAgentVaultSelector(request.vault).kind) ||
        !profile || profile.deletionState === 'deleting' || profile.agentAccessDisabled === true) throw unavailable();
}
function consentDigest(uid: string, request: AuthorizationRequest, client: RegisteredClient, epoch: unknown, vault: AgentVaultAdmission) {
    return hashApiKey(JSON.stringify([uid, request, client, epoch ?? 0, vault]));
}
function callbackUrl(request: AuthorizationRequest, response: { code: string } | { error: string }) {
    const url = new URL(request.redirect_uri);
    for (const [key, value] of Object.entries(response)) url.searchParams.set(key, value);
    url.searchParams.set('state', request.state);
    url.searchParams.set('iss', AGENT_OAUTH_ISSUER);
    return url.toString();
}
export async function executePreviewAgentAuthorization(uid: string, raw: unknown,
    db: FirebaseFirestore.Firestore = admin.firestore(), policy = consentPolicy()) {
    const request = parseAgentAuthorization(raw);
    if (request.scopes.includes('memories:write') && !policy.writesEnabled) throw unavailable();
    return db.runTransaction(async tx => {
        if (!await liveAccountInTransaction(tx, db, uid)) throw unavailable();
        const [clientDoc, profileDoc] = await tx.getAll(db.collection('agentClients').doc(request.client_id), db.collection('users').doc(uid));
        const client = readClient(clientDoc.data());
        assertAvailable(client, request, profileDoc.data());
        const vault = await inspectAgentVault(tx, db, uid, parseAgentVaultSelector(request.vault)).catch(() => { throw unavailable(); });
        return { clientName: client!.name, redirectUri: request.redirect_uri, scopes: request.scopes, vault: request.vault, vaultName: vault.name,
            consentDigest: consentDigest(uid, request, client!, profileDoc.data()?.agentAccessEpoch, vault.admission),
            denialUrl: callbackUrl(request, { error: 'access_denied' }) };
    });
}
export async function executeAuthorizeAgentClient(uid: string, raw: unknown,
    db: FirebaseFirestore.Firestore = admin.firestore(), now = Date.now(), policy = consentPolicy()) {
    const data = record(raw);
    if (data.confirmed !== true || data.expectedUid !== uid || typeof data.consentDigest !== 'string') throw invalid();
    const request = parseAgentAuthorization(data);
    if (request.scopes.includes('memories:write') && !policy.writesEnabled) throw unavailable();
    const code = `${agentCodePrefix(parseAgentVaultSelector(request.vault), request.scopes)}${randomBytes(32).toString('base64url')}`;
    const grantId = grantIdFor(uid, request.client_id, request.vault);
    const eventRef = db.collection('users').doc(uid).collection('agentEvents').doc();
    await db.runTransaction(async tx => {
        if (!await liveAccountInTransaction(tx, db, uid)) throw unavailable();
        const grantRef = db.collection('agentGrants').doc(grantId);
        const [clientDoc, profileDoc, grantDoc] = await tx.getAll(db.collection('agentClients').doc(request.client_id),
            db.collection('users').doc(uid), grantRef);
        const activeGrants = await tx.get(db.collection('agentGrants').where('uid', '==', uid)
            .where('revoked', '==', false).limit(MAX_ACTIVE_AGENT_GRANTS));
        const client = readClient(clientDoc.data());
        const profile = profileDoc.data();
        assertAvailable(client, request, profile);
        const vault = await inspectAgentVault(tx, db, uid, parseAgentVaultSelector(request.vault)).catch(() => { throw unavailable(); });
        if (data.consentDigest !== consentDigest(uid, request, client!, profile?.agentAccessEpoch, vault.admission)) throw unavailable();
        if (grantDoc.data()?.revoked !== false && activeGrants.size >= MAX_ACTIVE_AGENT_GRANTS) {
            throw new functions.https.HttpsError('resource-exhausted', 'Revoke an application before authorizing another');
        }
        // Each new consent invalidates older codes/tokens for this user and application.
        const previous = grantDoc.data()?.version;
        const version = (Number.isSafeInteger(previous) && previous >= 0 ? previous : 0) + 1;
        if (!Number.isSafeInteger(version)) throw unavailable();
        tx.set(grantRef, { uid, clientId: request.client_id, name: client!.name, scopes: request.scopes,
            vault: vault.admission, vaultName: vault.name, version, revoked: false, createdAt: now, lastUsedAt: null });
        tx.create(db.collection('agentAuthorizationCodes').doc(hashApiKey(code)), { uid, clientId: request.client_id,
            redirectUri: request.redirect_uri, scopes: request.scopes, codeChallenge: request.code_challenge,
            grantId, grantVersion: version, vault: vault.admission, accessEpoch: profile?.agentAccessEpoch ?? 0,
            createdAt: now, expiresAt: now + AGENT_AUTHORIZATION_LIFETIME_MS,
            deleteAfter: admin.firestore.Timestamp.fromMillis(now + AGENT_AUTHORIZATION_LIFETIME_MS) });
        tx.create(eventRef, { kind: 'consent-granted', source: 'account-owner', clientId: request.client_id,
            scopes: request.scopes, vault: request.vault, schemaVersion: 2, occurredAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    return { redirectUrl: callbackUrl(request, { code }) };
}

export async function redeemAgentAuthorizationCode(raw: unknown,
    db: FirebaseFirestore.Firestore = admin.firestore(), now = Date.now(), policy = consentPolicy()) {
    const data = record(raw);
    if (data.grant_type !== 'authorization_code' || typeof data.code !== 'string' ||
        !/^mne_(?:code|vault_code|review_code)_[A-Za-z0-9_-]{43}$/.test(data.code) || typeof data.client_id !== 'string' ||
        !/^[A-Za-z0-9_-]{3,64}$/.test(data.client_id) || !validRedirect(data.redirect_uri) ||
        typeof data.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(data.code_verifier)) throw invalid();
    const challenge = digest(data.code_verifier);
    const entropy = randomBytes(32).toString('base64url');
    const expiresAt = now + AGENT_TOKEN_LIFETIME_MS;
    const scopes = await db.runTransaction(async tx => {
        const codeRef = db.collection('agentAuthorizationCodes').doc(hashApiKey(data.code as string));
        const code = (await tx.get(codeRef)).data();
        if (!code || typeof code.uid !== 'string' || typeof code.grantId !== 'string' ||
            !/^[a-f0-9]{64}$/.test(code.grantId) || !Array.isArray(code.scopes) ||
            !Number.isSafeInteger(code.grantVersion) || code.grantVersion < 1 ||
            code.clientId !== data.client_id || code.redirectUri !== data.redirect_uri ||
            !Number.isFinite(code.createdAt) || !Number.isFinite(code.expiresAt) || code.createdAt > now ||
            code.expiresAt <= now || code.expiresAt > code.createdAt + AGENT_AUTHORIZATION_LIFETIME_MS ||
            typeof code.codeChallenge !== 'string' || Buffer.byteLength(code.codeChallenge) !== Buffer.byteLength(challenge) ||
            !timingSafeEqual(Buffer.from(code.codeChallenge), Buffer.from(challenge))) throw unavailable();
        if (!await liveAccountInTransaction(tx, db, code.uid)) throw unavailable();
        const [clientDoc, profileDoc, grantDoc] = await tx.getAll(db.collection('agentClients').doc(code.clientId),
            db.collection('users').doc(code.uid), db.collection('agentGrants').doc(code.grantId));
        const client = readClient(clientDoc.data());
        const profile = profileDoc.data();
        const grant = grantDoc.data();
        const requested = parseAgentScopes(code.scopes);
        if (!client || !client.redirectUris.includes(code.redirectUri) || requested.includes('memories:write') && !policy.writesEnabled ||
            !profile || profile.agentAccessDisabled === true || profile.deletionState === 'deleting' ||
            (profile.agentAccessEpoch ?? 0) !== code.accessEpoch || !grant || grant.revoked !== false ||
            grant.uid !== code.uid || grant.clientId !== code.clientId || grant.version !== code.grantVersion ||
            !Array.isArray(grant.scopes) || requested.some(s => !client.scopes.includes(s) || !grant.scopes.includes(s))) throw unavailable();
        let vault: AgentVaultAdmission;
        try {
            vault = parseAgentVaultAdmission(code.vault, true);
            if (!(data.code as string).startsWith(agentCodePrefix(vault, requested))) throw unavailable();
            if (!client.vaultTypes.includes(vault.kind) || agentVaultAdmissionBytes(vault) !== agentVaultAdmissionBytes(parseAgentVaultAdmission(grant.vault, true))) throw unavailable();
            await assertAgentVaultAdmission(tx, db, code.uid, vault);
        } catch { throw unavailable(); }
        const prefix = agentTokenPrefix(vault, requested), secret = `${prefix}${entropy}`;
        tx.delete(codeRef);
        tx.create(db.collection('agentSessions').doc(hashApiKey(secret)), { uid: code.uid, clientId: code.clientId,
            grantId: code.grantId, grantVersion: code.grantVersion, scopes: requested, vault, credentialPrefix: prefix, accessEpoch: code.accessEpoch,
            createdAt: now, expiresAt, revoked: false, deleteAfter: admin.firestore.Timestamp.fromMillis(expiresAt) });
        tx.create(db.collection('users').doc(code.uid).collection('agentEvents').doc(), {
            kind: 'session-issued', source: 'oauth-pkce', clientId: code.clientId, scopes: requested,
            expiresAt, vault: agentVaultSelector(vault), schemaVersion: 2, occurredAt: admin.firestore.FieldValue.serverTimestamp() });
        return { scopes: requested, secret };
    });
    return { access_token: scopes.secret, token_type: 'Bearer' as const, expires_in: AGENT_TOKEN_LIFETIME_MS / 1000, scope: scopes.scopes.join(' ') };
}

/** Shared transaction admission for token verification and human-approved mutations. */
export async function inspectOAuthAgentSession(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore,
    sessionId: string, session: Data, now = Date.now()): Promise<ApiKeyRecord | null> {
    if (!/^[a-f0-9]{64}$/.test(sessionId) || typeof session.grantId !== 'string' || !/^[a-f0-9]{64}$/.test(session.grantId) ||
        typeof session.clientId !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(session.clientId) || !agentUidValid(session.uid) ||
        session.revoked !== false || !Number.isSafeInteger(session.createdAt) || !Number.isSafeInteger(session.expiresAt) ||
        (session.createdAt as number) > now || (session.expiresAt as number) <= now ||
        (session.expiresAt as number) <= (session.createdAt as number) || (session.expiresAt as number) > (session.createdAt as number) + AGENT_TOKEN_LIFETIME_MS) return null;
    const uid = session.uid, grantId = session.grantId, clientId = session.clientId;
    const scopes = parseAgentScopes(session.scopes), vault = parseAgentVaultAdmission(session.vault, true);
    const prefix = agentTokenPrefix(vault, scopes), epoch = session.accessEpoch === undefined ? 0 : session.accessEpoch;
    if (!Number.isSafeInteger(epoch) || (epoch as number) < 0 || session.parentKeyId !== undefined ||
        (session.credentialPrefix !== undefined && session.credentialPrefix !== prefix) ||
        (scopes.includes('memories:write') && session.credentialPrefix !== prefix)) return null;
    if (!await liveAccountInTransaction(tx, db, uid)) return null;
    const [grantDoc, clientDoc, profileDoc] = await tx.getAll(db.collection('agentGrants').doc(grantId),
        db.collection('agentClients').doc(clientId), db.collection('users').doc(uid));
    const grant = grantDoc.data(), client = readClient(clientDoc.data()), profile = profileDoc.data(), access = readAgentAccessState(profile);
    if (!grant || !client || !profile || !access || access.disabled || access.epoch !== epoch || grant.revoked !== false || grant.uid !== uid ||
        grant.clientId !== clientId || grant.version !== session.grantVersion || !Number.isSafeInteger(grant.version) || grant.version < 1 ||
        !Array.isArray(grant.scopes) || profile.deletionState === 'deleting' ||
        scopes.some(scope => !parseAgentScopes(grant.scopes).includes(scope) || !client.scopes.includes(scope)) ||
        !client.vaultTypes.includes(vault.kind) || agentVaultAdmissionBytes(vault) !== agentVaultAdmissionBytes(parseAgentVaultAdmission(grant.vault, true))) return null;
    await assertAgentVaultAdmission(tx, db, uid, vault);
    return { id: grantId, uid, name: client.name, scopes, createdAt: grant.createdAt, vault, clientId,
        agentSessionId: sessionId, agentSessionExpiresAt: session.expiresAt as number, grantVersion: grant.version, accessEpoch: epoch as number,
        lastUsedAt: grant.lastUsedAt ?? null, revoked: false, keyPrefix: prefix, credentialKind: 'agent-grant' };
}
export async function verifyOAuthAgentSession(session: Data, scopes: ApiScope[], db: FirebaseFirestore.Firestore,
    sessionId: string, now = Date.now()): Promise<ApiKeyRecord | null> {
    try {
        if (JSON.stringify(scopes) !== JSON.stringify(parseAgentScopes(session.scopes))) return null;
        return await db.runTransaction(tx => inspectOAuthAgentSession(tx, db, sessionId, session, now));
    } catch { return null; }
}

export async function executeRevokeAgentGrant(uid: string, raw: unknown, db: FirebaseFirestore.Firestore = admin.firestore()) {
    const id = record(raw).grantId;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw invalid();
    await db.runTransaction(async tx => {
        if (!await liveAccountInTransaction(tx, db, uid)) throw unavailable();
        const ref = db.collection('agentGrants').doc(id);
        const grant = (await tx.get(ref)).data();
        if (!grant || grant.uid !== uid) throw unavailable();
        tx.update(ref, { revoked: true });
        tx.create(db.collection('users').doc(uid).collection('agentEvents').doc(), { kind: 'consent-revoked',
            source: 'account-owner', clientId: grant.clientId, schemaVersion: 1,
            occurredAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    return { ok: true };
}
export async function executeListAgentGrants(uid: string, db: FirebaseFirestore.Firestore = admin.firestore()) {
    if (!await isLiveAccount(uid, db)) throw unavailable();
    const profile = await db.collection('users').doc(uid).get();
    if (!profile.exists || profile.data()?.deletionState === 'deleting') throw unavailable();
    const docs = await db.collection('agentGrants').where('uid', '==', uid).where('revoked', '==', false)
        .limit(MAX_ACTIVE_AGENT_GRANTS).get();
    return { grants: docs.docs.map(doc => {
        const grant = doc.data();
        const vault = parseAgentVaultAdmission(grant.vault, true);
        return { id: doc.id, name: grant.name, clientId: grant.clientId, scopes: grant.scopes, createdAt: grant.createdAt,
            vault: agentVaultSelector(vault), vaultName: typeof grant.vaultName === 'string' ? grant.vaultName.slice(0, 200) : null };
    }) };
}
const authenticated = async (context: functions.https.CallableContext, data: unknown) => {
    if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    const expected = record(data).expectedUid;
    if (!agentUidValid(expected) || expected !== context.auth.uid) throw unavailable();
    const rate = await consumeServerRateLimit(`uid:${context.auth.uid}`, { bucket: 'agent-consent', max: 20, windowMs: 60_000 });
    if (!rate.allowed) throw new functions.https.HttpsError('resource-exhausted', 'Try again later');
    return context.auth.uid;
};
const regional = functions.region('europe-west1');
export const previewAgentAuthorization = regional.https.onCall(async (data, context) =>
    executePreviewAgentAuthorization(await authenticated(context, data), data));
export const authorizeAgentClient = regional.https.onCall(async (data, context) =>
    executeAuthorizeAgentClient(await authenticated(context, data), data));
export const revokeAgentGrant = regional.https.onCall(async (data, context) =>
    executeRevokeAgentGrant(await authenticated(context, data), data));
export const listAgentGrants = regional.https.onCall(async (data, context) =>
    executeListAgentGrants(await authenticated(context, data)));
