import { randomBytes } from 'node:crypto';
import * as admin from 'firebase-admin';
import { ApiKeyRecord, hashApiKey, parseAndValidateScopes, readKeyDoc, verifyApiKeySecret } from './apiKeys';

import { AGENT_TOKEN_PREFIX, AGENT_TOKEN_LIFETIME_MS } from './agentCredentials';
import { verifyOAuthAgentSession } from './agentOAuth';
import { liveAccountInTransaction, isLiveAccount } from './accountAccess';
import { AGENT_VAULT_TOKEN_PREFIX, AGENT_REVIEW_TOKEN_PREFIX, agentTokenPrefix, parseAgentScopes } from './agentVaultContract';
export { AGENT_TOKEN_PREFIX, AGENT_TOKEN_LIFETIME_MS } from './agentCredentials';

export async function issueAgentSession(parent: ApiKeyRecord, requestedScopes: unknown,
    db: FirebaseFirestore.Firestore = admin.firestore(), now = Date.now()) {
    if (parent.keyPrefix === AGENT_TOKEN_PREFIX || parent.keyPrefix === AGENT_VAULT_TOKEN_PREFIX || parent.keyPrefix === AGENT_REVIEW_TOKEN_PREFIX || parent.credentialKind === 'agent-grant') throw new Error('Delegation is not allowed');
    const scopes = parseAndValidateScopes(requestedScopes ?? parent.scopes.filter(scope => scope !== 'memories:write'));
    if (scopes.some(scope => scope === 'memories:write' || !parent.scopes.includes(scope))) {
        throw new Error('Agent scopes must be a read-only subset of the parent key');
    }
    const secret = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const id = hashApiKey(secret);
    const expiresAt = now + AGENT_TOKEN_LIFETIME_MS;
    const eventRef = db.collection('users').doc(parent.uid).collection('agentEvents').doc();
    await db.runTransaction(async tx => {
        if (!await liveAccountInTransaction(tx, db, parent.uid)) throw new Error('Agent access is unavailable');
        const parentRef = db.collection('apiKeys').doc(parent.id);
        const [parentDoc, userDoc] = await tx.getAll(parentRef, db.collection('users').doc(parent.uid));
        const current = readKeyDoc(parent.id, parentDoc.data());
        if (!current || current.revoked || current.uid !== parent.uid ||
            scopes.some(scope => !current.scopes.includes(scope)) || !userDoc.exists ||
            userDoc.data()?.deletionState === 'deleting' || userDoc.data()?.agentAccessDisabled === true) {
            throw new Error('Agent access is unavailable');
        }
        tx.create(db.collection('agentSessions').doc(id), {
            accessEpoch: userDoc.data()?.agentAccessEpoch ?? 0,
            uid: parent.uid, parentKeyId: parent.id, scopes, createdAt: now, expiresAt, revoked: false,
            deleteAfter: admin.firestore.Timestamp.fromMillis(expiresAt),
        });
        tx.create(eventRef, { kind: 'session-issued', source: 'api-key', schemaVersion: 1,
            scopes, expiresAt, occurredAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    return { access_token: secret, token_type: 'Bearer' as const, expires_in: AGENT_TOKEN_LIFETIME_MS / 1000, scopes };
}

export async function verifyAgentSession(secret: string, db: FirebaseFirestore.Firestore = admin.firestore(), now = Date.now()): Promise<ApiKeyRecord | null> {
    if (!/^mne_(?:agent|vault|review)_[A-Za-z0-9_-]{43}$/.test(secret)) return null;
    const snapshot = await db.collection('agentSessions').doc(hashApiKey(secret)).get();
    const session = snapshot.data();
    if (!session || session.revoked !== false || typeof session.uid !== 'string' ||
        !Number.isFinite(session.createdAt) || !Number.isFinite(session.expiresAt) ||
        !Array.isArray(session.scopes) || session.scopes.length === 0 ||
        session.createdAt > now || session.expiresAt <= now ||
        session.expiresAt > session.createdAt + AGENT_TOKEN_LIFETIME_MS) return null;
    let scopes;
    try { scopes = session.grantId !== undefined ? parseAgentScopes(session.scopes) : parseAndValidateScopes(session.scopes); } catch { return null; }
    if (session.grantId !== undefined) {
        if (session.parentKeyId !== undefined) return null;
        const verified = await verifyOAuthAgentSession(session, scopes, db, snapshot.id, now);
        return verified && verified.vault && secret.startsWith(agentTokenPrefix(verified.vault, scopes)) ? verified : null;
    }
    if (scopes.includes('memories:write') || !secret.startsWith(AGENT_TOKEN_PREFIX)) return null;
    if (typeof session.parentKeyId !== 'string' || !/^[a-f0-9]{64}$/.test(session.parentKeyId)) return null;
    if (!await isLiveAccount(session.uid, db)) return null;
    const [parentDoc, userDoc] = await db.getAll(db.collection('apiKeys').doc(session.parentKeyId), db.collection('users').doc(session.uid));
    const parent = readKeyDoc(session.parentKeyId, parentDoc.data());
    if (!parent || parent.revoked || parent.uid !== session.uid || !userDoc.exists ||
        (session.accessEpoch ?? 0) !== (userDoc.data()?.agentAccessEpoch ?? 0) ||
        userDoc.data()?.deletionState === 'deleting' || userDoc.data()?.agentAccessDisabled === true ||
        scopes.some(scope => !parent.scopes.includes(scope))) return null;
    // Retain the parent ID so issuing more sessions cannot multiply its rate limit.
    return { ...parent, scopes, keyPrefix: AGENT_TOKEN_PREFIX };
}

export async function verifyGatewayBearer(secret: string): Promise<ApiKeyRecord | null> {
    return secret.startsWith(AGENT_TOKEN_PREFIX) || secret.startsWith(AGENT_VAULT_TOKEN_PREFIX) || secret.startsWith(AGENT_REVIEW_TOKEN_PREFIX) ? verifyAgentSession(secret) : verifyApiKeySecret(secret);
}
