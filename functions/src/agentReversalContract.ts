/** Owner-only encrypted reversal. No agent bearer or tool can confirm this protocol. */
import { attachmentIdValid } from './attachmentEnvelope';
import { agentUidValid } from './agentAccountContract';
import { parseMemoryEditMetadata } from './memoryEditContract';
import { parseTeamRevisionCipher, type TeamRevisionCipher } from './teamRevisionContract';
import { canonicalSyncState, syncHashValid, syncInteger } from './mobileSyncImportContract';

export const AGENT_REVERSAL_MAX_BYTES = 640 * 1024;
export interface AgentReversalBaseline {
  proposalId: string; sessionId: string; teamId: string | null; authorUid: string; ownerUid: string;
  originalDigest: string; originalRevision: number; revision: number; reversalEpoch: number; stateHash: string; stateDigest: string;
  versionId: string; versionHash: string; teamStateHash: string | null; epochStateHash: string | null;
  keyEpoch: number | null; keyId: string | null; currentKeyEpoch: number | null; currentKeyId: string | null;
  sourceKeyEpoch: number | null; sourceKeyId: string | null;
}
export interface AgentReversalPreparation {
  baseline: AgentReversalBaseline; currentEnc: TeamRevisionCipher; sourceEnc: TeamRevisionCipher;
  currentMetadata: Record<string, unknown>; sourceMetadata: Record<string, unknown>;
  currentLearning: Record<string, unknown> | null; sourceLearning: Record<string, unknown> | null;
  currentLearningPresent: boolean; sourceLearningPresent: boolean; deleted: boolean;
}
export interface AgentReversalRequest { operationId: string; baseline: AgentReversalBaseline; enc: TeamRevisionCipher }
export interface AgentReversalOutcome {
  operationId: string; proposalId: string; sessionId: string; teamId: string | null; digest: string;
  status: 'unknown' | 'committed' | 'cancelled' | 'revoked'; revision: number | null; createdAt: number | null;
}
const fail = () => Error('Invalid encrypted agent reversal');
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw fail();
  return value as Record<string, unknown>;
}
function learning(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || new TextEncoder().encode(canonicalSyncState(value)).byteLength > 100 * 1024) throw fail();
  return structuredClone(value) as Record<string, unknown>;
}
export function parseAgentReversalBaseline(value: unknown): AgentReversalBaseline {
  const row = record(value, ['proposalId', 'sessionId', 'teamId', 'authorUid', 'ownerUid', 'originalDigest', 'originalRevision', 'revision', 'reversalEpoch', 'stateHash', 'stateDigest',
    'versionId', 'versionHash', 'teamStateHash', 'epochStateHash', 'keyEpoch', 'keyId', 'currentKeyEpoch', 'currentKeyId', 'sourceKeyEpoch', 'sourceKeyId']);
  if (!attachmentIdValid(row.proposalId) || !agentUidValid(row.sessionId) || !agentUidValid(row.authorUid) || !agentUidValid(row.ownerUid) ||
    !syncHashValid(row.originalDigest) || !syncInteger(row.originalRevision) || Number(row.originalRevision) < 1 || !syncInteger(row.revision) || row.revision !== row.originalRevision || !syncInteger(row.reversalEpoch) ||
    !syncHashValid(row.stateHash) || !syncHashValid(row.stateDigest) || !syncHashValid(row.versionHash) || row.versionId !== 'memory-edit-' + row.proposalId) throw fail();
  const keyFields = ['keyEpoch', 'keyId', 'currentKeyEpoch', 'currentKeyId', 'sourceKeyEpoch', 'sourceKeyId', 'teamStateHash', 'epochStateHash'];
  if (row.teamId === null) {
    if (row.ownerUid !== row.authorUid || keyFields.some(key => row[key] !== null)) throw fail();
  } else {
    if (!agentUidValid(row.teamId) || !syncHashValid(row.teamStateHash) || !syncHashValid(row.epochStateHash) ||
      !syncInteger(row.keyEpoch) || Number(row.keyEpoch) < 1 || !attachmentIdValid(row.keyId)) throw fail();
    for (const prefix of ['current', 'source']) if (!syncInteger(row[prefix + 'KeyEpoch']) || Number(row[prefix + 'KeyEpoch']) < 1 || Number(row[prefix + 'KeyEpoch']) > Number(row.keyEpoch) ||
      row[prefix + 'KeyId'] !== null && !attachmentIdValid(row[prefix + 'KeyId'])) throw fail();
  }
  return structuredClone(row) as unknown as AgentReversalBaseline;
}
export function parseAgentReversalPreparation(value: unknown): AgentReversalPreparation {
  const row = record(value, ['baseline', 'currentEnc', 'sourceEnc', 'currentMetadata', 'sourceMetadata', 'currentLearning', 'sourceLearning', 'currentLearningPresent', 'sourceLearningPresent', 'deleted']);
  const baseline = parseAgentReversalBaseline(row.baseline), currentEnc = parseTeamRevisionCipher(row.currentEnc), sourceEnc = parseTeamRevisionCipher(row.sourceEnc);
  if (typeof row.deleted !== 'boolean' || typeof row.currentLearningPresent !== 'boolean' || typeof row.sourceLearningPresent !== 'boolean' ||
    !row.currentLearningPresent && row.currentLearning !== null || !row.sourceLearningPresent && row.sourceLearning !== null ||
    baseline.teamId === null && (currentEnc.v !== 1 || sourceEnc.v !== 1) || baseline.teamId !== null &&
    (currentEnc.v === 2 && baseline.currentKeyId === null || sourceEnc.v === 2 && baseline.sourceKeyId === null)) throw fail();
  const result = { baseline, currentEnc, sourceEnc, currentMetadata: parseMemoryEditMetadata(row.currentMetadata), sourceMetadata: parseMemoryEditMetadata(row.sourceMetadata),
    currentLearning: learning(row.currentLearning), sourceLearning: learning(row.sourceLearning), currentLearningPresent: row.currentLearningPresent, sourceLearningPresent: row.sourceLearningPresent, deleted: row.deleted };
  if (new TextEncoder().encode(canonicalSyncState(result)).byteLength > 2 * AGENT_REVERSAL_MAX_BYTES) throw fail();
  return result;
}
export function parseAgentReversalRequest(value: unknown): AgentReversalRequest {
  const row = record(value, ['operationId', 'baseline', 'enc']), baseline = parseAgentReversalBaseline(row.baseline), enc = parseTeamRevisionCipher(row.enc);
  if (!attachmentIdValid(row.operationId) || row.operationId === baseline.proposalId || enc.v !== (baseline.teamId === null ? 1 : 2)) throw fail();
  const result = { operationId: row.operationId, baseline, enc };
  if (new TextEncoder().encode(canonicalSyncState(result)).byteLength > AGENT_REVERSAL_MAX_BYTES) throw fail();
  return result;
}
export const agentReversalRequestBytes = (value: AgentReversalRequest) => canonicalSyncState(parseAgentReversalRequest(value));
export function parseAgentReversalCommand(mode: 'prepare' | 'apply' | 'status' | 'cancel', value: unknown) {
  const row = record(value, mode === 'apply' ? ['expectedUid', 'request', 'reviewDigest', 'confirmed'] : ['expectedUid', 'request']);
  if (!agentUidValid(row.expectedUid)) throw fail();
  if (mode === 'prepare') {
    const target = record(row.request, ['proposalId']); if (!attachmentIdValid(target.proposalId)) throw fail();
    return { expectedUid: row.expectedUid, request: { proposalId: target.proposalId } };
  }
  if (!['apply', 'status', 'cancel'].includes(mode) || mode === 'apply' && (row.confirmed !== true || !syncHashValid(row.reviewDigest))) throw fail();
  return { expectedUid: row.expectedUid, request: parseAgentReversalRequest(row.request), ...(mode === 'apply' ? { reviewDigest: row.reviewDigest as string, confirmed: true as const } : {}) };
}
export function parseAgentReversalOutcome(value: unknown): AgentReversalOutcome {
  const row = record(value, ['operationId', 'proposalId', 'sessionId', 'teamId', 'digest', 'status', 'revision', 'createdAt']);
  if (!attachmentIdValid(row.operationId) || !attachmentIdValid(row.proposalId) || !agentUidValid(row.sessionId) || row.teamId !== null && !agentUidValid(row.teamId) || !syncHashValid(row.digest) ||
    !['unknown', 'committed', 'cancelled', 'revoked'].includes(row.status as string) || (row.status === 'committed' ? !syncInteger(row.revision) || Number(row.revision) < 1 : row.revision !== null) ||
    (row.status === 'unknown' || row.status === 'revoked' ? row.createdAt !== null : !syncInteger(row.createdAt) || Number(row.createdAt) < 1)) throw fail();
  return structuredClone(row) as unknown as AgentReversalOutcome;
}
