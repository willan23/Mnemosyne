/** Public, credential-free contract. A grant names exactly one vault. */
import { agentUidValid } from './agentAccountContract';
import { attachmentIdValid } from './attachmentEnvelope';
// Legacy gateways only accept mne_code_/mne_agent_; team authority must fail closed there.
export const AGENT_VAULT_CODE_PREFIX = 'mne_vault_code_';
export const AGENT_VAULT_TOKEN_PREFIX = 'mne_vault_';
export const AGENT_REVIEW_CODE_PREFIX = 'mne_review_code_';
export const AGENT_REVIEW_TOKEN_PREFIX = 'mne_review_';
export type AgentScope = 'memories:read' | 'memories:search' | 'memories:write';
/** Structural permissions; operational write gates are enforced by consent and mutation entrypoints. */
export function parseAgentScopes(value: unknown): AgentScope[] {
  if (!Array.isArray(value) || !value.length || value.length > 3 || value.some(scope =>
    scope !== 'memories:read' && scope !== 'memories:search' && scope !== 'memories:write')) throw new Error('Invalid agent scopes');
  return [...new Set(value)] as AgentScope[];
}
export const agentCodePrefix = (vault: AgentVaultTarget, scopes: readonly string[]) => scopes.includes('memories:write') ? AGENT_REVIEW_CODE_PREFIX : vault.kind === 'team' ? AGENT_VAULT_CODE_PREFIX : 'mne_code_';
export const agentTokenPrefix = (vault: AgentVaultTarget, scopes: readonly string[]) => scopes.includes('memories:write') ? AGENT_REVIEW_TOKEN_PREFIX : vault.kind === 'team' ? AGENT_VAULT_TOKEN_PREFIX : 'mne_agent_';

export type AgentVaultTarget = { kind: 'personal' } | { kind: 'team'; teamId: string };
export type AgentVaultAdmission = { kind: 'personal' } | {
  kind: 'team'; teamId: string; keyEpoch: number; keyId: string; teamStateHash: string; epochStateHash: string;
};
const fail = () => new Error('Invalid agent vault');
export function parseAgentVaultSelector(value: unknown): AgentVaultTarget {
  if (value === undefined || value === 'personal') return { kind: 'personal' };
  if (typeof value !== 'string' || !value.startsWith('team:') || !agentUidValid(value.slice(5))) throw fail();
  return { kind: 'team', teamId: value.slice(5) };
}
export const agentVaultSelector = (value: AgentVaultTarget): string => value.kind === 'personal' ? 'personal' : `team:${value.teamId}`;
export function parseAgentVaultAdmission(value: unknown, legacyPersonal = false): AgentVaultAdmission {
  if (value === undefined && legacyPersonal) return { kind: 'personal' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  const row = value as Record<string, unknown>, keys = Object.keys(row).sort().join(',');
  if (row.kind === 'personal' && keys === 'kind') return { kind: 'personal' };
  if (row.kind !== 'team' || keys !== 'epochStateHash,keyEpoch,keyId,kind,teamId,teamStateHash' ||
    !agentUidValid(row.teamId) || !attachmentIdValid(row.keyId) || typeof row.keyEpoch !== 'number' ||
    !Number.isSafeInteger(row.keyEpoch) || row.keyEpoch < 1 ||
    ![row.teamStateHash, row.epochStateHash].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) throw fail();
  return { kind: 'team', teamId: row.teamId, keyEpoch: row.keyEpoch, keyId: row.keyId,
    teamStateHash: row.teamStateHash as string, epochStateHash: row.epochStateHash as string };
}
export const agentVaultAdmissionBytes = (value: AgentVaultAdmission) => JSON.stringify(parseAgentVaultAdmission(value));
