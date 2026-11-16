/** Public ciphertext-only proposal contract. Agent tools never approve or apply a change. */
import { agentUidValid } from './agentAccountContract';
import { attachmentIdValid } from './attachmentEnvelope';
import { agentVaultSelector, parseAgentVaultAdmission, type AgentVaultAdmission } from './agentVaultContract';
import { memoryEditRequestBytes, parseMemoryEditRequest, type MemoryEditRequest, type MemoryEditOutcome } from './memoryEditContract';

export const AGENT_MUTATION_MAX_BYTES = 640 * 1024;
export const AGENT_MUTATION_PENDING_LIMIT = 10;
export type AgentMutationStatus = 'pending' | 'applied' | 'rejected' | 'expired' | 'reverted';
export interface AgentMutationAuthority {
  uid: string; grantId: string; clientId: string; grantVersion: number; sessionId: string;
  accessEpoch: number; expiresAt: number; vault: AgentVaultAdmission;
}
export interface AgentMutationReceipt {
  proposalId: string; uid: string; clientId: string; clientName: string; vault: string;
  digest: string; sessionId: string; teamId: string | null; operation: 'edit' | 'delete';
  status: AgentMutationStatus; createdAt: number; expiresAt: number; decidedAt: number | null;
  result: MemoryEditOutcome | null;
}
export interface AgentMutationDecision { expectedUid: string; proposalId: string; reviewDigest: string; confirmed: true }
export interface AgentMutationReview { receipt: AgentMutationReceipt; reviewState: 'ready' | 'terminal' | 'unavailable'; request?: MemoryEditRequest }
const fail = () => new Error('Invalid encrypted agent proposal');
const hashValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw fail();
  return value as Record<string, unknown>;
}
export function parseAgentMutationAuthority(value: unknown): AgentMutationAuthority {
  const row = record(value, ['uid', 'grantId', 'clientId', 'grantVersion', 'sessionId', 'accessEpoch', 'expiresAt', 'vault']);
  if (!agentUidValid(row.uid) || !hashValid(row.grantId) || !hashValid(row.sessionId) ||
    typeof row.clientId !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(row.clientId) ||
    !integer(row.grantVersion) || row.grantVersion < 1 || !integer(row.accessEpoch) || !integer(row.expiresAt) || row.expiresAt < 1) throw fail();
  return { uid: row.uid, grantId: row.grantId, clientId: row.clientId, grantVersion: row.grantVersion,
    sessionId: row.sessionId, accessEpoch: row.accessEpoch, expiresAt: row.expiresAt, vault: parseAgentVaultAdmission(row.vault) };
}
export function parseAgentMutationRequest(value: unknown): MemoryEditRequest {
  const request = parseMemoryEditRequest(value);
  if (new TextEncoder().encode(memoryEditRequestBytes(request)).byteLength > AGENT_MUTATION_MAX_BYTES) throw fail();
  return request;
}
export function parseAgentMutationDecision(value: unknown): AgentMutationDecision {
  const row = record(value, ['expectedUid', 'proposalId', 'reviewDigest', 'confirmed']);
  if (!agentUidValid(row.expectedUid) || !attachmentIdValid(row.proposalId) || !hashValid(row.reviewDigest) || row.confirmed !== true) throw fail();
  return { expectedUid: row.expectedUid, proposalId: row.proposalId, reviewDigest: row.reviewDigest, confirmed: true };
}
export function parseAgentMutationOwnerTarget(value: unknown): { expectedUid: string; proposalId: string } {
  const row = record(value, ['expectedUid', 'proposalId']);
  if (!agentUidValid(row.expectedUid) || !attachmentIdValid(row.proposalId)) throw fail();
  return { expectedUid: row.expectedUid, proposalId: row.proposalId };
}
export function parseAgentMutationAgentTarget(value: unknown): { proposalId: string; digest: string } {
  const row = record(value, ['proposalId', 'digest']);
  if (!attachmentIdValid(row.proposalId) || !hashValid(row.digest)) throw fail();
  return { proposalId: row.proposalId, digest: row.digest };
}
export function assertAgentMutationTarget(authority: AgentMutationAuthority, request: MemoryEditRequest): void {
  const base = request.baseline;
  if (authority.vault.kind === 'personal' ? base.kind !== 'personal' || base.teamId !== null || base.authorUid !== authority.uid :
    base.kind !== 'team' || base.teamId !== authority.vault.teamId || base.teamStateHash !== authority.vault.teamStateHash ||
    base.epochStateHash !== authority.vault.epochStateHash || base.keyEpoch !== authority.vault.keyEpoch || base.keyId !== authority.vault.keyId) throw fail();
}
export function parseAgentMutationReceipt(value: unknown): AgentMutationReceipt {
  const row = record(value, ['proposalId', 'uid', 'clientId', 'clientName', 'vault', 'digest', 'sessionId', 'teamId', 'operation', 'status', 'createdAt', 'expiresAt', 'decidedAt', 'result']);
  if (!attachmentIdValid(row.proposalId) || !agentUidValid(row.uid) || typeof row.clientId !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(row.clientId) ||
    typeof row.clientName !== 'string' || !row.clientName || row.clientName.length > 100 || typeof row.vault !== 'string' ||
    !hashValid(row.digest) || !agentUidValid(row.sessionId) || row.teamId !== null && !agentUidValid(row.teamId) ||
    !['edit', 'delete'].includes(row.operation as string) || !['pending', 'applied', 'rejected', 'expired', 'reverted'].includes(row.status as string) ||
    !integer(row.createdAt) || row.createdAt < 1 || !integer(row.expiresAt) || row.expiresAt <= row.createdAt ||
    (row.status === 'pending' ? row.decidedAt !== null : !integer(row.decidedAt) || row.decidedAt < row.createdAt) ||
    row.vault !== (row.teamId === null ? 'personal' : agentVaultSelector({ kind: 'team', teamId: row.teamId as string }))) throw fail();
  if (row.status === 'applied' || row.status === 'reverted') {
    const result = record(row.result, ['operationId', 'sessionId', 'teamId', 'operation', 'digest', 'status', 'revision', 'createdAt']);
    if (result.operationId !== row.proposalId || result.sessionId !== row.sessionId || result.teamId !== row.teamId || result.operation !== row.operation ||
      result.digest !== row.digest || result.status !== 'committed' || !integer(result.revision) || result.revision < 1 || !integer(result.createdAt) || result.createdAt < 1) throw fail();
  } else if (row.result !== null) throw fail();
  return structuredClone(row) as unknown as AgentMutationReceipt;
}
export function parseAgentMutationReview(value: unknown): AgentMutationReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  const state = (value as Record<string, unknown>).reviewState;
  const row = record(value, state === 'ready' ? ['receipt', 'reviewState', 'request'] : ['receipt', 'reviewState']);
  const receipt = parseAgentMutationReceipt(row.receipt);
  if (state === 'terminal') { if (receipt.status === 'pending') throw fail(); return { receipt, reviewState: state }; }
  if (receipt.status !== 'pending' || !['ready', 'unavailable'].includes(state as string)) throw fail();
  if (state === 'unavailable') return { receipt, reviewState: state };
  const request = parseAgentMutationRequest(row.request);
  if (request.operationId !== receipt.proposalId || request.baseline.sessionId !== receipt.sessionId || request.baseline.teamId !== receipt.teamId || request.operation !== receipt.operation) throw fail();
  return { receipt, reviewState: 'ready', request };
}
