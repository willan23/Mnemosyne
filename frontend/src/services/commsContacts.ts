import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {COMMS_CONTACT_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {parseCommsRecipientLookup,parseCommsRecipient,parseCommsContactRequest,parseCommsContactResponse,parseCommsContactCommand,commsContactRequestBytes,type CommsRecipient,type CommsContactRequest,type CommsContactOutcome} from '../../../functions/src/commsContactContract';
import {attachmentActorIdValid} from '../../../functions/src/attachmentEnvelope';
export interface CommsContactClientDeps {enabled:()=>boolean;storage:Storage;id:()=>string;mutation?:PersonalMemoryMutationDeps;exclusive:typeof withClipCaptureLock;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;call:(mode:'lookup'|'create'|'status'|'cancel'|'respond',value:unknown)=>Promise<unknown>;observeStorage:(uid:string,changed:()=>void)=>()=>void}
export class CommsContactError extends Error {constructor(){super('Não foi possível confirmar o pedido. A cópia cifrada local foi conservada para recuperação.');}}
export const commsContactPendingKey=(uid:string)=>`mnemosyne:comms-contact:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:comms-contact-changed',notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingCommsContact(uid:string){try{return localStorage.getItem(commsContactPendingKey(uid))!==null;}catch{return true;}}
export function observeCommsContacts(changed:()=>void){window.addEventListener(event,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(event,changed);window.removeEventListener('storage',changed);};}
const defaults=():CommsContactClientDeps=>({enabled:()=>COMMS_CONTACT_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,
  call:async(mode,value)=>{const names={lookup:'lookupCommsRecipient',create:'createCommsContactRequest',status:'getCommsContactRequestStatus',cancel:'cancelCommsContactRequest',respond:'respondCommsContactRequest'};return(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(value)).data;},
  observeStorage:(uid,changed)=>{const listener=(value:StorageEvent)=>{if(value.key===null||value.key===commsContactPendingKey(uid))changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export async function lookupCommsRecipient(uid:string,lookup:string,outer:()=>void=()=>{},deps=defaults()):Promise<CommsRecipient>{
  const input=parseCommsRecipientLookup({lookup}),command=parseCommsContactCommand({actorUid:uid,request:input},'lookup');return withPersonalMemoryMutation(uid,async context=>{const guard=()=>{outer();context.assertCurrent();};guard();const profile=parseCommsRecipient(await deps.call('lookup',command));guard();if(profile.uid===uid||await hash(profile.publicKeyPem)!==profile.fingerprint)throw new CommsContactError();guard();return profile;},deps.mutation);
}
function result(value:unknown,input:CommsContactRequest,digest:string):CommsContactOutcome {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdAt,digest,requestId,status,updatedAt')throw new CommsContactError();const row=value as CommsContactOutcome;
  if(row.requestId!==input.requestId||row.digest!==digest||!['unknown','pending','accepted','rejected','cancelled','revoked'].includes(row.status))throw new CommsContactError();
  if(row.createdAt===null||row.updatedAt===null){if(!['unknown','revoked'].includes(row.status)||row.createdAt!==null||row.updatedAt!==null)throw new CommsContactError();}
  else if(row.status==='unknown'||!Number.isSafeInteger(row.createdAt)||Number(row.createdAt)<1||!Number.isSafeInteger(row.updatedAt)||Number(row.updatedAt)<Number(row.createdAt))throw new CommsContactError();return{...row};
}
async function operate(uid:string,recipient:Pick<CommsRecipient,'uid'|'fingerprint'>|null,mode:'start'|'recover'|'cancel',outer:()=>void,deps:CommsContactClientDeps){
  if(!attachmentActorIdValid(uid)||mode==='start'&&!deps.enabled())throw new CommsContactError();const selected=recipient?{uid:recipient.uid,fingerprint:recipient.fingerprint}:null;
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:comms-contact:v1:${encodeURIComponent(uid)}`,async()=>{
    const key=commsContactPendingKey(uid);let changed=false;const stop=deps.observeStorage(uid,()=>{changed=true;});let raw:string|null=null;
    const guard=()=>{outer();context.assertCurrent();if(changed||deps.storage.getItem(key)!==raw)throw new CommsContactError();};
    try{
      raw=deps.storage.getItem(key);guard();let request:CommsContactRequest;
      if(raw!==null){if(mode==='start'||raw.length>20000)throw new CommsContactError();let journal;
        try{const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw new CommsContactError();const text=(await deps.decrypt(envelope)).text;guard();if(text.length>10000)throw new CommsContactError();journal=JSON.parse(text);
          if(!journal||Object.keys(journal).sort().join(',')!=='request,uid,v'||journal.v!==1||journal.uid!==uid)throw new CommsContactError();request=parseCommsContactRequest(journal.request);
        }catch{guard();throw new CommsContactError();}
      }else{
        if(mode!=='start'||!selected)throw new CommsContactError();request=parseCommsContactRequest({requestId:deps.id(),recipientUid:selected.uid,recipientFingerprint:selected.fingerprint});if(request.recipientUid===uid)throw new CommsContactError();
        const encrypted=JSON.stringify(await deps.encrypt({text:JSON.stringify({v:1,uid,request})}));guard();if(encrypted.length>20000)throw new CommsContactError();deps.storage.setItem(key,encrypted);raw=encrypted;guard();notify();
      }
      const digest=await hash(commsContactRequestBytes(request));guard();const call=async(which:'create'|'status'|'cancel')=>{guard();const command=parseCommsContactCommand({actorUid:uid,request},which);const outcome=result(await deps.call(which,command),request,digest);guard();return outcome;};
      let outcome=await call('status');if(mode==='cancel'&&['unknown','pending'].includes(outcome.status))outcome=await call('cancel');else if(outcome.status==='unknown'){if(!deps.enabled())throw new CommsContactError();outcome=await call('create');}
      if(outcome.status==='unknown')throw new CommsContactError();guard();deps.storage.removeItem(key);raw=null;guard();notify();return outcome;
    }finally{stop();}
  }),deps.mutation);
}
export const requestCommsContact=(uid:string,recipient:Pick<CommsRecipient,'uid'|'fingerprint'>,guard:()=>void=()=>{},deps=defaults())=>operate(uid,recipient,'start',guard,deps);
export const recoverCommsContact=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,null,'recover',guard,deps);
export const cancelCommsContact=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,null,'cancel',guard,deps);
export async function respondCommsContact(uid:string,requestId:string,status:'accepted'|'rejected',outer:()=>void=()=>{},deps=defaults()){
  const input=parseCommsContactResponse({requestId,status}),command=parseCommsContactCommand({actorUid:uid,request:input},'respond');if(!deps.enabled())throw new CommsContactError();return withPersonalMemoryMutation(uid,async context=>{const guard=()=>{outer();context.assertCurrent();};guard();const value=await deps.call('respond',command);guard();
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='requestId,status,updatedAt')throw new CommsContactError();const row=value as{requestId:string;status:string;updatedAt:number};if(row.requestId!==input.requestId||row.status!==input.status||!Number.isSafeInteger(row.updatedAt)||row.updatedAt<1)throw new CommsContactError();return{...row};
  },deps.mutation);
}
