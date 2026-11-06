import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {decryptMemoryEnvelope,encryptMemoryFields,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {canonicalSyncState,syncInteger} from '../../../functions/src/mobileSyncImportContract';
import {parseSyncConflictBase,parseSyncConflictTarget,parseSyncConflictRequest,syncConflictRequestBytes,type SyncConflictCall,type SyncConflictTarget,type SyncConflictOutcome,type SyncConflictRequest} from '../../../functions/src/syncConflictContract';
export type {SyncConflictAction} from '../../../functions/src/syncConflictContract';

export class SyncConflictError extends Error{constructor(){super('A decisão aguarda confirmação. O pedido cifrado foi conservado.');}}
export interface SyncConflictDeps{enabled:()=>boolean;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;id:()=>string;exclusive:typeof withClipCaptureLock;mutation?:PersonalMemoryMutationDeps;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;call:(mode:SyncConflictCall,command:{actorUid:string;request:unknown})=>Promise<unknown>}
const names={prepare:'prepareSyncConflictDecision',apply:'applySyncConflictDecision',status:'getSyncConflictDecisionStatus',cancel:'cancelSyncConflictDecision'};
const defaults=():SyncConflictDeps=>({enabled:()=>PERSONAL_REVISION_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,call:async(mode,command)=>(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(command)).data});
const fail=()=>new SyncConflictError(),event='mnemosyne:sync-conflict-changed',notify=()=>window.dispatchEvent(new Event(event));
export const syncConflictCheckpointKey=(uid:string)=>'mnemosyne:sync-conflict:v1:'+encodeURIComponent(uid);
export const syncConflictWritesEnabled=()=>PERSONAL_REVISION_WRITES_ENABLED;
export function observeSyncConflict(change:()=>void){window.addEventListener(event,change);window.addEventListener('storage',change);return()=>{window.removeEventListener(event,change);window.removeEventListener('storage',change);};}
export function hasPendingSyncConflict(uid:string,storage:Pick<Storage,'getItem'>=localStorage){try{return storage.getItem(syncConflictCheckpointKey(uid))!==null;}catch{return true;}}
const hash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');
export const syncConflictViewDigest=(row:Record<string,unknown>)=>hash(canonicalSyncState(row));
function outcome(value:unknown,request:SyncConflictRequest,digest:string):SyncConflictOutcome{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdAt,digest,operationId,revision,status')throw fail();const row=value as SyncConflictOutcome;
  if(row.operationId!==request.operationId||row.digest!==digest||!['unknown','committed','cancelled','revoked'].includes(row.status)||(row.status==='committed'?!syncInteger(row.revision):row.revision!==null)||(['unknown','revoked'].includes(row.status)?row.createdAt!==null:!syncInteger(row.createdAt)||row.createdAt<1))throw fail();return{...row};
}
async function decode(raw:string,uid:string,guard:()=>void,deps:SyncConflictDeps){try{if(raw.length>20000)throw fail();const header=JSON.parse(raw);if(!header||Object.keys(header).sort().join(',')!=='enc,revision,uid,v'||header.v!==1||header.uid!==uid||typeof header.revision!=='string'||!isEncryptedMemoryEnvelope(header.enc))throw fail();const text=(await deps.decrypt(header.enc)).text;guard();if(text.length>10000)throw fail();const body=JSON.parse(text);if(!body||Object.keys(body).sort().join(',')!=='request,uid,v'||body.v!==1||body.uid!==uid)throw fail();const request=parseSyncConflictRequest(body.request);if(header.revision!==request.operationId||request.baseline.ownerUid!==uid)throw fail();return request;}catch{guard();throw fail();}}
async function operate(uid:string,mode:'start'|'recover'|'cancel',target:SyncConflictTarget|undefined,outer:()=>void,deps:SyncConflictDeps){
  const captured=target?parseSyncConflictTarget(structuredClone(target)):undefined;if(mode==='start'&&!deps.enabled())throw fail();
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(syncConflictCheckpointKey(uid),async()=>{
    const key=syncConflictCheckpointKey(uid),scope=()=>{outer();context.assertCurrent();};scope();let bytes=deps.storage.getItem(key);const guard=()=>{scope();if(deps.storage.getItem(key)!==bytes)throw fail();};let request:SyncConflictRequest;
    if(bytes!==null){if(mode==='start')throw fail();request=await decode(bytes,uid,guard,deps);guard();}
    else{if(mode!=='start'||!captured)throw fail();const baseline=parseSyncConflictBase(await deps.call('prepare',{actorUid:uid,request:captured}));guard();if(baseline.ownerUid!==uid||baseline.conflictId!==captured.conflictId||baseline.originalId!==captured.originalId||baseline.action!==captured.action)throw fail();request=parseSyncConflictRequest({operationId:deps.id(),baseline});const enc=await deps.encrypt({text:JSON.stringify({v:1,uid,request})});guard();const next=JSON.stringify({v:1,uid,revision:request.operationId,enc});if(syncConflictRequestBytes(await decode(next,uid,guard,deps))!==syncConflictRequestBytes(request))throw fail();guard();deps.storage.setItem(key,next);bytes=next;guard();notify();}
    const digest=await hash(syncConflictRequestBytes(request));guard();const call=async(mode:SyncConflictCall)=>{guard();const result=await deps.call(mode,{actorUid:uid,request});guard();return outcome(result,request,digest);};let result=await call('status');
    if(result.status==='unknown'){if(mode!=='cancel'&&!deps.enabled())throw fail();result=await call(mode==='cancel'?'cancel':'apply');}if(result.status==='unknown')throw fail();const confirmed=await call('status');if(canonicalSyncState(result)!==canonicalSyncState(confirmed))throw fail();guard();deps.storage.removeItem(key);bytes=null;guard();notify();return confirmed;
  }),deps.mutation);
}
export async function resolvePersonalSyncConflict(input:{uid:string}&SyncConflictTarget,guard:()=>void=()=>{},deps=defaults()){const {uid,...target}=input;const result=await operate(uid,'start',target,guard,deps);if(result.status!=='committed')throw fail();return result;}
export const recoverSyncConflict=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,'recover',undefined,guard,deps);
export const cancelSyncConflict=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,'cancel',undefined,guard,deps);
