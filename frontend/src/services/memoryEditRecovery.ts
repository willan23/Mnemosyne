import {doc,getDocFromServer} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import app,{auth,db} from '../firebase';
import {TEAM_WRITES_ENABLED,PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {buildEncryptedMemoryFields,encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {encryptTeamMemoryFields,decryptTeamMemoryEnvelope,getTeamKeyCacheGeneration,onTeamKeyChanged} from './teamVault';
import {unlockTeamKey} from './teamKeyAccess';
import {parseTeam} from './teamsService';
import {readSessionMnemonic} from '../utils/sessionMnemonic';
import {canonicalSyncState,syncHashValid} from '../../../functions/src/mobileSyncImportContract';
import {parseTeamRevisionCipher,teamRevisionTime} from '../../../functions/src/teamRevisionContract';
import {MEMORY_EDIT_MAX_BYTES,MEMORY_EDIT_METADATA_FIELDS,memoryEditRequestBytes,parseMemoryEditBaseline,parseMemoryEditTarget,parseMemoryEditRequest,parseMemoryEditMetadata,type MemoryEditBaseline,type MemoryEditRequest,type MemoryEditOutcome} from '../../../functions/src/memoryEditContract';
export type {MemoryEditBaseline};
export class MemoryEditError extends Error{readonly reason:'baseline'|'closed'|'pending'|'checkpoint'|'confirmation';constructor(reason:MemoryEditError['reason']){super(reason==='baseline'?'A memória ou o acesso mudou desde que a edição foi aberta. O rascunho foi conservado.':reason==='closed'?'Esta alteração de memória está em validação antes do lançamento.':'A alteração de memória aguarda confirmação. Recupera ou cancela o pedido; conserva o rascunho.');this.reason=reason;}}
export interface MemoryEditContent{text:string;title:string|null;metadata:Record<string,unknown>}
export interface MemoryEditDeps{
  enabled:(kind:'personal'|'team')=>boolean;storage:Storage;id:()=>string;exclusive:typeof withClipCaptureLock;mutation?:PersonalMemoryMutationDeps;
  read:(id:string)=>Promise<Record<string,unknown>|undefined>;key:(base:MemoryEditBaseline,prior:boolean,guard:()=>void)=>Promise<CryptoKey|null>;
  encryptJournal:typeof encryptMemoryFields;decryptJournal:typeof decryptMemoryEnvelope;encryptPersonal:typeof buildEncryptedMemoryFields;decryptPersonal:typeof decryptMemoryEnvelope;encryptTeam:typeof encryptTeamMemoryFields;decryptTeam:typeof decryptTeamMemoryEnvelope;
  call:(mode:'prepare'|'apply'|'status'|'cancel',command:{actorUid:string;request:unknown})=>Promise<unknown>;generation:()=>number;observe:(uid:string,changed:()=>void)=>()=>void;
}
export const memoryEditCheckpointKey=(uid:string)=>`mnemosyne:memory-edit:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:memory-edit-changed',notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingMemoryEdit(uid:string){try{return localStorage.getItem(memoryEditCheckpointKey(uid))!==null;}catch{return true;}}
export function observeMemoryEdits(callback:()=>void,owner:()=>string|null=()=>auth.currentUser?.uid??null){const storage=(value:StorageEvent)=>{const uid=owner();if(uid&&(value.key===null||value.key===memoryEditCheckpointKey(uid)))callback();};window.addEventListener(event,callback);window.addEventListener('storage',storage);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',storage);};}
const defaults=():MemoryEditDeps=>({enabled:kind=>kind==='team'?TEAM_WRITES_ENABLED:PERSONAL_REVISION_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,read:async id=>(await getDocFromServer(doc(db,'sessions',id))).data(),
  key:async(base,prior,guard)=>{if(base.kind==='personal')return null;const uid=auth.currentUser?.uid,words=readSessionMnemonic();if(!uid||!words)throw new MemoryEditError('baseline');const team=parseTeam(base.teamId!,(await getDocFromServer(doc(db,'teams',base.teamId!))).data()??{});guard();if(!team||team.activeKeyEpoch!==base.keyEpoch||team.activeKeyId!==base.keyId)throw new MemoryEditError('baseline');return unlockTeamKey(team,uid,[...words],{epoch:(prior?base.priorKeyEpoch:base.keyEpoch)!,notify:false,isCurrent:()=>{guard();return true;}});},
  encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,encryptPersonal:buildEncryptedMemoryFields,decryptPersonal:decryptMemoryEnvelope,encryptTeam:encryptTeamMemoryFields,decryptTeam:decryptTeamMemoryEnvelope,generation:getTeamKeyCacheGeneration,
  call:async(mode,command)=>{const names={prepare:'prepareMemoryEdit',apply:'applyMemoryEdit',status:'getMemoryEditStatus',cancel:'cancelMemoryEdit'};return(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(command)).data;},
  observe:(uid,changed)=>{const stop=onTeamKeyChanged(changed),listener=(value:StorageEvent)=>{if(value.key===null||value.key===memoryEditCheckpointKey(uid))changed();};window.addEventListener('storage',listener);return()=>{stop();window.removeEventListener('storage',listener);};},
});
export const memoryEditDependencies = defaults;
export const memoryEditStateDigest=async(value:Record<string,unknown>)=>hash(canonicalSyncState(value));
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const fail=(reason:MemoryEditError['reason']='checkpoint')=>new MemoryEditError(reason);
async function scoped<T>(uid:string,outer:()=>void,deps:MemoryEditDeps,work:(guard:()=>void)=>Promise<T>){return withPersonalMemoryMutation(uid,context=>{const generation=deps.generation();let changed=false;const stop=deps.observe(uid,()=>{changed=true;});const guard=()=>{outer();context.assertCurrent();if(changed||deps.generation()!==generation)throw fail('baseline');};try{guard();return work(guard).finally(stop);}catch(error){stop();throw error;}},deps.mutation);}
export { scoped as withMemoryEditCryptoScope };
async function readBaseline(uid:string,target:{sessionId:string;teamId:string|null},guard:()=>void,deps:MemoryEditDeps){
  const before=await deps.read(target.sessionId);guard();if(!before||before.teamId!==target.teamId||before.deletedAt!=null||before.teamScopeAmbiguous===true||['nodes','links','generatedPrompt','generatedImagePrompt'].some(key=>before[key]!=null))throw fail('baseline');const digest=await memoryEditStateDigest(before);guard();
  const baseline=parseMemoryEditBaseline(await deps.call('prepare',{actorUid:uid,request:target}));guard();if(baseline.sessionId!==target.sessionId||baseline.teamId!==target.teamId||baseline.authorUid!==before.uid||baseline.stateDigest!==digest||baseline.revision!==teamRevisionTime(before.updatedAt??before.timestamp))throw fail('baseline');
  if(baseline.kind==='personal'&&baseline.authorUid!==uid||baseline.kind==='team'&&(baseline.priorKeyEpoch!==(before.keyEpoch??1)||baseline.priorKeyId!==(before.keyId??null)))throw fail('baseline');return{before,baseline};
}
async function originalFields(before:Record<string,unknown>,base:MemoryEditBaseline,guard:()=>void,deps:MemoryEditDeps){
  if(before.enc==null){if(base.kind!=='personal'||typeof before.text!=='string'||before.title!=null&&typeof before.title!=='string')throw fail('baseline');return{text:before.text,title:before.title as string|null??null};}
  const enc=parseTeamRevisionCipher(before.enc);if(before.text!==''||before.title!=null)throw fail('baseline');if(base.kind==='personal'){if(enc.v!==1)throw fail('baseline');const fields=await deps.decryptPersonal(enc as Parameters<typeof decryptMemoryEnvelope>[0]);guard();return fields;}
  const key=await deps.key(base,true,guard);guard();if(!key)throw fail('baseline');const fields=await deps.decryptTeam(key,enc,{teamId:base.teamId!,keyEpoch:base.priorKeyEpoch!,keyId:base.priorKeyId??base.keyId!},{strictPayload:true});guard();return fields;
}
export async function captureMemoryEditBaseline(input:{uid:string;id:string;teamId:string|null;viewDigest:string;expected:{text:string;title:string|null;authorUid:string};assertCurrent?:()=>void},deps=defaults()):Promise<MemoryEditBaseline>{
  const captured={...input,expected:{...input.expected}},target=parseMemoryEditTarget({sessionId:captured.id,teamId:captured.teamId});if(!syncHashValid(captured.viewDigest))throw fail('baseline');
  return scoped(captured.uid,()=>captured.assertCurrent?.(),deps,async guard=>{const read=await readBaseline(captured.uid,target,guard,deps);if(read.baseline.stateDigest!==captured.viewDigest||read.baseline.authorUid!==captured.expected.authorUid)throw fail('baseline');const fields=await originalFields(read.before,read.baseline,guard,deps);guard();if(fields.text!==captured.expected.text||fields.title!==captured.expected.title)throw fail('baseline');return{...read.baseline};});
}
export interface EncryptedMemoryEditReview {
  request: MemoryEditRequest; digest: string; before: MemoryEditContent; after: MemoryEditContent | null;
}
/** Decrypt the immutable ciphertext ourselves; retain the account/key guard through an optional confirmation RPC. */
export async function reviewEncryptedMemoryEdit<T = EncryptedMemoryEditReview>(uid:string,value:unknown,outer:()=>void=()=>{},consume?:(review:EncryptedMemoryEditReview,guard:()=>void)=>Promise<T>,deps=defaults()):Promise<T|EncryptedMemoryEditReview>{
  const request=parseMemoryEditRequest(value);
  return scoped(uid,outer,deps,async guard=>{
    const read=await readBaseline(uid,{sessionId:request.baseline.sessionId,teamId:request.baseline.teamId},guard,deps);
    if(canonicalSyncState(read.baseline)!==canonicalSyncState(request.baseline)||read.before.enc==null||canonicalSyncState(parseTeamRevisionCipher(read.before.enc))!==canonicalSyncState(request.priorEnc))throw fail('baseline');
    const fields=await originalFields(read.before,read.baseline,guard,deps);guard();
    const metadata=structuredClone(Object.fromEntries(MEMORY_EDIT_METADATA_FIELDS.filter(key=>key in read.before).map(key=>[key,read.before[key]])));
    let after:MemoryEditContent|null=null;
    if(request.operation==='edit'){
      if(!request.enc)throw fail('baseline');
      const key=read.baseline.kind==='team'?await deps.key(read.baseline,false,guard):null;guard();
      if(read.baseline.kind==='team'&&!key)throw fail('baseline');
      const next=read.baseline.kind==='personal'?await deps.decryptPersonal(request.enc as Parameters<typeof decryptMemoryEnvelope>[0]):await deps.decryptTeam(key!,request.enc,{teamId:read.baseline.teamId!,keyEpoch:read.baseline.keyEpoch!,keyId:read.baseline.keyId!},{strictPayload:true});guard();
      after={text:next.text,title:next.title??null,metadata:{...metadata,...request.metadata}};
    }
    const review:EncryptedMemoryEditReview={request,digest:await hash(memoryEditRequestBytes(request)),before:{text:fields.text,title:fields.title??null,metadata},after};guard();
    const result=consume?await consume(review,guard):review;guard();return result;
  });
}
function outcome(value:unknown,request:MemoryEditRequest,digest:string):MemoryEditOutcome{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdAt,digest,operation,operationId,revision,sessionId,status,teamId')throw fail('confirmation');const row=value as MemoryEditOutcome;
  if(row.operationId!==request.operationId||row.operation!==request.operation||row.sessionId!==request.baseline.sessionId||row.teamId!==request.baseline.teamId||row.digest!==digest||!['unknown','committed','cancelled','revoked'].includes(row.status)||(row.status==='committed'?teamRevisionTime(row.revision)===null||Number(row.revision)<=request.baseline.revision:row.revision!==null)||(row.status==='unknown'||row.status==='revoked'?row.createdAt!==null:teamRevisionTime(row.createdAt)===null||Number(row.createdAt)<1))throw fail('confirmation');return{...row};
}
async function journal(raw:string,uid:string,guard:()=>void,deps:MemoryEditDeps){try{if(raw.length>3_000_000)throw fail();const enc:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(enc)||Object.keys(enc).sort().join(',')!=='ct,iv,v')throw fail();const text=(await deps.decryptJournal(enc)).text;guard();if(new TextEncoder().encode(text).length>MEMORY_EDIT_MAX_BYTES+1000)throw fail();const row=JSON.parse(text);if(!row||Object.keys(row).sort().join(',')!=='request,uid,v'||row.v!==1||row.uid!==uid)throw fail();return parseMemoryEditRequest(row.request);}catch{guard();throw fail();}}
export interface MemoryEditInput{uid:string;id:string;teamId:string|null;operation:'edit'|'delete';baseline:MemoryEditBaseline;prepare?:(guard:()=>void)=>Promise<MemoryEditContent>;assertCurrent?:()=>void}
async function operate(uid:string,mode:'start'|'recover'|'cancel',input:MemoryEditInput|undefined,outer:()=>void,deps:MemoryEditDeps){
  const captured=input?{...input,baseline:parseMemoryEditBaseline(input.baseline)}:undefined;if(captured&&(captured.id!==captured.baseline.sessionId||captured.teamId!==captured.baseline.teamId||captured.baseline.kind==='personal'&&captured.baseline.authorUid!==uid||captured.operation==='delete'&&captured.baseline.kind==='team'&&captured.baseline.ownerUid!==uid))throw fail('baseline');if(mode==='start'&&(!captured||!deps.enabled(captured.baseline.kind)))throw fail('closed');
  return scoped(uid,()=>{outer();captured?.assertCurrent?.();},deps,scope=>deps.exclusive(memoryEditCheckpointKey(uid),async()=>{
    scope();const key=memoryEditCheckpointKey(uid),stored=()=>deps.storage.getItem(key);let raw=stored();const guard=()=>{scope();if(stored()!==raw)throw fail();};let request:MemoryEditRequest;
    if(raw!==null){if(mode==='start')throw fail('pending');request=await journal(raw,uid,guard,deps);guard();}
    else{if(!captured||mode!=='start')throw fail('pending');const read=await readBaseline(uid,{sessionId:captured.id,teamId:captured.teamId},guard,deps);guard();if(canonicalSyncState(read.baseline)!==canonicalSyncState(captured.baseline))throw fail('baseline');
      const priorEnc=read.before.enc!=null?parseTeamRevisionCipher(read.before.enc):(await deps.encryptPersonal((await originalFields(read.before,read.baseline,guard,deps)).text,read.before.title as string|null??null)).enc;guard();
      let enc:MemoryEditRequest['enc']=null,metadata:Record<string,unknown>={};if(captured.operation==='edit'){if(!captured.prepare)throw fail();const content=structuredClone(await captured.prepare(guard));guard();if(!content||typeof content.text!=='string'||new TextEncoder().encode(content.text).length>500_000||content.title!==null&&(typeof content.title!=='string'||new TextEncoder().encode(content.title).length>2000))throw fail();metadata=parseMemoryEditMetadata(content.metadata);
        if(read.baseline.kind==='personal')enc=(await deps.encryptPersonal(content.text,content.title)).enc;else{const key=await deps.key(read.baseline,false,guard);guard();if(!key)throw fail('baseline');enc=await deps.encryptTeam(key,content,{teamId:read.baseline.teamId!,keyEpoch:read.baseline.keyEpoch!,keyId:read.baseline.keyId!});}guard();
      }
      request=parseMemoryEditRequest({operationId:deps.id(),operation:captured.operation,baseline:captured.baseline,priorEnc,enc,metadata});const next=JSON.stringify(await deps.encryptJournal({text:JSON.stringify({v:1,uid,request})}));guard();if(next.length>3_000_000)throw fail();await journal(next,uid,guard,deps);guard();deps.storage.setItem(key,next);raw=next;guard();notify();guard();
    }
    const digest=await hash(memoryEditRequestBytes(request));guard();const call=async(which:'apply'|'status'|'cancel')=>{guard();const result=outcome(await deps.call(which,{actorUid:uid,request}),request,digest);guard();return result;};
    let result=await call('status');if(result.status==='unknown'){if(mode!=='cancel'&&!deps.enabled(request.baseline.kind))throw fail('pending');result=await call(mode==='cancel'?'cancel':'apply');}if(result.status==='unknown')throw fail('confirmation');const confirmed=await call('status');if(canonicalSyncState(result)!==canonicalSyncState(confirmed))throw fail('confirmation');guard();deps.storage.removeItem(key);raw=null;guard();notify();guard();return confirmed;
  }));
}
export async function applyMemoryEdit(input:MemoryEditInput,deps=defaults()){const result=await operate(input.uid,'start',input,()=>{},deps);if(result.status!=='committed')throw fail('confirmation');return result;}
export async function recoverPendingMemoryEdit(uid:string,outer:()=>void=()=>{},deps=defaults()){return operate(uid,'recover',undefined,outer,deps);}
export async function cancelPendingMemoryEdit(uid:string,outer:()=>void=()=>{},deps=defaults()){return operate(uid,'cancel',undefined,outer,deps);}
