import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../firebase', () => ({ default: {}, auth: {}, db: {} }));
import { listAgentMutations, previewAgentMutation, approveAgentMutation, rejectAgentMutation, getAgentMutationReceipt, type AgentMutationClientDeps } from './agentMutations';
import type { AgentMutationReceipt } from '../../../functions/src/agentMutationContract';
import type { EncryptedMemoryEditReview } from './memoryEditRecovery';
import { memoryEditRequestBytes } from '../../../functions/src/memoryEditContract';
const id = '32345678-1234-4234-8234-123456789012';
let deps: AgentMutationClientDeps, receipt: AgentMutationReceipt, review: EncryptedMemoryEditReview;
let uid: string, epoch: number, enabled: boolean, lost: boolean, unavailable: boolean;
const call = vi.fn(), cryptoReview = vi.fn();
beforeEach(async () => {
  uid = 'alice'; epoch = 0; enabled = true; lost = false; unavailable = false;
  const baseline = { kind: 'personal' as const, sessionId: 'note', teamId: null, authorUid: 'alice', ownerUid: 'alice', stateHash: 'a'.repeat(64), stateDigest: 'b'.repeat(64), revision: 1,
    teamStateHash: null, epochStateHash: null, keyEpoch: null, keyId: null, priorKeyEpoch: null, priorKeyId: null };
  const request = { operationId: id, operation: 'edit' as const, baseline, priorEnc: { v: 1 as const, iv: 'A'.repeat(16), ct: 'B'.repeat(32) }, enc: { v: 1 as const, iv: 'A'.repeat(16), ct: 'C'.repeat(32) }, metadata: { tags: ['new'] } };
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(memoryEditRequestBytes(request)))), value => value.toString(16).padStart(2, '0')).join('');
  review = { request, digest, before: { text: 'Synthetic private source', title: null, metadata: { tags: ['old'] } }, after: { text: 'Synthetic private proposal', title: null, metadata: { tags: ['new'] } } };
  receipt = { proposalId: id, uid, clientId: 'synthetic-client', clientName: 'Synthetic app', vault: 'personal', digest, sessionId: 'note', teamId: null, operation: 'edit', status: 'pending', createdAt: 1000, expiresAt: 901000, decidedAt: null, result: null };
  cryptoReview.mockReset(); cryptoReview.mockImplementation(async (_uid, _request, guard, consume) => { guard(); return consume ? consume(structuredClone(review), guard) : structuredClone(review); });
  call.mockReset(); call.mockImplementation(async (name, command) => {
    expect(command.expectedUid).toBe('alice');
    if (name === 'listAgentMutationProposals') return { receipts: [structuredClone(receipt)], nextCursor: null };
    if (name === 'getAgentMutationProposal') return receipt.status !== 'pending' ? { receipt: structuredClone(receipt), reviewState: 'terminal' } : unavailable ? { receipt: structuredClone(receipt), reviewState: 'unavailable' } : { receipt: structuredClone(receipt), reviewState: 'ready', request: structuredClone(request) };
    expect(command).toEqual({ expectedUid: 'alice', proposalId: id, reviewDigest: digest, confirmed: true });
    receipt = { ...receipt, status: name === 'approveAgentMutationProposal' ? 'applied' : 'rejected', decidedAt: 1002,
      result: name === 'approveAgentMutationProposal' ? { operationId: id, operation: 'edit', sessionId: 'note', teamId: null, digest, status: 'committed', revision: 1002, createdAt: 1002 } : null };
    if (lost) throw Error('Synthetic lost acknowledgement');
    return structuredClone(receipt);
  });
  deps = { enabled: () => enabled, call, review: cryptoReview as AgentMutationClientDeps['review'], account: async (expected, work) => {
    const captured = epoch, guard = () => { if (uid !== expected || epoch !== captured) throw Error('Synthetic account changed'); };
    guard(); const result = await work(guard); guard(); return result;
  } };
});
it('listing, receipt inspection and rejection remain available without decrypting or write admission', async () => {
  enabled = false; expect((await listAgentMutations('alice', 'pending', null, deps)).receipts).toEqual([receipt]);
  expect(await getAgentMutationReceipt('alice', id, deps)).toEqual(receipt);
  expect((await rejectAgentMutation('alice', receipt, deps)).status).toBe('rejected'); expect(cryptoReview).not.toHaveBeenCalled();
});
it('preview never approves; explicit confirmation rechecks the exact decrypted content and immutable digest', async () => {
  const preview = await previewAgentMutation('alice', id, () => {}, deps);
  expect(call.mock.calls.every(row => row[0] === 'getAgentMutationProposal')).toBe(true);
  expect((await approveAgentMutation('alice', preview, () => {}, deps)).status).toBe('applied'); expect(cryptoReview).toHaveBeenCalledTimes(2);
  expect(call.mock.calls.filter(row => row[0] === 'approveAgentMutationProposal')).toHaveLength(1);
  expect(JSON.stringify(call.mock.calls)).not.toContain('Synthetic private');
});
it('an edited preview or a replaced proposal digest cannot dispatch approval', async () => {
  const preview = await previewAgentMutation('alice', id, () => {}, deps); preview.before.text = 'Substituted source';
  await expect(approveAgentMutation('alice', preview, () => {}, deps)).rejects.toThrow();
  expect(call.mock.calls.some(row => row[0] === 'approveAgentMutationProposal')).toBe(false);
  receipt.digest = 'e'.repeat(64); await expect(previewAgentMutation('alice', id, () => {}, deps)).rejects.toThrow();
});
it('a lost approval response is recovered by reading the durable receipt, without another approval', async () => {
  const preview = await previewAgentMutation('alice', id, () => {}, deps); lost = true;
  await expect(approveAgentMutation('alice', preview, () => {}, deps)).rejects.toThrow(); enabled = false;
  expect((await getAgentMutationReceipt('alice', id, deps)).status).toBe('applied');
  await listAgentMutations('alice', 'history', null, deps);
  expect(call.mock.calls.filter(row => row[0] === 'approveAgentMutationProposal')).toHaveLength(1);
});
it('closed admission and an unavailable original grant cannot dispatch approval', async () => {
  const preview = await previewAgentMutation('alice', id, () => {}, deps); enabled = false; call.mockClear();
  expect(() => approveAgentMutation('alice', preview, () => {}, deps)).toThrow(); expect(call).not.toHaveBeenCalled();
  enabled = true; unavailable = true; await expect(approveAgentMutation('alice', preview, () => {}, deps)).rejects.toThrow(); expect(call.mock.calls.some(row => row[0] === 'approveAgentMutationProposal')).toBe(false);
});
it('account ABA during the RPC discards the response and does not repeat approval', async () => {
  const preview = await previewAgentMutation('alice', id, () => {}, deps), rpc = deps.call;
  deps.call = async (name, command) => { const result = await rpc(name, command); if (name === 'approveAgentMutationProposal') { uid = 'bob'; epoch++; uid = 'alice'; epoch++; } return result; };
  await expect(approveAgentMutation('alice', preview, () => {}, deps)).rejects.toThrow(); expect(receipt.status).toBe('applied');
  expect(call.mock.calls.filter(row => row[0] === 'approveAgentMutationProposal')).toHaveLength(1);
});
it('foreign, duplicate and unexpected receipt payloads are refused before review', async () => {
  receipt.uid = 'bob'; await expect(getAgentMutationReceipt('alice', id, deps)).rejects.toThrow(); receipt.uid = 'alice';
  deps.call = async () => ({ receipts: [receipt, receipt], nextCursor: null }); await expect(listAgentMutations('alice', 'pending', null, deps)).rejects.toThrow();
  deps.call = async () => ({ receipt, reviewState: 'ready', request: review.request, text: 'Untrusted preview' }); await expect(previewAgentMutation('alice', id, () => {}, deps)).rejects.toThrow(); expect(cryptoReview).not.toHaveBeenCalled();
});
