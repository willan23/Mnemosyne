import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {auth} from '../firebase';
import {COMMS_IDENTITY_ROLLOVERS_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {createEncryptedIdentityCandidate,openEncryptedIdentity,clearVolatileIdentities} from '../utils/crypto';
import {parseCommsIdentityBaseline,parseCommsIdentityRollover,commsIdentityRequestBytes,type CommsIdentityBaseline,type CommsIdentityRolloverRequest,type CommsIdentityRolloverOutcome} from '../../../functions/src/commsIdentityContract';
import {attachmentActorIdValid,attachmentIdValid} from '../../../functions/src/attachmentEnvelope';
export interface CommsIdentityRolloverDeps{
  enabled:()=>boolean;storage:Storage;mutation?:PersonalMemoryMutationDeps;id:()=>string;
  exclusive:typeof withClipCaptureLock;prepare:typeof createEncryptedIdentityCandidate;open:typeof openEncryptedIdentity;retire:()=>void;
  encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;
  call:(mode:'prepare'|'apply'|'status'|'cancel',value:unknown)=>Promise<unknown>;
  observeStorage:(uid:string,changed:()=>void)=>()=>void;
}
export class CommsIdentityRolloverError extends Error{
  constructor(){super('Não foi possível confirmar a identidade. As cifras e o pedido local foram conservados para recuperação.');}
}
export class CommsIdentitySupersededError extends CommsIdentityRolloverError{}
export interface CommsIdentityConflictPreview{uid:string;operationId:string;journalDigest:string;candidateFingerprint:string;baseline:CommsIdentityBaseline}
export const commsIdentityRolloverKey=(uid:string)=>`mnemosyne:comms-identity-rollover:v1:${encodeURIComponent(uid)}`;
export const commsIdentityHistoryPrefix=(uid:string)=>`mnemosyne:comms-identity-history:v1:${encodeURIComponent(uid)}:`;
export const commsIdentityBackupRecoveryKey=(uid:string)=>`mnemosyne:comms-identity-backup:v1:${encodeURIComponent(uid)}`;
const primary=(uid:string)=>`mnemosyne_identity_vault_${uid}`,event='mnemosyne:comms-identity-rollover-changed';
const notify=()=>window.dispatchEvent(new Event(event));
export const notifyCommsIdentityChanged=notify;
export function hasPendingCommsIdentityRollover(uid:string){try{return localStorage.getItem(commsIdentityRolloverKey(uid))!==null;}catch{return true;}}
export function hasPendingCommsIdentityRecovery(uid:string){try{return hasPendingCommsIdentityRollover(uid)||localStorage.getItem(commsIdentityBackupRecoveryKey(uid))!==null;}catch{return true;}}
export function observeCommsIdentityRollovers(callback:()=>void,owner:()=>string|null=()=>auth.currentUser?.uid??null){const storage=(value:StorageEvent)=>{const uid=owner();if(uid&&(value.key===null||value.key===primary(uid)||value.key===commsIdentityRolloverKey(uid)||value.key===commsIdentityBackupRecoveryKey(uid)||value.key?.startsWith(commsIdentityHistoryPrefix(uid))))callback();};window.addEventListener(event,callback);window.addEventListener('storage',storage);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',storage);};}
const defaults=():CommsIdentityRolloverDeps=>({enabled:()=>COMMS_IDENTITY_ROLLOVERS_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,prepare:createEncryptedIdentityCandidate,open:openEncryptedIdentity,retire:clearVolatileIdentities,
  encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,
  call:async(mode,value)=>{const names={prepare:'prepareCommsIdentityRollover',apply:'applyCommsIdentityRollover',status:'getCommsIdentityRolloverStatus',cancel:'cancelCommsIdentityRollover'};return(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(value)).data;},
  observeStorage:(uid,changed)=>{const listener=(value:StorageEvent)=>{if(value.key===null||value.key===primary(uid)||value.key===commsIdentityRolloverKey(uid)||value.key===commsIdentityBackupRecoveryKey(uid)||value.key?.startsWith(commsIdentityHistoryPrefix(uid)))changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
});
type JournalBase={uid:string;request:CommsIdentityRolloverRequest;oldVaultRaw:string;newVaultRaw:string};
export type CommsIdentityJournal=JournalBase&({v:1}|{v:2;localPriorFingerprint:string;cancelVaultRaw:string});
type Journal=CommsIdentityJournal;
export type CommsIdentityCipherDeps=Pick<CommsIdentityRolloverDeps,'open'|'decrypt'>;
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const failure=()=>new CommsIdentityRolloverError();
function historyKeys(uid:string,storage:Storage){const prefix=commsIdentityHistoryPrefix(uid);const keys=Array.from({length:storage.length},(_,index)=>storage.key(index)).filter((key):key is string=>Boolean(key?.startsWith(prefix)));
  if(keys.length>20||keys.some(key=>!attachmentIdValid(key.slice(prefix.length))))throw failure();return keys.sort();}
async function decode(raw:string,uid:string,guard:()=>void,deps:Pick<CommsIdentityCipherDeps,'decrypt'>):Promise<Journal>{
  try{if(raw.length>100_000)throw failure();const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw failure();
    const text=(await deps.decrypt(envelope)).text;guard();if(text.length>60_000)throw failure();const journal=JSON.parse(text);
    if(!journal||typeof journal!=='object'||(journal.v===1?Object.keys(journal).sort().join(',')!=='newVaultRaw,oldVaultRaw,request,uid,v':journal.v!==2||Object.keys(journal).sort().join(',')!=='cancelVaultRaw,localPriorFingerprint,newVaultRaw,oldVaultRaw,request,uid,v'||
      typeof journal.localPriorFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(journal.localPriorFingerprint)||![journal.oldVaultRaw,journal.newVaultRaw].includes(journal.cancelVaultRaw))||journal.uid!==uid||
      typeof journal.oldVaultRaw!=='string'||!journal.oldVaultRaw||journal.oldVaultRaw.length>16_384||typeof journal.newVaultRaw!=='string'||!journal.newVaultRaw||journal.newVaultRaw.length>16_384||journal.oldVaultRaw===journal.newVaultRaw)throw failure();
    const base={uid,oldVaultRaw:journal.oldVaultRaw,newVaultRaw:journal.newVaultRaw,request:parseCommsIdentityRollover(journal.request)};
    return journal.v===1?{v:1,...base}:{v:2,...base,localPriorFingerprint:journal.localPriorFingerprint,cancelVaultRaw:journal.cancelVaultRaw};
  }catch{guard();throw failure();}
}
const localPriorFingerprint=(journal:Journal)=>journal.v===1?journal.request.baseline.priorFingerprint:journal.localPriorFingerprint;
const cancelVaultRaw=(journal:Journal)=>journal.v===1?journal.oldVaultRaw:journal.cancelVaultRaw;
/** Shared local validation for retained keys and identity backup. No RPC or cache publication. */
export async function openCommsIdentityJournal(uid:string,words:string[],raw:string,guard:()=>void,deps:CommsIdentityCipherDeps){
  const phrase=[...words],journal=await decode(raw,uid,guard,deps);guard();
  const old=await deps.open(uid,phrase,journal.oldVaultRaw,guard),next=await deps.open(uid,phrase,journal.newVaultRaw,guard);guard();
  if(await hash(old.pemPublic)!==localPriorFingerprint(journal)||next.pemPublic!==journal.request.publicKeyPem)throw failure();guard();
  return{journal,old,next};
}
/** v3 is a single retained local key. It is not a rollover request or a server receipt. */
export async function openCommsIdentityHistory(uid:string,words:string[],raw:string,guard:()=>void,deps:CommsIdentityCipherDeps){
  if(raw.length>100_000)throw failure();let value:unknown;
  try{const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw failure();value=JSON.parse((await deps.decrypt(envelope)).text);guard();}catch{guard();throw failure();}
  const row=value as {v?:unknown;uid?:unknown;operationId?:unknown;vaultRaw?:unknown;fingerprint?:unknown};
  if(row?.v!==3){const result=await openCommsIdentityJournal(uid,words,raw,guard,deps);return{operationId:result.journal.request.operationId,vaults:[{raw:result.journal.oldVaultRaw,identity:result.old},{raw:result.journal.newVaultRaw,identity:result.next}]};}
  if(Object.keys(row).sort().join(',')!=='fingerprint,operationId,uid,v,vaultRaw'||row.uid!==uid||!attachmentIdValid(row.operationId)||typeof row.vaultRaw!=='string'||!row.vaultRaw||row.vaultRaw.length>16_384||typeof row.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(row.fingerprint))throw failure();
  const identity=await deps.open(uid,[...words],row.vaultRaw,guard);guard();if(await hash(identity.pemPublic)!==row.fingerprint)throw failure();guard();return{operationId:row.operationId,vaults:[{raw:row.vaultRaw,identity}]};
}
function archiveJournal(uid:string,journal:Journal,raw:string,guard:()=>void,deps:CommsIdentityRolloverDeps){
  guard();const archive=commsIdentityHistoryPrefix(uid)+journal.request.operationId,prior=deps.storage.getItem(archive);if(prior!==null&&prior!==raw)throw failure();
  if(prior===null){if(historyKeys(uid,deps.storage).length>=20)throw failure();deps.storage.setItem(archive,raw);guard();}
  if(deps.storage.getItem(archive)!==raw)throw failure();return archive;
}
function capturePreview(uid:string,value:CommsIdentityConflictPreview):CommsIdentityConflictPreview{
  if(!value||Object.keys(value).sort().join(',')!=='baseline,candidateFingerprint,journalDigest,operationId,uid'||value.uid!==uid||!attachmentIdValid(value.operationId)||
    !/^[a-f0-9]{64}$/.test(value.journalDigest)||!/^[a-f0-9]{64}$/.test(value.candidateFingerprint))throw failure();
  return{uid,operationId:value.operationId,journalDigest:value.journalDigest,candidateFingerprint:value.candidateFingerprint,baseline:parseCommsIdentityBaseline(value.baseline)};
}
function outcome(value:unknown,request:CommsIdentityRolloverRequest,digest:string,fingerprint:string):CommsIdentityRolloverOutcome{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdAt,current,digest,fingerprint,operationId,status')throw failure();
  const row=value as CommsIdentityRolloverOutcome;if(row.operationId!==request.operationId||row.digest!==digest||row.fingerprint!==fingerprint||!['unknown','committed','cancelled'].includes(row.status)||typeof row.current!=='boolean'||row.current&&row.status!=='committed'||
    (row.status==='unknown'?row.createdAt!==null:!Number.isSafeInteger(row.createdAt)||Number(row.createdAt)<1))throw failure();return{...row};
}
async function operate(uid:string,mnemonic:string[],mode:'start'|'recover'|'cancel'|'republish',outer:()=>void,deps:CommsIdentityRolloverDeps,preview?:CommsIdentityConflictPreview){
  const words=[...mnemonic],capturedPreview=mode==='republish'?capturePreview(uid,preview!):null;if(!attachmentActorIdValid(uid)||words.length!==12||(mode==='start'||mode==='republish')&&!deps.enabled())throw failure();
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:comms-identity:v1:${encodeURIComponent(uid)}`,async()=>{
    const key=commsIdentityRolloverKey(uid);let changed=false;const stop=deps.observeStorage(uid,()=>{changed=true;});
    const scope=()=>{outer();context.assertCurrent();if(changed||deps.storage.getItem(commsIdentityBackupRecoveryKey(uid))!==null)throw failure();};const stored=()=>deps.storage.getItem(key);let raw:string|null=null;let journal:Journal;
    const guard=()=>{scope();if(stored()!==raw)throw failure();};
    try{
      scope();raw=stored();guard();if(raw!==null){if(mode==='start')throw failure();journal=await decode(raw,uid,guard,deps);guard();}
      else{
        if(mode!=='start'||historyKeys(uid,deps.storage).length>=20)throw failure();const oldVaultRaw=deps.storage.getItem(primary(uid));if(!oldVaultRaw)throw failure();
        const old=await deps.open(uid,words,oldVaultRaw,guard);guard();const baseline=parseCommsIdentityBaseline(await deps.call('prepare',{actorUid:uid,request:{}}));guard();if(await hash(old.pemPublic)!==baseline.priorFingerprint)throw failure();guard();
        const candidate=await deps.prepare(uid,words,guard);guard();if(candidate.identity.pemPublic===old.pemPublic||deps.storage.getItem(primary(uid))!==oldVaultRaw)throw failure();
        const request=parseCommsIdentityRollover({operationId:deps.id(),baseline,publicKeyPem:candidate.identity.pemPublic});journal={v:1,uid,request,oldVaultRaw,newVaultRaw:candidate.vaultRaw};
        const prepared=JSON.stringify(await deps.encrypt({text:JSON.stringify(journal)}));guard();if(prepared.length>100_000||deps.storage.getItem(primary(uid))!==oldVaultRaw)throw failure();
        deps.storage.setItem(key,prepared);raw=prepared;guard();notify();
      }
      const primaryGuard=()=>{guard();const current=deps.storage.getItem(primary(uid));if(current!==journal.oldVaultRaw&&current!==journal.newVaultRaw)throw failure();};
      primaryGuard();const old=await deps.open(uid,words,journal.oldVaultRaw,primaryGuard),candidate=await deps.open(uid,words,journal.newVaultRaw,primaryGuard);primaryGuard();
      if(await hash(old.pemPublic)!==localPriorFingerprint(journal)||candidate.pemPublic!==journal.request.publicKeyPem)throw failure();primaryGuard();
      if(capturedPreview){
        if(journal.request.operationId!==capturedPreview.operationId||await hash(raw!)!==capturedPreview.journalDigest||await hash(candidate.pemPublic)!==capturedPreview.candidateFingerprint)throw failure();primaryGuard();
        const priorDigest=await hash(commsIdentityRequestBytes(journal.request)),prior=outcome(await deps.call('status',{actorUid:uid,request:journal.request}),journal.request,priorDigest,capturedPreview.candidateFingerprint);primaryGuard();
        if(prior.status!=='committed'||prior.current)throw failure();
        const baseline=parseCommsIdentityBaseline(await deps.call('prepare',{actorUid:uid,request:{}}));primaryGuard();
        if(JSON.stringify(baseline)!==JSON.stringify(capturedPreview.baseline)||baseline.priorFingerprint===capturedPreview.candidateFingerprint)throw failure();
        const priorArchive=commsIdentityHistoryPrefix(uid)+journal.request.operationId;
        if(historyKeys(uid,deps.storage).length+(deps.storage.getItem(priorArchive)===null?2:1)>20)throw failure();
        const nextId=deps.id();if(!attachmentIdValid(nextId)||nextId===journal.request.operationId||deps.storage.getItem(commsIdentityHistoryPrefix(uid)+nextId)!==null)throw failure();
        const next:Journal={v:2,uid,oldVaultRaw:journal.oldVaultRaw,newVaultRaw:journal.newVaultRaw,localPriorFingerprint:localPriorFingerprint(journal),cancelVaultRaw:deps.storage.getItem(primary(uid))!,
          request:parseCommsIdentityRollover({operationId:nextId,baseline,publicKeyPem:candidate.pemPublic})};
        const prepared=JSON.stringify(await deps.encrypt({text:JSON.stringify(next)}));primaryGuard();if(prepared.length>100_000)throw failure();
        const archive=archiveJournal(uid,journal,raw!,primaryGuard,deps);primaryGuard();if(deps.storage.getItem(archive)!==raw)throw failure();
        deps.storage.setItem(key,prepared);raw=prepared;guard();journal=next;primaryGuard();notify();
      }
      const captured=journal;
      const digest=await hash(commsIdentityRequestBytes(captured.request)),fingerprint=await hash(captured.request.publicKeyPem);primaryGuard();
      const call=async(which:'apply'|'status'|'cancel')=>{primaryGuard();const result=outcome(await deps.call(which,{actorUid:uid,request:captured.request}),captured.request,digest,fingerprint);primaryGuard();return result;};
      let result=await call('status');if(result.status==='unknown'){if(mode==='cancel')result=await call('cancel');else{if(!deps.enabled())throw failure();result=await call('apply');}}
      if(result.status==='committed'&&!result.current)throw new CommsIdentitySupersededError();
      if(result.status==='unknown'||result.status==='cancelled'&&deps.storage.getItem(primary(uid))!==cancelVaultRaw(captured))throw failure();
      const archive=archiveJournal(uid,captured,raw!,primaryGuard,deps);
      result=await call('status');if(result.status==='unknown'||result.status==='committed'&&!result.current)throw failure();
      if(result.status==='committed'){primaryGuard();deps.storage.setItem(primary(uid),captured.newVaultRaw);primaryGuard();if(deps.storage.getItem(primary(uid))!==captured.newVaultRaw)throw failure();deps.retire();}
      result=await call('status');if(result.status==='unknown'||result.status==='committed'&&!result.current||result.status==='cancelled'&&deps.storage.getItem(primary(uid))!==cancelVaultRaw(captured))throw failure();
      primaryGuard();if(deps.storage.getItem(archive)!==raw)throw failure();deps.storage.removeItem(key);raw=null;guard();notify();return{result,identity:result.status==='committed'||cancelVaultRaw(captured)===captured.newVaultRaw?candidate:old};
    }finally{stop();}
  }),deps.mutation);
}
export async function regenerateCommsIdentity(uid:string,words:string[],guard:()=>void=()=>{},deps=defaults()){return(await operate(uid,words,'start',guard,deps)).identity;}
export async function recoverCommsIdentityRollover(uid:string,words:string[],guard:()=>void=()=>{},deps=defaults()){return operate(uid,words,'recover',guard,deps);}
export async function cancelCommsIdentityRollover(uid:string,words:string[],guard:()=>void=()=>{},deps=defaults()){return(await operate(uid,words,'cancel',guard,deps)).result;}
/** Read-only preview: both private keys remain local and the remote pair is only read. */
export async function inspectCommsIdentityConflict(uid:string,words:string[],outer:()=>void=()=>{},deps=defaults()):Promise<CommsIdentityConflictPreview>{
  const phrase=[...words];if(!attachmentActorIdValid(uid)||phrase.length!==12)throw failure();
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:comms-identity:v1:${encodeURIComponent(uid)}`,async()=>{
    let changed=false;const stop=deps.observeStorage(uid,()=>{changed=true;});const key=commsIdentityRolloverKey(uid);let raw:string|null=null;
    const guard=()=>{outer();context.assertCurrent();if(changed||!raw||deps.storage.getItem(key)!==raw||deps.storage.getItem(commsIdentityBackupRecoveryKey(uid))!==null)throw failure();};
    try{
      raw=deps.storage.getItem(key);guard();const journal=await decode(raw!,uid,guard,deps);guard();const local=deps.storage.getItem(primary(uid));
      const primaryGuard=()=>{guard();if(deps.storage.getItem(primary(uid))!==local||local!==journal.oldVaultRaw&&local!==journal.newVaultRaw)throw failure();};
      primaryGuard();const old=await deps.open(uid,phrase,journal.oldVaultRaw,primaryGuard),candidate=await deps.open(uid,phrase,journal.newVaultRaw,primaryGuard);primaryGuard();
      const digest=await hash(commsIdentityRequestBytes(journal.request)),fingerprint=await hash(candidate.pemPublic);primaryGuard();
      if(await hash(old.pemPublic)!==localPriorFingerprint(journal)||candidate.pemPublic!==journal.request.publicKeyPem)throw failure();primaryGuard();
      const result=outcome(await deps.call('status',{actorUid:uid,request:journal.request}),journal.request,digest,fingerprint);primaryGuard();if(result.status!=='committed'||result.current)throw failure();
      const baseline=parseCommsIdentityBaseline(await deps.call('prepare',{actorUid:uid,request:{}}));primaryGuard();if(baseline.priorFingerprint===fingerprint)throw failure();
      const journalDigest=await hash(raw!);primaryGuard();return{uid,operationId:journal.request.operationId,journalDigest,candidateFingerprint:fingerprint,baseline};
    }finally{stop();}
  }),deps.mutation);
}
/** A new nonce explicitly republishes the retained candidate against the reviewed remote baseline. */
export async function republishCommsIdentityConflict(uid:string,words:string[],preview:CommsIdentityConflictPreview,guard:()=>void=()=>{},deps=defaults()){
  return operate(uid,words,'republish',guard,deps,preview);
}
/** Retained ciphertext identities are local-only and never published as the active public key. */
export async function loadRetainedCommsIdentities(uid:string,words:string[],outer:()=>void=()=>{},deps=defaults()){
  const capturedWords=[...words];
  return withPersonalMemoryMutation(uid,async context=>{const guard=()=>{outer();context.assertCurrent();if(deps.storage.getItem(commsIdentityBackupRecoveryKey(uid))!==null)throw failure();};guard();const identities:Awaited<ReturnType<typeof openEncryptedIdentity>>[]=[];const seen=new Set<string>();
    for(const key of historyKeys(uid,deps.storage)){guard();const raw=deps.storage.getItem(key);if(!raw)throw failure();const result=await openCommsIdentityHistory(uid,capturedWords,raw,guard,deps);guard();if(!key.endsWith(':'+result.operationId)||deps.storage.getItem(key)!==raw)throw failure();
      for(const {identity} of result.vaults){if(!seen.has(identity.pemPublic)){seen.add(identity.pemPublic);identities.push(identity);}}
    }guard();return identities;
  },deps.mutation);
}
