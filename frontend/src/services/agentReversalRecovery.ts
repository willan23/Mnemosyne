import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth } from '../firebase';
import { recipherMemoryEnvelope, isEncryptedMemoryEnvelope } from './memoryCrypto';
import { recipherTeamMemoryEnvelope } from './teamVault';
import { memoryEditDependencies, withMemoryEditCryptoScope, memoryEditStateDigest, type MemoryEditDeps, type MemoryEditContent, type MemoryEditBaseline } from './memoryEditRecovery';
import { canonicalSyncState } from '../../../functions/src/mobileSyncImportContract';
import { MEMORY_EDIT_METADATA_FIELDS } from '../../../functions/src/memoryEditContract';
import { AGENT_REVERSAL_MAX_BYTES, agentReversalRequestBytes, parseAgentReversalPreparation, parseAgentReversalRequest, parseAgentReversalOutcome,
  type AgentReversalRequest, type AgentReversalPreparation, type AgentReversalOutcome, type AgentReversalBaseline } from '../../../functions/src/agentReversalContract';

export interface AgentReversalPreview { request: AgentReversalRequest; digest: string; before: MemoryEditContent; after: MemoryEditContent; deleted: boolean }
export interface AgentReversalClientDeps {
  crypto: MemoryEditDeps; recipherPersonal: typeof recipherMemoryEnvelope; recipherTeam: typeof recipherTeamMemoryEnvelope;
  call: (mode: 'prepare' | 'apply' | 'status' | 'cancel', command: unknown) => Promise<unknown>;
}
const defaults = (): AgentReversalClientDeps => ({ crypto: memoryEditDependencies(), recipherPersonal: recipherMemoryEnvelope, recipherTeam: recipherTeamMemoryEnvelope,
  call: async (mode, command) => (await httpsCallable(getFunctions(app, 'europe-west1'), { prepare: 'prepareAgentMutationReversal', apply: 'applyAgentMutationReversal', status: 'getAgentMutationReversalStatus', cancel: 'cancelAgentMutationReversal' }[mode])(command)).data });
const fail = () => Error('Encrypted reversal unavailable; recover or cancel the pending request');
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
export const agentReversalCheckpointKey = (uid: string) => 'mnemosyne:agent-reversal:v1:' + encodeURIComponent(uid);
const changedEvent = 'mnemosyne:agent-reversal-changed';
const notify = () => window.dispatchEvent(new Event(changedEvent));
export function hasPendingAgentReversal(uid: string) { try { return localStorage.getItem(agentReversalCheckpointKey(uid)) !== null; } catch { return true; } }
export function observeAgentReversals(changed: () => void, owner: () => string | null = () => auth.currentUser?.uid ?? null) {
  const storage = (event: StorageEvent) => { const uid = owner(); if (uid && (event.key === null || event.key === agentReversalCheckpointKey(uid))) changed(); };
  window.addEventListener(changedEvent, changed); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(changedEvent, changed); window.removeEventListener('storage', storage); };
}
function cryptoBaseline(base: AgentReversalBaseline, which: 'source' | 'current' | 'active'): MemoryEditBaseline {
  return { kind: base.teamId === null ? 'personal' : 'team', sessionId: base.sessionId, teamId: base.teamId, authorUid: base.authorUid, ownerUid: base.ownerUid,
    stateHash: base.stateHash, stateDigest: base.stateDigest, revision: base.revision, teamStateHash: base.teamStateHash, epochStateHash: base.epochStateHash,
    keyEpoch: base.keyEpoch, keyId: base.keyId, priorKeyEpoch: which === 'active' ? base.keyEpoch : base[which === 'source' ? 'sourceKeyEpoch' : 'currentKeyEpoch'],
    priorKeyId: which === 'active' ? base.keyId : base[which === 'source' ? 'sourceKeyId' : 'currentKeyId'] };
}
async function open(preparation: AgentReversalPreparation, which: 'current' | 'source' | 'target', enc: AgentReversalRequest['enc'], guard: () => void, deps: AgentReversalClientDeps) {
  if (preparation.baseline.teamId === null) { const fields = await deps.crypto.decryptPersonal(enc as Parameters<MemoryEditDeps['decryptPersonal']>[0]); guard(); return fields; }
  const base = cryptoBaseline(preparation.baseline, which === 'target' ? 'active' : which), key = await deps.crypto.key(base, true, guard); guard();
  if (!key) throw fail();
  const fields = await deps.crypto.decryptTeam(key, enc, { teamId: base.teamId!, keyEpoch: base.priorKeyEpoch!, keyId: base.priorKeyId ?? base.keyId! }, { strictPayload: true }); guard(); return fields;
}
async function prepare(uid: string, proposalId: string, guard: () => void, deps: AgentReversalClientDeps) {
  guard(); const result = parseAgentReversalPreparation(await deps.call('prepare', { expectedUid: uid, request: { proposalId } })); guard();
  const base = result.baseline;
  if (base.proposalId !== proposalId || base.teamId === null && base.authorUid !== uid) throw fail();
  const current = await deps.crypto.read(base.sessionId); guard();
  if (!current || await memoryEditStateDigest(current) !== base.stateDigest || canonicalSyncState(current.enc) !== canonicalSyncState(result.currentEnc)) throw fail();
  const actualMetadata = Object.fromEntries(MEMORY_EDIT_METADATA_FIELDS.filter(key => key in current).map(key => [key, current[key]]));
  if (canonicalSyncState(actualMetadata) !== canonicalSyncState(result.currentMetadata) || ('learning' in current) !== result.currentLearningPresent ||
    canonicalSyncState(current.learning ?? null) !== canonicalSyncState(result.currentLearning) || (current.deletedAt != null) !== result.deleted) throw fail();
  guard(); return result;
}
async function review(uid: string, preparation: AgentReversalPreparation, existing: AgentReversalRequest | undefined, guard: () => void, deps: AgentReversalClientDeps): Promise<AgentReversalPreview> {
  if (preparation.baseline.teamId === null && preparation.baseline.authorUid !== uid) throw fail();
  const before = await open(preparation, 'current', preparation.currentEnc, guard, deps), source = await open(preparation, 'source', preparation.sourceEnc, guard, deps); guard();
  let request: AgentReversalRequest;
  if (existing) {
    request = parseAgentReversalRequest(existing);
    if (canonicalSyncState(request.baseline) !== canonicalSyncState(preparation.baseline)) throw fail();
  } else {
    let enc: AgentReversalRequest['enc'];
    if (preparation.baseline.teamId === null) enc = await deps.recipherPersonal(preparation.sourceEnc as Parameters<typeof recipherMemoryEnvelope>[0]);
    else {
      const from = cryptoBaseline(preparation.baseline, 'source'), to = cryptoBaseline(preparation.baseline, 'active');
      const fromKey = await deps.crypto.key(from, true, guard); guard(); const toKey = await deps.crypto.key(to, true, guard); guard();
      if (!fromKey || !toKey) throw fail();
      enc = await deps.recipherTeam(fromKey, preparation.sourceEnc, { teamId: from.teamId!, keyEpoch: from.priorKeyEpoch!, keyId: from.priorKeyId ?? from.keyId! }, toKey,
        { teamId: to.teamId!, keyEpoch: to.keyEpoch!, keyId: to.keyId! });
    }
    guard(); request = parseAgentReversalRequest({ operationId: deps.crypto.id(), baseline: preparation.baseline, enc });
  }
  const after = await open(preparation, 'target', request.enc, guard, deps); guard();
  if (canonicalSyncState(after) !== canonicalSyncState(source)) throw fail();
  const digest = await hash(agentReversalRequestBytes(request)); guard();
  return { request, digest, deleted: preparation.deleted, before: { text: before.text, title: before.title ?? null,
    metadata: { ...preparation.currentMetadata, ...(preparation.currentLearningPresent ? { learning: preparation.currentLearning } : {}) } },
    after: { text: after.text, title: after.title ?? null, metadata: { ...preparation.sourceMetadata, ...(preparation.sourceLearningPresent ? { learning: preparation.sourceLearning } : {}) } } };
}
export function previewAgentReversal(uid: string, proposalId: string, outer: () => void = () => {}, deps = defaults()): Promise<AgentReversalPreview> {
  return withMemoryEditCryptoScope(uid, outer, deps.crypto, async guard => {
    if (deps.crypto.storage.getItem(agentReversalCheckpointKey(uid)) !== null) throw fail();
    return review(uid, await prepare(uid, proposalId, guard, deps), undefined, guard, deps);
  });
}
function result(value: unknown, request: AgentReversalRequest, digest: string): AgentReversalOutcome {
  const row = parseAgentReversalOutcome(value), base = request.baseline;
  if (row.operationId !== request.operationId || row.proposalId !== base.proposalId || row.sessionId !== base.sessionId || row.teamId !== base.teamId || row.digest !== digest ||
    row.status === 'committed' && Number(row.revision) <= base.revision) throw fail();
  return row;
}
async function journal(raw: string, uid: string, guard: () => void, deps: AgentReversalClientDeps) {
  try {
    if (raw.length > 1_000_000) throw fail(); const enc: unknown = JSON.parse(raw);
    if (!isEncryptedMemoryEnvelope(enc) || Object.keys(enc).sort().join(',') !== 'ct,iv,v') throw fail();
    const plaintext = (await deps.crypto.decryptJournal(enc)).text; guard();
    if (new TextEncoder().encode(plaintext).byteLength > AGENT_REVERSAL_MAX_BYTES + 1000) throw fail();
    const row = JSON.parse(plaintext);
    if (!row || Object.keys(row).sort().join(',') !== 'request,uid,v' || row.v !== 1 || row.uid !== uid) throw fail();
    return parseAgentReversalRequest(row.request);
  } catch { guard(); throw fail(); }
}
function terminal(status: AgentReversalOutcome['status']) { return status === 'committed' || status === 'cancelled' || status === 'revoked'; }
export type AgentReversalRecovery = { state: 'terminal'; outcome: AgentReversalOutcome } | { state: 'review'; preview: AgentReversalPreview };
/** Recovery never dispatches apply. A recovered unknown operation requires another review and explicit click. */
export function recoverAgentReversal(uid: string, outer: () => void = () => {}, deps = defaults()): Promise<AgentReversalRecovery> {
  return operate(uid, 'recover', undefined, outer, deps) as Promise<AgentReversalRecovery>;
}
export function cancelAgentReversal(uid: string, outer: () => void = () => {}, deps = defaults()): Promise<AgentReversalOutcome> {
  return operate(uid, 'cancel', undefined, outer, deps) as Promise<AgentReversalOutcome>;
}
export function confirmAgentReversal(uid: string, preview: AgentReversalPreview, outer: () => void = () => {}, deps = defaults()): Promise<AgentReversalOutcome> {
  return operate(uid, 'confirm', structuredClone(preview), outer, deps) as Promise<AgentReversalOutcome>;
}
async function operate(uid: string, mode: 'recover' | 'confirm' | 'cancel', expected: AgentReversalPreview | undefined, outer: () => void, deps: AgentReversalClientDeps) {
  return withMemoryEditCryptoScope(uid, outer, deps.crypto, guard => deps.crypto.exclusive(agentReversalCheckpointKey(uid), async () => {
    guard(); const key = agentReversalCheckpointKey(uid), stored = () => deps.crypto.storage.getItem(key); let raw = stored();
    let foreignChange = false;
    const changed = (event: StorageEvent) => { if (event.key === null || event.key === key) foreignChange = true; };
    window.addEventListener('storage', changed);
    const current = () => { guard(); if (foreignChange || stored() !== raw) throw fail(); };
    try {
    let request: AgentReversalRequest;
    if (raw !== null) { request = await journal(raw, uid, current, deps); current(); }
    else {
      if (mode !== 'confirm' || !expected) throw fail(); request = parseAgentReversalRequest(expected.request);
      if (!deps.crypto.enabled(request.baseline.teamId === null ? 'personal' : 'team')) throw fail();
      const fresh = await review(uid, await prepare(uid, request.baseline.proposalId, current, deps), request, current, deps); current();
      if (canonicalSyncState(fresh) !== canonicalSyncState(expected)) throw fail();
      const next = JSON.stringify(await deps.crypto.encryptJournal({ text: JSON.stringify({ v: 1, uid, request }) })); current();
      await journal(next, uid, current, deps); current(); deps.crypto.storage.setItem(key, next); raw = next; current(); notify();
    }
    const digest = await hash(agentReversalRequestBytes(request)); current();
    if (mode === 'confirm' && (!expected || expected.digest !== digest || agentReversalRequestBytes(expected.request) !== agentReversalRequestBytes(request))) throw fail();
    const call = async (operation: 'apply' | 'status' | 'cancel') => {
      current(); const response = result(await deps.call(operation, { expectedUid: uid, request, ...(operation === 'apply' ? { confirmed: true, reviewDigest: digest } : {}) }), request, digest); current(); return response;
    };
    let response = await call('status');
    if (response.status === 'unknown') {
      if (mode === 'recover') {
        const preview = await review(uid, await prepare(uid, request.baseline.proposalId, current, deps), request, current, deps); current();
        return { state: 'review' as const, preview };
      }
      if (mode === 'confirm') {
        if (!deps.crypto.enabled(request.baseline.teamId === null ? 'personal' : 'team')) throw fail();
        const fresh = await review(uid, await prepare(uid, request.baseline.proposalId, current, deps), request, current, deps); current();
        if (canonicalSyncState(fresh) !== canonicalSyncState(expected)) throw fail();
      }
      response = await call(mode === 'cancel' ? 'cancel' : 'apply');
    }
    if (!terminal(response.status)) throw fail(); const confirmed = await call('status');
    if (canonicalSyncState(response) !== canonicalSyncState(confirmed)) throw fail();
    current(); deps.crypto.storage.removeItem(key); raw = null; current(); notify(); current();
    return mode === 'recover' ? { state: 'terminal' as const, outcome: confirmed } : confirmed;
    } finally { window.removeEventListener('storage', changed); }
  }));
}
