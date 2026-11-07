import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
export const COMMS_CONTACT_REMOVAL_PAGE_SIZE=25;
export interface CommsContactRemovalRequest {requestId:string;actorUid:string;peerUid:string;anchorId:string;anchorUpdatedAt:number}
export type CommsContactRemovalStatus='unknown'|'pending'|'complete'|'cancelled'|'revoked';
export interface CommsContactRemovalOutcome {requestId:string;digest:string;status:CommsContactRemovalStatus;removedCount:number;createdAt:number|null;updatedAt:number|null}
const invalid=()=>new Error('Invalid contact removal');
function exact(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw invalid();return value as Record<string,unknown>;}
export function parseCommsContactRemovalRequest(value:unknown):CommsContactRemovalRequest{
  const row=exact(value,['requestId','actorUid','peerUid','anchorId','anchorUpdatedAt']);
  if(!attachmentIdValid(row.requestId)||!attachmentActorIdValid(row.actorUid)||!attachmentActorIdValid(row.peerUid)||row.actorUid===row.peerUid||!attachmentActorIdValid(row.anchorId)||!Number.isSafeInteger(row.anchorUpdatedAt)||Number(row.anchorUpdatedAt)<1)throw invalid();
  return{requestId:row.requestId,actorUid:row.actorUid,peerUid:row.peerUid,anchorId:row.anchorId,anchorUpdatedAt:Number(row.anchorUpdatedAt)};
}
export const commsContactRemovalBytes=(value:CommsContactRemovalRequest)=>JSON.stringify(parseCommsContactRemovalRequest(value));
export const isCommsContactPairRemoving=(pair:Record<string,unknown>|undefined)=>pair?.removalRequestId!==undefined&&pair.removalRequestId!==null;
export function parseCommsContactRemovalOutcome(value:unknown,input:CommsContactRemovalRequest,digest:string):CommsContactRemovalOutcome{
  const row=exact(value,['requestId','digest','status','removedCount','createdAt','updatedAt']);
  if(row.requestId!==input.requestId||row.digest!==digest||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||!['unknown','pending','complete','cancelled','revoked'].includes(String(row.status))||!Number.isSafeInteger(row.removedCount)||Number(row.removedCount)<0||row.status==='cancelled'&&row.removedCount!==0)throw invalid();
  if(row.createdAt===null||row.updatedAt===null){if(!['unknown','revoked'].includes(String(row.status))||row.createdAt!==null||row.updatedAt!==null||row.removedCount!==0)throw invalid();}
  else if(row.status==='unknown'||!Number.isSafeInteger(row.createdAt)||Number(row.createdAt)<1||!Number.isSafeInteger(row.updatedAt)||Number(row.updatedAt)<Number(row.createdAt))throw invalid();
  return{requestId:input.requestId,digest,status:row.status as CommsContactRemovalStatus,removedCount:Number(row.removedCount),createdAt:row.createdAt as number|null,updatedAt:row.updatedAt as number|null};
}
