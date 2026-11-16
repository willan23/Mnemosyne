import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase';
import { AGENT_MUTATION_WRITES_ENABLED } from '../config/releaseGates';
import { withAgentAccount } from './agentAccount';
import { reviewEncryptedMemoryEdit, type EncryptedMemoryEditReview } from './memoryEditRecovery';
import { canonicalSyncState } from '../../../functions/src/mobileSyncImportContract';
import { parseAgentMutationOwnerTarget, parseAgentMutationDecision, parseAgentMutationReceipt, parseAgentMutationReview,
  type AgentMutationReceipt, type AgentMutationReview } from '../../../functions/src/agentMutationContract';

export interface AgentMutationPreview extends EncryptedMemoryEditReview { receipt: AgentMutationReceipt }
export interface AgentMutationList { receipts: AgentMutationReceipt[]; nextCursor: string | null }
export interface AgentMutationClientDeps {
  enabled: () => boolean;
  account: typeof withAgentAccount;
  review: typeof reviewEncryptedMemoryEdit;
  call: (name: string, command: unknown) => Promise<unknown>;
}
const defaults = (): AgentMutationClientDeps => ({ enabled: () => AGENT_MUTATION_WRITES_ENABLED, account: withAgentAccount,
  review: reviewEncryptedMemoryEdit, call: async (name, command) => (await httpsCallable(getFunctions(app, 'europe-west1'), name)(command)).data });
const fail = () => new Error('Agent proposal unavailable; refresh the receipt');
function ownedReceipt(value: unknown, uid: string, proposalId?: string, digest?: string) {
  const receipt = parseAgentMutationReceipt(value);
  if (receipt.uid !== uid || proposalId !== undefined && receipt.proposalId !== proposalId || digest !== undefined && receipt.digest !== digest) throw fail();
  return receipt;
}
async function get(uid: string, proposalId: string, guard: () => void, deps: AgentMutationClientDeps): Promise<AgentMutationReview> {
  const command = parseAgentMutationOwnerTarget({ expectedUid: uid, proposalId }); guard();
  const result = parseAgentMutationReview(await deps.call('getAgentMutationProposal', command)); guard();
  ownedReceipt(result.receipt, uid, proposalId); return result;
}
export function getAgentMutationReceipt(uid: string, proposalId: string, deps = defaults()) {
  return deps.account(uid, async guard => (await get(uid, proposalId, guard, deps)).receipt);
}
export function listAgentMutations(uid: string, mode: 'pending' | 'history', cursor: string | null = null, deps = defaults()): Promise<AgentMutationList> {
  if (!['pending', 'history'].includes(mode) || mode === 'pending' && cursor !== null) throw fail();
  if (cursor !== null) parseAgentMutationOwnerTarget({ expectedUid: uid, proposalId: cursor });
  return deps.account(uid, async guard => {
    guard(); const value = await deps.call('listAgentMutationProposals', { expectedUid: uid, mode, cursor }); guard();
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'nextCursor,receipts') throw fail();
    const row = value as { receipts: unknown[]; nextCursor: string | null };
    if (!Array.isArray(row.receipts) || row.receipts.length > (mode === 'pending' ? 10 : 20) || mode === 'pending' && row.nextCursor !== null) throw fail();
    const receipts = row.receipts.map(receipt => ownedReceipt(receipt, uid));
    if (new Set(receipts.map(receipt => receipt.proposalId)).size !== receipts.length || mode === 'pending' && receipts.some(receipt => receipt.status !== 'pending')) throw fail();
    if (row.nextCursor !== null) {
      parseAgentMutationOwnerTarget({ expectedUid: uid, proposalId: row.nextCursor });
      if (!receipts.some(receipt => receipt.proposalId === row.nextCursor)) throw fail();
    }
    return { receipts, nextCursor: row.nextCursor };
  });
}
export function previewAgentMutation(uid: string, proposalId: string, assertCurrent: () => void, deps = defaults()): Promise<AgentMutationPreview> {
  return deps.account(uid, async account => {
    const guard = () => { account(); assertCurrent(); }; guard();
    const row = await get(uid, proposalId, guard, deps);
    if (row.reviewState !== 'ready' || !row.request) throw fail();
    const preview = await deps.review(uid, row.request, guard); guard();
    if (preview.digest !== row.receipt.digest) throw fail();
    return { ...preview, receipt: row.receipt };
  });
}
/** A fresh decrypt/baseline check runs under one account/vault lease through the explicit approval RPC. */
export function approveAgentMutation(uid: string, value: AgentMutationPreview, assertCurrent: () => void, deps = defaults()): Promise<AgentMutationReceipt> {
  const expected = structuredClone(value);
  const decision = parseAgentMutationDecision({ expectedUid: uid, proposalId: expected.receipt.proposalId, reviewDigest: expected.digest, confirmed: true });
  ownedReceipt(expected.receipt, uid, decision.proposalId, expected.digest);
  if (!deps.enabled()) throw fail();
  return deps.account(uid, async account => {
    const guard = () => { account(); assertCurrent(); if (!deps.enabled()) throw fail(); }; guard();
    const row = await get(uid, decision.proposalId, guard, deps);
    if (row.receipt.digest !== expected.digest) throw fail();
    if (row.reviewState === 'terminal') return row.receipt;
    if (!row.request || row.reviewState !== 'ready') throw fail();
    const result = await deps.review(uid, row.request, guard, async (fresh, current) => {
      current(); guard();
      if (fresh.digest !== expected.digest || canonicalSyncState(fresh) !== canonicalSyncState({ request: expected.request, digest: expected.digest, before: expected.before, after: expected.after })) throw fail();
      const receipt = ownedReceipt(await deps.call('approveAgentMutationProposal', decision), uid, decision.proposalId, expected.digest); current(); guard();
      const confirmed = (await get(uid, decision.proposalId, guard, deps)).receipt;
      if (canonicalSyncState(receipt) !== canonicalSyncState(confirmed) || confirmed.status === 'pending') throw fail();
      return confirmed;
    });
    return ownedReceipt(result, uid, decision.proposalId, expected.digest);
  });
}
/** Rejection and receipt recovery remain available with the vault locked and admission closed. */
export function rejectAgentMutation(uid: string, value: AgentMutationReceipt, deps = defaults()): Promise<AgentMutationReceipt> {
  const receipt = ownedReceipt(value, uid);
  const command = parseAgentMutationDecision({ expectedUid: uid, proposalId: receipt.proposalId, reviewDigest: receipt.digest, confirmed: true });
  return deps.account(uid, async guard => {
    guard(); const result = ownedReceipt(await deps.call('rejectAgentMutationProposal', command), uid, receipt.proposalId, receipt.digest); guard();
    const confirmed = (await get(uid, receipt.proposalId, guard, deps)).receipt;
    if (canonicalSyncState(result) !== canonicalSyncState(confirmed) || confirmed.status === 'pending') throw fail();
    return confirmed;
  });
}
