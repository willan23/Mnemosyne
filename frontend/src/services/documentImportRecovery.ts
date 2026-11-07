import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {DOCUMENT_IMPORT_WRITES_ENABLED} from '../config/releaseGates';
import {decryptMemoryEnvelope,encryptMemoryFields,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {hasPendingPersonalConnection} from './personalConnections';
import {resumeEncryptedAttachmentUpload,validatePreparedPersonalAttachment,forgetPreparedPersonalAttachment,cancelPreparedPersonalAttachment,type PreparedPersonalAttachment} from './attachmentUploadClient';
import {parseAttachmentHeader,encodeAttachmentHeader} from '../../../functions/src/attachmentEnvelope';
import {attachmentBytesDigest} from './attachmentUploadCheckpoint';
import {getLocalAiConfig,type MemoryPermission} from './localAiConfig';
import {documentPlanBytes,documentPlanBatches,parseDocumentImportPlan,type DocumentImportPlan,type DocumentImportStatus,type DocumentImportIdentity,type DocumentImportBatch} from '../../../functions/src/documentImportContract';
export interface DocumentImportResult{batchId:string;imported:number;hubId:string}

export class DocumentImportRecoveryError extends Error{
  readonly reason:'closed'|'pending'|'storage'|'checkpoint'|'confirmation';
  constructor(reason:DocumentImportRecoveryError['reason']){
    super(reason==='closed'?'A importação recuperável está em validação antes do lançamento.':'A importação aguarda confirmação. Recupera ou cancela o lote pendente antes de repetir.');this.reason=reason;
  }
}
export interface CapturedDocumentImport{plan:DocumentImportPlan;result:DocumentImportResult;uploads:PreparedPersonalAttachment[]}
export interface DocumentImportRecoveryDeps{
  enabled:()=>boolean;blocked:()=>boolean;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
  exclusive:<T>(name:string,work:()=>Promise<T>)=>Promise<T>;encryptJournal:typeof encryptMemoryFields;decryptJournal:typeof decryptMemoryEnvelope;
  call:(mode:'begin'|'apply'|'status'|'cancel',request:DocumentImportPlan|DocumentImportBatch|DocumentImportIdentity)=>Promise<unknown>;
  validateUpload:(uid:string,upload:PreparedPersonalAttachment,guard:()=>void)=>Promise<unknown>;
  resumeUpload:(uid:string,upload:PreparedPersonalAttachment,guard:()=>void)=>Promise<{status:'ready'|'cancelled'}>;
  cancelUpload:(uid:string,upload:PreparedPersonalAttachment,guard:()=>void)=>Promise<unknown>;
  forgetUpload:(uid:string,upload:PreparedPersonalAttachment,guard:()=>void)=>Promise<unknown>;
  policy?:()=>MemoryPermission; subscribePolicy?:(changed:()=>void)=>()=>void;
  mutation?:PersonalMemoryMutationDeps;
}
const names={begin:'beginDocumentImport',apply:'applyDocumentImportBatch',status:'getDocumentImportStatus',cancel:'cancelDocumentImport'};
const defaults=(uid:string):DocumentImportRecoveryDeps=>({enabled:()=>DOCUMENT_IMPORT_WRITES_ENABLED,blocked:()=>hasPendingPersonalConnection(uid),storage:localStorage,exclusive:withClipCaptureLock,
  policy:()=>getLocalAiConfig().memoryPermission,subscribePolicy:changed=>{window.addEventListener('mnemosyne:local-ai-config',changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener('mnemosyne:local-ai-config',changed);window.removeEventListener('storage',changed);};},
  validateUpload:validatePreparedPersonalAttachment,resumeUpload:(uid,upload,guard)=>resumeEncryptedAttachmentUpload(uid,upload.id,undefined,guard,upload),
  cancelUpload:cancelPreparedPersonalAttachment,forgetUpload:forgetPreparedPersonalAttachment,
  encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,call:async(mode,request)=>(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(request)).data});
export const documentImportCheckpointKey=(uid:string)=>`mnemosyne:document-import:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:document-import-changed';const notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingDocumentImport(uid:string){try{return localStorage.getItem(documentImportCheckpointKey(uid))!==null;}catch{return true;}}
export function observeDocumentImports(callback:()=>void){window.addEventListener(event,callback);window.addEventListener('storage',callback);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};}
export function assertDocumentImportWrites(enabled=DOCUMENT_IMPORT_WRITES_ENABLED){if(!enabled)throw new DocumentImportRecoveryError('closed');}
function captured(value:CapturedDocumentImport,uid:string):CapturedDocumentImport{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='plan,result,uploads')throw new DocumentImportRecoveryError('checkpoint');
  const plan=parseDocumentImportPlan(value.plan);const result=structuredClone(value.result);
  if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='batchId,hubId,imported'||result.batchId!==plan.importId||result.imported!==plan.memories.filter(item=>item.role==='document').length||result.hubId!==plan.memories[0].sessionId||plan.memories[0].role!=='hub'||!Array.isArray(value.uploads)||value.uploads.length!==plan.attachments.length)throw new DocumentImportRecoveryError('checkpoint');
  const uploads=value.uploads.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join(',')!=='bytesDigest,header,id'||typeof item.bytesDigest!=='string'||!/^[a-f0-9]{64}$/.test(item.bytesDigest))throw new DocumentImportRecoveryError('checkpoint');
    const header=parseAttachmentHeader(item.header);
    if(header.uid!==uid||header.scope.kind!=='personal'||header.scope.uid!==uid||header.id!==item.id||!plan.attachments.some(ref=>ref.id===item.id))throw new DocumentImportRecoveryError('checkpoint');
    return{id:item.id,header,bytesDigest:item.bytesDigest};
  });
  if(new Set(uploads.map(item=>item.id)).size!==uploads.length)throw new DocumentImportRecoveryError('checkpoint');return{plan,result,uploads};
}
const digest=async(plan:DocumentImportPlan)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(documentPlanBytes(plan)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function terminal(value:unknown,identity:DocumentImportIdentity,plan:DocumentImportPlan):DocumentImportStatus{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdCount,edgeCount,importId,linkedCount,memoryCount,nextBatch,planDigest,status')throw new DocumentImportRecoveryError('confirmation');
  const data=value as DocumentImportStatus;
  if(data.importId!==identity.importId||data.planDigest!==identity.planDigest||!['unknown','pending','complete','cancelled'].includes(data.status)||
    ![data.nextBatch,data.createdCount,data.linkedCount,data.memoryCount,data.edgeCount].every(value=>Number.isSafeInteger(value)&&value>=0))throw new DocumentImportRecoveryError('confirmation');
  if(data.memoryCount===0){if(!['unknown','cancelled'].includes(data.status)||data.edgeCount!==0||data.nextBatch!==0||data.createdCount!==0||data.linkedCount!==0)throw new DocumentImportRecoveryError('confirmation');return{...data};}
  const batches=documentPlanBatches(plan);const processed=batches.slice(0,data.nextBatch);
  if(data.status==='unknown'||data.memoryCount!==plan.memories.length||data.edgeCount!==plan.edges.length||data.nextBatch>batches.length||
    data.createdCount!==processed.reduce((sum,batch)=>sum+batch.memories.length,0)||data.linkedCount!==processed.reduce((sum,batch)=>sum+batch.edges.length,0)||
    (data.status==='complete'&&data.nextBatch!==batches.length)||(data.status==='pending'&&data.nextBatch===batches.length))throw new DocumentImportRecoveryError('confirmation');return{...data};
}
async function readJournal(raw:string,uid:string,deps:DocumentImportRecoveryDeps,guard:()=>void):Promise<CapturedDocumentImport>{
  try{
    if(raw.length>8_000_000)throw new Error();const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw new Error();
    const text=(await deps.decryptJournal(envelope)).text;guard();if(new TextEncoder().encode(text).byteLength>4_200_000)throw new Error();
    const journal=JSON.parse(text);if(!journal||typeof journal!=='object'||Array.isArray(journal)||Object.keys(journal).sort().join(',')!=='plan,result,uid,uploads,v'||journal.v!==1||journal.uid!==uid)throw new Error();
    return captured({plan:journal.plan,result:journal.result,uploads:journal.uploads},uid);
  }catch{guard();throw new DocumentImportRecoveryError('checkpoint');}
}
export interface DocumentImportRecoveryOutcome{status:DocumentImportStatus;importedConfirmed:number;linksConfirmed:number;result:DocumentImportResult}
async function operate(uid:string,mode:'start'|'recover'|'cancel',prepare:((guard:()=>void)=>Promise<CapturedDocumentImport>)|undefined,outerGuard:()=>void,progress:((done:number,total:number)=>void)|undefined,injected?:DocumentImportRecoveryDeps):Promise<DocumentImportRecoveryOutcome>{
  if(mode==='start')assertDocumentImportWrites(injected?injected.enabled():DOCUMENT_IMPORT_WRITES_ENABLED);
  const deps=injected??defaults(uid);outerGuard();
  const policy=deps.policy?.();let policyChanged=false;const stopPolicy=deps.subscribePolicy?.(()=>{policyChanged=true;});
  try { return await withPersonalMemoryMutation(uid,async context=>deps.exclusive(documentImportCheckpointKey(uid),async()=>{
    const key=documentImportCheckpointKey(uid);const scope=()=>{context.assertCurrent();outerGuard();if(policyChanged||deps.policy?.()!==policy)throw new DocumentImportRecoveryError('pending');};scope();
    const stored=()=>{try{return deps.storage.getItem(key);}catch{throw new DocumentImportRecoveryError('storage');}};let raw=stored();
    const guard=()=>{scope();if(stored()!==raw)throw new DocumentImportRecoveryError('checkpoint');};
    let data:CapturedDocumentImport;
    if(raw!==null){if(mode==='start')throw new DocumentImportRecoveryError('pending');data=await readJournal(raw,uid,deps,guard);guard();}
    else{
      if(mode!=='start'||!prepare)throw new DocumentImportRecoveryError('pending');if(deps.blocked())throw new DocumentImportRecoveryError('pending');
      data=captured(await prepare(guard),uid);guard();
      const text=JSON.stringify({v:1,uid,...data});if(new TextEncoder().encode(text).byteLength>4_200_000)throw new DocumentImportRecoveryError('checkpoint');
      const encrypted=await deps.encryptJournal({text});guard();if(!isEncryptedMemoryEnvelope(encrypted))throw new DocumentImportRecoveryError('checkpoint');
      const next=JSON.stringify(encrypted);if(next.length>8_000_000)throw new DocumentImportRecoveryError('checkpoint');
      try{deps.storage.setItem(key,next);raw=next;if(stored()!==raw)throw new Error();}catch{throw new DocumentImportRecoveryError('storage');}guard();notify();guard();
    }
    for(const upload of data.uploads){
      const hash=await attachmentBytesDigest(encodeAttachmentHeader(upload.header));guard();
      if(data.plan.attachments.find(ref=>ref.id===upload.id)?.headerDigest!==hash)throw new DocumentImportRecoveryError('checkpoint');
    }
    if(mode==='start')for(const upload of data.uploads){await deps.validateUpload(uid,upload,guard);guard();}
    const identity={importId:data.plan.importId,planDigest:await digest(data.plan)};guard();
    const read=async()=>{const result=terminal(await deps.call('status',identity),identity,data.plan);guard();return result;};
    let state=await read();
    if(mode==='cancel'){
      if(!['complete','cancelled'].includes(state.status)){state=terminal(await deps.call('cancel',identity),identity,data.plan);guard();}
    }else{
      if(['unknown','pending'].includes(state.status))for(const upload of data.uploads){await deps.validateUpload(uid,upload,guard);guard();}
      if(state.status==='unknown'){
        if(!deps.enabled())throw new DocumentImportRecoveryError('pending');state=terminal(await deps.call('begin',data.plan),identity,data.plan);guard();
        if(state.status==='unknown')throw new DocumentImportRecoveryError('confirmation');
      }
      if(state.status==='pending'){
        if(!deps.enabled())throw new DocumentImportRecoveryError('pending');
        for(const upload of data.uploads){const result=await deps.resumeUpload(uid,upload,guard);guard();if(result.status!=='ready')throw new DocumentImportRecoveryError('confirmation');}
      }
      const batches=documentPlanBatches(data.plan);
      while(state.status==='pending'){
        if(!deps.enabled())throw new DocumentImportRecoveryError('pending');guard();const batch=batches[state.nextBatch];
        const next=terminal(await deps.call('apply',{...identity,...batch}),identity,data.plan);guard();
        if(next.status==='unknown'||(next.status==='pending'&&next.nextBatch<=state.nextBatch))throw new DocumentImportRecoveryError('confirmation');state=next;
        const done=data.plan.memories.slice(0,state.createdCount).filter(item=>item.role==='document').length;progress?.(done,data.result.imported);guard();
      }
    }
    if(!['complete','cancelled'].includes(state.status))throw new DocumentImportRecoveryError('confirmation');const confirmed=await read();
    if(Object.keys(state).some(key=>state[key as keyof DocumentImportStatus]!==confirmed[key as keyof DocumentImportStatus]))throw new DocumentImportRecoveryError('confirmation');
    // Cleanups are themselves resumable: missing terminal checkpoints mean an earlier confirmed cleanup.
    for(const upload of data.uploads){
      if(confirmed.status==='complete')await deps.forgetUpload(uid,upload,guard);else await deps.cancelUpload(uid,upload,guard);guard();
    }
    try{guard();deps.storage.removeItem(key);raw=null;if(stored()!==null)throw new Error();}catch{throw new DocumentImportRecoveryError('storage');}guard();notify();guard();
    const importedConfirmed=data.plan.memories.slice(0,confirmed.createdCount).filter(item=>item.role==='document').length;
    const linksConfirmed=documentPlanBatches(data.plan).slice(0,confirmed.nextBatch).flatMap(batch=>batch.edges).length;
    return{status:confirmed,importedConfirmed,linksConfirmed,result:data.result};
  }),deps.mutation); } finally {stopPolicy?.();}
}
export async function startCapturedDocumentImport(uid:string,prepare:(guard:()=>void)=>Promise<CapturedDocumentImport>,outerGuard:()=>void=()=>{},progress?:((done:number,total:number)=>void),deps?:DocumentImportRecoveryDeps):Promise<DocumentImportResult>{
  const outcome=await operate(uid,'start',prepare,outerGuard,progress,deps);if(outcome.status.status!=='complete')throw new DocumentImportRecoveryError('confirmation');return outcome.result;
}
export const recoverPendingDocumentImport=(uid:string,deps?:DocumentImportRecoveryDeps)=>operate(uid,'recover',undefined,()=>{},undefined,deps);
export const cancelPendingDocumentImport=(uid:string,deps?:DocumentImportRecoveryDeps)=>operate(uid,'cancel',undefined,()=>{},undefined,deps);
