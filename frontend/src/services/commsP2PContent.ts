import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {COMMS_P2P_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {commsP2PInboxStore,parseStoredCommsP2PPacket,type CommsP2PInboxStore,type StoredCommsP2PPacket,type CommsP2PInboxCursor} from './commsP2PInboxStore';
import {parseCommsDeliveryRequest,commsDeliveryRequestBytes,type CommsDeliveryRequest} from '../../../functions/src/commsDeliveryContract';
import {parseCommsP2PContentDescriptor,parseCommsP2PContentOutcome,assertCommsP2PPacketSession,type CommsP2PContentDescriptor,type CommsP2PContentOutcome} from '../../../functions/src/commsP2PContentContract';
import {parseCommsP2PBinding,type CommsP2PBinding} from '../../../functions/src/commsP2PContract';
import {CommsP2PAssembler,parseCommsP2PFrame,planCommsP2PTransfer,type CommsP2PComplete} from './commsP2PWire';
import type {CommsAttachment,CommsEnvelope} from './commsTransport';
export interface CommsP2POpened {message:string;attachment:CommsAttachment|null}
export interface CommsP2PReceived {packet:CommsDeliveryRequest;descriptor:CommsP2PContentDescriptor;opened:CommsP2POpened;createdAt:number;acknowledgedAt:number|null}
export interface CommsP2PContentDeps {enabled:()=>boolean;storage:Storage;store:CommsP2PInboxStore;id:()=>string;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;mutation?:PersonalMemoryMutationDeps;exclusive:typeof withClipCaptureLock;call:(mode:'admit'|'status'|'cancel'|'ack',value:unknown)=>Promise<unknown>;ackTimeoutMs:number;observeStorage:(uid:string,changed:()=>void)=>()=>void}
export class CommsP2PContentError extends Error {constructor(){super('A entrega P2P ainda não foi confirmada. A cápsula cifrada foi conservada.');}}
export const commsP2PContentPendingKey=(uid:string)=>`mnemosyne:comms-p2p-content:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:comms-p2p-content-changed',inboxEvent='mnemosyne:comms-p2p-inbox-changed';
const notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingCommsP2PContent(uid:string){try{return localStorage.getItem(commsP2PContentPendingKey(uid))!==null;}catch{return true;}}
export function observeCommsP2PContent(callback:()=>void){window.addEventListener(event,callback);window.addEventListener('storage',callback);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};}
export function observeCommsP2PInbox(uid:string,callback:()=>void){const listener=(value:Event)=>{if((value as CustomEvent).detail?.uid===uid)callback();};window.addEventListener(inboxEvent,listener);return()=>window.removeEventListener(inboxEvent,listener);}
const defaults=():CommsP2PContentDeps=>({enabled:()=>COMMS_P2P_WRITES_ENABLED,storage:localStorage,store:commsP2PInboxStore,id:()=>crypto.randomUUID(),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,exclusive:withClipCaptureLock,ackTimeoutMs:15000,
  call:async(mode,value)=>{const names={admit:'admitCommsP2PContent',status:'getCommsP2PContentStatus',cancel:'cancelCommsP2PContent',ack:'acknowledgeCommsP2PContent'};return(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(value)).data;},
  observeStorage:(uid,changed)=>{const listener=(value:StorageEvent)=>{if(value.key===null||value.key===commsP2PContentPendingKey(uid))changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function describeCommsP2PPacket(value:CommsDeliveryRequest,guard:()=>void):Promise<CommsP2PContentDescriptor>{const packet=parseCommsDeliveryRequest(value),bytes=commsDeliveryRequestBytes(packet),digest=await hash(bytes);guard();return parseCommsP2PContentDescriptor({requestId:packet.requestId,senderUid:packet.senderUid,recipientUid:packet.recipientUid,senderFingerprint:packet.senderFingerprint,recipientFingerprint:packet.recipientFingerprint,digest,bytes:new TextEncoder().encode(bytes).length});}
async function status(uid:string,packet:CommsP2PContentDescriptor,mode:'status'|'cancel'|'ack',guard:()=>void,deps:CommsP2PContentDeps){guard();const result=parseCommsP2PContentOutcome(await deps.call(mode,{actorUid:uid,packet}),packet);guard();return result;}
function equalDescriptor(a:CommsP2PContentDescriptor,b:CommsP2PContentDescriptor){if(JSON.stringify(a)!==JSON.stringify(b))throw new CommsP2PContentError();}
async function decodeStored(value:StoredCommsP2PPacket,uid:string,guard:()=>void,deps:CommsP2PContentDeps){const stored=parseStoredCommsP2PPacket(value,uid);guard();const text=(await deps.decrypt(stored.enc)).text;guard();if(text.length>700000)throw new CommsP2PContentError();const journal=JSON.parse(text);if(!journal||Object.keys(journal).sort().join(',')!=='packet,uid,v'||journal.v!==1||journal.uid!==uid)throw new CommsP2PContentError();const packet=parseCommsDeliveryRequest(journal.packet);if(packet.recipientUid!==uid||packet.requestId!==stored.requestId)throw new CommsP2PContentError();const descriptor=await describeCommsP2PPacket(packet,guard);if(descriptor.digest!==stored.digest||descriptor.bytes!==stored.bytes)throw new CommsP2PContentError();return{stored,packet,descriptor};}
export interface CommsP2PContentLink {readonly session:CommsP2PBinding;maximum:()=>number;send:(wire:string)=>Promise<void>;wait:(requestId:string,transferId:string,digest:string)=>{done:Promise<void>;stop:()=>void};receive:(value:unknown)=>Promise<void>;stop:()=>void}
export function createCommsP2PContentLink(uid:string,sessionValue:CommsP2PBinding,channel:RTCDataChannel,maximum:()=>number,outer:()=>void,open:(envelope:CommsEnvelope,guard:()=>void)=>Promise<CommsP2POpened>,received:(value:CommsP2PReceived)=>void,deps=defaults()):CommsP2PContentLink {
  const session=parseCommsP2PBinding(sessionValue);if(session.actorUid!==uid)throw new CommsP2PContentError();const assembler=new CommsP2PAssembler(session),waiters=new Map<string,{requestId:string;digest:string;resolve:()=>void;timer:ReturnType<typeof setTimeout>}>(),complete=new Map<string,CommsP2PContentDescriptor>();let active=true,queue=Promise.resolve(),queuedBytes=0,queuedFrames=0;
  const guard=()=>{if(!active||channel.readyState!=='open')throw new CommsP2PContentError();outer();};
  const send=async(wire:string)=>{guard();const cap=Math.min(maximum(),16*1024);if(!Number.isFinite(cap)||cap<=0||new TextEncoder().encode(wire).length>cap)throw new CommsP2PContentError();const started=Date.now();while(channel.bufferedAmount>64*1024){guard();if(Date.now()-started>10000)throw new CommsP2PContentError();await new Promise<void>(resolve=>setTimeout(resolve,20));guard();}channel.send(wire);guard();};
  const process=async(value:unknown)=>{
    guard();const frame=parseCommsP2PFrame(value,session);if(frame.type==='ack'){const waiting=waiters.get(frame.transferId);if(waiting&&waiting.requestId===frame.requestId&&waiting.digest===frame.digest)waiting.resolve();return;}
    const old=complete.get(frame.transferId);if(old){if(old.requestId!==frame.requestId)throw new CommsP2PContentError();if(frame.type==='commit'){const confirmed=await status(uid,old,'status',guard,deps);if(confirmed.status==='received')await send(JSON.stringify({v:1,type:'ack',roomId:session.roomId,transferId:frame.transferId,requestId:old.requestId,digest:old.digest}));}return;}
    if(frame.type==='manifest'){const admitted=await status(uid,frame.packet,'status',guard,deps);if(!['admitted','received'].includes(admitted.status)||admitted.roomId!==session.roomId)throw new CommsP2PContentError();}
    const assembled=assembler.accept(frame);if(!assembled)return;
    await acceptPacket(assembled);
  };
  const acceptPacket=async(value:CommsP2PComplete)=>withPersonalMemoryMutation(uid,async context=>{const current=()=>{guard();context.assertCurrent();};current();const descriptor=await describeCommsP2PPacket(value.packet,current);equalDescriptor(descriptor,value.descriptor);assertCommsP2PPacketSession(descriptor,session,false);const admitted=await status(uid,descriptor,'status',current,deps);if(!['admitted','received'].includes(admitted.status)||admitted.roomId!==session.roomId||admitted.createdAt===null)throw new CommsP2PContentError();
    return deps.exclusive(`mnemosyne:p2p-inbox:${encodeURIComponent(uid)}:${descriptor.requestId}`,async()=>{
      current();let stored=await deps.store.get(uid,descriptor.requestId);current();if(stored){const existing=await decodeStored(stored,uid,current,deps);equalDescriptor(existing.descriptor,descriptor);if(stored.createdAt!==admitted.createdAt)throw new CommsP2PContentError();}
      else{const enc=await deps.encrypt({text:JSON.stringify({v:1,uid,packet:value.packet})});current();stored={v:1,uid,requestId:descriptor.requestId,digest:descriptor.digest,bytes:descriptor.bytes,createdAt:admitted.createdAt!,acknowledgedAt:null,enc};await deps.store.compareExchange(uid,descriptor.requestId,null,stored,current);current();const observed=await deps.store.get(uid,descriptor.requestId);current();if(!observed||JSON.stringify(observed)!==JSON.stringify(stored))throw new CommsP2PContentError();}
      const opened=await open(value.packet.envelope,current);current();let confirmed:CommsP2PContentOutcome|null=null;
      try{confirmed=await status(uid,descriptor,'ack',current,deps);if(confirmed.status!=='received'||confirmed.updatedAt===null)throw new CommsP2PContentError();const updated={...stored!,acknowledgedAt:confirmed.updatedAt};await deps.store.compareExchange(uid,descriptor.requestId,JSON.stringify(stored),updated,current);current();stored=updated;}catch{current();}
      current();received({packet:value.packet,descriptor,opened,createdAt:stored!.createdAt,acknowledgedAt:stored!.acknowledgedAt});complete.set(value.transferId,descriptor);if(complete.size>8)complete.delete(complete.keys().next().value!);window.dispatchEvent(new CustomEvent(inboxEvent,{detail:{uid}}));if(confirmed?.status==='received')await send(JSON.stringify({v:1,type:'ack',roomId:session.roomId,transferId:value.transferId,requestId:descriptor.requestId,digest:descriptor.digest}));
    });
  },deps.mutation);
  return{session,maximum,send,wait:(requestId,transferId,digest)=>{if(waiters.has(transferId))throw new CommsP2PContentError();let resolve!:()=>void;const done=new Promise<void>(finish=>{resolve=finish;}),timer=setTimeout(resolve,deps.ackTimeoutMs);waiters.set(transferId,{requestId,digest,resolve,timer});return{done,stop:()=>{clearTimeout(timer);waiters.delete(transferId);resolve();}};},
    receive:value=>{guard();if(typeof value!=='string'||value.length>16*1024)throw new CommsP2PContentError();const bytes=new TextEncoder().encode(value).length;if(queuedFrames>=2200||queuedBytes+bytes>2*1024*1024)throw new CommsP2PContentError();queuedFrames++;queuedBytes+=bytes;const pending=queue.then(()=>process(value));queue=pending.catch(()=>{});return pending.finally(()=>{queuedFrames--;queuedBytes-=bytes;});},
    stop:()=>{active=false;assembler.clear();complete.clear();for(const row of waiters.values()){clearTimeout(row.timer);row.resolve();}waiters.clear();},
  };
}
async function operate(uid:string,value:Omit<CommsDeliveryRequest,'requestId'|'senderUid'>|null,mode:'start'|'confirm'|'resume'|'cancel',link:CommsP2PContentLink|null,outer:()=>void,deps:CommsP2PContentDeps){
  const selected=value?parseCommsDeliveryRequest({...value,requestId:deps.id(),senderUid:uid}):null;if(mode==='start'&&!deps.enabled())throw new CommsP2PContentError();
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:p2p-content:${encodeURIComponent(uid)}`,async()=>{const key=commsP2PContentPendingKey(uid);let raw:string|null=null,changed=false;const stop=deps.observeStorage(uid,()=>{changed=true;});const guard=()=>{outer();context.assertCurrent();if(changed||deps.storage.getItem(key)!==raw)throw new CommsP2PContentError();};
    try{raw=deps.storage.getItem(key);guard();let packet:CommsDeliveryRequest;if(raw!==null){if(mode==='start'||raw.length>1000000)throw new CommsP2PContentError();const enc:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(enc)||Object.keys(enc).sort().join(',')!=='ct,iv,v')throw new CommsP2PContentError();const text=(await deps.decrypt(enc)).text;guard();if(text.length>700000)throw new CommsP2PContentError();const journal=JSON.parse(text);if(!journal||Object.keys(journal).sort().join(',')!=='packet,uid,v'||journal.v!==1||journal.uid!==uid)throw new CommsP2PContentError();packet=parseCommsDeliveryRequest(journal.packet);}else{if(mode!=='start'||!selected)throw new CommsP2PContentError();packet=selected;const enc=JSON.stringify(await deps.encrypt({text:JSON.stringify({v:1,uid,packet})}));guard();if(enc.length>1000000)throw new CommsP2PContentError();deps.storage.setItem(key,enc);raw=enc;guard();notify();}
      if(packet.senderUid!==uid)throw new CommsP2PContentError();const descriptor=await describeCommsP2PPacket(packet,guard);let result=await status(uid,descriptor,'status',guard,deps);if(mode==='cancel'&&['unknown','admitted'].includes(result.status))result=await status(uid,descriptor,'cancel',guard,deps);
      if((mode==='start'||mode==='resume')&&['unknown','admitted'].includes(result.status)){
        if(!deps.enabled()||!link)throw new CommsP2PContentError();const session=parseCommsP2PBinding(link.session);assertCommsP2PPacketSession(descriptor,session,true);const transferId=deps.id(),frames=planCommsP2PTransfer(packet,descriptor,session,transferId,link.maximum());guard();result=parseCommsP2PContentOutcome(await deps.call('admit',{actorUid:uid,packet:descriptor,session}),descriptor);guard();
        if(result.status==='admitted'){if(result.roomId!==session.roomId)throw new CommsP2PContentError();const waiting=link.wait(descriptor.requestId,transferId,descriptor.digest);try{for(const frame of frames){guard();await link.send(frame);guard();}await waiting.done;guard();result=await status(uid,descriptor,'status',guard,deps);}finally{waiting.stop();}if(result.status!=='received')throw new CommsP2PContentError();}
      }
      if(['received','cancelled','revoked'].includes(result.status)){guard();deps.storage.removeItem(key);raw=null;guard();notify();}return result;
    }finally{stop();}
  }),deps.mutation);
}
export const sendCommsP2PContent=(uid:string,value:Omit<CommsDeliveryRequest,'requestId'|'senderUid'>,link:CommsP2PContentLink,guard:()=>void=()=>{},deps=defaults())=>operate(uid,value,'start',link,guard,deps);
export const confirmCommsP2PContent=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,null,'confirm',null,guard,deps);
export const resumeCommsP2PContent=(uid:string,link:CommsP2PContentLink,guard:()=>void=()=>{},deps=defaults())=>operate(uid,null,'resume',link,guard,deps);
export const cancelCommsP2PContent=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,null,'cancel',null,guard,deps);
export async function readCommsP2PInbox(uid:string,after:CommsP2PInboxCursor|null,open:(value:CommsEnvelope,guard:()=>void)=>Promise<CommsP2POpened>,outer:()=>void,deps=defaults()){
  return withPersonalMemoryMutation(uid,async context=>{
    const guard=()=>{outer();context.assertCurrent();};guard();const page=await deps.store.page(uid,after);guard();
    const rows:CommsP2PReceived[]=[];let unavailable=page.unavailable;
    for(const value of page.rows){
      guard();try{const decoded=await decodeStored(value,uid,guard,deps),opened=await open(decoded.packet.envelope,guard);guard();rows.push({packet:decoded.packet,descriptor:decoded.descriptor,opened,createdAt:decoded.stored.createdAt,acknowledgedAt:decoded.stored.acknowledgedAt});}
      catch{guard();unavailable++;}
    }
    guard();return{rows,next:page.next,scanned:page.scanned,unavailable};
  },deps.mutation);
}
export async function acknowledgeStoredCommsP2P(uid:string,id:string,open:(value:CommsEnvelope,guard:()=>void)=>Promise<CommsP2POpened>,outer:()=>void,deps=defaults()){
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:p2p-inbox:${encodeURIComponent(uid)}:${id}`,async()=>{const guard=()=>{outer();context.assertCurrent();};guard();const value=await deps.store.get(uid,id);guard();if(!value)throw new CommsP2PContentError();const decoded=await decodeStored(value,uid,guard,deps);await open(decoded.packet.envelope,guard);guard();const result=await status(uid,decoded.descriptor,'ack',guard,deps);if(result.status!=='received'||result.updatedAt===null)throw new CommsP2PContentError();const next={...decoded.stored,acknowledgedAt:result.updatedAt};await deps.store.compareExchange(uid,id,JSON.stringify(decoded.stored),next,guard);guard();window.dispatchEvent(new CustomEvent(inboxEvent,{detail:{uid}}));return result;}),deps.mutation);
}
