import {attachmentIdValid} from './attachmentEnvelope';
import {canonicalSyncState,parseSyncCipher,parseSyncMetadata,syncHashValid,syncIdValid,syncInteger,type SyncCipher} from './mobileSyncImportContract';
export const PERSONAL_REVISION_MAX_BYTES=2_100_000;
export interface PersonalRevisionBaseline {sessionId:string;stateHash:string;stateDigest:string;revision:number}
export interface PersonalRevisionMetadata {embedding:number[]|null;embeddingModel:string|null;semanticClusterId:string|null;position:[number,number,number]|null;importance:number;processingMethod:string}
export interface PersonalRevisionRequest {operationId:string;baseline:PersonalRevisionBaseline;enc:SyncCipher;priorEnc:SyncCipher;metadata:PersonalRevisionMetadata}
export interface PersonalRevisionOutcome {operationId:string;sessionId:string;digest:string;status:'unknown'|'committed'|'cancelled';revision:number|null;createdAt:number|null}
const fail=()=>new Error('Invalid encrypted revision');
function record(value:unknown,fields:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...fields].sort().join(','))throw fail();return value as Record<string,unknown>;}
export function parsePersonalRevisionTarget(value:unknown){const data=record(value,['sessionId']);if(!syncIdValid(data.sessionId))throw fail();return{sessionId:data.sessionId};}
export function parsePersonalRevisionBaseline(value:unknown):PersonalRevisionBaseline{
  const data=record(value,['sessionId','stateHash','stateDigest','revision']);parsePersonalRevisionTarget({sessionId:data.sessionId});
  if(!syncHashValid(data.stateHash)||!syncHashValid(data.stateDigest)||!syncInteger(data.revision))throw fail();
  return {sessionId:data.sessionId as string,stateHash:data.stateHash as string,stateDigest:data.stateDigest as string,revision:data.revision as number};
}
export function parsePersonalRevisionRequest(value:unknown):PersonalRevisionRequest{
  const data=record(value,['operationId','baseline','enc','priorEnc','metadata']);if(!attachmentIdValid(data.operationId))throw fail();
  const baseline=parsePersonalRevisionBaseline(data.baseline);const metadata=record(data.metadata,['embedding','embeddingModel','semanticClusterId','position','importance','processingMethod']);
  if(typeof metadata.processingMethod!=='string'||!metadata.processingMethod||metadata.processingMethod.length>200||typeof metadata.importance!=='number')throw fail();
  parseSyncMetadata(Object.fromEntries(Object.entries(metadata).filter(([key,value])=>key!=='processingMethod'&&value!==null)));
  const result={operationId:data.operationId,baseline:{...baseline},enc:parseSyncCipher(data.enc),priorEnc:parseSyncCipher(data.priorEnc),metadata:JSON.parse(JSON.stringify(metadata)) as PersonalRevisionMetadata};
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>PERSONAL_REVISION_MAX_BYTES)throw fail();return result;
}
export const personalRevisionRequestBytes=(request:PersonalRevisionRequest)=>canonicalSyncState(parsePersonalRevisionRequest(request));
