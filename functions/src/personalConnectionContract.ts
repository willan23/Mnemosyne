import {canonicalSyncState, MAX_SYNC_CONNECTIONS, syncHashValid, syncIdValid} from './mobileSyncImportContract';

export const MAX_PERSONAL_CONNECTIONS = MAX_SYNC_CONNECTIONS;
export interface PersonalConnectionPair {sourceId: string; targetId: string}
export interface PersonalConnectionPreparation extends PersonalConnectionPair {sourceHash: string; targetHash: string}
export interface PersonalConnectionRequest extends PersonalConnectionPair {
  operationId: string; operation: 'link'|'unlink'; expectedSourceHash: string; expectedTargetHash: string;
}
export interface PersonalConnectionOutcome {
  operationId: string; digest: string; status: 'unknown'|'committed'|'cancelled'; changed: boolean; createdAt: number|null;
}
function record(value: unknown, fields: string[]): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.sort().join(',')) throw new Error('Invalid connection request');
  return value as Record<string,unknown>;
}
export function parsePersonalConnectionPair(value: unknown): PersonalConnectionPair {
  const data = record(value,['sourceId','targetId']);
  if (!syncIdValid(data.sourceId) || !syncIdValid(data.targetId) || data.sourceId === data.targetId) throw new Error('Invalid connection request');
  return {sourceId:data.sourceId,targetId:data.targetId};
}
export function parsePersonalConnectionRequest(value: unknown): PersonalConnectionRequest {
  const data = record(value,['sourceId','targetId','operationId','operation','expectedSourceHash','expectedTargetHash']);
  const pair = parsePersonalConnectionPair({sourceId:data.sourceId,targetId:data.targetId});
  if (!syncIdValid(data.operationId) || !['link','unlink'].includes(String(data.operation)) || !syncHashValid(data.expectedSourceHash) || !syncHashValid(data.expectedTargetHash)) throw new Error('Invalid connection request');
  return {...pair,operationId:data.operationId,operation:data.operation as 'link'|'unlink',expectedSourceHash:data.expectedSourceHash,expectedTargetHash:data.expectedTargetHash};
}
export const personalConnectionRequestBytes = (input: PersonalConnectionRequest) => canonicalSyncState(parsePersonalConnectionRequest(input));
