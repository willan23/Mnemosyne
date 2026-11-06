import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
export interface CommsRecipient {uid:string;displayName:string;publicKeyPem:string;fingerprint:string}
export interface CommsContactRequest {requestId:string;recipientUid:string;recipientFingerprint:string}
export type CommsContactStatus='unknown'|'pending'|'accepted'|'rejected'|'cancelled'|'revoked';
export interface CommsContactOutcome {requestId:string;digest:string;status:CommsContactStatus;createdAt:number|null;updatedAt:number|null}
export type CommsContactCall='lookup'|'create'|'status'|'cancel'|'respond';
export interface CommsContactCommand {actorUid:string;request:CommsContactRequest|{lookup:string}|{requestId:string;status:'accepted'|'rejected'}}
const invalid=()=>new Error('Invalid Comms contact operation');
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw invalid();return value as Record<string,unknown>;}
export function parseCommsRecipientLookup(value:unknown):{lookup:string}{const row=object(value,['lookup']);if(typeof row.lookup!=='string')throw invalid();const lookup=row.lookup.trim();
  if(lookup.includes('@')?!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lookup)||lookup.length>254:!attachmentActorIdValid(lookup))throw invalid();return{lookup:lookup.includes('@')?lookup.toLowerCase():lookup};}
export function parseCommsRecipient(value:unknown):CommsRecipient {const row=object(value,['uid','displayName','publicKeyPem','fingerprint']);if(!attachmentActorIdValid(row.uid)||typeof row.displayName!=='string'||!row.displayName||row.displayName.length>120||typeof row.publicKeyPem!=='string'||row.publicKeyPem.length>2000||!/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/]+=*\n-----END PUBLIC KEY-----$/.test(row.publicKeyPem)||typeof row.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(row.fingerprint))throw invalid();return{uid:row.uid,displayName:row.displayName,publicKeyPem:row.publicKeyPem,fingerprint:row.fingerprint};}
export function parseCommsContactRequest(value:unknown):CommsContactRequest {const row=object(value,['requestId','recipientUid','recipientFingerprint']);if(!attachmentIdValid(row.requestId)||!attachmentActorIdValid(row.recipientUid)||typeof row.recipientFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(row.recipientFingerprint))throw invalid();return{requestId:row.requestId,recipientUid:row.recipientUid,recipientFingerprint:row.recipientFingerprint};}
export const commsContactRequestBytes=(request:CommsContactRequest)=>JSON.stringify(parseCommsContactRequest(request));
export function parseCommsContactResponse(value:unknown):{requestId:string;status:'accepted'|'rejected'} {const row=object(value,['requestId','status']);if(!attachmentActorIdValid(row.requestId)||!['accepted','rejected'].includes(String(row.status)))throw invalid();return{requestId:row.requestId,status:row.status as 'accepted'|'rejected'};}
/** Transport binding is outside the durable v1 journal/v2 request bytes so
 * recovery can keep the same UUID, fingerprint, digest and encrypted copy. */
export function parseCommsContactCommand(value:unknown,mode:CommsContactCall):CommsContactCommand {
  const row=object(value,['actorUid','request']);if(!attachmentActorIdValid(row.actorUid)||!['lookup','create','status','cancel','respond'].includes(mode))throw invalid();
  const request=mode==='lookup'?parseCommsRecipientLookup(row.request):mode==='respond'?parseCommsContactResponse(row.request):parseCommsContactRequest(row.request);
  return{actorUid:row.actorUid,request};
}
