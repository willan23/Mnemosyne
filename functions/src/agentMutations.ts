import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'node:crypto';
import { API_MEMORY_WRITES_ENABLED, type ApiKeyRecord } from './apiKeys';
import { liveAccountInTransaction } from './accountAccess';
import { inspectOAuthAgentSession } from './agentOAuth';
import { AGENT_REVIEW_TOKEN_PREFIX, agentVaultSelector } from './agentVaultContract';
import { AGENT_MUTATION_MAX_BYTES, AGENT_MUTATION_PENDING_LIMIT, assertAgentMutationTarget,
  parseAgentMutationAgentTarget, parseAgentMutationAuthority, parseAgentMutationDecision,
  parseAgentMutationOwnerTarget, parseAgentMutationReceipt, parseAgentMutationRequest,
  type AgentMutationAuthority, type AgentMutationReceipt, type AgentMutationReview } from './agentMutationContract';
import { executeMemoryEdit, inspectMemoryEditBaseline, type MemoryEditServerDeps } from './memoryEdits';
import { memoryEditRequestBytes, parseMemoryEditTarget, type MemoryEditBaseline, type MemoryEditRequest } from './memoryEditContract';
import { canonicalSyncState } from './mobileSyncImportContract';
import { syncStateHash } from './mobileSyncImport';
import { parseTeamRevisionCipher } from './teamRevisionContract';
import { consumeServerRateLimit } from './rateLimit';
import { agentUidValid } from './agentAccountContract';
import { TEAM_WRITES_ENABLED } from './teams';
import { PERSONAL_REVISION_WRITES_ENABLED } from './personalRevisions';

export const AGENT_MUTATION_DAILY_LIMITS = { proposals: 50, bytes: 20 * 1024 * 1024, teamProposals: 500, teamBytes: 100 * 1024 * 1024 } as const;
export interface AgentMutationDeps { firestore: FirebaseFirestore.Firestore; now: () => number; enabled: boolean; memoryWritesEnabled: (kind: 'personal' | 'team') => boolean }
const defaults = (): AgentMutationDeps => ({ firestore: admin.firestore(), now: Date.now, enabled: API_MEMORY_WRITES_ENABLED,
  memoryWritesEnabled: kind => kind === 'team' ? TEAM_WRITES_ENABLED : PERSONAL_REVISION_WRITES_ENABLED });
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Agent change unavailable; inspect the receipt before retrying');
const parsed = <T>(parse: (value: unknown) => T, value: unknown): T => { try { return parse(value); } catch { throw fail('invalid-argument'); } };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const authorityBytes = (value: AgentMutationAuthority) => canonicalSyncState(parseAgentMutationAuthority(value));
const checkedNow = (deps: AgentMutationDeps) => { const value = deps.now(); if (!Number.isSafeInteger(value) || value < 1) throw fail(); return value; };
const receiptRef = (db: FirebaseFirestore.Firestore, id: string) => db.doc('agentMutationReceipts/' + id);
const proposalRef = (db: FirebaseFirestore.Firestore, id: string) => db.doc('agentMutationProposals/' + id);
interface Ledger { uid: string; authorUid: string; ownerUid: string; authority: AgentMutationAuthority; receipt: AgentMutationReceipt }
function readLedger(value: FirebaseFirestore.DocumentData | undefined, uid: string): Ledger {
  if (!value || value.v !== 1 || value.uid !== uid || !agentUidValid(value.authorUid) || !agentUidValid(value.ownerUid)) throw fail('permission-denied');
  const authority = parsed(parseAgentMutationAuthority, value.authority), receipt = parsed(parseAgentMutationReceipt, value.receipt);
  if (authority.uid !== uid || receipt.uid !== uid || value.status !== receipt.status || value.createdAt !== receipt.createdAt ||
    value.teamId !== receipt.teamId || receipt.expiresAt !== authority.expiresAt || receipt.clientId !== authority.clientId ||
    receipt.vault !== agentVaultSelector(authority.vault)) throw fail('permission-denied');
  return { uid, authorUid: value.authorUid, ownerUid: value.ownerUid, authority, receipt };
}
function authorityFromKey(key: ApiKeyRecord): AgentMutationAuthority {
  if (key.credentialKind !== 'agent-grant' || key.keyPrefix !== AGENT_REVIEW_TOKEN_PREFIX || !key.scopes.includes('memories:write')) throw fail('permission-denied');
  return parsed(parseAgentMutationAuthority, { uid: key.uid, grantId: key.id, clientId: key.clientId, grantVersion: key.grantVersion,
    sessionId: key.agentSessionId, accessEpoch: key.accessEpoch, expiresAt: key.agentSessionExpiresAt, vault: key.vault });
}
async function currentAuthority(tx: FirebaseFirestore.Transaction, deps: AgentMutationDeps, expected: AgentMutationAuthority, clientName?: string): Promise<ApiKeyRecord> {
  const session = await tx.get(deps.firestore.doc('agentSessions/' + expected.sessionId));
  if (!session.exists) throw fail('permission-denied');
  const key = await inspectOAuthAgentSession(tx, deps.firestore, expected.sessionId, session.data()!, checkedNow(deps));
  if (!key || authorityBytes(authorityFromKey(key)) !== authorityBytes(expected) || clientName !== undefined && key.name !== clientName) throw fail('permission-denied');
  return key;
}
function readBody(value: FirebaseFirestore.DocumentData | undefined, ledger: Ledger): MemoryEditRequest {
  if (!value || value.v !== 1 || value.uid !== ledger.uid || value.digest !== ledger.receipt.digest ||
    value.authorUid !== ledger.authorUid || value.ownerUid !== ledger.ownerUid ||
    authorityBytes(parsed(parseAgentMutationAuthority, value.authority)) !== authorityBytes(ledger.authority)) throw fail();
  const request = parsed(parseAgentMutationRequest, value.request);
  if (request.operationId !== ledger.receipt.proposalId || request.baseline.sessionId !== ledger.receipt.sessionId || request.operation !== ledger.receipt.operation ||
    request.baseline.authorUid !== ledger.authorUid || request.baseline.ownerUid !== ledger.ownerUid || hash(memoryEditRequestBytes(request)) !== ledger.receipt.digest) throw fail();
  try { assertAgentMutationTarget(ledger.authority, request); } catch { throw fail('permission-denied'); }
  return request;
}
async function checkRequest(tx: FirebaseFirestore.Transaction, deps: AgentMutationDeps, authority: AgentMutationAuthority, request: MemoryEditRequest): Promise<void> {
  try { assertAgentMutationTarget(authority, request); } catch { throw fail('permission-denied'); }
  const current = await inspectMemoryEditBaseline(tx, deps.firestore, authority.uid, { sessionId: request.baseline.sessionId, teamId: request.baseline.teamId });
  if (canonicalSyncState(current) !== canonicalSyncState(request.baseline)) throw fail('aborted');
  const memory = await tx.get(deps.firestore.doc('sessions/' + request.baseline.sessionId));
  const cipher = parsed(parseTeamRevisionCipher, memory.data()?.enc);
  if (canonicalSyncState(cipher) !== canonicalSyncState(request.priorEnc)) throw fail('aborted');
}
function terminal(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, ledger: Ledger, status: 'rejected' | 'expired', now: number): AgentMutationReceipt {
  const receipt = parsed(parseAgentMutationReceipt, { ...ledger.receipt, status, decidedAt: now });
  tx.update(receiptRef(db, receipt.proposalId), { status, receipt }); tx.delete(proposalRef(db, receipt.proposalId)); return receipt;
}
function event(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, ledger: Ledger, kind: string, suffix: string) {
  tx.create(db.doc(`users/${ledger.uid}/agentEvents/${ledger.receipt.proposalId}-${suffix}`), {
    kind, schemaVersion: 1, source: suffix === 'proposed' ? 'agent' : 'account-owner', clientId: ledger.authority.clientId,
    grantId: ledger.authority.grantId, proposalId: ledger.receipt.proposalId, sessionId: ledger.receipt.sessionId,
    vault: ledger.receipt.vault, occurredAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
export async function executePrepareAgentMutation(key: ApiKeyRecord, value: unknown, deps = defaults()) {
  if (!deps.enabled) throw fail(); const authority = authorityFromKey(key), target = parsed(parseMemoryEditTarget, value);
  if (target.teamId !== (authority.vault.kind === 'team' ? authority.vault.teamId : null)) throw fail('permission-denied');
  return deps.firestore.runTransaction(async tx => {
    await currentAuthority(tx, deps, authority);
    const baseline = await inspectMemoryEditBaseline(tx, deps.firestore, authority.uid, target);
    if (authority.vault.kind === 'team' && (baseline.teamStateHash !== authority.vault.teamStateHash || baseline.epochStateHash !== authority.vault.epochStateHash)) throw fail();
    const snapshot = await tx.get(deps.firestore.doc('sessions/' + target.sessionId)); parsed(parseTeamRevisionCipher, snapshot.data()?.enc);
    return baseline;
  });
}
export async function executeProposeAgentMutation(key: ApiKeyRecord, value: unknown, deps = defaults()): Promise<AgentMutationReceipt> {
  if (!deps.enabled) throw fail(); const authority = authorityFromKey(key), request = parsed(parseAgentMutationRequest, value);
  try { assertAgentMutationTarget(authority, request); } catch { throw fail('permission-denied'); }
  const digest = hash(memoryEditRequestBytes(request)), bytes = Buffer.byteLength(memoryEditRequestBytes(request)), db = deps.firestore;
  if (bytes > AGENT_MUTATION_MAX_BYTES) throw fail('invalid-argument');
  return db.runTransaction(async tx => {
    const current = await currentAuthority(tx, deps, authority), now = checkedNow(deps), ref = receiptRef(db, request.operationId), previous = await tx.get(ref);
    if (previous.exists) {
      const row = readLedger(previous.data(), authority.uid);
      if (authorityBytes(row.authority) !== authorityBytes(authority) || row.receipt.digest !== digest) throw fail('already-exists');
      return row.receipt;
    }
    if ((await tx.get(db.doc('memoryEdits/' + request.operationId))).exists) throw fail('already-exists');
    const pending = await tx.get(db.collection('agentMutationReceipts').where('uid', '==', authority.uid).where('status', '==', 'pending').limit(AGENT_MUTATION_PENDING_LIMIT));
    const rows = pending.docs.map(doc => readLedger(doc.data(), authority.uid)), expired = rows.filter(row => row.receipt.expiresAt <= now);
    if (rows.length - expired.length >= AGENT_MUTATION_PENDING_LIMIT) throw fail('resource-exhausted');
    await checkRequest(tx, deps, authority, request);
    const day = new Date(now).toISOString().slice(0, 10), userRef = db.doc('agentMutationBudgets/' + hash(authority.uid) + '_' + day);
    const teamRef = request.baseline.teamId === null ? null : db.doc('agentMutationTeamBudgets/' + hash(request.baseline.teamId) + '_' + day);
    const user = await tx.get(userRef), team = teamRef ? await tx.get(teamRef) : null;
    const budget = (snapshot: FirebaseFirestore.DocumentSnapshot | null, teamBudget: boolean) => {
      const row = snapshot?.data();
      if (row && (row.v !== 1 || row.day !== day || row.teamId !== (teamBudget ? request.baseline.teamId : null) ||
        !teamBudget && row.uid !== authority.uid || !Number.isSafeInteger(row.proposals) || row.proposals < 0 || !Number.isSafeInteger(row.bytes) || row.bytes < 0)) throw fail();
      const result = { proposals: Number(row?.proposals ?? 0) + 1, bytes: Number(row?.bytes ?? 0) + bytes };
      if (result.proposals > (teamBudget ? AGENT_MUTATION_DAILY_LIMITS.teamProposals : AGENT_MUTATION_DAILY_LIMITS.proposals) ||
        result.bytes > (teamBudget ? AGENT_MUTATION_DAILY_LIMITS.teamBytes : AGENT_MUTATION_DAILY_LIMITS.bytes)) throw fail('resource-exhausted');
      return result;
    };
    const userBudget = budget(user, false), teamBudget = teamRef ? budget(team, true) : null;
    if (checkedNow(deps) >= authority.expiresAt) throw fail('permission-denied');
    const receipt = parsed(parseAgentMutationReceipt, { proposalId: request.operationId, uid: authority.uid, clientId: authority.clientId,
      clientName: current.name, vault: agentVaultSelector(authority.vault), digest, sessionId: request.baseline.sessionId,
      teamId: request.baseline.teamId, operation: request.operation, status: 'pending', createdAt: now, expiresAt: authority.expiresAt, decidedAt: null, result: null });
    const row: Ledger = { uid: authority.uid, authorUid: request.baseline.authorUid, ownerUid: request.baseline.ownerUid, authority, receipt };
    for (const old of expired) terminal(tx, db, old, 'expired', now);
    tx.create(ref, { v: 1, ...row, teamId: receipt.teamId, status: receipt.status, createdAt: now });
    tx.create(proposalRef(db, receipt.proposalId), { v: 1, uid: authority.uid, authorUid: row.authorUid, ownerUid: row.ownerUid,
      teamId: receipt.teamId, authority, digest, request, deleteAfter: admin.firestore.Timestamp.fromMillis(authority.expiresAt + 86_400_000) });
    tx.set(userRef, { v: 1, uid: authority.uid, teamId: null, day, ...userBudget });
    // This aggregate belongs to the team, so deleting a former owner cannot reset its quota.
    if (teamRef && teamBudget) tx.set(teamRef, { v: 1, teamId: receipt.teamId, day, ...teamBudget });
    event(tx, db, row, 'mutation-proposed', 'proposed'); return receipt;
  });
}
export async function executeAgentMutationStatus(key: ApiKeyRecord, value: unknown, deps = defaults()): Promise<AgentMutationReceipt> {
  const authority = authorityFromKey(key), target = parsed(parseAgentMutationAgentTarget, value);
  return deps.firestore.runTransaction(async tx => {
    await currentAuthority(tx, deps, authority);
    const row = readLedger((await tx.get(receiptRef(deps.firestore, target.proposalId))).data(), authority.uid);
    if (row.receipt.digest !== target.digest || authorityBytes(row.authority) !== authorityBytes(authority)) throw fail('permission-denied');
    return row.receipt;
  });
}

function ownerTarget(uid: string, value: unknown) {
  const command = parsed(parseAgentMutationOwnerTarget, value);
  if (command.expectedUid !== uid) throw fail('permission-denied'); return command;
}
function ownerDecision(uid: string, value: unknown) {
  const command = parsed(parseAgentMutationDecision, value);
  if (command.expectedUid !== uid) throw fail('permission-denied'); return command;
}
export async function executeGetAgentMutation(uid: string, value: unknown, deps = defaults()): Promise<AgentMutationReview> {
  const command = ownerTarget(uid, value), db = deps.firestore;
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
    const row = readLedger((await tx.get(receiptRef(db, command.proposalId))).data(), uid), now = checkedNow(deps);
    if (row.receipt.status !== 'pending') return { receipt: row.receipt, reviewState: 'terminal' };
    if (row.receipt.expiresAt <= now) return { receipt: terminal(tx, db, row, 'expired', now), reviewState: 'terminal' };
    try {
      await currentAuthority(tx, deps, row.authority, row.receipt.clientName);
      const request = readBody((await tx.get(proposalRef(db, command.proposalId))).data(), row);
      await checkRequest(tx, deps, row.authority, request);
      return { receipt: row.receipt, reviewState: 'ready', request };
    } catch { return { receipt: row.receipt, reviewState: 'unavailable' }; }
  });
}
export async function executeListAgentMutations(uid: string, value: unknown, deps = defaults()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'cursor,expectedUid,mode') throw fail('invalid-argument');
  const command = value as Record<string, unknown>;
  if (command.expectedUid !== uid || !agentUidValid(uid)) throw fail('permission-denied');
  if (!['pending', 'history'].includes(command.mode as string) || command.cursor !== null &&
    (typeof command.cursor !== 'string' || !/^[0-9a-f-]{36}$/i.test(command.cursor)) || command.mode === 'pending' && command.cursor !== null) throw fail('invalid-argument');
  const db = deps.firestore;
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
    let query = db.collection('agentMutationReceipts').where('uid', '==', uid);
    const pending = command.mode === 'pending', limit = pending ? AGENT_MUTATION_PENDING_LIMIT : 20;
    if (pending) query = query.where('status', '==', 'pending');
    else {
      query = query.orderBy('createdAt', 'desc');
      if (command.cursor !== null) {
        const cursor = await tx.get(receiptRef(db, command.cursor as string)); readLedger(cursor.data(), uid);
        query = query.startAfter(cursor);
      }
    }
    const docs = await tx.get(query.limit(limit + (pending ? 0 : 1))), rows = docs.docs.slice(0, limit).map(doc => readLedger(doc.data(), uid));
    const now = checkedNow(deps), receipts = rows.map(row => row.receipt.status === 'pending' && row.receipt.expiresAt <= now ? terminal(tx, db, row, 'expired', now) : row.receipt);
    // History retains Firestore's tie order so its last snapshot is the real pagination cursor.
    return { receipts: pending ? receipts.filter(row => row.status === 'pending').sort((a, b) => b.createdAt - a.createdAt || a.proposalId.localeCompare(b.proposalId)) : receipts,
      nextCursor: !pending && docs.size > limit ? receipts.at(-1)!.proposalId : null };
  });
}
export async function executeRejectAgentMutation(uid: string, value: unknown, deps = defaults()): Promise<AgentMutationReceipt> {
  const command = ownerDecision(uid, value), db = deps.firestore;
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
    const row = readLedger((await tx.get(receiptRef(db, command.proposalId))).data(), uid);
    if (row.receipt.digest !== command.reviewDigest) throw fail('permission-denied');
    if (row.receipt.status !== 'pending') return row.receipt;
    const now = checkedNow(deps), expired = row.receipt.expiresAt <= now;
    const result = terminal(tx, db, row, expired ? 'expired' : 'rejected', now);
    if (!expired) event(tx, db, row, 'mutation-rejected', 'rejected'); return result;
  });
}
export async function executeApproveAgentMutation(uid: string, value: unknown, deps = defaults()): Promise<AgentMutationReceipt> {
  const command = ownerDecision(uid, value);
  if (!deps.enabled) throw fail();
  const review = await executeGetAgentMutation(uid, { expectedUid: uid, proposalId: command.proposalId }, deps);
  if (review.receipt.digest !== command.reviewDigest) throw fail('permission-denied');
  if (review.reviewState === 'terminal') return review.receipt;
  if (!review.request || review.reviewState !== 'ready' || !deps.memoryWritesEnabled(review.request.baseline.kind)) throw fail();
  const request = review.request, db = deps.firestore;
  const memoryDeps: MemoryEditServerDeps = { firestore: db, now: deps.now, authorize: async (tx, input, digest, memoryReceipt) => {
    if (!deps.enabled || !deps.memoryWritesEnabled(input.baseline.kind)) throw fail();
    const row = readLedger((await tx.get(receiptRef(db, command.proposalId))).data(), uid);
    if (row.receipt.digest !== command.reviewDigest || digest !== command.reviewDigest || input.operationId !== command.proposalId) throw fail('permission-denied');
    if (memoryReceipt) {
      if (row.receipt.status !== 'applied' || !row.receipt.result || canonicalSyncState(row.receipt.result) !==
        canonicalSyncState(Object.fromEntries(Object.keys(row.receipt.result).map(key => [key, memoryReceipt[key]])))) throw fail();
      return undefined;
    }
    if (row.receipt.status !== 'pending' || checkedNow(deps) >= row.receipt.expiresAt) throw fail();
    await currentAuthority(tx, deps, row.authority, row.receipt.clientName);
    const current = readBody((await tx.get(proposalRef(db, command.proposalId))).data(), row);
    if (memoryEditRequestBytes(current) !== memoryEditRequestBytes(input)) throw fail('aborted');
    return (outcome, context) => {
      const now = checkedNow(deps);
      if (!deps.enabled || !deps.memoryWritesEnabled(input.baseline.kind) || now >= row.receipt.expiresAt) throw fail();
      const receipt = parsed(parseAgentMutationReceipt, { ...row.receipt, status: 'applied', decidedAt: now, result: outcome });
      tx.update(receiptRef(db, command.proposalId), { status: 'applied', receipt, versionId: context.versionId, afterStateDigest: syncStateHash(context.after) });
      tx.delete(proposalRef(db, command.proposalId)); event(tx, db, row, 'mutation-applied', 'applied');
    };
  } };
  await executeMemoryEdit(uid, request, 'apply', memoryDeps);
  return (await executeGetAgentMutation(uid, { expectedUid: uid, proposalId: command.proposalId }, deps)).receipt;
}

function ownerCallable<T>(operation: (uid: string, value: unknown) => Promise<T>) {
  return functions.region('europe-west1').runWith({ timeoutSeconds: 60, memory: '512MB' }).https.onCall(async (value, context) => {
    if (!context.auth?.uid) throw fail('unauthenticated');
    const uid = context.auth.uid;
    if (!value || typeof value !== 'object' || (value as Record<string, unknown>).expectedUid !== uid) throw fail('permission-denied');
    try {
      if (!(await consumeServerRateLimit('uid:' + uid, { bucket: 'agent-mutation-owner', max: 120, windowMs: 60_000 })).allowed) throw fail('resource-exhausted');
      return await operation(uid, value);
    } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
  });
}
export const getAgentMutationProposal = ownerCallable(executeGetAgentMutation);
export const listAgentMutationProposals = ownerCallable(executeListAgentMutations);
export const rejectAgentMutationProposal = ownerCallable(executeRejectAgentMutation);
export const approveAgentMutationProposal = ownerCallable(executeApproveAgentMutation);

export interface AgentMutationApi {
  enabled: boolean;
  prepare: (key: ApiKeyRecord, value: unknown) => Promise<MemoryEditBaseline>;
  propose: (key: ApiKeyRecord, value: unknown) => Promise<AgentMutationReceipt>;
  status: (key: ApiKeyRecord, value: unknown) => Promise<AgentMutationReceipt>;
}
export function createAgentMutationApi(deps = defaults()): AgentMutationApi {
  return { enabled: deps.enabled, prepare: (key, value) => executePrepareAgentMutation(key, value, deps),
    propose: (key, value) => executeProposeAgentMutation(key, value, deps), status: (key, value) => executeAgentMutationStatus(key, value, deps) };
}
