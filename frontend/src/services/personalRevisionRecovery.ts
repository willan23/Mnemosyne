import {doc,getDocFromServer} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import app,{db} from '../firebase';
import {PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import {buildEncryptedMemoryFields,resolveMemoryDocFields,encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {PersonalMemoryMutationError,withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {canonicalSyncState,syncInteger} from '../../../functions/src/mobileSyncImportContract';
import {parsePersonalRevisionTarget,parsePersonalRevisionBaseline,parsePersonalRevisionRequest,personalRevisionRequestBytes,PERSONAL_REVISION_MAX_BYTES,
  type PersonalRevisionBaseline,type PersonalRevisionMetadata,type PersonalRevisionRequest,type PersonalRevisionOutcome} from '../../../functions/src/personalRevisionContract';
export type {PersonalRevisionBaseline};
export interface PersonalRevisionContent extends PersonalRevisionMetadata {text:string;title:string|null}
export class PersonalRevisionError extends Error {
  readonly reason:'closed'|'baseline'|'pending'|'storage'|'checkpoint'|'confirmation';
  constructor(reason:PersonalRevisionError['reason']){super(reason==='closed'?'A revisão recuperável está em validação antes do lançamento.':reason==='baseline'?'A memória mudou desde que o rascunho foi aberto. Atualiza a vista antes de rever.':'A revisão aguarda confirmação. Recupera ou cancela a operação pendente antes de repetir.');this.reason=reason;}
}
export interface PersonalRevisionDeps {
  enabled:()=>boolean;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;id:()=>string;exclusive:<T>(name:string,work:()=>Promise<T>)=>Promise<T>;
  read:(id:string)=>Promise<Record<string,unknown>|undefined>;encryptJournal:typeof encryptMemoryFields;decryptJournal:typeof decryptMemoryEnvelope;
  encryptContent:typeof buildEncryptedMemoryFields;call:(mode:'prepare'|'apply'|'status'|'cancel',request:{sessionId:string}|PersonalRevisionRequest)=>Promise<unknown>;
  mutation?:PersonalMemoryMutationDeps;
}
const names={prepare:'preparePersonalRevision',apply:'applyPersonalRevision',status:'getPersonalRevisionStatus',cancel:'cancelPersonalRevision'};
const defaults=():PersonalRevisionDeps=>({enabled:()=>PERSONAL_REVISION_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,
  read:async id=>(await getDocFromServer(doc(db,'sessions',id))).data(),encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,encryptContent:buildEncryptedMemoryFields,
  call:async(mode,request)=>(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(request)).data});
export const personalRevisionCheckpointKey=(uid:string)=>`mnemosyne:personal-revision:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:personal-revision-changed';const notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingPersonalRevision(uid:string){try{return localStorage.getItem(personalRevisionCheckpointKey(uid))!==null;}catch{return true;}}
export function observePersonalRevisions(callback:()=>void){window.addEventListener(event,callback);window.addEventListener('storage',callback);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};}
const hash=async(bytes:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bytes))),byte=>byte.toString(16).padStart(2,'0')).join('');
function personal(before:Record<string,unknown>|undefined,uid:string):asserts before is Record<string,unknown>{
  if(!before||before.uid!==uid||before.teamId!==null||before.teamScopeAmbiguous===true||before.deletedAt!=null||
    (before.sharedWithIds!=null&&(!Array.isArray(before.sharedWithIds)||before.sharedWithIds.length!==0))||!syncInteger(before.timestamp)||!syncInteger(before.updatedAt??before.timestamp)||
    (before.learning!=null&&(typeof before.learning!=='object'||Array.isArray(before.learning))))throw new PersonalMemoryMutationError();
}
async function readBaseline(uid:string,id:string,guard:()=>void,deps:PersonalRevisionDeps){
  parsePersonalRevisionTarget({sessionId:id});const before=await deps.read(id);guard();personal(before,uid);
  const digest=await hash(canonicalSyncState(before));guard();const baseline=parsePersonalRevisionBaseline(await deps.call('prepare',{sessionId:id}));guard();
  if(baseline.sessionId!==id||baseline.stateDigest!==digest||baseline.revision!==(before.updatedAt??before.timestamp))throw new PersonalRevisionError('baseline');
  const previous=await resolveMemoryDocFields(before);guard();if(previous.locked||(before.enc!=null&&!previous.encrypted))throw new PersonalMemoryMutationError();
  return{before,baseline,previous};
}
/** Capture while opening the editable result; never silently adopt a later document as its baseline. */
export async function capturePersonalRevisionBaseline(input:{uid:string;id:string;expected?:{text:string;title:string|null};assertCurrent?:()=>void},injected?:PersonalRevisionDeps):Promise<PersonalRevisionBaseline>{
  const captured={...input,expected:input.expected?{...input.expected}:undefined};const expected=captured.expected;const deps=injected??defaults();
  return withPersonalMemoryMutation(captured.uid,async context=>{const guard=()=>{context.assertCurrent();captured.assertCurrent?.();};guard();const read=await readBaseline(captured.uid,captured.id,guard,deps);guard();
    if(expected&&(read.previous.text!==expected.text||read.previous.title!==expected.title))throw new PersonalRevisionError('baseline');return{...read.baseline};
  },deps.mutation);
}
function outcome(value:unknown,request:PersonalRevisionRequest,digest:string):PersonalRevisionOutcome{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdAt,digest,operationId,revision,sessionId,status')throw new PersonalRevisionError('confirmation');
  const data=value as PersonalRevisionOutcome;if(data.operationId!==request.operationId||data.sessionId!==request.baseline.sessionId||data.digest!==digest||!['unknown','committed','cancelled'].includes(data.status)||
    (data.status==='committed'?(!syncInteger(data.revision)||data.revision<=request.baseline.revision):data.revision!==null)||
    (data.status==='unknown'?data.createdAt!==null:!syncInteger(data.createdAt)||data.createdAt<1))throw new PersonalRevisionError('confirmation');return{...data};
}
async function readJournal(raw:string,uid:string,guard:()=>void,deps:PersonalRevisionDeps){
  try{if(raw.length>6_000_000)throw Error();const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw Error();
    const text=(await deps.decryptJournal(envelope)).text;guard();if(new TextEncoder().encode(text).byteLength>PERSONAL_REVISION_MAX_BYTES+1000)throw Error();const journal=JSON.parse(text);
    if(!journal||typeof journal!=='object'||Array.isArray(journal)||Object.keys(journal).sort().join(',')!=='request,uid,v'||journal.v!==1||journal.uid!==uid)throw Error();return parsePersonalRevisionRequest(journal.request);
  }catch{guard();throw new PersonalRevisionError('checkpoint');}
}
type RevisionInput={uid:string;id:string;baseline:PersonalRevisionBaseline;prepare:(assertCurrent:()=>void)=>Promise<PersonalRevisionContent>;assertCurrent?:()=>void};
async function operate(uid:string,mode:'start'|'recover'|'cancel',input:RevisionInput|undefined,injected?:PersonalRevisionDeps):Promise<PersonalRevisionOutcome>{
  const deps=injected??defaults();if(mode==='start'&&!deps.enabled())throw new PersonalRevisionError('closed');
  const captured=input?{...input,baseline:parsePersonalRevisionBaseline(input.baseline)}:undefined;
  if(captured&&captured.baseline.sessionId!==captured.id)throw new PersonalRevisionError('baseline');
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(personalRevisionCheckpointKey(uid),async()=>{
    const key=personalRevisionCheckpointKey(uid),scope=()=>{context.assertCurrent();captured?.assertCurrent?.();};scope();
    const stored=()=>{try{return deps.storage.getItem(key);}catch{throw new PersonalRevisionError('storage');}};let raw=stored();
    const guard=()=>{scope();if(stored()!==raw)throw new PersonalRevisionError('checkpoint');};let request:PersonalRevisionRequest;
    if(raw!==null){if(mode==='start')throw new PersonalRevisionError('pending');request=await readJournal(raw,uid,guard,deps);guard();}
    else{
      if(mode!=='start'||!captured)throw new PersonalRevisionError('pending');const operationId=deps.id();guard();
      const read=await readBaseline(uid,captured.id,guard,deps);guard();if(canonicalSyncState(read.baseline)!==canonicalSyncState(captured.baseline))throw new PersonalRevisionError('baseline');
      const content=structuredClone(await captured.prepare(guard));guard();if(!content||typeof content.text!=='string'||new TextEncoder().encode(content.text).byteLength>500_000||
        (content.title!==null&&(typeof content.title!=='string'||new TextEncoder().encode(content.title).byteLength>2000)))throw new PersonalRevisionError('checkpoint');
      const encrypted=await deps.encryptContent(content.text,content.title);guard();
      const priorEnc=read.before.enc!=null?structuredClone(read.before.enc):(await deps.encryptContent(read.previous.text,read.previous.title)).enc;guard();
      request=parsePersonalRevisionRequest({operationId,baseline:captured.baseline,enc:encrypted.enc,priorEnc,metadata:{embedding:content.embedding,embeddingModel:content.embeddingModel,semanticClusterId:content.semanticClusterId,position:content.position,importance:content.importance,processingMethod:content.processingMethod}});
      const sealed=await deps.encryptJournal({text:JSON.stringify({v:1,uid,request})});guard();if(!isEncryptedMemoryEnvelope(sealed))throw new PersonalRevisionError('checkpoint');const next=JSON.stringify(sealed);if(next.length>6_000_000)throw new PersonalRevisionError('checkpoint');
      try{deps.storage.setItem(key,next);raw=next;if(stored()!==raw)throw Error();}catch{throw new PersonalRevisionError('storage');}guard();notify();guard();
    }
    const digest=await hash(personalRevisionRequestBytes(request));guard();
    const read=async()=>{const value=outcome(await deps.call('status',request),request,digest);guard();return value;};let result=await read();
    if(result.status==='unknown'){
      if(mode!=='cancel'&&!deps.enabled())throw new PersonalRevisionError('pending');result=outcome(await deps.call(mode==='cancel'?'cancel':'apply',request),request,digest);guard();if(result.status==='unknown')throw new PersonalRevisionError('confirmation');
    }
    const confirmed=await read();if(canonicalSyncState(result)!==canonicalSyncState(confirmed))throw new PersonalRevisionError('confirmation');
    try{guard();deps.storage.removeItem(key);raw=null;if(stored()!==null)throw Error();}catch{throw new PersonalRevisionError('storage');}guard();notify();guard();return confirmed;
  }),deps.mutation);
}
export async function revisePersonalLearnedMemory(input:RevisionInput,deps?:PersonalRevisionDeps){const result=await operate(input.uid,'start',input,deps);if(result.status!=='committed')throw new PersonalRevisionError('confirmation');return result;}
export const recoverPendingPersonalRevision=(uid:string,deps?:PersonalRevisionDeps)=>operate(uid,'recover',undefined,deps);
export const cancelPendingPersonalRevision=(uid:string,deps?:PersonalRevisionDeps)=>operate(uid,'cancel',undefined,deps);
