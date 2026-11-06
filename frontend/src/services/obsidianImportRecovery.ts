import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {OBSIDIAN_IMPORT_WRITES_ENABLED,CAPSULE_IMPORT_WRITES_ENABLED} from '../config/releaseGates';
import {decryptMemoryEnvelope,encryptMemoryFields,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {hasPendingPersonalConnection} from './personalConnections';
import {confirmStarterAssimilated} from './starterAssimilationState';
import {obsidianPlanBytes,obsidianPlanBatches,parseObsidianImportPlan,type ObsidianImportPlan,type ObsidianImportStatus,type ObsidianImportIdentity,type ObsidianImportBatch} from '../../../functions/src/obsidianImportContract';
import type {ObsidianVaultImportResult} from './obsidianVaultImport';

export class ObsidianImportRecoveryError extends Error{
  readonly reason:'closed'|'pending'|'storage'|'checkpoint'|'confirmation';
  constructor(reason:ObsidianImportRecoveryError['reason']){
    super(reason==='closed'?'A importação recuperável está em validação antes do lançamento.':'A importação aguarda confirmação. Recupera ou cancela o lote pendente antes de repetir.');this.reason=reason;
  }
}
export interface CapturedObsidianImport{plan:ObsidianImportPlan;result:ObsidianVaultImportResult}
export interface ObsidianImportRecoveryDeps{
  enabled:(source?:ObsidianImportPlan['source'])=>boolean;blocked:()=>boolean;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
  exclusive:<T>(name:string,work:()=>Promise<T>)=>Promise<T>;encryptJournal:typeof encryptMemoryFields;decryptJournal:typeof decryptMemoryEnvelope;
  call:(mode:'begin'|'apply'|'status'|'cancel',request:ObsidianImportPlan|ObsidianImportBatch|ObsidianImportIdentity,source?:ObsidianImportPlan['source'])=>Promise<unknown>;
  mutation?:PersonalMemoryMutationDeps;
}
const names={begin:'beginObsidianImport',apply:'applyObsidianImportBatch',status:'getObsidianImportStatus',cancel:'cancelObsidianImport'};
const defaults=(uid:string):ObsidianImportRecoveryDeps=>({enabled:source=>source==='capsule-import'?CAPSULE_IMPORT_WRITES_ENABLED:OBSIDIAN_IMPORT_WRITES_ENABLED,blocked:()=>hasPendingPersonalConnection(uid),storage:localStorage,exclusive:withClipCaptureLock,
  encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,call:async(mode,request,source)=>(await httpsCallable(getFunctions(app,'europe-west1'),source==='capsule-import'&&mode==='begin'?'beginCapsuleImport':source==='capsule-import'&&mode==='apply'?'applyCapsuleImportBatch':names[mode])(request)).data});
export const obsidianImportCheckpointKey=(uid:string)=>`mnemosyne:obsidian-import:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:obsidian-import-changed';const notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingObsidianImport(uid:string){try{return localStorage.getItem(obsidianImportCheckpointKey(uid))!==null;}catch{return true;}}
export function observeObsidianImports(callback:()=>void){window.addEventListener(event,callback);window.addEventListener('storage',callback);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};}
export function assertObsidianImportWrites(enabled=OBSIDIAN_IMPORT_WRITES_ENABLED){if(!enabled)throw new ObsidianImportRecoveryError('closed');}
function captured(value:CapturedObsidianImport):CapturedObsidianImport{
  const plan=parseObsidianImportPlan(value.plan);const result=structuredClone(value.result);const notes=plan.memories.filter(item=>item.role==='note').map(item=>item.sessionId);const hubs=plan.memories.filter(item=>item.role==='hub').map(item=>item.sessionId);
  if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='hubIds,imported,linked,memoryIds,skipped,statsLabel,unresolvedLinks'||
    result.imported!==notes.length||result.linked!==plan.edges.filter(item=>item.kind==='wikilink').length||!Number.isSafeInteger(result.skipped)||result.skipped<0||!Number.isSafeInteger(result.unresolvedLinks)||result.unresolvedLinks<0||
    typeof result.statsLabel!=='string'||result.statsLabel.length>2000||JSON.stringify(result.memoryIds)!==JSON.stringify(notes)||JSON.stringify(result.hubIds)!==JSON.stringify(hubs))throw new ObsidianImportRecoveryError('checkpoint');
  return{plan,result};
}
const digest=async(plan:ObsidianImportPlan)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(obsidianPlanBytes(plan)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function terminal(value:unknown,identity:ObsidianImportIdentity,plan:ObsidianImportPlan):ObsidianImportStatus{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdCount,edgeCount,importId,linkedCount,memoryCount,nextBatch,planDigest,status')throw new ObsidianImportRecoveryError('confirmation');
  const data=value as ObsidianImportStatus;
  if(data.importId!==identity.importId||data.planDigest!==identity.planDigest||!['unknown','pending','complete','cancelled'].includes(data.status)||
    ![data.nextBatch,data.createdCount,data.linkedCount,data.memoryCount,data.edgeCount].every(value=>Number.isSafeInteger(value)&&value>=0))throw new ObsidianImportRecoveryError('confirmation');
  if(data.memoryCount===0){if(!['unknown','cancelled'].includes(data.status)||data.edgeCount!==0||data.nextBatch!==0||data.createdCount!==0||data.linkedCount!==0)throw new ObsidianImportRecoveryError('confirmation');return{...data};}
  const batches=obsidianPlanBatches(plan);const processed=batches.slice(0,data.nextBatch);
  if(data.status==='unknown'||data.memoryCount!==plan.memories.length||data.edgeCount!==plan.edges.length||data.nextBatch>batches.length||
    data.createdCount!==processed.reduce((sum,batch)=>sum+batch.memories.length,0)||data.linkedCount!==processed.reduce((sum,batch)=>sum+batch.edges.length,0)||
    (data.status==='complete'&&data.nextBatch!==batches.length)||(data.status==='pending'&&data.nextBatch===batches.length))throw new ObsidianImportRecoveryError('confirmation');return{...data};
}
async function readJournal(raw:string,uid:string,deps:ObsidianImportRecoveryDeps,guard:()=>void):Promise<CapturedObsidianImport>{
  try{
    if(raw.length>8_000_000)throw new Error();const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw new Error();
    const text=(await deps.decryptJournal(envelope)).text;guard();if(new TextEncoder().encode(text).byteLength>4_200_000)throw new Error();
    const journal=JSON.parse(text);if(!journal||typeof journal!=='object'||Array.isArray(journal)||Object.keys(journal).sort().join(',')!=='plan,result,uid,v'||journal.v!==1||journal.uid!==uid)throw new Error();
    return captured({plan:journal.plan,result:journal.result});
  }catch{guard();throw new ObsidianImportRecoveryError('checkpoint');}
}
export interface ObsidianImportRecoveryOutcome{status:ObsidianImportStatus;importedConfirmed:number;linksConfirmed:number;result:ObsidianVaultImportResult}
async function operate(uid:string,mode:'start'|'recover'|'cancel',prepare:((guard:()=>void)=>Promise<CapturedObsidianImport>)|undefined,outerGuard:()=>void,progress:((done:number,total:number)=>void)|undefined,injected?:ObsidianImportRecoveryDeps,source:ObsidianImportPlan['source']='obsidian-vault'):Promise<ObsidianImportRecoveryOutcome>{
  if(mode==='start')assertObsidianImportWrites(injected?injected.enabled(source):source==='capsule-import'?CAPSULE_IMPORT_WRITES_ENABLED:OBSIDIAN_IMPORT_WRITES_ENABLED);
  const deps=injected??defaults(uid);outerGuard();
  return withPersonalMemoryMutation(uid,async context=>deps.exclusive(obsidianImportCheckpointKey(uid),async()=>{
    const key=obsidianImportCheckpointKey(uid);const scope=()=>{context.assertCurrent();outerGuard();};scope();
    const stored=()=>{try{return deps.storage.getItem(key);}catch{throw new ObsidianImportRecoveryError('storage');}};let raw=stored();
    const guard=()=>{scope();if(stored()!==raw)throw new ObsidianImportRecoveryError('checkpoint');};
    let data:CapturedObsidianImport;
    if(raw!==null){if(mode==='start')throw new ObsidianImportRecoveryError('pending');data=await readJournal(raw,uid,deps,guard);guard();}
    else{
      if(mode!=='start'||!prepare)throw new ObsidianImportRecoveryError('pending');if(deps.blocked())throw new ObsidianImportRecoveryError('pending');
      data=captured(await prepare(guard));guard();
      if((data.plan.source==='capsule-import')!==(source==='capsule-import'))throw new ObsidianImportRecoveryError('checkpoint');
      const text=JSON.stringify({v:1,uid,...data});if(new TextEncoder().encode(text).byteLength>4_200_000)throw new ObsidianImportRecoveryError('checkpoint');
      const encrypted=await deps.encryptJournal({text});guard();if(!isEncryptedMemoryEnvelope(encrypted))throw new ObsidianImportRecoveryError('checkpoint');
      const next=JSON.stringify(encrypted);if(next.length>8_000_000)throw new ObsidianImportRecoveryError('checkpoint');
      try{deps.storage.setItem(key,next);raw=next;if(stored()!==raw)throw new Error();}catch{throw new ObsidianImportRecoveryError('storage');}guard();notify();guard();
    }
    const identity={importId:data.plan.importId,planDigest:await digest(data.plan)};guard();
    const read=async()=>{const result=terminal(await deps.call('status',identity,data.plan.source),identity,data.plan);guard();return result;};
    let state=await read();
    if(mode==='cancel'){
      if(!['complete','cancelled'].includes(state.status)){state=terminal(await deps.call('cancel',identity,data.plan.source),identity,data.plan);guard();}
    }else{
      if(state.status==='unknown'){
        if(!deps.enabled(data.plan.source))throw new ObsidianImportRecoveryError('pending');state=terminal(await deps.call('begin',data.plan,data.plan.source),identity,data.plan);guard();
        if(state.status==='unknown')throw new ObsidianImportRecoveryError('confirmation');
      }
      const batches=obsidianPlanBatches(data.plan);
      while(state.status==='pending'){
        if(!deps.enabled(data.plan.source))throw new ObsidianImportRecoveryError('pending');guard();const batch=batches[state.nextBatch];
        const next=terminal(await deps.call('apply',{...identity,...batch},data.plan.source),identity,data.plan);guard();
        if(next.status==='unknown'||(next.status==='pending'&&next.nextBatch<=state.nextBatch))throw new ObsidianImportRecoveryError('confirmation');state=next;
        const done=data.plan.memories.slice(0,state.createdCount).filter(item=>item.role==='note').length;progress?.(done,data.result.imported);guard();
      }
    }
    if(!['complete','cancelled'].includes(state.status))throw new ObsidianImportRecoveryError('confirmation');const confirmed=await read();
    if(Object.keys(state).some(key=>state[key as keyof ObsidianImportStatus]!==confirmed[key as keyof ObsidianImportStatus]))throw new ObsidianImportRecoveryError('confirmation');
    if(confirmed.status==='complete'&&data.plan.source==='starter-universe')confirmStarterAssimilated(uid,guard);
    try{guard();deps.storage.removeItem(key);raw=null;if(stored()!==null)throw new Error();}catch{throw new ObsidianImportRecoveryError('storage');}guard();notify();guard();
    const importedConfirmed=data.plan.memories.slice(0,confirmed.createdCount).filter(item=>item.role==='note').length;
    const linksConfirmed=obsidianPlanBatches(data.plan).slice(0,confirmed.nextBatch).flatMap(batch=>batch.edges).filter(edge=>edge.kind==='wikilink').length;
    return{status:confirmed,importedConfirmed,linksConfirmed,result:data.result};
  }),deps.mutation);
}
export async function startCapturedObsidianImport(uid:string,prepare:(guard:()=>void)=>Promise<CapturedObsidianImport>,outerGuard:()=>void=()=>{},progress?:((done:number,total:number)=>void),deps?:ObsidianImportRecoveryDeps):Promise<ObsidianVaultImportResult>{
  const outcome=await operate(uid,'start',prepare,outerGuard,progress,deps);if(outcome.status.status!=='complete')throw new ObsidianImportRecoveryError('confirmation');return outcome.result;
}
export const recoverPendingObsidianImport=(uid:string,deps?:ObsidianImportRecoveryDeps)=>operate(uid,'recover',undefined,()=>{},undefined,deps);
export const cancelPendingObsidianImport=(uid:string,deps?:ObsidianImportRecoveryDeps)=>operate(uid,'cancel',undefined,()=>{},undefined,deps);
export async function startCapturedCapsuleImport(uid:string,prepare:(guard:()=>void)=>Promise<CapturedObsidianImport>,outerGuard:()=>void=()=>{},deps?:ObsidianImportRecoveryDeps):Promise<ObsidianVaultImportResult>{
  const outcome=await operate(uid,'start',prepare,outerGuard,undefined,deps,'capsule-import');if(outcome.status.status!=='complete')throw new ObsidianImportRecoveryError('confirmation');return outcome.result;
}
