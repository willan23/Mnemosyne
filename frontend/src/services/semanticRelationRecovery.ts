import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {PERSONAL_CONNECTION_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {decryptMemoryEnvelope,encryptMemoryFields,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {canonicalSyncState,syncInteger} from '../../../functions/src/mobileSyncImportContract';
import {parseSemanticRelationCandidates,parseSemanticRelationCandidateTarget,parseSemanticRelationReviewTarget,parseSemanticRelationReviewBase,parseSemanticRelationRequest,semanticRelationRequestBytes,semanticRelationProjection,type SemanticRelationCandidates,type SemanticRelationRequest,type SemanticRelationReviewBase,type SemanticRelationReviewTarget,type SemanticRelationCall,type SemanticRelationOutcome} from '../../../functions/src/semanticRelationContract';
import type {SemanticRelationProposal} from './semanticConnectionBackfill';

export class SemanticRelationError extends Error{readonly reason:'closed'|'pending'|'baseline'|'journal'|'confirmation';constructor(reason:SemanticRelationError['reason']){super('A operação de relações aguarda confirmação. O pedido cifrado foi conservado.');this.reason=reason;}}
export interface SemanticRelationDeps{enabled:()=>boolean;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;id:()=>string;exclusive:typeof withClipCaptureLock;mutation?:PersonalMemoryMutationDeps;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;call:(mode:SemanticRelationCall,command:{actorUid:string;request:unknown})=>Promise<unknown>}
const names={'prepare-candidates':'prepareSemanticRelationCandidates','prepare-review':'prepareSemanticRelationReview',apply:'applySemanticRelations',status:'getSemanticRelationStatus',cancel:'cancelSemanticRelations'};
const defaults=():SemanticRelationDeps=>({enabled:()=>PERSONAL_CONNECTION_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,call:async(mode,command)=>(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(command)).data});
const failure=(reason:SemanticRelationError['reason']='journal')=>new SemanticRelationError(reason),event='mnemosyne:semantic-relations-changed',notify=()=>window.dispatchEvent(new Event(event));
const resumedEvent='mnemosyne:semantic-relations-resumed';
export const semanticRelationCheckpointKey=(uid:string)=>'mnemosyne:semantic-relations:v1:'+encodeURIComponent(uid);
export function observeSemanticRelations(change:()=>void){window.addEventListener(event,change);window.addEventListener('storage',change);return()=>{window.removeEventListener(event,change);window.removeEventListener('storage',change);};}
export function observeSemanticRelationResumed(uid:string,change:()=>void){const callback=(event:Event)=>{if((event as CustomEvent).detail===uid)change();};window.addEventListener(resumedEvent,callback);return()=>window.removeEventListener(resumedEvent,callback);}
export function hasPendingSemanticRelations(uid:string,storage:Pick<Storage,'getItem'>=localStorage){try{return storage.getItem(semanticRelationCheckpointKey(uid))!==null;}catch{return true;}}
export const semanticRelationWritesEnabled=()=>PERSONAL_CONNECTION_WRITES_ENABLED;
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
export const semanticRelationViewHash=(id:string,row:Record<string,unknown>)=>hash(canonicalSyncState(semanticRelationProjection(id,row)));
export async function prepareSemanticRelationCandidates(uid:string,views:Array<{sessionId:string;viewHash:string}>,guard:()=>void=()=>{},deps=defaults()):Promise<SemanticRelationCandidates>{
  const target=parseSemanticRelationCandidateTarget({views});if(!deps.enabled())throw failure('closed');if(hasPendingSemanticRelations(uid,deps.storage))throw failure('pending');
  return withPersonalMemoryMutation(uid,async context=>{const current=()=>{guard();context.assertCurrent();};current();const prepared=parseSemanticRelationCandidates(await deps.call('prepare-candidates',{actorUid:uid,request:target}));current();if(prepared.ownerUid!==uid||prepared.dependencies.length!==target.views.length||prepared.dependencies.some((row,index)=>row.sessionId!==target.views[index].sessionId))throw failure('baseline');return prepared;},deps.mutation);
}
export async function prepareSemanticRelationReview(uid:string,view:SemanticRelationReviewTarget,guard:()=>void=()=>{},deps=defaults()):Promise<SemanticRelationReviewBase>{
  const target=parseSemanticRelationReviewTarget(view);if(!deps.enabled())throw failure('closed');if(hasPendingSemanticRelations(uid,deps.storage))throw failure('pending');
  return withPersonalMemoryMutation(uid,async context=>{const current=()=>{guard();context.assertCurrent();};current();const base=parseSemanticRelationReviewBase(await deps.call('prepare-review',{actorUid:uid,request:target}));current();if(base.ownerUid!==uid||base.sourceId!==target.sourceId||base.targetId!==target.targetId)throw failure('baseline');return base;},deps.mutation);
}
function outcome(value:unknown,request:SemanticRelationRequest,digest:string):SemanticRelationOutcome{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='changes,createdAt,digest,kind,operationId,status')throw failure('confirmation');const row=value as SemanticRelationOutcome;
  if(row.kind!==request.kind||row.operationId!==request.operationId||row.digest!==digest||!['unknown','committed','cancelled','revoked'].includes(row.status)||(row.status==='committed'?!syncInteger(row.changes)||row.changes>16:row.changes!==null)||(['unknown','revoked'].includes(row.status)?row.createdAt!==null:!syncInteger(row.createdAt)||row.createdAt<1))throw failure('confirmation');return{...row};
}
async function decode(raw:string,uid:string,guard:()=>void,deps:SemanticRelationDeps){try{
  if(raw.length>100000)throw failure();const header=JSON.parse(raw);if(!header||Object.keys(header).sort().join(',')!=='enc,revision,uid,v'||header.v!==1||header.uid!==uid||typeof header.revision!=='string'||!isEncryptedMemoryEnvelope(header.enc))throw failure();const text=(await deps.decrypt(header.enc)).text;guard();if(new TextEncoder().encode(text).length>65000)throw failure();const body=JSON.parse(text);if(!body||Object.keys(body).sort().join(',')!=='request,uid,v'||body.v!==1||body.uid!==uid)throw failure();const request=parseSemanticRelationRequest(body.request);if(header.revision!==request.operationId)throw failure();return request;
}catch{guard();throw failure();}}
async function operate(uid:string,mode:'start'|'recover'|'cancel',proposal:Omit<Extract<SemanticRelationRequest,{kind:'suggest'}>,'operationId'>|Omit<Extract<SemanticRelationRequest,{kind:'review'}>,'operationId'>|undefined,outer:()=>void,deps:SemanticRelationDeps){
  const captured=proposal?structuredClone(proposal):undefined;if(mode==='start'&&!deps.enabled())throw failure('closed');
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(semanticRelationCheckpointKey(uid),async()=>{
    const key=semanticRelationCheckpointKey(uid),scope=()=>{outer();context.assertCurrent();};scope();let bytes=deps.storage.getItem(key);const guard=()=>{scope();if(deps.storage.getItem(key)!==bytes)throw failure();};let request:SemanticRelationRequest;
    if(bytes!==null){if(mode==='start')throw failure('pending');request=await decode(bytes,uid,guard,deps);guard();}
    else{if(mode!=='start'||!captured)throw failure('pending');request=parseSemanticRelationRequest({...captured,operationId:deps.id()});if((request.kind==='suggest'?request.ownerUid:request.baseline.ownerUid)!==uid)throw failure('baseline');if(new TextEncoder().encode(semanticRelationRequestBytes(request)).length>64000)throw failure();const enc=await deps.encrypt({text:JSON.stringify({v:1,uid,request})});guard();const next=JSON.stringify({v:1,uid,revision:request.operationId,enc});if(next.length>100000||semanticRelationRequestBytes(await decode(next,uid,guard,deps))!==semanticRelationRequestBytes(request))throw failure();guard();deps.storage.setItem(key,next);bytes=next;guard();notify();}
    const digest=await hash(semanticRelationRequestBytes(request));guard();const call=async(mode:SemanticRelationCall)=>{guard();const result=await deps.call(mode,{actorUid:uid,request});guard();return outcome(result,request,digest);};let result=await call('status');
    if(result.status==='unknown'){if(mode!=='cancel'&&!deps.enabled())throw failure('pending');result=await call(mode==='cancel'?'cancel':'apply');}if(result.status==='unknown')throw failure('confirmation');const confirmed=await call('status');if(canonicalSyncState(result)!==canonicalSyncState(confirmed))throw failure('confirmation');guard();deps.storage.removeItem(key);bytes=null;guard();notify();return confirmed;
  }),deps.mutation);
}
export async function persistSemanticRelationSource(uid:string,prepared:SemanticRelationCandidates,sourceId:string,proposals:SemanticRelationProposal[],guard:()=>void=()=>{},deps=defaults()){
  const baseline=parseSemanticRelationCandidates(prepared),byId=new Map(baseline.dependencies.map(row=>[row.sessionId,row])),ids=[sourceId,...proposals.map(row=>row.targetId)];const dependencies=ids.map(id=>{const row=byId.get(id);if(!row)throw failure('baseline');return row;});
  const result=await operate(uid,'start',{kind:'suggest',ownerUid:baseline.ownerUid,sourceId,dependencies,proposals},guard,deps);if(result.status!=='committed')throw failure('confirmation');return result;
}
export async function applySemanticRelationReview(uid:string,baseline:SemanticRelationReviewBase,decision:'accepted'|'rejected',guard:()=>void=()=>{},deps=defaults()){
  const result=await operate(uid,'start',{kind:'review',baseline:parseSemanticRelationReviewBase(baseline),decision},guard,deps);if(result.status!=='committed')throw failure('confirmation');return result;
}
export const recoverSemanticRelation=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,'recover',undefined,guard,deps).then(result=>{guard();if(result.kind==='suggest'&&result.status==='committed')window.dispatchEvent(new CustomEvent(resumedEvent,{detail:uid}));return result;});
export const cancelSemanticRelation=(uid:string,guard:()=>void=()=>{},deps=defaults())=>operate(uid,'cancel',undefined,guard,deps);
