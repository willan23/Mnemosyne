import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'node:crypto';
import { recordMemorySupersession } from './memorySupersession';
import { liveAccountInTransaction } from './accountAccess';
import { agentUidValid } from './agentAccountContract';
import { parseAgentMutationAuthority, parseAgentMutationReceipt, type AgentMutationReceipt } from './agentMutationContract';
import { agentVaultSelector } from './agentVaultContract';
import { agentReversalRequestBytes, parseAgentReversalBaseline, parseAgentReversalCommand, parseAgentReversalOutcome, parseAgentReversalPreparation, parseAgentReversalRequest,
  type AgentReversalRequest, type AgentReversalOutcome, type AgentReversalPreparation } from './agentReversalContract';
import { MEMORY_EDIT_DAILY_LIMITS } from './memoryEdits';
import { MEMORY_EDIT_METADATA_FIELDS } from './memoryEditContract';
import { canonicalSyncState, syncInteger } from './mobileSyncImportContract';
import { syncDocumentStateHash, syncStateHash } from './mobileSyncImport';
import { TEAM_REVISION_ARCHIVE_FIELDS, parseTeamRevisionCipher, teamRevisionTime } from './teamRevisionContract';
import { teamRevisionAccess, teamRevisionMembership } from './teamRevisions';
import { PERSONAL_REVISION_WRITES_ENABLED } from './personalRevisions';
import { TEAM_WRITES_ENABLED } from './teams';
import { consumeServerRateLimit } from './rateLimit';

export interface AgentReversalServerDeps { firestore: FirebaseFirestore.Firestore; now: () => number; enabled: (team: boolean) => boolean }
const defaults = (): AgentReversalServerDeps => ({ firestore: admin.firestore(), now: Date.now, enabled: team => team ? TEAM_WRITES_ENABLED : PERSONAL_REVISION_WRITES_ENABLED });
const fail = (code: functions.https.FunctionsErrorCode = 'failed-precondition') => new functions.https.HttpsError(code, 'Reversal unavailable; inspect or cancel the encrypted pending request');
function parsed<T>(parse: (value: unknown) => T, value: unknown) { try { return parse(value); } catch { throw fail('invalid-argument'); } }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const metadata = (row: FirebaseFirestore.DocumentData) => Object.fromEntries(MEMORY_EDIT_METADATA_FIELDS.filter(key => key in row).map(key => [key, row[key]]));
const archiveFields = [...TEAM_REVISION_ARCHIVE_FIELDS, 'color', 'scale', 'orbitRadius', 'orbitSpeed'];
export const AGENT_REVERSAL_DAILY_CANCELLATIONS = 200;
function control(value: FirebaseFirestore.DocumentData | undefined) {
  if (!value || !syncInteger(value.agentReversalEpoch ?? 0) || !syncInteger(value.agentReversalPausedUntil ?? 0)) throw fail();
  return { epoch: Number(value.agentReversalEpoch ?? 0), pausedUntil: Number(value.agentReversalPausedUntil ?? 0) };
}
function ledger(value: FirebaseFirestore.DocumentData | undefined, uid: string) {
  if (!value || value.v !== 1 || value.uid !== uid || !agentUidValid(value.authorUid) || !agentUidValid(value.ownerUid)) throw fail('permission-denied');
  const receipt = parsed(parseAgentMutationReceipt, value.receipt), authority = parsed(parseAgentMutationAuthority, value.authority);
  if (receipt.uid !== uid || authority.uid !== uid || value.status !== receipt.status || value.createdAt !== receipt.createdAt || value.teamId !== receipt.teamId || receipt.vault !== agentVaultSelector(authority.vault)) throw fail('permission-denied');
  return { row: value, receipt };
}
/** Read all current authority and both immutable-source/current snapshots in the caller's transaction. */
async function inspect(tx: FirebaseFirestore.Transaction, deps: AgentReversalServerDeps, uid: string, proposalId: string) {
  const db = deps.firestore;
  if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
  const state = control((await tx.get(db.doc('users/' + uid))).data());
  const now = deps.now(); if (!syncInteger(now) || now < 1) throw fail();
  if (state.pausedUntil > now || state.epoch === Number.MAX_SAFE_INTEGER) throw fail('resource-exhausted');
  const original = ledger((await tx.get(db.doc('agentMutationReceipts/' + proposalId))).data(), uid), { row, receipt } = original;
  if (receipt.proposalId !== proposalId || receipt.status !== 'applied' || !receipt.result || row.versionId !== 'memory-edit-' + proposalId) throw fail();
  const memory = await tx.get(db.doc('sessions/' + receipt.sessionId)), current = memory.data();
  if (!current || current.uid !== row.authorUid || current.teamId !== receipt.teamId || current.text !== '' || current.title != null ||
    current.lastVersionId !== row.versionId || syncStateHash(current) !== row.afterStateDigest || teamRevisionTime(current.updatedAt) !== receipt.result.revision ||
    (receipt.operation === 'delete' ? current.deletedAt !== receipt.result.revision : current.deletedAt != null)) throw fail('aborted');
  if (!await liveAccountInTransaction(tx, db, row.authorUid, false)) throw fail('permission-denied');
  const access = receipt.teamId === null ? null : await teamRevisionAccess(tx, db, uid, receipt.teamId);
  if (access?.revoked || receipt.teamId === null && (row.authorUid !== uid || row.ownerUid !== uid)) throw fail('permission-denied');
  if (access && !access.revoked && receipt.operation === 'delete' && access.row.ownerUid !== uid) throw fail('permission-denied');
  const source = await tx.get(memory.ref.collection('versions').doc(row.versionId)), version = source.data();
  if (!version || version.uid !== current.uid || version.teamId !== current.teamId || teamRevisionTime(version.timestamp) === null || teamRevisionTime(version.timestamp) !== teamRevisionTime(current.timestamp) || version.editorUid !== uid ||
    version.createdAt !== receipt.result.revision || version.text !== '' || version.title != null || teamRevisionTime(version.previousUpdatedAt) === null) throw fail();
  const active = access && !access.revoked ? access : null;
  const baseline = parsed(parseAgentReversalBaseline, { proposalId, sessionId: receipt.sessionId, teamId: receipt.teamId, authorUid: current.uid,
    ownerUid: active ? active.row.ownerUid : uid, originalDigest: receipt.digest, originalRevision: receipt.result.revision,
    revision: teamRevisionTime(current.updatedAt), reversalEpoch: state.epoch, stateHash: syncDocumentStateHash(memory), stateDigest: syncStateHash(current), versionId: row.versionId,
    versionHash: syncDocumentStateHash(source), teamStateHash: active ? syncDocumentStateHash(active.team) : null, epochStateHash: active ? syncDocumentStateHash(active.epoch) : null,
    keyEpoch: active ? active.row.activeKeyEpoch : null, keyId: active ? active.row.activeKeyId : null,
    currentKeyEpoch: active ? current.keyEpoch ?? 1 : null, currentKeyId: active ? current.keyId ?? null : null,
    sourceKeyEpoch: active ? version.keyEpoch ?? 1 : null, sourceKeyId: active ? version.keyId ?? null : null });
  const preparation = parsed(parseAgentReversalPreparation, { baseline, currentEnc: current.enc, sourceEnc: version.enc,
    currentMetadata: metadata(current), sourceMetadata: metadata(version), currentLearning: current.learning ?? null, sourceLearning: version.learning ?? null,
    currentLearningPresent: 'learning' in current, sourceLearningPresent: 'learning' in version, deleted: receipt.operation === 'delete' });
  return { ...original, memory, current, source, version, preparation };
}
export async function executePrepareAgentReversal(uid: string, value: unknown, deps = defaults()): Promise<AgentReversalPreparation> {
  const command = parsed(input => parseAgentReversalCommand('prepare', input), value);
  if (command.expectedUid !== uid || !('proposalId' in command.request)) throw fail('permission-denied');
  const proposalId = command.request.proposalId;
  return deps.firestore.runTransaction(async tx => (await inspect(tx, deps, uid, proposalId)).preparation);
}
function outcome(uid: string, input: AgentReversalRequest, digest: string, data: FirebaseFirestore.DocumentData): AgentReversalOutcome {
  const result = parsed(parseAgentReversalOutcome, Object.fromEntries(['operationId', 'proposalId', 'sessionId', 'teamId', 'digest', 'status', 'revision', 'createdAt'].map(key => [key, data[key]])));
  const base = input.baseline;
  if (data.v !== 1 || data.uid !== uid || data.authorUid !== base.authorUid || data.ownerUid !== base.ownerUid || result.operationId !== input.operationId ||
    result.proposalId !== base.proposalId || result.sessionId !== base.sessionId || result.teamId !== base.teamId || result.digest !== digest ||
    !['committed', 'cancelled'].includes(result.status) || result.status === 'committed' && Number(result.revision) <= base.revision) throw fail('permission-denied');
  return result;
}
export async function executeAgentReversal(uid: string, value: unknown, mode: 'apply' | 'status' | 'cancel', deps = defaults()): Promise<AgentReversalOutcome> {
  const command = parsed(input => parseAgentReversalCommand(mode, input), value);
  if (command.expectedUid !== uid || !('baseline' in command.request)) throw fail('permission-denied');
  const input = parsed(parseAgentReversalRequest, command.request), base = input.baseline, digest = hash(agentReversalRequestBytes(input)), db = deps.firestore;
  if (mode === 'apply' && ('reviewDigest' in command ? command.reviewDigest !== digest : true)) throw fail('permission-denied');
  if (mode === 'apply' && !deps.enabled(base.teamId !== null)) throw fail();
  return db.runTransaction(async tx => {
    if (!await liveAccountInTransaction(tx, db, uid)) throw fail('permission-denied');
    const ref = db.doc('agentMutationReversals/' + input.operationId), previous = await tx.get(ref);
    if (previous.exists) { const result = outcome(uid, input, digest, previous.data()!); if (mode === 'apply' && result.status !== 'committed') throw fail(); return result; }
    const result: AgentReversalOutcome = { operationId: input.operationId, proposalId: base.proposalId, sessionId: base.sessionId, teamId: base.teamId, digest, status: 'unknown', revision: null, createdAt: null };
    const profile = await tx.get(db.doc('users/' + uid)), state = control(profile.data());
    const now = deps.now(); if (!syncInteger(now) || now < 1) throw fail();
    if (state.epoch !== base.reversalEpoch || state.pausedUntil > now || state.epoch === Number.MAX_SAFE_INTEGER) {
      if (mode === 'apply') throw fail('permission-denied'); return { ...result, status: 'revoked' };
    }
    const original = await tx.get(db.doc('agentMutationReceipts/' + base.proposalId));
    if (!original.exists) { if (mode === 'apply') throw fail(); return { ...result, status: 'revoked' }; }
    const origin = ledger(original.data(), uid);
    if (origin.receipt.proposalId !== base.proposalId || origin.receipt.sessionId !== base.sessionId || origin.receipt.teamId !== base.teamId || origin.receipt.digest !== base.originalDigest ||
      origin.row.authorUid !== base.authorUid || origin.receipt.result?.revision !== base.originalRevision) throw fail('permission-denied');
    const access = base.teamId === null ? null : await teamRevisionMembership(tx, db, uid, base.teamId);
    if (origin.receipt.status !== 'applied' || access?.revoked || access && !access.revoked && access.row.ownerUid !== base.ownerUid ||
      !await liveAccountInTransaction(tx, db, base.authorUid, false) || !await liveAccountInTransaction(tx, db, base.ownerUid, false)) {
      if (mode === 'apply') throw fail('permission-denied'); return { ...result, status: 'revoked' };
    }
    if (mode === 'status') return result;
    const identifiers = { v: 1, uid, authorUid: base.authorUid, ownerUid: base.ownerUid };
    if (mode === 'cancel') {
      const day = new Date(now).toISOString().slice(0, 10), budgetRef = db.doc('agentReversalCancelBudgets/' + hash(uid) + '_' + day), budget = await tx.get(budgetRef), count = budget.data();
      if (count && (count.v !== 1 || count.uid !== uid || count.day !== day || !syncInteger(count.cancellations) || count.cancellations > AGENT_REVERSAL_DAILY_CANCELLATIONS)) throw fail();
      if (Number(count?.cancellations ?? 0) >= AGENT_REVERSAL_DAILY_CANCELLATIONS) {
        // At the storage limit, retire every outstanding reversal without minting another receipt.
        // The epoch makes old payloads permanently invalid, including after tomorrow's admission resumes.
        if (state.epoch === Number.MAX_SAFE_INTEGER) throw fail();
        tx.update(profile.ref, { agentReversalEpoch: state.epoch + 1, agentReversalPausedUntil: Date.parse(day + 'T00:00:00Z') + 86_400_000 });
        tx.create(db.doc(`users/${uid}/agentEvents/agent-reversal-budget-${day}`), { kind: 'mutation-reversal-budget-closed', schemaVersion: 1, source: 'account-control',
          reversalEpoch: state.epoch + 1, day, occurredAt: admin.firestore.FieldValue.serverTimestamp() });
        return { ...result, status: 'revoked' };
      }
      const cancelled = { ...result, status: 'cancelled' as const, createdAt: now }; tx.create(ref, { ...identifiers, ...cancelled });
      tx.create(db.doc(`users/${uid}/agentEvents/${input.operationId}-cancelled`), { kind: 'mutation-reversal-cancelled', schemaVersion: 1, source: 'account-owner',
        proposalId: base.proposalId, operationId: input.operationId, sessionId: base.sessionId, vault: origin.receipt.vault, occurredAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.set(budgetRef, { v: 1, uid, day, cancellations: Number(count?.cancellations ?? 0) + 1 });
      return cancelled;
    }
    const current = await inspect(tx, deps, uid, base.proposalId);
    if (canonicalSyncState(current.preparation.baseline) !== canonicalSyncState(base)) throw fail('aborted');
    if (base.teamId !== null && (await tx.get(db.doc('config/teamSecurity'))).data()?.writesEnabled !== true) throw fail();
    const versionRef = current.memory.ref.collection('versions').doc('agent-reversal-' + input.operationId), eventRef = db.doc('memoryEditEvents/agent-reversal-' + input.operationId);
    if ((await tx.get(versionRef)).exists || (await tx.get(eventRef)).exists) throw fail('already-exists');
    const day = new Date(now).toISOString().slice(0, 10), userRef = db.doc('memoryEditBudgets/' + hash(JSON.stringify([uid, base.teamId])) + '_' + day), teamRef = base.teamId ? db.doc('memoryEditTeamBudgets/' + hash(base.teamId) + '_' + day) : null;
    const userRow = await tx.get(userRef), teamRow = teamRef ? await tx.get(teamRef) : null;
    const cipherBytes = Buffer.byteLength(current.preparation.currentEnc.ct) + Buffer.byteLength(input.enc.ct);
    const budget = (snapshot: FirebaseFirestore.DocumentSnapshot | null, actor: boolean) => {
      const row = snapshot?.data(); if (row && (row.v !== 1 || row.teamId !== base.teamId || row.day !== day || actor && row.uid !== uid || !syncInteger(row.operations) || !syncInteger(row.cipherBytes))) throw fail();
      return { operations: Number(row?.operations ?? 0) + 1, cipherBytes: Number(row?.cipherBytes ?? 0) + cipherBytes };
    };
    const user = budget(userRow, true), team = teamRef ? budget(teamRow, false) : null;
    if (user.operations > MEMORY_EDIT_DAILY_LIMITS.operations || user.cipherBytes > MEMORY_EDIT_DAILY_LIMITS.cipherBytes || team &&
      (team.operations > MEMORY_EDIT_DAILY_LIMITS.teamOperations || team.cipherBytes > MEMORY_EDIT_DAILY_LIMITS.teamCipherBytes)) throw fail('resource-exhausted');
    if (!deps.enabled(base.teamId !== null)) throw fail();
    const revision = Math.max(now, base.revision + 1); if (!syncInteger(revision)) throw fail();
    const archivedMetadata = Object.fromEntries(archiveFields.filter(key => key in current.current).map(key => [key, current.current[key]]));
    tx.create(versionRef, { ...archivedMetadata, uid: base.authorUid, timestamp: current.current.timestamp, teamId: base.teamId, text: '', title: null,
      enc: parseTeamRevisionCipher(current.current.enc), ...(base.teamId ? { keyEpoch: base.currentKeyEpoch, keyId: base.currentKeyId } : {}), deletedAt: current.current.deletedAt ?? null,
      previousUpdatedAt: base.revision, createdAt: revision, editorUid: uid });
    const restored = Object.fromEntries(MEMORY_EDIT_METADATA_FIELDS.map(key => [key, key in current.version ? current.version[key] : admin.firestore.FieldValue.delete()]));
    tx.update(current.memory.ref, { ...restored, enc: input.enc, text: '', title: null, updatedAt: revision, lastVersionId: versionRef.id, deletedAt: admin.firestore.FieldValue.delete(),
      learning: 'learning' in current.version ? current.version.learning : admin.firestore.FieldValue.delete(),
      ...(base.teamId ? { keyEpoch: base.keyEpoch, keyId: base.keyId } : {}), nodes: null, links: null, generatedPrompt: null, generatedImagePrompt: null });
    const committed: AgentReversalOutcome = { ...result, status: 'committed', revision, createdAt: now };
    recordMemorySupersession(tx,db,uid,{operationId:input.operationId,memoryId:base.sessionId,
      previousRevision:base.revision,revision,versionId:versionRef.id,source:'agent-reversal'});
    tx.create(ref, { ...identifiers, ...committed });
    const receipt: AgentMutationReceipt = parsed(parseAgentMutationReceipt, { ...current.receipt, status: 'reverted', decidedAt: now });
    tx.update(original.ref, { status: 'reverted', receipt, reversalId: input.operationId, reversalDigest: digest, reversalRevision: revision });
    tx.create(eventRef, { ...identifiers, proposalId: base.proposalId, sessionId: base.sessionId, teamId: base.teamId, operation: 'agent-reversal', versionId: versionRef.id, revision, createdAt: now });
    tx.create(db.doc(`users/${uid}/agentEvents/${input.operationId}-reverted`), { kind: 'mutation-reverted', schemaVersion: 1, source: 'account-owner', proposalId: base.proposalId,
      operationId: input.operationId, sessionId: base.sessionId, vault: current.receipt.vault, occurredAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(userRef, { v: 1, uid, teamId: base.teamId, day, ...user, updatedAt: now });
    if (teamRef && team) tx.set(teamRef, { v: 1, teamId: base.teamId, day, ...team, updatedAt: now });
    return committed;
  });
}
function callable(mode: 'prepare' | 'apply' | 'status' | 'cancel') {
  return functions.region('europe-west1').runWith({ timeoutSeconds: 60, memory: '512MB' }).https.onCall(async (value, context) => {
    if (!context.auth?.uid) throw fail('unauthenticated');
    if (!value || typeof value !== 'object' || value.expectedUid !== context.auth.uid) throw fail('permission-denied');
    const command = parsed(input => parseAgentReversalCommand(mode, input), value);
    try {
      if (!(await consumeServerRateLimit('uid:' + context.auth.uid, { bucket: 'agent-reversal-' + mode, max: mode === 'apply' ? 60 : 120, windowMs: 60_000 })).allowed) throw fail('resource-exhausted');
      return mode === 'prepare' ? executePrepareAgentReversal(context.auth.uid, command) : executeAgentReversal(context.auth.uid, command, mode);
    } catch (error) { if (error instanceof functions.https.HttpsError) throw error; throw fail(); }
  });
}
export const prepareAgentMutationReversal = callable('prepare'), applyAgentMutationReversal = callable('apply'), getAgentMutationReversalStatus = callable('status'), cancelAgentMutationReversal = callable('cancel');
