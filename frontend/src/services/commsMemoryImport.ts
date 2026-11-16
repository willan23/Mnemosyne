import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {PERSONAL_MEMORY_CREATION_ENABLED,ATTACHMENT_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {buildEncryptedMemoryFields,encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {cognitiveEngine} from '../engines/CognitiveEngine';
import {semanticCandidateEligibility} from './semanticCandidateCapture';
import {withSemanticCandidates} from './semanticCandidateOperations';
import {getLocalAiConfig,type MemoryPermission} from './localAiConfig';
import {preparePersonalAttachment,validatePreparedPersonalAttachment,resumeEncryptedAttachmentUpload,forgetPreparedPersonalAttachment,cancelPreparedPersonalAttachment,type PreparedPersonalAttachment} from './attachmentUploadClient';
import {maxUploadBytesForFile} from '../utils/fileTypes';
import {attachmentActorIdValid,attachmentIdValid,parseAttachmentHeader} from '../../../functions/src/attachmentEnvelope';
import {canonicalAttachedMemoryJson,parseAttachedMemoryInput,type AttachedMemoryInput} from '../../../functions/src/attachedMemoryContract';
import type {SessionData} from '../hooks/useSessions';

export interface CommsReceivedAttachment{name:string;type:string;size:number;dataUrl:string}
export interface CommsMemoryInput{text:string;title:string;attachment:CommsReceivedAttachment|null}
export class CommsMemoryImportError extends Error{
  constructor(){super('A importação aguarda confirmação. Recupera ou cancela a operação pendente antes de repetir.');}
}
export interface CommsImportDeps{
  enabled:(attachment:boolean)=>boolean;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;id:()=>string;now:()=>number;
  exclusive:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;policy:()=>MemoryPermission;subscribePolicy:(changed:()=>void)=>()=>void;
  encryptJournal:typeof encryptMemoryFields;decryptJournal:typeof decryptMemoryEnvelope;encryptContent:typeof buildEncryptedMemoryFields;process:typeof cognitiveEngine.processMemory;
  prepareUpload:typeof preparePersonalAttachment;validateUpload:typeof validatePreparedPersonalAttachment;resumeUpload:(uid:string,upload:PreparedPersonalAttachment,guard:()=>void)=>Promise<{status:'ready'|'cancelled'}>;
  forgetUpload:typeof forgetPreparedPersonalAttachment;cancelUpload:typeof cancelPreparedPersonalAttachment;
  call:(mode:'apply'|'status'|'cancel',request:AttachedMemoryInput)=>Promise<unknown>;mutation?:PersonalMemoryMutationDeps;
}
const defaults=():CommsImportDeps=>({enabled:attached=>attached?ATTACHMENT_WRITES_ENABLED:PERSONAL_MEMORY_CREATION_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),now:Date.now,exclusive:withClipCaptureLock,
  policy:()=>getLocalAiConfig().memoryPermission,subscribePolicy:changed=>{window.addEventListener('mnemosyne:local-ai-config',changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener('mnemosyne:local-ai-config',changed);window.removeEventListener('storage',changed);};},
  encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,encryptContent:buildEncryptedMemoryFields,process:(...args)=>cognitiveEngine.processMemory(...args),
  prepareUpload:preparePersonalAttachment,validateUpload:validatePreparedPersonalAttachment,resumeUpload:(uid,upload,guard)=>resumeEncryptedAttachmentUpload(uid,upload.id,undefined,guard,upload),forgetUpload:forgetPreparedPersonalAttachment,cancelUpload:cancelPreparedPersonalAttachment,
  call:async(mode,request)=>(await httpsCallable(getFunctions(app,'europe-west1'),mode==='apply'?(request.attachmentIds.length?'createAttachedMemory':'createPersonalMemory'):mode==='status'?'getAttachedMemoryCreationStatus':'cancelAttachedMemoryCreation')(request)).data});
export const commsImportCheckpointKey=(uid:string)=>`mnemosyne:comms-import:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:comms-import-changed',notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingCommsImport(uid:string){try{return localStorage.getItem(commsImportCheckpointKey(uid))!==null;}catch{return true;}}
export function observeCommsImports(callback:()=>void){window.addEventListener(event,callback);window.addEventListener('storage',callback);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};}
const fail=()=>new CommsMemoryImportError();
function object(value:unknown,keys:string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw fail();}
const bytes=(value:string)=>new TextEncoder().encode(value).byteLength;
/** No fetch: only a bounded canonical base64 data URL is accepted as received file bytes. */
export function captureCommsMemory(value:CommsMemoryInput):CommsMemoryInput{
  object(value,['text','title','attachment']);if(typeof value.text!=='string'||!value.text.trim()||bytes(value.text)>250_000||typeof value.title!=='string'||bytes(value.title)>2000)throw fail();
  let attachment:CommsReceivedAttachment|null=null;
  if(value.attachment!==null){const item=value.attachment;object(item,['name','type','size','dataUrl']);
    if(typeof item.name!=='string'||!item.name||bytes(item.name)>1024||Array.from(item.name).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127||char==='/'||char==='\\')||typeof item.type!=='string'||!/^[-a-z0-9.+]+\/[-a-z0-9.+]+$/.test(item.type)||
      !Number.isSafeInteger(item.size)||item.size<1||item.size>Math.min(200*1024*1024,maxUploadBytesForFile(new File([],item.name,{type:item.type})))||typeof item.dataUrl!=='string'||item.dataUrl.length>Math.ceil(item.size/3)*4+512||
      !item.dataUrl.startsWith(`data:${item.type};base64,`))throw fail();
    const payload=item.dataUrl.slice(item.dataUrl.indexOf(',')+1);if(payload.length!==Math.ceil(item.size/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(payload))throw fail();
    attachment={name:item.name,type:item.type,size:item.size,dataUrl:item.dataUrl};
  }
  return{text:value.text,title:value.title,attachment};
}
function fileFromAttachment(item:CommsReceivedAttachment){const payload=item.dataUrl.slice(item.dataUrl.indexOf(',')+1);let decoded:string;try{decoded=atob(payload);}catch{throw fail();}
  if(decoded.length!==item.size||btoa(decoded)!==payload)throw fail();const data=Uint8Array.from(decoded,char=>char.charCodeAt(0));try{return new File([data],item.name,{type:item.type});}finally{data.fill(0);}}
interface Journal{v:1;uid:string;request:AttachedMemoryInput;upload:PreparedPersonalAttachment|null}
function parseJournal(value:unknown,uid:string):Journal{
  object(value,['v','uid','request','upload']);if(value.v!==1||value.uid!==uid)throw fail();const request=parseAttachedMemoryInput(value.request);
  const learning=request.metadata.learning as Record<string,unknown>|undefined;
  if(request.teamId!==null||request.keyEpoch!==null||request.keyId!==null||request.attachmentIds.length>1||!Array.isArray(request.metadata.connections)||request.metadata.connections.length||request.metadata.parentId!==null||
    !learning||learning.source!=='comms-import'||learning.batchId!==request.sessionId)throw fail();
  let upload:PreparedPersonalAttachment|null=null;
  if(value.upload!==null){object(value.upload,['id','header','bytesDigest']);const header=parseAttachmentHeader(value.upload.header);
    if(value.upload.id!==header.id||header.uid!==uid||header.scope.kind!=='personal'||header.scope.uid!==uid||typeof value.upload.bytesDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.upload.bytesDigest)||request.attachmentIds.length!==1||request.attachmentIds[0]!==header.id)throw fail();
    upload={id:header.id,header,bytesDigest:value.upload.bytesDigest};
  }else if(request.attachmentIds.length)throw fail();
  return{v:1,uid,request,upload};
}
export interface CommsImportOutcome{sessionId:string;digest:string;status:'unknown'|'committed'|'cancelled';createdAt:number|null}
async function digest(request:AttachedMemoryInput){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalAttachedMemoryJson(request)))),b=>b.toString(16).padStart(2,'0')).join('');}
function outcome(value:unknown,request:AttachedMemoryInput,hash:string):CommsImportOutcome{
  object(value,['sessionId','digest','status','createdAt']);if(value.sessionId!==request.sessionId||value.digest!==hash||!['unknown','committed','cancelled'].includes(value.status as string)||
    (value.status==='unknown'?value.createdAt!==null:!Number.isSafeInteger(value.createdAt)||(value.createdAt as number)<1))throw fail();return {...value} as unknown as CommsImportOutcome;
}
async function prepare(uid:string,input:CommsMemoryInput,existing:readonly SessionData[],guard:()=>void,deps:CommsImportDeps):Promise<Journal>{
  const sessionId=deps.id(),attachmentId=input.attachment?deps.id():null,now=deps.now();guard();
  if(!attachmentIdValid(sessionId)||attachmentId!==null&&!attachmentIdValid(attachmentId)||!Number.isSafeInteger(now)||now<1)throw fail();
  const file=input.attachment?fileFromAttachment(input.attachment):null;guard();
  let semantic:Awaited<ReturnType<typeof cognitiveEngine.processMemory>>|null=null;
  try{semantic=await withSemanticCandidates(existing,{assertCurrent:guard,eligible:semanticCandidateEligibility(uid)},(candidates,current)=>deps.process(input.text,candidates,{assertCurrent:current}));}catch{guard();console.warn('Não foi possível enriquecer a memória recebida localmente.');}guard();
  const enc=(await deps.encryptContent(input.text,input.title||null)).enc;guard();let upload:PreparedPersonalAttachment|null=null;
  if(file){upload=await deps.prepareUpload({uid,file,id:attachmentId!},guard);guard();}
  return parseJournal({v:1,uid,upload,request:{sessionId,teamId:null,keyEpoch:null,keyId:null,enc,attachmentIds:upload?[upload.id]:[],metadata:{
    tags:['auto-learned','comms-import'],category:'Comms',connections:[],parentId:null,embedding:semantic?.embedding??null,embeddingModel:semantic?.embeddingModel??null,
    semanticClusterId:semantic?.semanticClusterId??null,position:semantic?.position??null,importance:semantic?.importance??.55,celestialType:semantic?.celestialType??null,
    processingMethod:semantic?'learned:comms-import+local-embedding':'learned:comms-import',learning:{schemaVersion:1,source:'comms-import',modality:input.attachment?'mixed':'text',learnedAt:now,batchId:sessionId,attachmentCount:upload?1:0}}}},uid);
}
async function operate(uid:string,mode:'start'|'recover'|'cancel',input:CommsMemoryInput|undefined,existing:readonly SessionData[],outer:()=>void,deps:CommsImportDeps):Promise<CommsImportOutcome>{
  if(!attachmentActorIdValid(uid)||mode==='start'&&(!input||!deps.enabled(Boolean(input.attachment))))throw fail();const policy=deps.policy();
  if(!['never-cloud','confirm-cloud','allow-cloud'].includes(policy)||mode==='start'&&input?.attachment&&policy==='never-cloud')throw fail();
  let changed=false;const stop=deps.subscribePolicy(()=>{changed=true;});
  try{return await withPersonalMemoryMutation(uid,context=>deps.exclusive(commsImportCheckpointKey(uid),async()=>{
    const key=commsImportCheckpointKey(uid),stored=()=>{try{return deps.storage.getItem(key);}catch{throw fail();}};let raw=stored();
    const guard=()=>{context.assertCurrent();outer();if(changed||deps.policy()!==policy||stored()!==raw)throw fail();};guard();let journal:Journal;
    if(raw!==null){if(mode==='start'||raw.length>1_100_000)throw fail();const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw fail();
      const text=(await deps.decryptJournal(envelope)).text;guard();if(bytes(text)>550_000)throw fail();journal=parseJournal(JSON.parse(text),uid);
    }else{
      if(mode!=='start'||!input)throw fail();journal=await prepare(uid,input,existing,guard,deps);guard();const text=JSON.stringify(journal);if(bytes(text)>550_000)throw fail();
      const encrypted=await deps.encryptJournal({text});guard();if(!isEncryptedMemoryEnvelope(encrypted))throw fail();const next=JSON.stringify(encrypted);if(next.length>1_100_000)throw fail();
      try{deps.storage.setItem(key,next);raw=next;if(stored()!==raw)throw fail();}catch{throw fail();}guard();notify();guard();
    }
    if(mode==='start'&&journal.upload){await deps.validateUpload(uid,journal.upload,guard);guard();}
    const request=journal.request,hash=await digest(request);guard();const read=async()=>{const result=outcome(await deps.call('status',request),request,hash);guard();return result;};let result=await read();
    if(result.status==='unknown'){
      if(mode==='cancel'){result=outcome(await deps.call('cancel',request),request,hash);guard();}
      else{if(!deps.enabled(Boolean(journal.upload)))throw fail();if(journal.upload){if(policy==='never-cloud')throw fail();await deps.validateUpload(uid,journal.upload,guard);guard();
        if((await deps.resumeUpload(uid,journal.upload,guard)).status!=='ready')throw fail();guard();}
        if(!deps.enabled(Boolean(journal.upload)))throw fail();result=outcome(await deps.call('apply',request),request,hash);guard();}
    }
    if(result.status==='unknown')throw fail();const confirmed=await read();if(canonicalAttachedMemoryJson(confirmed)!==canonicalAttachedMemoryJson(result))throw fail();
    if(journal.upload){await(result.status==='committed'?deps.forgetUpload:deps.cancelUpload)(uid,journal.upload,guard);guard();}
    const after=await read();if(canonicalAttachedMemoryJson(after)!==canonicalAttachedMemoryJson(confirmed))throw fail();
    try{guard();deps.storage.removeItem(key);raw=null;if(stored()!==null)throw fail();}catch{throw fail();}guard();notify();guard();return after;
  }),deps.mutation);}finally{stop();}
}
export async function importCommsMemory(uid:string,input:CommsMemoryInput,existing:readonly SessionData[]=[],outer:()=>void=()=>{},deps=defaults()){
  const captured=captureCommsMemory(input);outer();const result=await operate(uid,'start',captured,existing,outer,deps);if(result.status!=='committed')throw fail();return{id:result.sessionId};
}
export const recoverPendingCommsImport=(uid:string,deps=defaults())=>operate(uid,'recover',undefined,[],()=>{},deps);
export const cancelPendingCommsImport=(uid:string,deps=defaults())=>operate(uid,'cancel',undefined,[],()=>{},deps);
