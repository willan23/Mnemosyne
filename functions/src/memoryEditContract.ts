import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
import {canonicalSyncState,parseSyncMetadata,syncHashValid,syncIdValid,syncInteger} from './mobileSyncImportContract';
import {parseTeamRevisionBaseline,parseTeamRevisionCipher,teamRevisionRecord,type TeamRevisionCipher} from './teamRevisionContract';
export const MEMORY_EDIT_MAX_BYTES=2_100_000;
export type MemoryEditTarget={sessionId:string;teamId:string|null};
export interface MemoryEditBaseline extends MemoryEditTarget{
  kind:'personal'|'team';authorUid:string;ownerUid:string;stateHash:string;stateDigest:string;revision:number;
  teamStateHash:string|null;epochStateHash:string|null;keyEpoch:number|null;keyId:string|null;priorKeyEpoch:number|null;priorKeyId:string|null;
}
export interface MemoryEditRequest{operationId:string;operation:'edit'|'delete';baseline:MemoryEditBaseline;priorEnc:TeamRevisionCipher;enc:TeamRevisionCipher|null;metadata:Record<string,unknown>}
export interface MemoryEditOutcome{operationId:string;sessionId:string;teamId:string|null;operation:'edit'|'delete';digest:string;status:'unknown'|'committed'|'cancelled'|'revoked';revision:number|null;createdAt:number|null}
export type MemoryEditCall='prepare'|'apply'|'status'|'cancel';
const fail=()=>Error('Invalid encrypted memory edit');
export function parseMemoryEditTarget(value:unknown):MemoryEditTarget{
  const row=teamRevisionRecord(value,['sessionId','teamId']);if(!syncIdValid(row.sessionId)||row.teamId!==null&&!attachmentActorIdValid(row.teamId))throw fail();return{sessionId:row.sessionId,teamId:row.teamId as string|null};
}
export function parseMemoryEditBaseline(value:unknown):MemoryEditBaseline{
  const row=teamRevisionRecord(value,['kind','sessionId','teamId','authorUid','ownerUid','stateHash','stateDigest','revision','teamStateHash','epochStateHash','keyEpoch','keyId','priorKeyEpoch','priorKeyId']);const target=parseMemoryEditTarget({sessionId:row.sessionId,teamId:row.teamId});
  if(row.kind==='team'){if(target.teamId===null)throw fail();const {kind:_,...base}=row;return{kind:'team',...parseTeamRevisionBaseline(base)};}
  if(row.kind!=='personal'||target.teamId!==null||!attachmentActorIdValid(row.authorUid)||row.ownerUid!==row.authorUid||!syncHashValid(row.stateHash)||!syncHashValid(row.stateDigest)||!syncInteger(row.revision)||['teamStateHash','epochStateHash','keyEpoch','keyId','priorKeyEpoch','priorKeyId'].some(key=>row[key]!==null))throw fail();
  return{...target,kind:'personal',authorUid:row.authorUid,ownerUid:row.authorUid,stateHash:row.stateHash,stateDigest:row.stateDigest,revision:row.revision,teamStateHash:null,epochStateHash:null,keyEpoch:null,keyId:null,priorKeyEpoch:null,priorKeyId:null};
}
export const MEMORY_EDIT_METADATA_FIELDS=['tags','category','semanticClusterId','position','importance','celestialType','embedding','embeddingModel','processingMethod','taxonomyLane','projectStatus','entities','color','scale','orbitRadius','orbitSpeed'] as const;
export function parseMemoryEditMetadata(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!(MEMORY_EDIT_METADATA_FIELDS as readonly string[]).includes(key)))throw fail();const row=value as Record<string,unknown>;
  const common=['tags','category','semanticClusterId','position','importance','celestialType','embedding','embeddingModel'];
  if(('embedding' in row)!==('embeddingModel' in row)||row.embedding!==undefined&&row.embedding!==null&&(typeof row.embeddingModel!=='string'||!row.embeddingModel))throw fail();
  parseSyncMetadata(Object.fromEntries(common.filter(key=>key in row&&row[key]!==null).map(key=>[key,row[key]])));
  if(row.tags===null||row.importance===null||row.celestialType!==undefined&&!['star','sun','planet','moon','comet','black_hole','nebula'].includes(row.celestialType as string))throw fail();
  if('processingMethod' in row&&(typeof row.processingMethod!=='string'||!row.processingMethod||row.processingMethod.length>200)||'taxonomyLane' in row&&row.taxonomyLane!==null&&!['A','B','C','D','E'].includes(row.taxonomyLane as string)||'projectStatus' in row&&row.projectStatus!==null&&!['planned','active','done'].includes(row.projectStatus as string))throw fail();
  if(row.entities!==undefined&&row.entities!==null){const entities=row.entities;if(typeof entities!=='object'||Array.isArray(entities)||Object.entries(entities).some(([key,list])=>!['people','places','events','concepts'].includes(key)||!Array.isArray(list)||list.length>100||list.some(item=>typeof item!=='string'||!item||item.length>200)))throw fail();}
  if('color' in row&&row.color!==null&&(typeof row.color!=='string'||!/^#[a-fA-F0-9]{6}$/.test(row.color)))throw fail();
  for(const key of ['scale','orbitRadius','orbitSpeed'])if(key in row&&row[key]!==null&&(typeof row[key]!=='number'||!Number.isFinite(row[key])||Math.abs(row[key] as number)>1_000_000||key!=='orbitSpeed'&&(row[key] as number)<0))throw fail();
  canonicalSyncState(row);return JSON.parse(JSON.stringify(row));
}
export function parseMemoryEditRequest(value:unknown):MemoryEditRequest{
  const row=teamRevisionRecord(value,['operationId','operation','baseline','priorEnc','enc','metadata']);if(!attachmentIdValid(row.operationId)||!['edit','delete'].includes(row.operation as string))throw fail();
  const baseline=parseMemoryEditBaseline(row.baseline),priorEnc=parseTeamRevisionCipher(row.priorEnc),enc=row.enc===null?null:parseTeamRevisionCipher(row.enc),metadata=parseMemoryEditMetadata(row.metadata);
  if(baseline.kind==='personal'&&priorEnc.v!==1||baseline.kind==='team'&&priorEnc.v===2&&baseline.priorKeyId===null||row.operation==='edit'&&(!enc||enc.v!==(baseline.kind==='personal'?1:2))||row.operation==='delete'&&(enc!==null||Object.keys(metadata).length!==0))throw fail();
  const result={operationId:row.operationId,operation:row.operation as MemoryEditRequest['operation'],baseline,priorEnc,enc,metadata};if(new TextEncoder().encode(JSON.stringify(result)).byteLength>MEMORY_EDIT_MAX_BYTES)throw fail();return result;
}
export const memoryEditRequestBytes=(value:MemoryEditRequest)=>canonicalSyncState(parseMemoryEditRequest(value));
export function parseMemoryEditCommand(mode:MemoryEditCall,value:unknown){const row=teamRevisionRecord(value,['actorUid','request']);if(!attachmentActorIdValid(row.actorUid)||!['prepare','apply','status','cancel'].includes(mode))throw fail();return{actorUid:row.actorUid,request:mode==='prepare'?parseMemoryEditTarget(row.request):parseMemoryEditRequest(row.request)};}
