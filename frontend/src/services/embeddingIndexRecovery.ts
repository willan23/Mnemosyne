import {doc,getDocFromServer} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import app,{auth,db} from '../firebase';
import {PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import type {SessionData} from '../hooks/useSessions';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope,resolveMemoryDocFields} from './memoryCrypto';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {readPreparedEmbedding} from './embeddingReindex';
import {embeddingProfileSpace,type EmbeddingProfileId} from './embeddingProfile';
import {canonicalSyncState,parseSyncCipher,syncInteger} from '../../../functions/src/mobileSyncImportContract';
import {EMBEDDING_INDEX_TARGET_SPACE,embeddingIndexRequestBytes,parseEmbeddingIndexBaseline,parseEmbeddingIndexRequest,
  type EmbeddingIndexBaseline,type EmbeddingIndexCall,type EmbeddingIndexOutcome,type EmbeddingIndexRequest} from '../../../functions/src/embeddingIndexContract';

export type {EmbeddingIndexBaseline};
export class EmbeddingIndexRecoveryError extends Error {
  readonly reason:'closed'|'baseline'|'pending'|'checkpoint'|'confirmation';
  constructor(reason:EmbeddingIndexRecoveryError['reason']) {
    super(reason==='closed'?'A publicação de vetores está em validação antes do lançamento.':reason==='baseline'?
      'A memória, conta ou cofre mudou. Atualiza a preparação antes de publicar.':'A alteração do índice aguarda confirmação. Conserva o pedido cifrado para recuperar ou cancelar.');
    this.reason=reason;
  }
}
export interface EmbeddingIndexRecoveryDeps {
  enabled:()=>boolean; storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>; id:()=>string;
  exclusive:typeof withClipCaptureLock; mutation?:PersonalMemoryMutationDeps;
  read:(id:string)=>Promise<Record<string,unknown>|undefined>;
  encrypt:typeof encryptMemoryFields; decrypt:typeof decryptMemoryEnvelope; prepared:typeof readPreparedEmbedding;
  observe:(key:string,changed:()=>void)=>()=>void;
  call:(mode:EmbeddingIndexCall,command:{actorUid:string;request:unknown})=>Promise<unknown>;
}
const names={prepare:'prepareEmbeddingIndexRevision',apply:'applyEmbeddingIndexRevision',status:'getEmbeddingIndexRevisionStatus',cancel:'cancelEmbeddingIndexRevision'};
const defaults=():EmbeddingIndexRecoveryDeps=>({enabled:()=>PERSONAL_REVISION_WRITES_ENABLED,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,
  read:async id=>(await getDocFromServer(doc(db,'sessions',id))).data(),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,prepared:readPreparedEmbedding,
  observe:(key,changed)=>{const listener=(event:StorageEvent)=>{if(event.key===null||event.key===key)changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
  call:async(mode,command)=>(await httpsCallable(getFunctions(app,'europe-west1'),names[mode])(command)).data});
export const embeddingIndexCheckpointKey=(uid:string)=>`mnemosyne:embedding-index:v1:${encodeURIComponent(uid)}`;
const event='mnemosyne:embedding-index-changed',notify=()=>window.dispatchEvent(new Event(event));
export function hasPendingEmbeddingIndex(uid:string,storage:Pick<Storage,'getItem'>=localStorage) {
  try{return storage.getItem(embeddingIndexCheckpointKey(uid))!==null;}catch{return true;}
}
export function observeEmbeddingIndexRequests(callback:()=>void,owner:()=>string|null=()=>auth.currentUser?.uid??null) {
  const changed=(value:StorageEvent)=>{const uid=owner();if(uid&&(value.key===null||value.key===embeddingIndexCheckpointKey(uid)))callback();};
  window.addEventListener(event,callback);window.addEventListener('storage',changed);
  return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',changed);};
}
const fail=(reason:EmbeddingIndexRecoveryError['reason']='checkpoint')=>new EmbeddingIndexRecoveryError(reason);
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export const embeddingIndexViewDigest=(value:Record<string,unknown>)=>hash(canonicalSyncState(value));
function personal(row:Record<string,unknown>|undefined,uid:string):asserts row is Record<string,unknown> {
  if(!row||row.uid!==uid||row.teamId!==null||row.teamScopeAmbiguous===true||row.deletedAt!=null||row.text!==''||row.title!=null||
    row.sharedWithIds!=null&&(!Array.isArray(row.sharedWithIds)||row.sharedWithIds.length!==0)||!syncInteger(row.timestamp)||!syncInteger(row.updatedAt??row.timestamp))throw fail('baseline');
  parseSyncCipher(row.enc);
}
async function readBaseline(uid:string,id:string,guard:()=>void,deps:EmbeddingIndexRecoveryDeps) {
  const row=await deps.read(id);guard();personal(row,uid);const digest=await embeddingIndexViewDigest(row);guard();
  const baseline=parseEmbeddingIndexBaseline(await deps.call('prepare',{actorUid:uid,request:{sessionId:id,viewDigest:digest}}));guard();
  const contentDigest=await hash(canonicalSyncState({uid:row.uid,teamId:row.teamId,enc:row.enc,keyEpoch:row.keyEpoch??null,keyId:row.keyId??null}));guard();
  if(baseline.sessionId!==id||baseline.ownerUid!==uid||baseline.stateDigest!==digest||baseline.contentDigest!==contentDigest||baseline.revision!==(row.updatedAt??row.timestamp))throw fail('baseline');
  const fields=await resolveMemoryDocFields(row);guard();if(fields.locked||!fields.encrypted)throw fail('baseline');return{row,baseline,fields};
}
export async function captureEmbeddingIndexBaseline(input:{uid:string;id:string;viewDigest:string;assertCurrent?:()=>void},deps=defaults()) {
  const captured={...input};return withPersonalMemoryMutation(captured.uid,async context=>{
    const guard=()=>{context.assertCurrent();captured.assertCurrent?.();};guard();const read=await readBaseline(captured.uid,captured.id,guard,deps);guard();
    if(read.baseline.stateDigest!==captured.viewDigest)throw fail('baseline');return{...read.baseline};
  },deps.mutation);
}
function outcome(value:unknown,request:EmbeddingIndexRequest,digest:string):EmbeddingIndexOutcome {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='createdAt,digest,operationId,revision,sessionId,status,versionId')throw fail('confirmation');
  const row=value as EmbeddingIndexOutcome,terminal=row.status==='committed'||row.status==='cancelled';
  if(row.operationId!==request.operationId||row.sessionId!==request.baseline.sessionId||row.digest!==digest||
    !['unknown','committed','cancelled','revoked'].includes(row.status)||
    (row.status==='committed'?(!syncInteger(row.revision)||row.revision<=request.baseline.revision||row.versionId!=='embedding-index-'+request.operationId):row.revision!==null||row.versionId!==null)||
    (terminal?!syncInteger(row.createdAt)||row.createdAt<1:row.createdAt!==null))throw fail('confirmation');return{...row};
}
async function openJournal(raw:string,uid:string,guard:()=>void,deps:EmbeddingIndexRecoveryDeps) {
  try{
    if(raw.length>300000)throw fail();const envelope:unknown=JSON.parse(raw);
    if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw fail();
    const text=(await deps.decrypt(envelope)).text;guard();if(new TextEncoder().encode(text).length>100000)throw fail();const row=JSON.parse(text);
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='kind,request,uid,v'||row.v!==1||row.kind!=='embedding-index'||row.uid!==uid)throw fail();
    const request=parseEmbeddingIndexRequest(row.request);if(request.baseline.ownerUid!==uid)throw fail();return request;
  }catch{guard();throw fail();}
}
type CommonInput={uid:string;id:string;baseline:EmbeddingIndexBaseline;assertCurrent?:()=>void};
type PublishInput=CommonInput&{profile:EmbeddingProfileId;readCurrent:()=>SessionData|undefined};
type RollbackInput=CommonInput&{versionId:string};
async function operate(uid:string,mode:'start'|'recover'|'cancel',input:PublishInput|RollbackInput|undefined,outer:()=>void,deps:EmbeddingIndexRecoveryDeps) {
  const captured=input?{...input,baseline:parseEmbeddingIndexBaseline(input.baseline)}:undefined;
  if(captured&&(captured.id!==captured.baseline.sessionId||captured.baseline.ownerUid!==uid))throw fail('baseline');
  if(mode==='start'&&(!captured||!deps.enabled()))throw fail('closed');
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(embeddingIndexCheckpointKey(uid),async()=>{
    const key=embeddingIndexCheckpointKey(uid);let changed=false;const stop=deps.observe(key,()=>{changed=true;});
    const scope=()=>{context.assertCurrent();outer();captured?.assertCurrent?.();if(changed)throw fail();};
    try{
      scope();const stored=()=>deps.storage.getItem(key);let raw=stored();const guard=()=>{scope();if(stored()!==raw)throw fail();};let request:EmbeddingIndexRequest;
      if(raw!==null){if(mode==='start')throw fail('pending');request=await openJournal(raw,uid,guard,deps);guard();}
      else{
        if(mode!=='start'||!captured)throw fail('pending');const read=await readBaseline(uid,captured.id,guard,deps);guard();
        if(canonicalSyncState(read.baseline)!==canonicalSyncState(captured.baseline))throw fail('baseline');
        let change:EmbeddingIndexRequest['change'];
        if('profile' in captured){
          if(embeddingProfileSpace(captured.profile)!==EMBEDDING_INDEX_TARGET_SPACE)throw fail('baseline');const current=captured.readCurrent();
          if(!current||current.id!==captured.id||current.uid!==uid||current.teamId!=null||current.teamScopeAmbiguous||current.encLocked||current.deletedAt!=null||
            current.syncConflictDigest!==captured.baseline.stateDigest||current.updatedAt!==captured.baseline.revision||current.text!==read.fields.text||(current.title??null)!==(read.fields.title??null))throw fail('baseline');
          const prepared=await deps.prepared(uid,captured.profile,captured.readCurrent,{signal:new AbortController().signal});guard();
          if(!prepared||prepared.uid!==uid||prepared.memoryId!==captured.id||prepared.space!==EMBEDDING_INDEX_TARGET_SPACE||captured.readCurrent()!==current)throw fail('baseline');
          change={kind:'publish',space:prepared.space,vector:[...prepared.vector]};
        }else change={kind:'rollback',versionId:captured.versionId};
        guard();request=parseEmbeddingIndexRequest({operationId:deps.id(),baseline:captured.baseline,change});
        const next=JSON.stringify(await deps.encrypt({text:JSON.stringify({v:1,kind:'embedding-index',uid,request})}));guard();
        const checked=await openJournal(next,uid,guard,deps);guard();if(embeddingIndexRequestBytes(checked)!==embeddingIndexRequestBytes(request))throw fail();
        deps.storage.setItem(key,next);raw=next;guard();notify();guard();
      }
      const digest=await hash(embeddingIndexRequestBytes(request));guard();const call=async(which:'status'|'apply'|'cancel')=>{
        guard();const result=outcome(await deps.call(which,{actorUid:uid,request}),request,digest);guard();return result;
      };
      let result=await call('status');
      if(result.status==='unknown'||result.status==='revoked'){
        // Revocation without a receipt is not a durable cancellation. Seal it before clearing the journal.
        const cancel=mode==='cancel'||result.status==='revoked';if(!cancel&&!deps.enabled())throw fail('pending');
        result=await call(cancel?'cancel':'apply');
      }
      if(result.status!=='committed'&&result.status!=='cancelled')throw fail('confirmation');
      const confirmed=await call('status');if(canonicalSyncState(result)!==canonicalSyncState(confirmed))throw fail('confirmation');
      guard();deps.storage.removeItem(key);raw=null;guard();notify();guard();return confirmed;
    }finally{stop();}
  }),deps.mutation);
}
export async function publishPreparedEmbedding(input:PublishInput,deps=defaults()) {
  const result=await operate(input.uid,'start',input,()=>{},deps);if(result.status!=='committed')throw fail('confirmation');return result;
}
export async function rollbackPublishedEmbedding(input:RollbackInput,deps=defaults()) {
  const result=await operate(input.uid,'start',input,()=>{},deps);if(result.status!=='committed')throw fail('confirmation');return result;
}
export const recoverPendingEmbeddingIndex=(uid:string,outer:()=>void=()=>{},deps=defaults())=>operate(uid,'recover',undefined,outer,deps);
export const cancelPendingEmbeddingIndex=(uid:string,outer:()=>void=()=>{},deps=defaults())=>operate(uid,'cancel',undefined,outer,deps);

/** Pending requests have no automatic expiry: their nonce may identify a committed server write. */
async function pending<T>(uid:string,outer:()=>void,deps:EmbeddingIndexRecoveryDeps,consume:(raw:string,request:EmbeddingIndexRequest,guard:()=>void)=>Promise<T>) {
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(embeddingIndexCheckpointKey(uid),async()=>{
    const key=embeddingIndexCheckpointKey(uid);let changed=false;const stop=deps.observe(key,()=>{changed=true;});
    try{const raw=deps.storage.getItem(key);const guard=()=>{context.assertCurrent();outer();if(changed||deps.storage.getItem(key)!==raw)throw fail();};
      guard();if(raw===null)throw fail('pending');const request=await openJournal(raw,uid,guard,deps);guard();const result=await consume(raw,request,guard);guard();return result;
    }finally{stop();}
  }),deps.mutation);
}
export function inspectPendingEmbeddingIndex(uid:string,outer:()=>void=()=>{},deps=defaults()) {
  return pending(uid,outer,deps,async(_raw,request)=>({operationId:request.operationId,sessionId:request.baseline.sessionId,
    kind:request.change.kind,revision:request.baseline.revision}));
}
export function exportPendingEmbeddingIndex(uid:string,outer:()=>void=()=>{},deps=defaults()):Promise<string> {
  return pending(uid,outer,deps,async(raw)=>JSON.stringify({format:'mnemosyne.embedding-index-request',v:1,uid,enc:JSON.parse(raw)},null,2));
}
/** Restores only encrypted local custody; no RPC or automatic apply is performed. */
export async function importPendingEmbeddingIndex(uid:string,bundle:string,outer:()=>void=()=>{},deps=defaults()) {
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(embeddingIndexCheckpointKey(uid),async()=>{
    const key=embeddingIndexCheckpointKey(uid);let changed=false;const stop=deps.observe(key,()=>{changed=true;});
    try{const prior=deps.storage.getItem(key),scope=()=>{context.assertCurrent();outer();if(changed)throw fail();};
      const guard=()=>{scope();if(deps.storage.getItem(key)!==prior)throw fail();};guard();if(prior!==null)throw fail('pending');
      if(typeof bundle!=='string'||new TextEncoder().encode(bundle).length>300000)throw fail();let data:Record<string,unknown>;
      try{data=JSON.parse(bundle);if(!data||Object.keys(data).sort().join(',')!=='enc,format,uid,v'||data.format!=='mnemosyne.embedding-index-request'||data.v!==1||data.uid!==uid)throw fail();}catch{throw fail();}
      const raw=JSON.stringify(data.enc),request=await openJournal(raw,uid,guard,deps);guard();
      deps.storage.setItem(key,raw);scope();if(deps.storage.getItem(key)!==raw)throw fail();notify();scope();if(deps.storage.getItem(key)!==raw)throw fail();
      return{operationId:request.operationId,sessionId:request.baseline.sessionId,kind:request.change.kind,revision:request.baseline.revision};
    }finally{stop();}
  }),deps.mutation);
}
