import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
import {canonicalSyncState,parseSyncCipher,syncHashValid,type SyncCipher} from './mobileSyncImportContract';
import {teamRevisionRecord} from './teamRevisionContract';
export type PersonalMigrationKind='session'|'version'|'nested';
export type PersonalMigrationCall='prepare'|'apply'|'status'|'cancel';
export interface PersonalMigrationTarget{kind:PersonalMigrationKind;recordId:string;sessionId:string|null;viewDigest:string;parentViewDigest:string|null}
export interface PersonalMigrationBase extends PersonalMigrationTarget{ownerUid:string;stateHash:string;parentHash:string|null}
export interface PersonalMigrationRequest{operationId:string;baseline:PersonalMigrationBase;enc:SyncCipher;archive:SyncCipher[]}
export interface PersonalMigrationOutcome{operationId:string;digest:string;status:'unknown'|'committed'|'cancelled'|'revoked';createdAt:number|null}
export const PERSONAL_MIGRATION_MAX_BYTES=8_000_000,PERSONAL_MIGRATION_MAX_CHUNKS=96;
const invalid=()=>Error('Invalid scoped personal migration');
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=1500&&!value.includes('/')&&value!=='.'&&value!=='..';
export function parsePersonalMigrationTarget(value:unknown):PersonalMigrationTarget{
  const row=teamRevisionRecord(value,['kind','recordId','sessionId','viewDigest','parentViewDigest']);
  if(!['session','version','nested'].includes(row.kind as string)||!id(row.recordId)||!syncHashValid(row.viewDigest)||(row.kind==='version'?!id(row.sessionId)||!syncHashValid(row.parentViewDigest):row.sessionId!==null||row.parentViewDigest!==null))throw invalid();
  return{kind:row.kind as PersonalMigrationKind,recordId:row.recordId,sessionId:row.sessionId as string|null,viewDigest:row.viewDigest,parentViewDigest:row.parentViewDigest as string|null};
}
export function parsePersonalMigrationBase(value:unknown):PersonalMigrationBase{
  const row=teamRevisionRecord(value,['kind','recordId','sessionId','viewDigest','parentViewDigest','ownerUid','stateHash','parentHash']);const target=parsePersonalMigrationTarget(Object.fromEntries(['kind','recordId','sessionId','viewDigest','parentViewDigest'].map(key=>[key,row[key]])));
  if(!attachmentActorIdValid(row.ownerUid)||!syncHashValid(row.stateHash)||(target.kind==='version'?!syncHashValid(row.parentHash):row.parentHash!==null))throw invalid();return{...target,ownerUid:row.ownerUid,stateHash:row.stateHash,parentHash:row.parentHash as string|null};
}
export function parsePersonalMigrationRequest(value:unknown):PersonalMigrationRequest{
  const row=teamRevisionRecord(value,['operationId','baseline','enc','archive']);if(!attachmentIdValid(row.operationId)||!Array.isArray(row.archive)||!row.archive.length||row.archive.length>PERSONAL_MIGRATION_MAX_CHUNKS)throw invalid();
  const result={operationId:row.operationId,baseline:parsePersonalMigrationBase(row.baseline),enc:parseSyncCipher(row.enc),archive:row.archive.map(value=>{const cipher=parseSyncCipher(value);if(cipher.ct.length>260000)throw invalid();return cipher;})};if(new TextEncoder().encode(JSON.stringify(result)).length>PERSONAL_MIGRATION_MAX_BYTES)throw invalid();return result;
}
export const personalMigrationRequestBytes=(value:PersonalMigrationRequest)=>canonicalSyncState(parsePersonalMigrationRequest(value));
export function parsePersonalMigrationCommand(mode:PersonalMigrationCall,value:unknown){const row=teamRevisionRecord(value,['actorUid','request']);if(!attachmentActorIdValid(row.actorUid)||!['prepare','apply','status','cancel'].includes(mode))throw invalid();return{actorUid:row.actorUid,request:mode==='prepare'?parsePersonalMigrationTarget(row.request):parsePersonalMigrationRequest(row.request)};}
export function parsePersonalMigrationArchiveCommand(value:unknown){const row=teamRevisionRecord(value,['actorUid','request']),request=teamRevisionRecord(row.request,['operationId']);if(!attachmentActorIdValid(row.actorUid)||!attachmentIdValid(request.operationId))throw invalid();return{actorUid:row.actorUid,operationId:request.operationId};}
