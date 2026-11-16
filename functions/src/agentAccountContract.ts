/** Public, credential-free contract for account-bound agent controls. */
export interface AgentAccessState { disabled: boolean; epoch: number }
export interface AgentAccessCommand { expectedUid: string; disabled: boolean; baseline: AgentAccessState }
export const agentUidValid = (value: unknown): value is string => typeof value === 'string' && /^[^/\x00-\x1f\x7f]{1,128}$/.test(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const epochValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function readAgentAccessState(value: unknown): AgentAccessState | null {
  const profile = record(value), epoch = profile.agentAccessEpoch === undefined ? 0 : profile.agentAccessEpoch;
  if (profile.agentAccessDisabled !== undefined && typeof profile.agentAccessDisabled !== 'boolean' || !epochValid(epoch)) return null;
  return { disabled: profile.agentAccessDisabled === true, epoch };
}
export function parseAgentAccessCommand(value: unknown): AgentAccessCommand {
  const row = record(value), baseline = record(row.baseline);
  if (Object.keys(row).sort().join(',') !== 'baseline,disabled,expectedUid' ||
    Object.keys(baseline).sort().join(',') !== 'disabled,epoch' || !agentUidValid(row.expectedUid) ||
    typeof row.disabled !== 'boolean' || typeof baseline.disabled !== 'boolean' || !epochValid(baseline.epoch) || row.disabled === baseline.disabled) throw new Error('Invalid agent control command');
  return { expectedUid: row.expectedUid, disabled: row.disabled, baseline: { disabled: baseline.disabled, epoch: baseline.epoch } };
}
