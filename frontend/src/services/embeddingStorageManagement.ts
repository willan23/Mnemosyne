import {collection,doc,documentId,getDocFromServer,getDocsFromServer,limit,orderBy,query,startAfter,where} from 'firebase/firestore';
import {db} from '../firebase';
import {PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import {withClipCaptureLock} from './clipCaptureService';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope,resolveMemoryDocFields} from './memoryCrypto';
import {captureEmbeddingIndexBaseline,compactStoredEmbedding,embeddingIndexViewDigest,hasPendingEmbeddingIndex,EmbeddingIndexRecoveryError} from './embeddingIndexRecovery';
import {parseEmbeddingIndexBaseline,type EmbeddingIndexBaseline} from '../../../functions/src/embeddingIndexContract';
import {readStoredEmbedding} from '../../../functions/src/embeddingStorage';
import {syncIdValid,syncInteger} from '../../../functions/src/mobileSyncImportContract';

export const EMBEDDING_STORAGE_PAGE_LIMIT=25;
export const embeddingStorageCursorKey=(uid:string)=>`mnemosyne:embedding-storage-cursor:v1:${encodeURIComponent(uid)}`;
type Scope={signal:AbortSignal;assertCurrent:()=>void};
export interface EmbeddingStoragePlan {
  readonly uid:string;readonly cursorRaw:string|null;readonly nextCursor:string|null;readonly scanned:number;readonly skipped:number;
  readonly items:readonly {readonly id:string;readonly baseline:EmbeddingIndexBaseline;readonly label:string;readonly dimensions:number}[];
}
export interface EmbeddingStorageDeps {
  enabled:()=>boolean;pending:(uid:string)=>boolean;mutation?:PersonalMemoryMutationDeps;
  storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;exclusive:typeof withClipCaptureLock;
  observe:(key:string,changed:()=>void)=>()=>void;
  page:(uid:string,after:string|null)=>Promise<{rows:Array<{id:string;data:Record<string,unknown>}>;nextCursor:string|null}>;
  read:(id:string)=>Promise<Record<string,unknown>|undefined>;
  capture:typeof captureEmbeddingIndexBaseline;compact:typeof compactStoredEmbedding;
  encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;label:(row:Record<string,unknown>)=>Promise<string>;
}
const fail=(reason:EmbeddingIndexRecoveryError['reason']='baseline')=>new EmbeddingIndexRecoveryError(reason);
const own=(row:Record<string,unknown>|undefined,uid:string)=>!!row&&row.uid===uid&&row.teamId===null&&!row.teamScopeAmbiguous;
const candidate=(row:Record<string,unknown>)=>row.deletedAt==null&&row.text===''&&row.title==null&&syncInteger(row.timestamp)&&syncInteger(row.updatedAt??row.timestamp)&&
  (row.sharedWithIds==null||Array.isArray(row.sharedWithIds)&&row.sharedWithIds.length===0)&&Array.isArray(row.embedding)&&row.embedding.length>0&&readStoredEmbedding(row.embedding)!==null;
const defaults=():EmbeddingStorageDeps=>({enabled:()=>PERSONAL_REVISION_WRITES_ENABLED,pending:hasPendingEmbeddingIndex,storage:localStorage,exclusive:withClipCaptureLock,
  observe:(key,changed)=>{const listener=(event:StorageEvent)=>{if(event.key===null||event.key===key)changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
  page:async(uid,after)=>{
    const base=query(collection(db,'sessions'),where('uid','==',uid),where('teamId','==',null),orderBy(documentId()));
    const request=after?query(base,startAfter(after),limit(EMBEDDING_STORAGE_PAGE_LIMIT)):query(base,limit(EMBEDDING_STORAGE_PAGE_LIMIT));
    const page=await getDocsFromServer(request);return{rows:page.docs.map(row=>({id:row.id,data:row.data()})),nextCursor:page.size===EMBEDDING_STORAGE_PAGE_LIMIT?page.docs[page.docs.length-1].id:null};
  },read:async id=>(await getDocFromServer(doc(db,'sessions',id))).data(),capture:captureEmbeddingIndexBaseline,compact:compactStoredEmbedding,
  encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,label:async row=>{const fields=await resolveMemoryDocFields(row);if(fields.locked||!fields.encrypted)throw fail();return(fields.title?.trim()||fields.text.slice(0,80)).slice(0,80);}});
const plans=new WeakSet<object>();
async function work<T>(uid:string,scope:Scope,deps:EmbeddingStorageDeps,run:(guard:()=>void,raw:string|null,save:(next:string|null)=>Promise<void>)=>Promise<T>,requireOpen=true):Promise<T>{
  return withPersonalMemoryMutation(uid,context=>deps.exclusive(embeddingStorageCursorKey(uid),async()=>{
    const key=embeddingStorageCursorKey(uid);let changed=false,raw=deps.storage.getItem(key);const stop=deps.observe(key,()=>{changed=true;});
    const guard=()=>{context.assertCurrent();scope.assertCurrent();if(scope.signal.aborted||changed||deps.storage.getItem(key)!==raw)throw fail('checkpoint');if(requireOpen&&!deps.enabled())throw fail('closed');};
    const save=async(next:string|null)=>{guard();if(next!==null&&!syncIdValid(next))throw fail();
      const value=next===null?null:JSON.stringify(await deps.encrypt({text:JSON.stringify({v:1,uid,lastId:next})}));guard();
      if(value===null)deps.storage.removeItem(key);else deps.storage.setItem(key,value);raw=value;guard();};
    try{guard();return await run(guard,raw,save);}finally{stop();}
  }),deps.mutation);
}
async function cursor(raw:string|null,uid:string,guard:()=>void,deps:EmbeddingStorageDeps){
  if(raw===null)return null;
  try{if(raw.length>8192)throw fail('checkpoint');const envelope:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(envelope)||Object.keys(envelope).sort().join(',')!=='ct,iv,v')throw fail('checkpoint');
    const fields=await deps.decrypt(envelope);guard();if(fields.text.length>4096)throw fail('checkpoint');const value=JSON.parse(fields.text);
    if(!value||Object.keys(value).sort().join(',')!=='lastId,uid,v'||value.v!==1||value.uid!==uid||!syncIdValid(value.lastId))throw fail('checkpoint');return value.lastId as string;
  }catch{guard();throw fail('checkpoint');}
}
/** Reads a bounded page, not the current full-list view. No apply request is sent during review. */
export async function reviewEmbeddingStorage(uid:string,scope:Scope,deps=defaults()):Promise<EmbeddingStoragePlan>{
  if(!deps.enabled())throw fail('closed');if(deps.pending(uid))throw fail('pending');
  return work(uid,scope,deps,async(guard,raw)=>{
    const after=await cursor(raw,uid,guard,deps);guard();const page=await deps.page(uid,after);guard();
    if(page.rows.length>EMBEDDING_STORAGE_PAGE_LIMIT||new Set(page.rows.map(row=>row.id)).size!==page.rows.length||page.rows.some(row=>!syncIdValid(row.id)||!own(row.data,uid))||
      page.nextCursor!==null&&(!page.rows.length||page.nextCursor!==page.rows[page.rows.length-1].id||page.nextCursor===after))throw fail();
    const items:EmbeddingStoragePlan['items'][number][]=[];
    for(const row of page.rows){guard();if(deps.pending(uid))throw fail('pending');if(!candidate(row.data))continue;
      const viewDigest=await embeddingIndexViewDigest(row.data);guard();const baseline=parseEmbeddingIndexBaseline(await deps.capture({uid,id:row.id,viewDigest,assertCurrent:guard}));guard();
      if(baseline.ownerUid!==uid||baseline.sessionId!==row.id||baseline.stateDigest!==viewDigest||baseline.revision!==(row.data.updatedAt??row.data.timestamp))throw fail();
      const label=await deps.label(row.data);guard();items.push(Object.freeze({id:row.id,baseline:Object.freeze({...baseline}),label:label.slice(0,80),dimensions:(row.data.embedding as number[]).length}));
    }
    const plan=Object.freeze({uid,cursorRaw:raw,nextCursor:page.nextCursor,scanned:page.rows.length,skipped:page.rows.length-items.length,items:Object.freeze(items)});plans.add(plan);return plan;
  });
}
/** Each confirmed operation has its own encrypted journal and server CAS. A failed batch keeps its page cursor. */
export async function applyEmbeddingStoragePlan(plan:EmbeddingStoragePlan,scope:Scope&{onProgress?:(completed:number,total:number)=>void},deps=defaults()){
  if(!plans.has(plan)||plan.items.length>EMBEDDING_STORAGE_PAGE_LIMIT)throw fail();if(deps.pending(plan.uid))throw fail('pending');
  return work(plan.uid,scope,deps,async(guard,raw,save)=>{
    if(raw!==plan.cursorRaw)throw fail('checkpoint');
    // Validate the complete review before its first write, then rebind every note in operate().
    for(const item of plan.items){guard();const row=await deps.read(item.id);guard();if(!own(row,plan.uid)||!candidate(row!))throw fail();
      const digest=await embeddingIndexViewDigest(row!);guard();if(digest!==item.baseline.stateDigest||(row!.updatedAt??row!.timestamp)!==item.baseline.revision)throw fail();}
    let completed=0;
    for(const item of plan.items){guard();await deps.compact({uid:plan.uid,id:item.id,baseline:item.baseline,assertCurrent:guard});guard();completed++;scope.onProgress?.(completed,plan.items.length);guard();}
    await save(plan.nextCursor);guard();plans.delete(plan);return{completed,scanned:plan.scanned,finished:plan.nextCursor===null};
  });
}
/** Only the read cursor is reset. An unresolved mutation journal always blocks this action. */
export async function resetEmbeddingStorageProgress(uid:string,scope:Scope,deps=defaults()){
  if(deps.pending(uid))throw fail('pending');return work(uid,scope,deps,async(guard,_raw,save)=>{guard();if(deps.pending(uid))throw fail('pending');await save(null);},false);
}
