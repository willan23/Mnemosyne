import {attachmentIdValid,attachmentActorIdValid} from './attachmentEnvelope';
import {canonicalSyncState,syncHashValid,syncIdValid,syncInteger} from './mobileSyncImportContract';
import {parsePersonalRevisionRequest,type PersonalRevisionMetadata} from './personalRevisionContract';
export const TEAM_REVISION_MAX_BYTES=2_100_000;
export interface TeamRevisionTarget{sessionId:string;teamId:string}
export interface TeamRevisionBaseline extends TeamRevisionTarget{
  authorUid:string;ownerUid:string;stateHash:string;stateDigest:string;revision:number;teamStateHash:string;epochStateHash:string;
  keyEpoch:number;keyId:string;priorKeyEpoch:number;priorKeyId:string|null;
}
export interface TeamRevisionCipher{v:1|2;iv:string;ct:string}
export interface TeamRevisionRequest{operationId:string;baseline:TeamRevisionBaseline;enc:TeamRevisionCipher;priorEnc:TeamRevisionCipher;metadata:PersonalRevisionMetadata}
export interface TeamRevisionOutcome{operationId:string;sessionId:string;teamId:string;digest:string;status:'unknown'|'committed'|'cancelled'|'revoked';revision:number|null;createdAt:number|null}
export type TeamRevisionCall='prepare'|'apply'|'status'|'cancel';
export function teamRevisionTime(value:unknown):number|null{if(syncInteger(value))return value;if(value&&typeof value==='object'&&'toMillis' in value&&typeof value.toMillis==='function'){const result=value.toMillis();return syncInteger(result)?result:null;}return null;}
export function teamRevisionRecord(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Invalid encrypted team revision');return value as Record<string,unknown>;}
export function parseTeamRevisionTarget(value:unknown):TeamRevisionTarget{
  const row=teamRevisionRecord(value,['sessionId','teamId']);if(!syncIdValid(row.sessionId)||!attachmentActorIdValid(row.teamId))throw Error('Invalid revision target');return{sessionId:row.sessionId,teamId:row.teamId};
}
export function parseTeamRevisionBaseline(value:unknown):TeamRevisionBaseline{
  const row=teamRevisionRecord(value,['sessionId','teamId','authorUid','ownerUid','stateHash','stateDigest','revision','teamStateHash','epochStateHash','keyEpoch','keyId','priorKeyEpoch','priorKeyId']);const target=parseTeamRevisionTarget({sessionId:row.sessionId,teamId:row.teamId});
  if(!attachmentActorIdValid(row.authorUid)||!attachmentActorIdValid(row.ownerUid)||![row.stateHash,row.stateDigest,row.teamStateHash,row.epochStateHash].every(syncHashValid)||!syncInteger(row.revision)||!syncInteger(row.keyEpoch)||row.keyEpoch<1||!attachmentIdValid(row.keyId)||!syncInteger(row.priorKeyEpoch)||row.priorKeyEpoch<1||row.priorKeyEpoch>row.keyEpoch||row.priorKeyId!==null&&!attachmentIdValid(row.priorKeyId))throw Error('Invalid revision baseline');
  return{...target,authorUid:row.authorUid,ownerUid:row.ownerUid,stateHash:row.stateHash as string,stateDigest:row.stateDigest as string,revision:row.revision,teamStateHash:row.teamStateHash as string,epochStateHash:row.epochStateHash as string,keyEpoch:row.keyEpoch,keyId:row.keyId,priorKeyEpoch:row.priorKeyEpoch,priorKeyId:row.priorKeyId as string|null};
}
export function parseTeamRevisionCipher(value:unknown):TeamRevisionCipher{
  const row=teamRevisionRecord(value,['v','iv','ct']);if(row.v!==1&&row.v!==2||typeof row.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(row.iv)||typeof row.ct!=='string'||row.ct.length<24||row.ct.length>1_000_000||row.ct.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(row.ct))throw Error('Invalid team ciphertext');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';if(row.ct.endsWith('==')&&alphabet.indexOf(row.ct.at(-3)!)%16!==0||!row.ct.endsWith('==')&&row.ct.endsWith('=')&&alphabet.indexOf(row.ct.at(-2)!)%4!==0)throw Error('Invalid ciphertext padding');
  return{v:row.v as 1|2,iv:row.iv,ct:row.ct};
}
export function parseTeamRevisionRequest(value:unknown):TeamRevisionRequest{
  const row=teamRevisionRecord(value,['operationId','baseline','enc','priorEnc','metadata']);if(!attachmentIdValid(row.operationId))throw Error('Invalid revision nonce');const baseline=parseTeamRevisionBaseline(row.baseline),enc=parseTeamRevisionCipher(row.enc),priorEnc=parseTeamRevisionCipher(row.priorEnc);if(enc.v!==2||priorEnc.v===2&&baseline.priorKeyId===null)throw Error('Invalid revision epoch');
  const metadata=parsePersonalRevisionRequest({operationId:row.operationId,baseline:{sessionId:baseline.sessionId,stateHash:baseline.stateHash,stateDigest:baseline.stateDigest,revision:baseline.revision},enc:{...enc,v:1},priorEnc:{...priorEnc,v:1},metadata:row.metadata}).metadata;
  const result={operationId:row.operationId,baseline,enc,priorEnc,metadata};if(new TextEncoder().encode(JSON.stringify(result)).byteLength>TEAM_REVISION_MAX_BYTES)throw Error('Revision too large');return result;
}
export const teamRevisionRequestBytes=(value:TeamRevisionRequest)=>canonicalSyncState(parseTeamRevisionRequest(value));
export function parseTeamRevisionCommand(mode:TeamRevisionCall,value:unknown){
  const row=teamRevisionRecord(value,['actorUid','request']);if(!attachmentActorIdValid(row.actorUid)||!['prepare','apply','status','cancel'].includes(mode))throw Error('Invalid revision command');return{actorUid:row.actorUid,request:mode==='prepare'?parseTeamRevisionTarget(row.request):parseTeamRevisionRequest(row.request)};
}
/** Content-free provenance fields; the old ciphertext contains the original text/title. */
export const TEAM_REVISION_ARCHIVE_FIELDS=['tags','category','attachments','embedding','embeddingModel','connections','semanticClusterId','position','importance','celestialType','entities','processingMethod','taxonomyLane','projectStatus','parentId','generatedProvider','generatedModel','generatedImageProvider','generatedImageModel','learning','connectionChange'] as const;
