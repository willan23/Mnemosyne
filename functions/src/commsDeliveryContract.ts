import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
export const COMMS_DELIVERY_MAX_TEXT_BYTES=32*1024,COMMS_DELIVERY_MAX_ATTACHMENT_BYTES=256*1024,COMMS_DELIVERY_MAX_WIRE_BYTES=600*1024,COMMS_DELIVERY_MAX_CIPHER_BYTES=384*1024;
export interface CommsDeliveryEnvelope {encryptedKey:string;encryptedPayload:string;payloadIv:string;hasAttachment:boolean;attachmentName:string|null}
export interface CommsDeliveryRequest {requestId:string;senderUid:string;recipientUid:string;senderFingerprint:string;recipientFingerprint:string;envelope:CommsDeliveryEnvelope}
export interface CommsDeliveryDescriptor {requestId:string;senderUid:string;recipientUid:string;senderFingerprint:string;recipientFingerprint:string;digest:string}
export interface CommsDeliveryOutcome {requestId:string;digest:string;status:'unknown'|'sent'|'received'|'cancelled'|'revoked';createdAt:number|null;updatedAt:number|null}
const invalid=()=>new Error('Invalid Comms delivery operation');
function object(value:unknown,keys?:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||keys&&Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw invalid();return value as Record<string,unknown>;}
const fingerprint=(value:unknown):string=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw invalid();return value;};
/** Portable canonical base64 validation, including unused padding bits, before decoding or crypto. */
export function commsBase64Size(value:unknown,minimum:number,maximum:number):number {
  if(typeof value!=='string'||value.length>4*Math.ceil(maximum/3)||value.length%4!==0||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw invalid();
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,count=value.length/4*3-padding;if(count<minimum||count>maximum)throw invalid();
  if(padding){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',index=alphabet.indexOf(value[value.length-padding-1]);if(index<0||index%(padding===2?16:4)!==0)throw invalid();}return count;
}
export function parseCommsDeliveryEnvelope(value:unknown):CommsDeliveryEnvelope {
  const row=object(value,['encryptedKey','encryptedPayload','payloadIv','hasAttachment','attachmentName']);commsBase64Size(row.encryptedKey,256,512);commsBase64Size(row.encryptedPayload,16,COMMS_DELIVERY_MAX_CIPHER_BYTES);commsBase64Size(row.payloadIv,12,12);
  if(typeof row.hasAttachment!=='boolean'||(row.hasAttachment?typeof row.attachmentName!=='string'||row.attachmentName.length<1||row.attachmentName.length>180||/[/\\]/.test(row.attachmentName)||Array.from(row.attachmentName).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127):row.attachmentName!==null))throw invalid();
  return{encryptedKey:row.encryptedKey as string,encryptedPayload:row.encryptedPayload as string,payloadIv:row.payloadIv as string,hasAttachment:row.hasAttachment,attachmentName:row.attachmentName as string|null};
}
export function parseCommsDeliveryRequest(value:unknown):CommsDeliveryRequest {
  const row=object(value,['requestId','senderUid','recipientUid','senderFingerprint','recipientFingerprint','envelope']);if(!attachmentIdValid(row.requestId)||!attachmentActorIdValid(row.senderUid)||!attachmentActorIdValid(row.recipientUid)||row.senderUid===row.recipientUid)throw invalid();
  const result={requestId:row.requestId,senderUid:row.senderUid,recipientUid:row.recipientUid,senderFingerprint:fingerprint(row.senderFingerprint),recipientFingerprint:fingerprint(row.recipientFingerprint),envelope:parseCommsDeliveryEnvelope(row.envelope)};
  if(new TextEncoder().encode(JSON.stringify(result)).length>COMMS_DELIVERY_MAX_WIRE_BYTES)throw invalid();return result;
}
export const commsDeliveryRequestBytes=(input:CommsDeliveryRequest)=>JSON.stringify(parseCommsDeliveryRequest(input));
export function parseCommsDeliveryDescriptor(value:unknown):CommsDeliveryDescriptor {
  const row=object(value,['requestId','senderUid','recipientUid','senderFingerprint','recipientFingerprint','digest']);if(!attachmentIdValid(row.requestId)||!attachmentActorIdValid(row.senderUid)||!attachmentActorIdValid(row.recipientUid)||row.senderUid===row.recipientUid)throw invalid();return{requestId:row.requestId,senderUid:row.senderUid,recipientUid:row.recipientUid,senderFingerprint:fingerprint(row.senderFingerprint),recipientFingerprint:fingerprint(row.recipientFingerprint),digest:fingerprint(row.digest)};
}
export function parseCommsDeliveryAck(value:unknown):{transmissionId:string;senderUid:string;recipientUid:string;digest:string} {
  const row=object(value,['transmissionId','senderUid','recipientUid','digest']);if(!attachmentActorIdValid(row.transmissionId)||!attachmentActorIdValid(row.senderUid)||!attachmentActorIdValid(row.recipientUid)||row.senderUid===row.recipientUid)throw invalid();return{transmissionId:row.transmissionId,senderUid:row.senderUid,recipientUid:row.recipientUid,digest:fingerprint(row.digest)};
}
/** Stable ACK binding for the old unversioned relay schema; status/receivedAt are deliberately excluded. */
export function commsLegacyDeliveryBytes(value:unknown):string {
  const row=object(value);if(row.v!==undefined||!attachmentActorIdValid(row.senderId)||!attachmentActorIdValid(row.recipientId)||row.senderId===row.recipientId||!Number.isSafeInteger(row.timestamp)||Number(row.timestamp)<1)throw invalid();
  const base={v:1,senderId:row.senderId,recipientId:row.recipientId,timestamp:row.timestamp};
  if(row.encryptedData!==undefined){if(row.encryptedKey!==undefined||row.encryptedPayload!==undefined||row.payloadIv!==undefined)throw invalid();commsBase64Size(row.encryptedData,256,512);return JSON.stringify({...base,encryptedData:row.encryptedData});}
  return JSON.stringify({...base,envelope:parseCommsDeliveryEnvelope({encryptedKey:row.encryptedKey,encryptedPayload:row.encryptedPayload,payloadIv:row.payloadIv,hasAttachment:row.hasAttachment,attachmentName:row.attachmentName})});
}
export function commsTransmissionBytes(transmissionId:string,value:unknown):string {
  const row=object(value);if(row.v!==2)return commsLegacyDeliveryBytes(row);
  return commsDeliveryRequestBytes(parseCommsDeliveryRequest({requestId:transmissionId,senderUid:row.senderId,recipientUid:row.recipientId,senderFingerprint:row.senderFingerprint,recipientFingerprint:row.recipientFingerprint,envelope:{encryptedKey:row.encryptedKey,encryptedPayload:row.encryptedPayload,payloadIv:row.payloadIv,hasAttachment:row.hasAttachment,attachmentName:row.attachmentName}}));
}
