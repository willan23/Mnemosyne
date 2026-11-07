import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
import {COMMS_DELIVERY_MAX_WIRE_BYTES,parseCommsDeliveryDescriptor,type CommsDeliveryRequest} from './commsDeliveryContract';
import {parseCommsP2PBinding,type CommsP2PBinding} from './commsP2PContract';
export interface CommsP2PContentDescriptor {requestId:string;senderUid:string;recipientUid:string;senderFingerprint:string;recipientFingerprint:string;digest:string;bytes:number}
export interface CommsP2PContentLookup {actorUid:string;packet:CommsP2PContentDescriptor}
export interface CommsP2PContentAdmission extends CommsP2PContentLookup {session:CommsP2PBinding}
export interface CommsP2PContentOutcome {requestId:string;digest:string;status:'unknown'|'admitted'|'received'|'cancelled'|'revoked';createdAt:number|null;updatedAt:number|null;roomId:string|null}
const invalid=()=>new Error('Invalid P2P content operation');
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw invalid();return value as Record<string,unknown>;}
export function parseCommsP2PContentDescriptor(value:unknown):CommsP2PContentDescriptor {
  const row=object(value,['requestId','senderUid','recipientUid','senderFingerprint','recipientFingerprint','digest','bytes']);const descriptor=parseCommsDeliveryDescriptor({requestId:row.requestId,senderUid:row.senderUid,recipientUid:row.recipientUid,senderFingerprint:row.senderFingerprint,recipientFingerprint:row.recipientFingerprint,digest:row.digest});if(!Number.isSafeInteger(row.bytes)||Number(row.bytes)<64||Number(row.bytes)>COMMS_DELIVERY_MAX_WIRE_BYTES)throw invalid();return{...descriptor,bytes:Number(row.bytes)};
}
export function parseCommsP2PContentLookup(value:unknown):CommsP2PContentLookup {const row=object(value,['actorUid','packet']),packet=parseCommsP2PContentDescriptor(row.packet);if(!attachmentActorIdValid(row.actorUid)||![packet.senderUid,packet.recipientUid].includes(row.actorUid))throw invalid();return{actorUid:row.actorUid,packet};}
export function parseCommsP2PContentAdmission(value:unknown):CommsP2PContentAdmission {
  const row=object(value,['actorUid','packet','session']),lookup=parseCommsP2PContentLookup({actorUid:row.actorUid,packet:row.packet}),session=parseCommsP2PBinding(row.session);assertCommsP2PPacketSession(lookup.packet,session,true);if(session.actorUid!==lookup.actorUid||lookup.actorUid!==lookup.packet.senderUid)throw invalid();return{...lookup,session};
}
export function assertCommsP2PPacketSession(packet:Pick<CommsP2PContentDescriptor,'senderUid'|'recipientUid'|'senderFingerprint'|'recipientFingerprint'>|CommsDeliveryRequest,session:CommsP2PBinding,sending:boolean){
  const senderCaller=packet.senderUid===session.callerUid;if(packet.senderUid!==(senderCaller?session.callerUid:session.calleeUid)||packet.recipientUid!==(senderCaller?session.calleeUid:session.callerUid)||packet.senderFingerprint!==(senderCaller?session.callerFingerprint:session.calleeFingerprint)||packet.recipientFingerprint!==(senderCaller?session.calleeFingerprint:session.callerFingerprint)||session.actorUid!==(sending?packet.senderUid:packet.recipientUid))throw invalid();
}
export function parseCommsP2PContentOutcome(value:unknown,input:CommsP2PContentDescriptor):CommsP2PContentOutcome {
  const row=object(value,['requestId','digest','status','createdAt','updatedAt','roomId']);if(row.requestId!==input.requestId||row.digest!==input.digest||!['unknown','admitted','received','cancelled','revoked'].includes(String(row.status)))throw invalid();const absent=row.status==='unknown'||row.status==='revoked';if(absent?row.createdAt!==null||row.updatedAt!==null||row.roomId!==null:!Number.isSafeInteger(row.createdAt)||Number(row.createdAt)<1||!Number.isSafeInteger(row.updatedAt)||Number(row.updatedAt)<Number(row.createdAt)||row.roomId!==null&&!attachmentIdValid(row.roomId))throw invalid();if((row.status==='admitted'||row.status==='received')&&!attachmentIdValid(row.roomId))throw invalid();return{...row} as unknown as CommsP2PContentOutcome;
}
