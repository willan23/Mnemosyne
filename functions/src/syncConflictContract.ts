import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
import {canonicalSyncState,syncHashValid,syncIdValid,syncInteger} from './mobileSyncImportContract';
import {teamRevisionRecord} from './teamRevisionContract';

export type SyncConflictAction='apply'|'keep-both'|'discard';
export type SyncConflictCall='prepare'|'apply'|'status'|'cancel';
export interface SyncConflictTarget{conflictId:string;conflictViewDigest:string;originalId:string|null;originalViewDigest:string|null;action:SyncConflictAction}
export interface SyncConflictBase{ownerUid:string;conflictId:string;conflictHash:string;conflictRevision:number;originalId:string|null;originalHash:string|null;originalRevision:number|null;action:SyncConflictAction}
export interface SyncConflictRequest{operationId:string;baseline:SyncConflictBase}
export interface SyncConflictOutcome{operationId:string;digest:string;status:'unknown'|'committed'|'cancelled'|'revoked';revision:number|null;createdAt:number|null}
const invalid=()=>Error('Invalid scoped conflict request');
function pair(id:unknown,digest:unknown,action:SyncConflictAction){if(action==='apply'){if(!syncIdValid(id)||!syncHashValid(digest))throw invalid();}else if(id!==null||digest!==null)throw invalid();}
function action(value:unknown):SyncConflictAction{if(!['apply','keep-both','discard'].includes(value as string))throw invalid();return value as SyncConflictAction;}
export function parseSyncConflictTarget(value:unknown):SyncConflictTarget{
  const row=teamRevisionRecord(value,['conflictId','conflictViewDigest','originalId','originalViewDigest','action']),kind=action(row.action);
  if(!syncIdValid(row.conflictId)||!syncHashValid(row.conflictViewDigest)||row.conflictId===row.originalId)throw invalid();pair(row.originalId,row.originalViewDigest,kind);
  return{conflictId:row.conflictId,conflictViewDigest:row.conflictViewDigest,originalId:row.originalId as string|null,originalViewDigest:row.originalViewDigest as string|null,action:kind};
}
export function parseSyncConflictBase(value:unknown):SyncConflictBase{
  const row=teamRevisionRecord(value,['ownerUid','conflictId','conflictHash','conflictRevision','originalId','originalHash','originalRevision','action']),kind=action(row.action);
  if(!attachmentActorIdValid(row.ownerUid)||!syncIdValid(row.conflictId)||!syncHashValid(row.conflictHash)||!syncInteger(row.conflictRevision)||row.conflictId===row.originalId)throw invalid();pair(row.originalId,row.originalHash,kind);
  if(kind==='apply'?!syncInteger(row.originalRevision):row.originalRevision!==null)throw invalid();
  return{ownerUid:row.ownerUid,conflictId:row.conflictId,conflictHash:row.conflictHash,conflictRevision:row.conflictRevision,originalId:row.originalId as string|null,originalHash:row.originalHash as string|null,originalRevision:row.originalRevision as number|null,action:kind};
}
export function parseSyncConflictRequest(value:unknown):SyncConflictRequest{const row=teamRevisionRecord(value,['operationId','baseline']);if(!attachmentIdValid(row.operationId))throw invalid();return{operationId:row.operationId,baseline:parseSyncConflictBase(row.baseline)};}
export const syncConflictRequestBytes=(value:SyncConflictRequest)=>canonicalSyncState(parseSyncConflictRequest(value));
export function parseSyncConflictCommand(mode:SyncConflictCall,value:unknown){const row=teamRevisionRecord(value,['actorUid','request']);if(!attachmentActorIdValid(row.actorUid)||!['prepare','apply','status','cancel'].includes(mode))throw invalid();return{actorUid:row.actorUid,request:mode==='prepare'?parseSyncConflictTarget(row.request):parseSyncConflictRequest(row.request)};}
