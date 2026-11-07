import {doc,getDocFromServer} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import app,{auth,db} from '../firebase';
import {TEAM_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {encryptTeamMemoryFields,decryptTeamMemoryEnvelope,getTeamKeyCacheGeneration,onTeamKeyChanged} from './teamVault';
import {unlockTeamKey} from './teamKeyAccess';
import {parseTeam} from './teamsService';
import {readSessionMnemonic} from '../utils/sessionMnemonic';
import {canonicalSyncState} from '../../../functions/src/mobileSyncImportContract';
import {parseTeamRevisionTarget,parseTeamRevisionBaseline,parseTeamRevisionRequest,parseTeamRevisionCipher,teamRevisionTime,teamRevisionRequestBytes,TEAM_REVISION_MAX_BYTES,type TeamRevisionBaseline,type TeamRevisionRequest,type TeamRevisionOutcome} from '../../../functions/src/teamRevisionContract';
import type {PersonalRevisionContent} from './personalLearnedRevision';
export type {TeamRevisionBaseline};
export class TeamRevisionError extends Error{readonly reason:'closed'|'baseline'|'pending'|'checkpoint'|'confirmation';constructor(reason:TeamRevisionError['reason']){super(reason==='baseline'?'A memória ou o acesso à equipa mudou desde que a edição foi aberta. Conserva o rascunho e volta a abrir a memória antes de rever.':reason==='closed'?'A revisão de equipa está em validação antes do lançamento.':'A revisão de equipa aguarda confirmação. Recupera ou cancela o pedido local antes de repetir.');this.reason=reason;}}
export interface TeamRevisionDeps{
  enabled:()=>boolean;storage:Storage;mutation?:PersonalMemoryMutationDeps;id:()=>string;exclusive:typeof withClipCaptureLock;
  read:(id:string)=>Promise<Record<string,unknown>|undefined>;key:(baseline:TeamRevisionBaseline,prior:boolean,guard:()=>void)=>Promise<CryptoKey>;
  encryptJournal:typeof encryptMemoryFields;decryptJournal:typeof decryptMemoryEnvelope;encryptContent:typeof encryptTeamMemoryFields;decryptContent:typeof decryptTeamMemoryEnvelope;
  call:(mode:'prepare'|'apply'|'status'|'cancel',command:{actorUid:string;request:unknown})=>Promise<unknown>;
  generation:()=>number;observe:(uid:string,changed:()=>void)=>()=>void;
}
export const teamRevisionCheckpointKey=(uid:string)=>`mnemosyne:team-revision:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:team-revision-changed',notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingTeamRevision(uid:string){try{return localStorage.getItem(teamRevisionCheckpointKey(uid))!==null;}catch{return true;}}
export function observeTeamRevisions(callback:()=>void,owner:()=>string|null=()=>auth.currentUser?.uid??null){const storage=(value:StorageEvent)=>{const uid=owner();if(uid&&(value.key===null||value.key===teamRevisionCheckpointKey(uid)))callback();};window.addEventListener(event,callback);window.addEventListener('storage',storage);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',storage);};}
const defaults=():TeamRevisionDeps=>({enabled:()=>TEAM_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,read:async id=>(await getDocFromServer(doc(db,'sessions',id))).data(),
  key:async(baseline,prior,guard)=>{const uid=auth.currentUser?.uid;if(!uid)throw new TeamRevisionError('baseline');const words=readSessionMnemonic();if(!words)throw new TeamRevisionError('baseline');const team=parseTeam(baseline.teamId,(await getDocFromServer(doc(db,'teams',baseline.teamId))).data()??{});guard();if(!team||team.activeKeyEpoch!==baseline.keyEpoch||team.activeKeyId!==baseline.keyId)throw new TeamRevisionError('baseline');return unlockTeamKey(team,uid,[...words],{epoch:prior?baseline.priorKeyEpoch:baseline.keyEpoch,notify:false,isCurrent:()=>{guard();return true;}});},
  encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,encryptContent:encryptTeamMemoryFields,decryptContent:decryptTeamMemoryEnvelope,generation:getTeamKeyCacheGeneration,
  call:async(mode,command)=>{const names={prepare:'prepareTeamRevision',apply:'applyTeamRevision',status:'getTeamRevisionStatus',cancel:'cancelTeamRevision'};return(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(command)).data;},
  observe:(uid,changed)=>{const stopTeam=onTeamKeyChanged(changed),listener=(value:StorageEvent)=>{if(value.key===null||value.key===teamRevisionCheckpointKey(uid))changed();};window.addEventListener('storage',listener);return()=>{stopTeam();window.removeEventListener('storage',listener);};},
});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const fail=(reason:TeamRevisionError['reason']='checkpoint')=>new TeamRevisionError(reason);
async function readBaseline(uid:string,target:{sessionId:string;teamId:string},guard:()=>void,deps:TeamRevisionDeps){
  const before=await deps.read(target.sessionId);guard();if(!before||before.teamId!==target.teamId||before.deletedAt!=null||before.text!==''||before.title!=null||['nodes','links','generatedPrompt','generatedImagePrompt'].some(key=>before[key]!=null))throw fail('baseline');const enc=parseTeamRevisionCipher(before.enc),digest=await hash(canonicalSyncState(before));guard();
  const baseline=parseTeamRevisionBaseline(await deps.call('prepare',{actorUid:uid,request:target}));guard();if(baseline.sessionId!==target.sessionId||baseline.teamId!==target.teamId||baseline.authorUid!==before.uid||baseline.stateDigest!==digest||baseline.revision!==teamRevisionTime(before.updatedAt??before.timestamp)||baseline.priorKeyEpoch!==(before.keyEpoch??1)||baseline.priorKeyId!==(before.keyId??null))throw fail('baseline');
  return{before,enc,baseline};
}
async function scoped<T>(uid:string,outer:()=>void,deps:TeamRevisionDeps,work:(guard:()=>void)=>Promise<T>){
  return withPersonalMemoryMutation(uid,context=>{const generation=deps.generation();let changed=false;const stop=deps.observe(uid,()=>{changed=true;});const guard=()=>{outer();context.assertCurrent();if(changed||deps.generation()!==generation)throw fail('baseline');};try{guard();return work(guard).finally(stop);}catch(error){stop();throw error;}},deps.mutation);
}
export async function captureTeamRevisionBaseline(input:{uid:string;id:string;teamId:string;keyEpoch:number;keyId:string;expected?:{text:string;title:string|null;authorUid?:string};assertCurrent?:()=>void},deps=defaults()):Promise<TeamRevisionBaseline>{
  const captured={...input,expected:input.expected?{...input.expected}:undefined},target=parseTeamRevisionTarget({sessionId:captured.id,teamId:captured.teamId});
  return scoped(captured.uid,()=>captured.assertCurrent?.(),deps,async guard=>{const read=await readBaseline(captured.uid,target,guard,deps);if(read.baseline.keyEpoch!==captured.keyEpoch||read.baseline.keyId!==captured.keyId||captured.expected?.authorUid&&read.baseline.authorUid!==captured.expected.authorUid)throw fail('baseline');
    const key=await deps.key(read.baseline,true,guard);guard();const fields=await deps.decryptContent(key,read.enc,{teamId:target.teamId,keyEpoch:read.baseline.priorKeyEpoch,keyId:read.baseline.priorKeyId??read.baseline.keyId},{strictPayload:true});guard();if(captured.expected&&(fields.text!==captured.expected.text||fields.title!==captured.expected.title))throw fail('baseline');return{...read.baseline};});
}
function outcome(value:unknown,request:TeamRevisionRequest,digest:string):TeamRevisionOutcome{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdAt,digest,operationId,revision,sessionId,status,teamId')throw fail('confirmation');const row=value as TeamRevisionOutcome;
  if(row.operationId!==request.operationId||row.sessionId!==request.baseline.sessionId||row.teamId!==request.baseline.teamId||row.digest!==digest||!['unknown','committed','cancelled','revoked'].includes(row.status)||(row.status==='committed'?teamRevisionTime(row.revision)===null||Number(row.revision)<=request.baseline.revision:row.revision!==null)||(row.status==='unknown'||row.status==='revoked'?row.createdAt!==null:teamRevisionTime(row.createdAt)===null||Number(row.createdAt)<1))throw fail('confirmation');return{...row};
}
async function journal(raw:string,uid:string,guard:()=>void,deps:TeamRevisionDeps){
  try{if(raw.length>3_000_000)throw fail();const enc:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(enc)||Object.keys(enc).sort().join(',')!=='ct,iv,v')throw fail();const text=(await deps.decryptJournal(enc)).text;guard();if(new TextEncoder().encode(text).length>TEAM_REVISION_MAX_BYTES+1000)throw fail();const row=JSON.parse(text);if(!row||Object.keys(row).sort().join(',')!=='request,uid,v'||row.v!==1||row.uid!==uid)throw fail();return parseTeamRevisionRequest(row.request);}catch{guard();throw fail();}
}
type Input={uid:string;id:string;teamId:string;baseline:TeamRevisionBaseline;prepare:(guard:()=>void)=>Promise<PersonalRevisionContent>;assertCurrent?:()=>void};
async function operate(uid:string,mode:'start'|'recover'|'cancel',input:Input|undefined,outer:()=>void,deps:TeamRevisionDeps){
  const captured=input?{...input,baseline:parseTeamRevisionBaseline(input.baseline)}:undefined;if(mode==='start'&&!deps.enabled())throw fail('closed');if(captured&&(captured.baseline.sessionId!==captured.id||captured.baseline.teamId!==captured.teamId))throw fail('baseline');
  return scoped(uid,()=>{outer();captured?.assertCurrent?.();},deps,scope=>deps.exclusive(teamRevisionCheckpointKey(uid),async()=>{
    scope();const key=teamRevisionCheckpointKey(uid),stored=()=>deps.storage.getItem(key);let raw=stored();const guard=()=>{scope();if(stored()!==raw)throw fail();};let request:TeamRevisionRequest;
    if(raw!==null){if(mode==='start')throw fail('pending');request=await journal(raw,uid,guard,deps);guard();}
    else{
      if(!captured||mode!=='start')throw fail('pending');const read=await readBaseline(uid,{sessionId:captured.id,teamId:captured.teamId},guard,deps);guard();if(canonicalSyncState(read.baseline)!==canonicalSyncState(captured.baseline))throw fail('baseline');
      const content=structuredClone(await captured.prepare(guard));guard();if(!content||typeof content.text!=='string'||new TextEncoder().encode(content.text).length>500_000||content.title!==null&&(typeof content.title!=='string'||new TextEncoder().encode(content.title).length>2000))throw fail();
      const teamKey=await deps.key(read.baseline,false,guard);guard();const enc=await deps.encryptContent(teamKey,content,{teamId:read.baseline.teamId,keyEpoch:read.baseline.keyEpoch,keyId:read.baseline.keyId});guard();
      request=parseTeamRevisionRequest({operationId:deps.id(),baseline:captured.baseline,enc,priorEnc:read.enc,metadata:{embedding:content.embedding,embeddingModel:content.embeddingModel,semanticClusterId:content.semanticClusterId,position:content.position,importance:content.importance,processingMethod:content.processingMethod}});
      const next=JSON.stringify(await deps.encryptJournal({text:JSON.stringify({v:1,uid,request})}));guard();if(next.length>3_000_000)throw fail();await journal(next,uid,guard,deps);guard();deps.storage.setItem(key,next);raw=next;guard();notify();guard();
    }
    const digest=await hash(teamRevisionRequestBytes(request));guard();const call=async(which:'apply'|'status'|'cancel')=>{guard();const result=outcome(await deps.call(which,{actorUid:uid,request}),request,digest);guard();return result;};
    let result=await call('status');if(result.status==='unknown'){if(mode!=='cancel'&&!deps.enabled())throw fail('pending');result=await call(mode==='cancel'?'cancel':'apply');}if(result.status==='unknown')throw fail('confirmation');const confirmed=await call('status');if(canonicalSyncState(result)!==canonicalSyncState(confirmed))throw fail('confirmation');
    guard();deps.storage.removeItem(key);raw=null;guard();notify();guard();return confirmed;
  }));
}
export async function reviseTeamLearnedMemory(input:Input,deps=defaults()){const result=await operate(input.uid,'start',input,()=>{},deps);if(result.status!=='committed')throw fail('confirmation');return result;}
export async function recoverPendingTeamRevision(uid:string,outer:()=>void=()=>{},deps=defaults()){return operate(uid,'recover',undefined,outer,deps);}
export async function cancelPendingTeamRevision(uid:string,outer:()=>void=()=>{},deps=defaults()){return operate(uid,'cancel',undefined,outer,deps);}
