import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
export const COMMS_P2P_MAX_CANDIDATES=64,COMMS_P2P_SESSION_MS=10*60*1000;
export interface CommsP2PSdp {type:'offer'|'answer';sdp:string}
export interface CommsP2PIce {candidate:string;sdpMid?:string|null;sdpMLineIndex?:number|null;usernameFragment?:string|null}
export interface CommsP2PBinding {roomId:string;actorUid:string;callerUid:string;calleeUid:string;callerFingerprint:string;calleeFingerprint:string;offerDigest:string}
export interface CommsP2PMutation extends CommsP2PBinding {operationId:string;kind:'create'|'answer'|'candidate'|'close';signal:CommsP2PSdp|CommsP2PIce|null}
export interface CommsP2PDescriptor extends CommsP2PBinding {operationId:string;kind:CommsP2PMutation['kind'];digest:string}
export type CommsP2PStatus='unknown'|'offer'|'active'|'closed'|'expired'|'revoked';
export interface CommsP2POutcome {operationId:string;digest:string;status:'unknown'|'applied'|'cancelled'|'revoked';roomStatus:CommsP2PStatus;createdAt:number|null;updatedAt:number|null}
export interface CommsP2PSession extends CommsP2PBinding {status:CommsP2PStatus;createdAt:number|null;updatedAt:number|null;expiresAt:number|null;offer:CommsP2PSdp|null;answer:CommsP2PSdp|null;candidates:{id:string;uid:string;candidate:CommsP2PIce}[]}
const invalid=()=>new Error('Invalid P2P signal');
function object(value:unknown,keys?:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||keys&&Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw invalid();return value as Record<string,unknown>;}
const fingerprint=(value:unknown):string=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw invalid();return value;};
export function parseCommsP2PSdp(value:unknown,type:'offer'|'answer'):CommsP2PSdp {const row=object(value,['type','sdp']);if(row.type!==type||typeof row.sdp!=='string'||!row.sdp.length||new TextEncoder().encode(row.sdp).length>32768)throw invalid();return{type,sdp:row.sdp};}
export function parseCommsP2PIce(value:unknown):CommsP2PIce {
  const row=object(value);if(Object.keys(row).some(key=>!['candidate','sdpMid','sdpMLineIndex','usernameFragment'].includes(key))||typeof row.candidate!=='string'||!row.candidate.length||new TextEncoder().encode(row.candidate).length>4096)throw invalid();
  for(const key of['sdpMid','usernameFragment'])if(row[key]!==undefined&&row[key]!==null&&(typeof row[key]!=='string'||(row[key] as string).length>256))throw invalid();if(row.sdpMLineIndex!==undefined&&row.sdpMLineIndex!==null&&(!Number.isInteger(row.sdpMLineIndex)||Number(row.sdpMLineIndex)<0||Number(row.sdpMLineIndex)>65535))throw invalid();
  const result:CommsP2PIce={candidate:row.candidate};for(const key of['sdpMid','sdpMLineIndex','usernameFragment'] as const)if(row[key]!==undefined)Object.assign(result,{[key]:row[key]});return result;
}
const bindingKeys=['roomId','actorUid','callerUid','calleeUid','callerFingerprint','calleeFingerprint','offerDigest'];
function binding(row:Record<string,unknown>):CommsP2PBinding {
  if(!attachmentIdValid(row.roomId)||!attachmentActorIdValid(row.actorUid)||!attachmentActorIdValid(row.callerUid)||!attachmentActorIdValid(row.calleeUid)||row.callerUid===row.calleeUid||![row.callerUid,row.calleeUid].includes(row.actorUid))throw invalid();
  return{roomId:row.roomId,actorUid:row.actorUid,callerUid:row.callerUid,calleeUid:row.calleeUid,callerFingerprint:fingerprint(row.callerFingerprint),calleeFingerprint:fingerprint(row.calleeFingerprint),offerDigest:fingerprint(row.offerDigest)};
}
export const parseCommsP2PBinding=(value:unknown)=>binding(object(value,bindingKeys));
export function parseCommsP2PMutation(value:unknown):CommsP2PMutation {
  const row=object(value,[...bindingKeys,'operationId','kind','signal']),base=binding(row);if(!attachmentIdValid(row.operationId)||!['create','answer','candidate','close'].includes(String(row.kind)))throw invalid();
  if(row.kind==='create'&&(base.actorUid!==base.callerUid||row.operationId!==base.roomId)||row.kind==='answer'&&base.actorUid!==base.calleeUid)throw invalid();
  const signal=row.kind==='create'||row.kind==='answer'?parseCommsP2PSdp(row.signal,row.kind==='create'?'offer':'answer'):row.kind==='candidate'?parseCommsP2PIce(row.signal):row.signal===null?null:(()=>{throw invalid();})();
  const result={...base,operationId:row.operationId,kind:row.kind as CommsP2PMutation['kind'],signal};if(new TextEncoder().encode(JSON.stringify(result)).length>48*1024)throw invalid();return result;
}
export function parseCommsP2PDescriptor(value:unknown):CommsP2PDescriptor {const row=object(value,[...bindingKeys,'operationId','kind','digest']),base=binding(row);if(!attachmentIdValid(row.operationId)||!['create','answer','candidate','close'].includes(String(row.kind))||row.kind==='create'&&(row.operationId!==row.roomId||base.actorUid!==base.callerUid)||row.kind==='answer'&&base.actorUid!==base.calleeUid)throw invalid();return{...base,operationId:row.operationId,kind:row.kind as CommsP2PMutation['kind'],digest:fingerprint(row.digest)};}
export const commsP2PMutationBytes=(value:CommsP2PMutation)=>JSON.stringify(parseCommsP2PMutation(value));
export const commsP2POfferBytes=(value:unknown)=>JSON.stringify(parseCommsP2PSdp(value,'offer'));
export function parseCommsP2POutcome(value:unknown,input:CommsP2PDescriptor):CommsP2POutcome {
  const row=object(value,['operationId','digest','status','roomStatus','createdAt','updatedAt']);if(row.operationId!==input.operationId||row.digest!==input.digest||!['unknown','applied','cancelled','revoked'].includes(String(row.status))||!['unknown','offer','active','closed','expired','revoked'].includes(String(row.roomStatus)))throw invalid();
  if(['unknown','revoked'].includes(String(row.status))?row.createdAt!==null||row.updatedAt!==null:!Number.isSafeInteger(row.createdAt)||Number(row.createdAt)<1||!Number.isSafeInteger(row.updatedAt)||Number(row.updatedAt)<Number(row.createdAt))throw invalid();return{...row} as unknown as CommsP2POutcome;
}
export function parseCommsP2PSession(value:unknown,input:CommsP2PBinding):CommsP2PSession {
  const row=object(value,[...bindingKeys,'status','createdAt','updatedAt','expiresAt','offer','answer','candidates']);for(const key of bindingKeys)if(row[key]!==input[key as keyof CommsP2PBinding])throw invalid();if(!['unknown','offer','active','closed','expired','revoked'].includes(String(row.status))||!Array.isArray(row.candidates)||row.candidates.length>COMMS_P2P_MAX_CANDIDATES)throw invalid();
  const opened=row.status==='offer'||row.status==='active';if(opened? !Number.isSafeInteger(row.createdAt)||Number(row.createdAt)<1||!Number.isSafeInteger(row.updatedAt)||Number(row.updatedAt)<Number(row.createdAt)||!Number.isSafeInteger(row.expiresAt)||Number(row.expiresAt)!==Number(row.createdAt)+COMMS_P2P_SESSION_MS:row.offer!==null||row.answer!==null||row.candidates.length!==0)throw invalid();
  if(['unknown','revoked'].includes(String(row.status))?row.createdAt!==null||row.updatedAt!==null||row.expiresAt!==null:!Number.isSafeInteger(row.createdAt)||Number(row.createdAt)<1||!Number.isSafeInteger(row.updatedAt)||Number(row.updatedAt)<Number(row.createdAt)||row.expiresAt!==Number(row.createdAt)+COMMS_P2P_SESSION_MS)throw invalid();
  const offer=opened?parseCommsP2PSdp(row.offer,'offer'):null,answer=row.status==='active'?parseCommsP2PSdp(row.answer,'answer'):null;if(row.status==='offer'&&row.answer!==null)throw invalid();
  const peer=input.actorUid===input.callerUid?input.calleeUid:input.callerUid,seen=new Set<string>();const candidates=row.candidates.map(value=>{const row=object(value,['id','uid','candidate']);if(!attachmentIdValid(row.id)||seen.has(row.id)||row.uid!==peer)throw invalid();seen.add(row.id);return{id:row.id,uid:peer,candidate:parseCommsP2PIce(row.candidate)};});
  const result={...input,status:row.status as CommsP2PStatus,createdAt:row.createdAt as number|null,updatedAt:row.updatedAt as number|null,expiresAt:row.expiresAt as number|null,offer,answer,candidates};if(new TextEncoder().encode(JSON.stringify(result)).length>600*1024)throw invalid();return result;
}
