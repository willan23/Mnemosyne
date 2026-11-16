import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {COMMS_DELIVERY_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {attachmentActorIdValid} from '../../../functions/src/attachmentEnvelope';
import {parseCommsDeliveryRequest,parseCommsDeliveryDescriptor,parseCommsDeliveryAck,commsDeliveryRequestBytes,commsTransmissionBytes,type CommsDeliveryRequest,type CommsDeliveryDescriptor,type CommsDeliveryOutcome} from '../../../functions/src/commsDeliveryContract';
export interface CommsDeliveryClientDeps {enabled:()=>boolean;storage:Storage;id:()=>string;mutation?:PersonalMemoryMutationDeps;exclusive:typeof withClipCaptureLock;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;call:(mode:'create'|'status'|'cancel'|'ack',value:unknown)=>Promise<unknown>;observeStorage:(uid:string,changed:()=>void)=>()=>void}
export class CommsDeliveryError extends Error {constructor(){super('Não foi possível confirmar o envio. O pedido cifrado local foi conservado para recuperação.');}}
export const commsDeliveryPendingKey=(uid:string)=>`mnemosyne:comms-delivery:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:comms-delivery-changed',notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingCommsDelivery(uid:string){try{return localStorage.getItem(commsDeliveryPendingKey(uid))!==null;}catch{return true;}}
export function observeCommsDeliveries(changed:()=>void){window.addEventListener(event,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(event,changed);window.removeEventListener('storage',changed);};}
const defaults=():CommsDeliveryClientDeps=>({enabled:()=>COMMS_DELIVERY_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,
  call:async(mode,value)=>{const names={create:'createCommsDelivery',status:'getCommsDeliveryStatus',cancel:'cancelCommsDelivery',ack:'acknowledgeCommsDelivery'};return(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(value)).data;},
  observeStorage:(uid,changed)=>{const listener=(value:StorageEvent)=>{if(value.key===null||value.key===commsDeliveryPendingKey(uid))changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
function result(value:unknown,input:CommsDeliveryDescriptor):CommsDeliveryOutcome {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdAt,digest,requestId,status,updatedAt')throw new CommsDeliveryError();const row=value as CommsDeliveryOutcome;
  if(row.requestId!==input.requestId||row.digest!==input.digest||!['unknown','sent','received','cancelled','revoked'].includes(row.status)||(['unknown','revoked'].includes(row.status)?row.createdAt!==null||row.updatedAt!==null:!Number.isSafeInteger(row.createdAt)||Number(row.createdAt)<1||!Number.isSafeInteger(row.updatedAt)||Number(row.updatedAt)<Number(row.createdAt)))throw new CommsDeliveryError();return{...row};
}
async function operate(uid:string,value:Omit<CommsDeliveryRequest,'requestId'|'senderUid'>|null,mode:'start'|'recover'|'cancel',outer:()=>void,deps:CommsDeliveryClientDeps){
  if(!attachmentActorIdValid(uid)||mode==='start'&&!deps.enabled())throw new CommsDeliveryError();
  // Clone every envelope field before any await; recovery never reconstructs or reciphers a request.
  const selected=value?parseCommsDeliveryRequest({...value,requestId:deps.id(),senderUid:uid}):null;
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:comms-delivery:v1:${encodeURIComponent(uid)}`,async()=>{
    const key=commsDeliveryPendingKey(uid);let changed=false,raw:string|null=null;const stop=deps.observeStorage(uid,()=>{changed=true;});
    const guard=()=>{outer();context.assertCurrent();if(changed||deps.storage.getItem(key)!==raw)throw new CommsDeliveryError();};
    try{
      raw=deps.storage.getItem(key);guard();let request:CommsDeliveryRequest;
      if(raw!==null){if(mode==='start'||raw.length>1_000_000)throw new CommsDeliveryError();
        try{const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw new CommsDeliveryError();const plain=(await deps.decrypt(envelope)).text;guard();if(plain.length>700_000)throw new CommsDeliveryError();const journal=JSON.parse(plain);
          if(!journal||Object.keys(journal).sort().join(',')!=='request,uid,v'||journal.v!==1||journal.uid!==uid)throw new CommsDeliveryError();request=parseCommsDeliveryRequest(journal.request);
        }catch{guard();throw new CommsDeliveryError();}
      }else{
        if(mode!=='start'||!selected)throw new CommsDeliveryError();request=selected;
        const encrypted=JSON.stringify(await deps.encrypt({text:JSON.stringify({v:1,uid,request})}));guard();if(encrypted.length>1_000_000)throw new CommsDeliveryError();deps.storage.setItem(key,encrypted);raw=encrypted;guard();notify();
      }
      if(request.senderUid!==uid)throw new CommsDeliveryError();
      const descriptor=parseCommsDeliveryDescriptor({requestId:request.requestId,senderUid:uid,recipientUid:request.recipientUid,senderFingerprint:request.senderFingerprint,recipientFingerprint:request.recipientFingerprint,digest:await hash(commsDeliveryRequestBytes(request))});guard();
      const call=async(which:'create'|'status'|'cancel')=>{guard();const confirmed=result(await deps.call(which,which==='create'?request:descriptor),descriptor);guard();return confirmed;};
      let confirmed=await call('status');if(mode==='cancel'&&['unknown','sent'].includes(confirmed.status))confirmed=await call('cancel');else if(confirmed.status==='unknown'){if(!deps.enabled())throw new CommsDeliveryError();confirmed=await call('create');}
      if(confirmed.status==='unknown')throw new CommsDeliveryError();guard();deps.storage.removeItem(key);raw=null;guard();notify();return confirmed;
    }finally{stop();}
  }),deps.mutation);
}
export const sendCommsDelivery=(uid:string,input:Omit<CommsDeliveryRequest,'requestId'|'senderUid'>,guard:()=>void=()=>{},deps=defaults())=>operate(uid,input,'start',guard,deps);
export const recoverCommsDelivery=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,null,'recover',guard,deps);
export const cancelCommsDelivery=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,null,'cancel',guard,deps);
export async function acknowledgeCommsTransmission(uid:string,id:string,value:unknown,outer:()=>void=()=>{},deps=defaults()){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new CommsDeliveryError();const row=value as Record<string,unknown>,senderUid=row.senderId,recipientUid=row.recipientId,timestamp=row.timestamp,version=row.v,claimedDigest=row.deliveryDigest;
  const binding=commsTransmissionBytes(id,value);if(recipientUid!==uid||senderUid===uid)throw new CommsDeliveryError();
  return withPersonalMemoryMutation(uid,async context=>{const guard=()=>{outer();context.assertCurrent();};guard();const digest=await hash(binding);guard();if(version===2&&claimedDigest!==digest)throw new CommsDeliveryError();const input=parseCommsDeliveryAck({transmissionId:id,senderUid,recipientUid:uid,digest});
    const response=await deps.call('ack',input);guard();if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).sort().join(',')!=='digest,status,transmissionId,updatedAt')throw new CommsDeliveryError();const confirmed=response as{transmissionId:string;digest:string;status:'received';updatedAt:number};
    if(confirmed.transmissionId!==id||confirmed.digest!==digest||confirmed.status!=='received'||!Number.isSafeInteger(confirmed.updatedAt)||typeof timestamp!=='number'||confirmed.updatedAt<timestamp)throw new CommsDeliveryError();return{...confirmed};
  },deps.mutation);
}
