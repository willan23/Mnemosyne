import {doc,getDocFromServer,onSnapshot} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import app,{db} from '../firebase';
import {MOBILE_SYNC_WRITES_ENABLED} from '../config/releaseGates';
import type {SessionData} from '../hooks/useSessions';
import type {MobileMemoryDelta,MobileMemorySnapshot} from './mobileSync';
import {buildMobileMemorySnapshot} from './mobileSyncBuilders';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {verifySyncImportPrivateKey} from './mobileSyncImport';
import {notifySyncCheckpoints} from './mobileSyncCheckpoints';
import {parseMobileSyncPayload,syncRecord,syncFields} from './mobileSyncPayload';
import {canonicalSyncState,syncHashValid,syncIdValid,syncInteger} from '../../../functions/src/mobileSyncImportContract';
import {parseSyncPublication,syncDeviceState,parseSyncPublicKey,type SyncPublicationRequest,type SyncPublicationOutcome} from '../../../functions/src/mobileSyncPublicationContract';

type Direction=SyncPublicationRequest['direction'];
type Fingerprint={id:string;digest:string};
interface SyncIndex {v:1;uid:string;deviceId:string;direction:Direction;entries:Fingerprint[];lastReceipt:{envelopeId:string;digest:string}|null}
interface Checkpoint {v:1;uid:string;request:SyncPublicationRequest;fingerprints:Fingerprint[];indexDigest:string|null}
export interface SyncOutboxResult {envelopeId:string|null;delivery:SyncPublicationOutcome['delivery']|'unchanged';imported:number;conflicts:number}
export class SyncOutboxError extends Error {
  constructor(){super('O envio aguarda confirmação. Retoma ou cancela o envio pendente antes de preparar outro.');}
}
const failure=()=>new SyncOutboxError();
export const mobileSyncOutboxKey=(uid:string,deviceId:string,direction:Direction)=>`mnemosyne:sync-outbox:v1:${encodeURIComponent(uid)}:${encodeURIComponent(deviceId)}:${direction}`;
export const mobileSyncIndexKey=(uid:string,deviceId:string,direction:Direction)=>`mnemosyne:sync-index:v1:${encodeURIComponent(uid)}:${encodeURIComponent(deviceId)}:${direction}`;
export {notifySyncCheckpoints,observeSyncCheckpoints} from './mobileSyncCheckpoints';
export function hasPendingSyncOutbox(uid:string,deviceId:string,direction:Direction){try{return localStorage.getItem(mobileSyncOutboxKey(uid,deviceId,direction))!==null;}catch{return true;}}
export interface SyncOutboxDeps {
  enabled:()=>boolean;id:()=>string;now:()=>number;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
  exclusive:<T>(name:string,work:()=>Promise<T>)=>Promise<T>;
  device:(id:string)=>Promise<unknown>;observeDevice:(id:string,changed:(value:unknown)=>void,failed:()=>void)=>()=>void;
  digest:(value:unknown)=>Promise<string>;encryptJournal:typeof encryptMemoryFields;decryptJournal:typeof decryptMemoryEnvelope;
  seal:(value:unknown,direction:Direction,device:ReturnType<typeof syncDeviceState>,privateKey:JsonWebKey|undefined,guard:()=>void)=>Promise<Pick<SyncPublicationRequest,'encryptedPayload'|'senderPublicKeyJwk'>>;
  call:(mode:'publish'|'status'|'cancel',request:SyncPublicationRequest)=>Promise<unknown>;mutation?:PersonalMemoryMutationDeps;
}
const encoder=new TextEncoder();
const base64url=(bytes:Uint8Array)=>{
  let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
};
export async function sealMobileSyncPayload(value:unknown,direction:Direction,device:ReturnType<typeof syncDeviceState>,privateKey:JsonWebKey|undefined,guard:()=>void){
  let local:CryptoKey;let senderPublicKeyJwk:JsonWebKey;
  if(direction==='mobile-to-desktop'){
    if(!privateKey)throw failure();await verifySyncImportPrivateKey(privateKey,device.publicKeyJwk,guard);guard();
    local=await crypto.subtle.importKey('jwk',privateKey,{name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);guard();senderPublicKeyJwk=device.publicKeyJwk;
  }else{
    const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);guard();local=pair.privateKey;
    senderPublicKeyJwk=await crypto.subtle.exportKey('jwk',pair.publicKey);guard();
  }
  const peer=await crypto.subtle.importKey('jwk',parseSyncPublicKey(direction==='desktop-to-mobile'?device.publicKeyJwk:device.desktopPublicKeyJwk),{name:'ECDH',namedCurve:'P-256'},false,[]);guard();
  const key=await crypto.subtle.deriveKey({name:'ECDH',public:peer},local,{name:'AES-GCM',length:256},false,['encrypt']);guard();
  const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(value)));guard();
  return {senderPublicKeyJwk:parseSyncPublicKey(senderPublicKeyJwk),encryptedPayload:{iv:base64url(iv),data:base64url(new Uint8Array(cipher))}};
}
function defaults():SyncOutboxDeps {
  const names={publish:'publishMobileSyncEnvelope',status:'getMobileSyncPublicationStatus',cancel:'cancelMobileSyncPublication'};
  return {enabled:()=>MOBILE_SYNC_WRITES_ENABLED,id:()=>crypto.randomUUID(),now:Date.now,storage:localStorage,exclusive:withClipCaptureLock,
    encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,seal:sealMobileSyncPayload,
    device:async id=>{const snapshot=await getDocFromServer(doc(db,'trustedDevices',id));if(!snapshot.exists())throw failure();return snapshot.data();},
    observeDevice:(id,changed,failed)=>onSnapshot(doc(db,'trustedDevices',id),snapshot=>{if(!snapshot.metadata.fromCache)changed(snapshot.exists()?snapshot.data():null);},failed),
    digest:async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(canonicalSyncState(value)))),byte=>byte.toString(16).padStart(2,'0')).join(''),
    call:async(mode,request)=>(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(request)).data};
}
function fingerprints(value:unknown,max:number):Fingerprint[]{
  if(!Array.isArray(value)||value.length>max)throw failure();const ids=new Set<string>();
  return value.map(item=>{const data=syncRecord(item);syncFields(data,['id','digest']);if(!syncIdValid(data.id)||!syncHashValid(data.digest)||ids.has(data.id))throw failure();ids.add(data.id);return {id:data.id,digest:data.digest};});
}
async function unseal(raw:string,max:number,deps:SyncOutboxDeps,guard:()=>void){
  if(raw.length>4000000)throw failure();const cipher:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(cipher))throw failure();
  const result=await deps.decryptJournal(cipher);guard();if(result.text.length>max)throw failure();return syncRecord(JSON.parse(result.text));
}
async function readIndex(raw:string|null,uid:string,deviceId:string,direction:Direction,deps:SyncOutboxDeps,guard:()=>void):Promise<SyncIndex>{
  if(raw===null)return {v:1,uid,deviceId,direction,entries:[],lastReceipt:null};
  const data=await unseal(raw,2000000,deps,guard);syncFields(data,['v','uid','deviceId','direction','entries','lastReceipt']);
  if(data.v!==1||data.uid!==uid||data.deviceId!==deviceId||data.direction!==direction)throw failure();
  let lastReceipt:SyncIndex['lastReceipt']=null;
  if(data.lastReceipt!==null){const receipt=syncRecord(data.lastReceipt);syncFields(receipt,['envelopeId','digest']);if(!syncIdValid(receipt.envelopeId)||!syncHashValid(receipt.digest))throw failure();lastReceipt={envelopeId:receipt.envelopeId,digest:receipt.digest};}
  return {v:1,uid,deviceId,direction,entries:fingerprints(data.entries,10000),lastReceipt};
}
async function readCheckpoint(raw:string,uid:string,deviceId:string,direction:Direction,deps:SyncOutboxDeps,guard:()=>void):Promise<Checkpoint>{
  const data=await unseal(raw,2000000,deps,guard);syncFields(data,['v','uid','request','fingerprints','indexDigest']);const request=parseSyncPublication(data.request);
  if(data.v!==1||data.uid!==uid||request.deviceId!==deviceId||request.direction!==direction||!(data.indexDigest===null||syncHashValid(data.indexDigest)))throw failure();
  const entries=fingerprints(data.fingerprints,2500);if(entries.length!==request.memoryCount)throw failure();
  return {v:1,uid,request,fingerprints:entries,indexDigest:data.indexDigest as string|null};
}
async function outcome(value:unknown,request:SyncPublicationRequest,deps:SyncOutboxDeps,guard:()=>void):Promise<SyncPublicationOutcome>{
  const digest=await deps.digest(request);guard();const data=syncRecord(value);syncFields(data,['envelopeId','digest','status','createdAt','delivery','imported','conflicts']);
  if(data.envelopeId!==request.envelopeId||data.digest!==digest||!['unknown','published','cancelled'].includes(String(data.status))||
    !['none','queued','pending','complete','expired','cancelled','unavailable'].includes(String(data.delivery))||!syncInteger(data.imported)||!syncInteger(data.conflicts)||data.imported+data.conflicts>request.memoryCount||
    (data.status==='unknown'?(data.createdAt!==null||data.delivery!=='none'):!syncInteger(data.createdAt)||data.createdAt<1)||
    (data.status==='cancelled'&&data.delivery!=='cancelled')||(data.status==='published'&&data.delivery==='none')||
    (!['pending','complete'].includes(String(data.delivery))&&(data.imported!==0||data.conflicts!==0))||(data.delivery==='pending'&&request.memoryCount===0))throw failure();
  return data as unknown as SyncPublicationOutcome;
}
async function writeCipher(key:string,value:unknown,expectedRaw:string|null,deps:SyncOutboxDeps,guard:()=>void){
  const text=JSON.stringify(value);if(text.length>2000000)throw failure();const cipher=await deps.encryptJournal({text});guard();if(!isEncryptedMemoryEnvelope(cipher))throw failure();
  const raw=JSON.stringify(cipher);if(raw.length>4000000||deps.storage.getItem(key)!==expectedRaw)throw failure();deps.storage.setItem(key,raw);if(deps.storage.getItem(key)!==raw)throw failure();guard();return raw;
}
async function operate(uid:string,deviceId:string,direction:Direction,mode:'start'|'recover'|'cancel',sessions:SessionData[]|undefined,snapshot:boolean,privateKey:JsonWebKey|undefined,deps:SyncOutboxDeps):Promise<SyncOutboxResult>{
  if(mode==='start'&&!deps.enabled())throw new Error('A sincronização está temporariamente em validação. Os envelopes existentes foram conservados.');
  if(!syncIdValid(deviceId)||!['desktop-to-mobile','mobile-to-desktop'].includes(direction))throw failure();
  try{return await withPersonalMemoryMutation(uid,async context=>deps.exclusive(mobileSyncOutboxKey(uid,deviceId,direction),async()=>{
    let deviceChanged=false;let stopDevice:(()=>void)|null=null;
    const key=mobileSyncOutboxKey(uid,deviceId,direction);const indexKey=mobileSyncIndexKey(uid,deviceId,direction);
    let boundRaw:string|null|undefined;
    const guard=()=>{context.assertCurrent();if(deviceChanged||(boundRaw!==undefined&&deps.storage.getItem(key)!==boundRaw))throw failure();};guard();
    try{
    let raw=deps.storage.getItem(key);let checkpoint:Checkpoint;
    if(raw!==null){if(mode==='start')throw failure();boundRaw=raw;checkpoint=await readCheckpoint(raw,uid,deviceId,direction,deps,guard);guard();}
    else{
      if(mode!=='start'||!sessions||(snapshot&&direction!=='desktop-to-mobile'))throw failure();
      const indexRaw=deps.storage.getItem(indexKey);const index=await readIndex(indexRaw,uid,deviceId,direction,deps,guard);guard();
      const built:MobileMemorySnapshot=JSON.parse(JSON.stringify(buildMobileMemorySnapshot(uid,sessions)));
      const view={ownerUid:uid,deviceId,direction:'desktop-to-mobile' as const,payloadType:'memory-snapshot' as const,memoryCount:built.memories.length,tombstoneIds:built.memories.filter(memory=>memory.deletedAt!==undefined).map(memory=>memory.id)};
      const valid=parseMobileSyncPayload(built,view).map(change=>change.memory);const known=new Map(index.entries.map(entry=>[entry.id,entry.digest]));
      const selected:MobileMemorySnapshot['memories']=[];const hashes:Fingerprint[]=[];
      for(const memory of valid){const digest=await deps.digest(memory);guard();if(snapshot||known.get(memory.id)!==digest){selected.push(memory);hashes.push({id:memory.id,digest});}}
      if(!selected.length)return {envelopeId:null,delivery:'unchanged',imported:0,conflicts:0};
      if(new Set([...known.keys(),...hashes.map(entry=>entry.id)]).size>10000)throw failure();
      const initial=syncDeviceState(await deps.device(deviceId),uid,deviceId);guard();const deviceCanonical=canonicalSyncState(initial);
      stopDevice=deps.observeDevice(deviceId,value=>{try{if(canonicalSyncState(syncDeviceState(value,uid,deviceId))!==deviceCanonical)deviceChanged=true;}catch{deviceChanged=true;}},()=>{deviceChanged=true;});
      const active=()=>{guard();if(deps.storage.getItem(indexKey)!==indexRaw)throw failure();};
        const payload:MobileMemorySnapshot|MobileMemoryDelta=snapshot?{...built,memories:selected}:{version:1,ownerUid:uid,exportedAt:built.exportedAt,source:direction==='desktop-to-mobile'?'desktop':'mobile',deviceId,since:0,
          cursor:selected.reduce((max,memory)=>Math.max(max,memory.updatedAt),0),changes:selected.map(memory=>({op:memory.deletedAt!==undefined?'delete':'upsert',memory}))};
        const payloadType=snapshot?'memory-snapshot' as const:'memory-delta' as const;const tombstoneIds=selected.filter(memory=>memory.deletedAt!==undefined).map(memory=>memory.id);
        parseMobileSyncPayload(payload,{ownerUid:uid,deviceId,direction,payloadType,memoryCount:selected.length,tombstoneIds});
        const sealed=await deps.seal(payload,direction,initial,privateKey,active);active();const expectedDeviceHash=await deps.digest(initial);active();
        const request=parseSyncPublication({envelopeId:deps.id(),deviceId,direction,payloadType,...sealed,memoryCount:selected.length,tombstoneIds,expiresAt:deps.now()+7*86400000,expectedDeviceHash});
        const indexDigest=indexRaw===null?null:await deps.digest(indexRaw);active();checkpoint={v:1,uid,request,fingerprints:hashes,indexDigest};
        if(deps.storage.getItem(indexKey)!==indexRaw||deps.storage.getItem(key)!==null)throw failure();raw=await writeCipher(key,checkpoint,null,deps,active);boundRaw=raw;active();notifySyncCheckpoints();
    }
    guard();let current=await outcome(await deps.call('status',checkpoint.request),checkpoint.request,deps,guard);guard();
    if(current.status==='unknown'){
      if(mode==='cancel'){current=await outcome(await deps.call('cancel',checkpoint.request),checkpoint.request,deps,guard);guard();}
      else{
        if(!deps.enabled())throw failure();const device=syncDeviceState(await deps.device(deviceId),uid,deviceId);guard();const digest=await deps.digest(device);guard();if(digest!==checkpoint.request.expectedDeviceHash)throw failure();
        if(!stopDevice){const canonical=canonicalSyncState(device);stopDevice=deps.observeDevice(deviceId,value=>{try{if(canonicalSyncState(syncDeviceState(value,uid,deviceId))!==canonical)deviceChanged=true;}catch{deviceChanged=true;}},()=>{deviceChanged=true;});}
        current=await outcome(await deps.call('publish',checkpoint.request),checkpoint.request,deps,guard);guard();
      }
    }else if(mode==='cancel'&&current.status==='published'&&!['complete','cancelled'].includes(current.delivery)){
      current=await outcome(await deps.call('cancel',checkpoint.request),checkpoint.request,deps,guard);guard();
    }
    if(current.status==='unknown')throw failure();
    const terminal=current.delivery==='complete'||current.delivery==='cancelled';
    if(terminal){
      const confirmed=await outcome(await deps.call('status',checkpoint.request),checkpoint.request,deps,guard);guard();if(canonicalSyncState(confirmed)!==canonicalSyncState(current))throw failure();
      if(current.delivery==='complete'){
        const indexRaw=deps.storage.getItem(indexKey);const index=await readIndex(indexRaw,uid,deviceId,direction,deps,guard);guard();
        const known=new Map(index.entries.map(entry=>[entry.id,entry.digest]));
        if(index.lastReceipt?.envelopeId===current.envelopeId&&index.lastReceipt.digest===current.digest){if(checkpoint.fingerprints.some(entry=>known.get(entry.id)!==entry.digest))throw failure();}
        else{
          const digest=indexRaw===null?null:await deps.digest(indexRaw);guard();if(digest!==checkpoint.indexDigest)throw failure();
          for(const entry of checkpoint.fingerprints)known.set(entry.id,entry.digest);
          const next:SyncIndex={v:1,uid,deviceId,direction,entries:Array.from(known,([id,digest])=>({id,digest})),lastReceipt:{envelopeId:current.envelopeId,digest:current.digest}};
          if(next.entries.length>10000||deps.storage.getItem(indexKey)!==indexRaw||deps.storage.getItem(key)!==raw)throw failure();
          const indexGuard=()=>{guard();if(deps.storage.getItem(key)!==raw)throw failure();};
          await writeCipher(indexKey,next,indexRaw,deps,indexGuard);guard();
        }
      }
      if(deps.storage.getItem(key)!==raw)throw failure();deps.storage.removeItem(key);if(deps.storage.getItem(key)!==null)throw failure();boundRaw=null;guard();notifySyncCheckpoints();
    }
    return {envelopeId:current.envelopeId,delivery:current.delivery,imported:current.imported,conflicts:current.conflicts};
    }finally{stopDevice?.();}
  }),deps.mutation);}catch{throw failure();}
}
export const queuePersonalSyncSnapshot=(uid:string,deviceId:string,sessions:SessionData[],deps=defaults())=>operate(uid,deviceId,'desktop-to-mobile','start',sessions,true,undefined,deps);
export const queuePersonalSyncDelta=(uid:string,deviceId:string,direction:Direction,sessions:SessionData[],privateKey?:JsonWebKey,deps=defaults())=>operate(uid,deviceId,direction,'start',sessions,false,privateKey,deps);
export const recoverPendingSyncOutbox=(uid:string,deviceId:string,direction:Direction,deps=defaults())=>operate(uid,deviceId,direction,'recover',undefined,false,undefined,deps);
export const cancelPendingSyncOutbox=(uid:string,deviceId:string,direction:Direction,deps=defaults())=>operate(uid,deviceId,direction,'cancel',undefined,false,undefined,deps);
