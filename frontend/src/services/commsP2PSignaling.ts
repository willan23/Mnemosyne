import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {COMMS_P2P_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {parseCommsP2PMutation,parseCommsP2PDescriptor,parseCommsP2PBinding,parseCommsP2POutcome,parseCommsP2PSession,commsP2PMutationBytes,commsP2POfferBytes,type CommsP2PMutation,type CommsP2PBinding,type CommsP2PSession} from '../../../functions/src/commsP2PContract';
export type {CommsP2PBinding};
export const commsP2PRequestBinding=(value:CommsP2PBinding)=>({roomId:value.roomId,callerUid:value.callerUid,calleeUid:value.calleeUid,callerFingerprint:value.callerFingerprint,calleeFingerprint:value.calleeFingerprint,offerDigest:value.offerDigest});
export interface CommsP2PClientDeps {enabled:()=>boolean;storage:Storage;id:()=>string;mutation?:PersonalMemoryMutationDeps;exclusive:typeof withClipCaptureLock;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;call:(mode:'apply'|'status'|'cancel'|'read',value:unknown)=>Promise<unknown>;observeStorage:(uid:string,changed:()=>void)=>()=>void;setInterval:typeof window.setInterval;clearInterval:typeof window.clearInterval}
export class CommsP2PSignalingError extends Error {constructor(){super('Não foi possível confirmar a sinalização P2P. A operação cifrada local foi conservada.');}}
export const commsP2PPendingKey=(uid:string)=>`mnemosyne:comms-p2p:v1:${encodeURIComponent(uid)}`;
export const commsP2PSessionKey=(uid:string)=>`mnemosyne:comms-p2p-session:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:comms-p2p-changed',notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingCommsP2P(uid:string){try{return localStorage.getItem(commsP2PPendingKey(uid))!==null;}catch{return true;}}
export function hasStoredCommsP2PSession(uid:string){try{return localStorage.getItem(commsP2PSessionKey(uid))!==null;}catch{return true;}}
export function observeCommsP2P(changed:()=>void){window.addEventListener(event,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(event,changed);window.removeEventListener('storage',changed);};}
const defaults=():CommsP2PClientDeps=>({enabled:()=>COMMS_P2P_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window),
  call:async(mode,value)=>{const names={apply:'mutateCommsP2P',status:'getCommsP2PMutationStatus',cancel:'cancelCommsP2PMutation',read:'readCommsP2PSession'};return(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(value)).data;},
  observeStorage:(uid,changed)=>{const listener=(value:StorageEvent)=>{if(value.key===null||value.key===commsP2PPendingKey(uid))changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
});
export const commsP2PHash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
async function operate(uid:string,value:Omit<CommsP2PMutation,'actorUid'|'operationId'>|null,mode:'start'|'recover'|'cancel'|'close-stored',outer:()=>void,deps:CommsP2PClientDeps){
  if(mode==='start'&&value?.kind!=='close'&&!deps.enabled())throw new CommsP2PSignalingError();const selected=value?parseCommsP2PMutation({...value,actorUid:uid,operationId:value.kind==='create'?value.roomId:deps.id()}):null;
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:comms-p2p:v1:${encodeURIComponent(uid)}`,async()=>{
    const key=commsP2PPendingKey(uid),sessionKey=commsP2PSessionKey(uid);let raw:string|null=null,sessionRaw:string|null=null,changed=false;const a=deps.observeStorage(uid,()=>{changed=true;}),listener=(value:StorageEvent)=>{if(value.key===null||value.key===sessionKey)changed=true;};window.addEventListener('storage',listener);const stop=()=>{a();window.removeEventListener('storage',listener);};const guard=()=>{outer();context.assertCurrent();if(changed||deps.storage.getItem(key)!==raw||deps.storage.getItem(sessionKey)!==sessionRaw)throw new CommsP2PSignalingError();};
    try{
      raw=deps.storage.getItem(key);sessionRaw=deps.storage.getItem(sessionKey);guard();let request:CommsP2PMutation;
      const decode=async(bytes:string)=>{if(bytes.length>256*1024)throw new CommsP2PSignalingError();const envelope:unknown=JSON.parse(bytes);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw new CommsP2PSignalingError();const text=(await deps.decrypt(envelope)).text;guard();if(text.length>80*1024)throw new CommsP2PSignalingError();const journal=JSON.parse(text);if(!journal||Object.keys(journal).sort().join(',')!=='request,uid,v'||journal.v!==1||journal.uid!==uid)throw new CommsP2PSignalingError();const request=parseCommsP2PMutation(journal.request);if(request.actorUid!==uid)throw new CommsP2PSignalingError();return request;};
      const stored=sessionRaw!==null?await decode(sessionRaw):null;guard();
      if(raw!==null){if(mode==='start'||mode==='close-stored'||raw.length>256*1024)throw new CommsP2PSignalingError();try{const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw Error();const text=(await deps.decrypt(envelope)).text;guard();if(text.length>80*1024)throw Error();const journal=JSON.parse(text);if(!journal||Object.keys(journal).sort().join(',')!=='request,uid,v'||journal.v!==1||journal.uid!==uid)throw Error();request=parseCommsP2PMutation(journal.request);}catch{guard();throw new CommsP2PSignalingError();}}
      else{if(mode==='close-stored'&&stored){request=parseCommsP2PMutation({...commsP2PRequestBinding(stored),actorUid:uid,kind:'close',signal:null,operationId:deps.id()});}else{if(mode!=='start'||!selected||selected.kind==='create'&&stored)throw new CommsP2PSignalingError();request=selected;}const encrypted=JSON.stringify(await deps.encrypt({text:JSON.stringify({v:1,uid,request})}));guard();if(encrypted.length>256*1024)throw new CommsP2PSignalingError();deps.storage.setItem(key,encrypted);raw=encrypted;guard();notify();}
      if(stored&&(['roomId','callerUid','calleeUid','callerFingerprint','calleeFingerprint','offerDigest'] as const).some(key=>stored[key]!==request[key]))throw new CommsP2PSignalingError();
      if(request.actorUid!==uid)throw new CommsP2PSignalingError();const input=parseCommsP2PDescriptor({...commsP2PRequestBinding(request),actorUid:uid,operationId:request.operationId,kind:request.kind,digest:await commsP2PHash(commsP2PMutationBytes(request))});guard();
      const call=async(which:'status'|'apply'|'cancel')=>{guard();const result=parseCommsP2POutcome(await deps.call(which,which==='apply'?request:input),input);guard();return result;};let result=await call('status');
      if(mode==='cancel'&&result.status!=='revoked')result=await call('cancel');else if(result.status==='unknown'){if(request.kind!=='close'&&!deps.enabled())throw new CommsP2PSignalingError();result=await call(request.kind==='close'?'cancel':'apply');}
      if(result.status==='unknown')throw new CommsP2PSignalingError();guard();if(result.status==='applied'&&['offer','active'].includes(result.roomStatus)){deps.storage.setItem(sessionKey,raw!);sessionRaw=raw;}else{deps.storage.removeItem(sessionKey);sessionRaw=null;}guard();deps.storage.removeItem(key);raw=null;guard();notify();return result;
    }finally{stop();}
  }),deps.mutation);
}
export const mutateCommsP2PSignal=(uid:string,value:Omit<CommsP2PMutation,'actorUid'|'operationId'>,outer:()=>void=()=>{},deps=defaults())=>operate(uid,value,'start',outer,deps);
export const recoverCommsP2PSignal=(uid:string,outer:()=>void=()=>{},deps=defaults())=>operate(uid,null,'recover',outer,deps);
export const cancelCommsP2PSignal=(uid:string,outer:()=>void=()=>{},deps=defaults())=>operate(uid,null,'cancel',outer,deps);
export const closeStoredCommsP2PSession=(uid:string,outer:()=>void=()=>{},deps=defaults())=>operate(uid,null,'close-stored',outer,deps);
/** Authoritative terminal-state reconciliation never creates a new operation or
 * deletes a pending mutation/content packet. Active rooms keep their handle. */
export async function reconcileStoredCommsP2PSession(uid:string,outer:()=>void=()=>{},deps=defaults()) {
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:comms-p2p:v1:${encodeURIComponent(uid)}`,async()=>{
    const key=commsP2PSessionKey(uid),pendingKey=commsP2PPendingKey(uid);
    const raw=deps.storage.getItem(key),pending=deps.storage.getItem(pendingKey);let changed=false;
    const storageListener=(event:StorageEvent)=>{if(event.key===null||event.key===key||event.key===pendingKey)changed=true;};
    window.addEventListener('storage',storageListener);
    const guard=()=>{outer();context.assertCurrent();if(changed||deps.storage.getItem(key)!==raw||deps.storage.getItem(pendingKey)!==pending)throw new CommsP2PSignalingError();};
    try {
      guard();if(raw===null)return null;if(pending!==null||raw.length>256*1024)throw new CommsP2PSignalingError();
      const envelope:unknown=JSON.parse(raw);
      if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw new CommsP2PSignalingError();
      const text=(await deps.decrypt(envelope)).text;guard();if(text.length>80*1024)throw new CommsP2PSignalingError();
      const journal=JSON.parse(text);
      if(!journal||Object.keys(journal).sort().join(',')!=='request,uid,v'||journal.v!==1||journal.uid!==uid)throw new CommsP2PSignalingError();
      const request=parseCommsP2PMutation(journal.request);if(request.actorUid!==uid)throw new CommsP2PSignalingError();
      const input=parseCommsP2PDescriptor({...commsP2PRequestBinding(request),actorUid:uid,operationId:request.operationId,kind:request.kind,digest:await commsP2PHash(commsP2PMutationBytes(request))});guard();
      const result=parseCommsP2POutcome(await deps.call('status',input),input);guard();
      if(['unknown','closed','expired','revoked'].includes(result.roomStatus)){
        deps.storage.removeItem(key);if(deps.storage.getItem(key)!==null||deps.storage.getItem(pendingKey)!==pending)throw new CommsP2PSignalingError();
        outer();context.assertCurrent();if(changed)throw new CommsP2PSignalingError();notify();
      }
      return result;
    }finally{window.removeEventListener('storage',storageListener);}
  }),deps.mutation);
}
export async function readCommsP2PSignal(uid:string,value:CommsP2PBinding,outer:()=>void=()=>{},deps=defaults()):Promise<CommsP2PSession>{
  const input=parseCommsP2PBinding(value);if(input.actorUid!==uid)throw new CommsP2PSignalingError();return withPersonalMemoryMutation(uid,async context=>{const guard=()=>{outer();context.assertCurrent();};guard();const result=parseCommsP2PSession(await deps.call('read',input),input);guard();if(result.offer&&await commsP2PHash(commsP2POfferBytes(result.offer))!==input.offerDigest)throw new CommsP2PSignalingError();guard();return result;},deps.mutation);
}
export function watchCommsP2PSignal(uid:string,value:CommsP2PBinding,guard:()=>void,changed:(value:CommsP2PSession)=>Promise<void>|void,failed:()=>void,deps=defaults()){
  const input=parseCommsP2PBinding(value);let active=true,busy=false,last:string|null=null;const current=()=>{if(!active)throw new CommsP2PSignalingError();guard();};
  const load=async()=>{if(!active||busy)return;busy=true;try{const result=await readCommsP2PSignal(uid,input,current,deps);current();const serialized=JSON.stringify(result);if(last!==serialized){last=serialized;await changed(result);current();}}catch{if(active){try{current();failed();}catch{/* A retired view receives no feedback. */}}}finally{busy=false;}};
  const timer=deps.setInterval(()=>void load(),2500);void load();return()=>{active=false;last=null;deps.clearInterval(timer);};
}
