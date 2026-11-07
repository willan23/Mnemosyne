import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {COMMS_CONTACT_WRITES_ENABLED} from '../config/releaseGates';
import {attachmentActorIdValid} from '../../../functions/src/attachmentEnvelope';
import {parseCommsContactRemovalRequest,parseCommsContactRemovalOutcome,commsContactRemovalBytes,type CommsContactRemovalRequest,type CommsContactRemovalOutcome} from '../../../functions/src/commsContactRemovalContract';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
export interface CommsContactRemovalClientDeps {enabled:()=>boolean;storage:Storage;id:()=>string;mutation?:PersonalMemoryMutationDeps;exclusive:typeof withClipCaptureLock;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;call:(mode:'begin'|'status'|'advance'|'cancel',value:unknown)=>Promise<unknown>;observeStorage:(uid:string,changed:()=>void)=>()=>void}
export const commsContactRemovalPendingKey=(uid:string)=>`mnemosyne:comms-contact-removal:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:comms-contact-removal-changed',notify=()=>window.dispatchEvent(new Event(event));
export class CommsContactRemovalError extends Error {constructor(){super('Não foi possível confirmar a remoção. A cópia cifrada local foi conservada.');}}
export function hasPendingCommsContactRemoval(uid:string){try{return localStorage.getItem(commsContactRemovalPendingKey(uid))!==null;}catch{return true;}}
export function observeCommsContactRemoval(changed:()=>void){window.addEventListener(event,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(event,changed);window.removeEventListener('storage',changed);};}
const defaults=():CommsContactRemovalClientDeps=>({enabled:()=>COMMS_CONTACT_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,
  call:async(mode,value)=>{const names={begin:'beginCommsContactRemoval',status:'getCommsContactRemovalStatus',advance:'advanceCommsContactRemoval',cancel:'cancelCommsContactRemoval'};return(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(value)).data;},
  observeStorage:(uid,changed)=>{const listener=(value:StorageEvent)=>{if(value.key===null||value.key===commsContactRemovalPendingKey(uid))changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
type Selection=Omit<CommsContactRemovalRequest,'requestId'|'actorUid'>;
async function operate(uid:string,selected:Selection|null,outer:()=>void,deps:CommsContactRemovalClientDeps,cancel=false):Promise<CommsContactRemovalOutcome>{
  if(!attachmentActorIdValid(uid)||selected&&!deps.enabled())throw new CommsContactRemovalError();
  const captured=selected?{peerUid:selected.peerUid,anchorId:selected.anchorId,anchorUpdatedAt:selected.anchorUpdatedAt}:null;
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:comms-contact:v1:${encodeURIComponent(uid)}`,async()=>{
    const key=commsContactRemovalPendingKey(uid);let changed=false,raw:string|null=null;
    const stop=deps.observeStorage(uid,()=>{changed=true;});
    const guard=()=>{outer();context.assertCurrent();if(changed||deps.storage.getItem(key)!==raw)throw new CommsContactRemovalError();};
    try{
      raw=deps.storage.getItem(key);guard();let request:CommsContactRemovalRequest;
      if(raw!==null){
        if(captured||raw.length>20000)throw new CommsContactRemovalError();
        const encrypted:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(encrypted)||Object.keys(encrypted).sort().join(',')!=='ct,iv,v')throw new CommsContactRemovalError();
        const text=(await deps.decrypt(encrypted)).text;guard();if(text.length>10000)throw new CommsContactRemovalError();const journal=JSON.parse(text);
        if(!journal||Object.keys(journal).sort().join(',')!=='request,uid,v'||journal.v!==1||journal.uid!==uid)throw new CommsContactRemovalError();request=parseCommsContactRemovalRequest(journal.request);
      }else{
        if(!captured)throw new CommsContactRemovalError();request=parseCommsContactRemovalRequest({requestId:deps.id(),actorUid:uid,...captured});if(request.peerUid===uid)throw new CommsContactRemovalError();
        const encrypted=JSON.stringify(await deps.encrypt({text:JSON.stringify({v:1,uid,request})}));guard();if(encrypted.length>20000)throw new CommsContactRemovalError();deps.storage.setItem(key,encrypted);raw=encrypted;guard();notify();
      }
      if(request.actorUid!==uid||request.peerUid===uid)throw new CommsContactRemovalError();const digest=await hash(commsContactRemovalBytes(request));guard();
      const call=async(mode:'begin'|'status'|'advance'|'cancel')=>{guard();const result=parseCommsContactRemovalOutcome(await deps.call(mode,request),request,digest);guard();return result;};
      let result=await call('status');if(cancel&&['unknown','pending'].includes(result.status))result=await call('cancel');
      else if(result.status==='unknown'){if(!deps.enabled())throw new CommsContactRemovalError();result=await call('begin');}
      else if(result.status==='pending')result=await call('advance');
      if(result.status==='unknown')throw new CommsContactRemovalError();
      if(result.status!=='pending'){guard();deps.storage.removeItem(key);raw=null;guard();}notify();return result;
    }finally{stop();}
  }),deps.mutation);
}
export const removeAcceptedCommsContact=(uid:string,selected:Selection,guard:()=>void=()=>{},deps=defaults())=>operate(uid,selected,guard,deps);
export const continueCommsContactRemoval=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,null,guard,deps);
export const cancelCommsContactRemoval=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,null,guard,deps,true);
