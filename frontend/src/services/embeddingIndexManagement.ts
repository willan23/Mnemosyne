import {collection,doc,getDocFromServer,getDocsFromServer,limit,orderBy,query,startAfter,type QueryDocumentSnapshot} from 'firebase/firestore';
import {db} from '../firebase';
import type {SessionData} from '../hooks/useSessions';
import {PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {resolveMemoryDocFields} from './memoryCrypto';
import {readPreparedEmbedding} from './embeddingReindex';
import {embeddingSpaceOf} from './embeddingModel';
import {captureEmbeddingIndexBaseline,publishPreparedEmbedding,hasPendingEmbeddingIndex,EmbeddingIndexRecoveryError,embeddingIndexViewDigest} from './embeddingIndexRecovery';
import {EMBEDDING_INDEX_TARGET_SPACE} from '../../../functions/src/embeddingIndexContract';
import {attachmentIdValid} from '../../../functions/src/attachmentEnvelope';
import {parseSyncCipher,syncHashValid,syncIdValid,syncInteger} from '../../../functions/src/mobileSyncImportContract';

export const EMBEDDING_PUBLICATION_BATCH_LIMIT=2000;
const fail=()=>new EmbeddingIndexRecoveryError('baseline');
export function personalEmbeddingCandidate(memory:SessionData,uid:string) {
  return syncIdValid(memory.id)&&memory.uid===uid&&memory.teamId==null&&!memory.teamScopeAmbiguous&&!memory.encLocked&&memory.encrypted===true&&memory.deletedAt==null&&
    (memory.sharedWithIds==null||Array.isArray(memory.sharedWithIds)&&memory.sharedWithIds.length===0)&&!!memory.text.trim()&&syncInteger(memory.updatedAt)&&syncHashValid(memory.syncConflictDigest);
}
export const needsEmbeddingPublication=(memory:SessionData,uid:string)=>personalEmbeddingCandidate(memory,uid)&&embeddingSpaceOf(memory.embeddingModel)!==EMBEDDING_INDEX_TARGET_SPACE;
export interface EmbeddingPublicationPlan {uid:string;items:Array<{id:string;viewDigest:string;revision:number}>;remaining:number}
export interface EmbeddingPublicationDeps {
  enabled:()=>boolean;pending:(uid:string)=>boolean;mutation?:PersonalMemoryMutationDeps;
  exclusive:typeof withClipCaptureLock;prepared:typeof readPreparedEmbedding;capture:typeof captureEmbeddingIndexBaseline;publish:typeof publishPreparedEmbedding;
}
const publicationDefaults=():EmbeddingPublicationDeps=>({enabled:()=>PERSONAL_REVISION_WRITES_ENABLED,pending:hasPendingEmbeddingIndex,exclusive:withClipCaptureLock,
  prepared:readPreparedEmbedding,capture:captureEmbeddingIndexBaseline,publish:publishPreparedEmbedding});
function currentItem(uid:string,item:EmbeddingPublicationPlan['items'][number],readCurrent:(id:string)=>SessionData|undefined) {
  const memory=readCurrent(item.id);if(!memory||!personalEmbeddingCandidate(memory,uid)||memory.syncConflictDigest!==item.viewDigest||memory.updatedAt!==item.revision)throw fail();return memory;
}
async function validatePlan(plan:EmbeddingPublicationPlan,readCurrent:(id:string)=>SessionData|undefined,guard:()=>void,signal:AbortSignal,deps:EmbeddingPublicationDeps) {
  if(!plan.items.length||plan.items.length>EMBEDDING_PUBLICATION_BATCH_LIMIT||new Set(plan.items.map(item=>item.id)).size!==plan.items.length)throw fail();
  for(const item of plan.items){guard();currentItem(plan.uid,item,readCurrent);const checkpoint=await deps.prepared(plan.uid,'multilingualCandidate',()=>currentItem(plan.uid,item,readCurrent),{signal});guard();if(!checkpoint)throw fail();}
}
/** Review all captured candidates before the first write; newly arriving memories belong to another batch. */
export async function reviewEmbeddingPublication(uid:string,records:readonly SessionData[],readCurrent:(id:string)=>SessionData|undefined,options:{signal:AbortSignal;assertCurrent:()=>void},deps=publicationDefaults()):Promise<EmbeddingPublicationPlan> {
  if(!deps.enabled())throw new EmbeddingIndexRecoveryError('closed');
  const targets=records.filter(memory=>needsEmbeddingPublication(memory,uid));
  const plan={uid,items:targets.slice(0,EMBEDDING_PUBLICATION_BATCH_LIMIT).map(memory=>({id:memory.id,viewDigest:memory.syncConflictDigest!,revision:memory.updatedAt})),remaining:Math.max(0,targets.length-EMBEDDING_PUBLICATION_BATCH_LIMIT)};
  return withPersonalMemoryMutation(uid,context=>deps.exclusive('mnemosyne-reindex:'+uid,async()=>{
    const guard=()=>{context.assertCurrent();options.assertCurrent();if(options.signal.aborted)throw fail();};guard();if(deps.pending(uid))throw new EmbeddingIndexRecoveryError('pending');
    await validatePlan(plan,readCurrent,guard,options.signal,deps);guard();return structuredClone(plan);
  }),deps.mutation);
}
export async function publishEmbeddingPlan(input:EmbeddingPublicationPlan,readCurrent:(id:string)=>SessionData|undefined,options:{signal:AbortSignal;assertCurrent:()=>void;onProgress:(completed:number,total:number)=>void},deps=publicationDefaults()) {
  const plan=structuredClone(input);if(!deps.enabled())throw new EmbeddingIndexRecoveryError('closed');
  return withPersonalMemoryMutation(plan.uid,context=>deps.exclusive('mnemosyne-reindex:'+plan.uid,async()=>{
    const guard=()=>{context.assertCurrent();options.assertCurrent();if(options.signal.aborted)throw fail();};guard();if(deps.pending(plan.uid))throw new EmbeddingIndexRecoveryError('pending');
    await validatePlan(plan,readCurrent,guard,options.signal,deps);let completed=0;
    for(const item of plan.items){guard();currentItem(plan.uid,item,readCurrent);
      const baseline=await deps.capture({uid:plan.uid,id:item.id,viewDigest:item.viewDigest,assertCurrent:guard});guard();
      await deps.publish({uid:plan.uid,id:item.id,baseline,profile:'multilingualCandidate',readCurrent:()=>currentItem(plan.uid,item,readCurrent),assertCurrent:guard});guard();
      completed++;options.onProgress(completed,plan.items.length);
    }
    return{completed,total:plan.items.length,remaining:plan.remaining};
  }),deps.mutation);
}

export interface EmbeddingIndexHistoryEntry {versionId:string;createdAt:number;previousRevision:number;space:string;dimensions:number;rollbackAllowed:boolean}
export interface EmbeddingIndexHistoryCursor {uid:string;sessionId:string;viewDigest:string;tail:unknown}
export interface EmbeddingIndexHistoryDeps {
  read:(id:string)=>Promise<Record<string,unknown>|undefined>;
  page:(id:string,tail:unknown)=>Promise<{rows:Array<{id:string;data:Record<string,unknown>}>;tail:unknown|null}>;
  mutation?:PersonalMemoryMutationDeps;
}
const historyDefaults=():EmbeddingIndexHistoryDeps=>({read:async id=>(await getDocFromServer(doc(db,'sessions',id))).data(),page:async(id,tail)=>{
  const path='sessions/'+id+'/versions',base=collection(db,path);let request=query(base,orderBy('createdAt','desc'),limit(25));
  if(tail){const snapshot=tail as QueryDocumentSnapshot;if(snapshot.ref?.parent.path!==path)throw fail();request=query(base,orderBy('createdAt','desc'),startAfter(snapshot),limit(25));}
  const page=await getDocsFromServer(request);return{rows:page.docs.map(row=>({id:row.id,data:row.data()})),tail:page.size===25?page.docs[page.docs.length-1]:null};
}});
export const embeddingIndexHistoryDependencies=historyDefaults;
const contentDigest=(row:Record<string,unknown>)=>embeddingIndexViewDigest({uid:row.uid,teamId:row.teamId,enc:row.enc,keyEpoch:row.keyEpoch??null,keyId:row.keyId??null});
function personalRow(row:Record<string,unknown>|undefined,uid:string):asserts row is Record<string,unknown> {
  if(!row||row.uid!==uid||row.teamId!==null||row.teamScopeAmbiguous===true||row.deletedAt!=null||row.text!==''||row.title!=null||
    row.sharedWithIds!=null&&(!Array.isArray(row.sharedWithIds)||row.sharedWithIds.length!==0))throw fail();parseSyncCipher(row.enc);
}
/** Page through all versions without a new composite index; only validated index archives enter the UI. */
export async function loadEmbeddingIndexHistory(input:{uid:string;id:string;viewDigest:string;cursor?:EmbeddingIndexHistoryCursor|null;assertCurrent:()=>void},deps=historyDefaults()) {
  const captured={...input};if(!syncIdValid(captured.id)||!syncHashValid(captured.viewDigest)||captured.cursor&&(captured.cursor.uid!==captured.uid||captured.cursor.sessionId!==captured.id||captured.cursor.viewDigest!==captured.viewDigest))throw fail();
  return withPersonalMemoryMutation(captured.uid,async context=>{
    const guard=()=>{context.assertCurrent();captured.assertCurrent();};guard();const before=await deps.read(captured.id);guard();personalRow(before,captured.uid);
    if(await embeddingIndexViewDigest(before)!==captured.viewDigest)throw fail();guard();const fields=await resolveMemoryDocFields(before);guard();if(fields.locked||!fields.encrypted)throw fail();const digest=await contentDigest(before);guard();
    const page=await deps.page(captured.id,captured.cursor?.tail);guard();if(page.rows.length>25)throw fail();const entries:EmbeddingIndexHistoryEntry[]=[];let invalid=0;
    for(const {id,data:row}of page.rows){guard();if(!row.embeddingIndex)continue;
      try{const marker=row.embeddingIndex as Record<string,unknown>;
        if(!id.startsWith('embedding-index-')||!attachmentIdValid(id.slice(16))||marker.v!==1||marker.operationId!==id.slice(16)||!['publish','rollback'].includes(String(marker.kind))||!syncHashValid(marker.contentDigest)||
          row.uid!==captured.uid||row.teamId!==null||row.text!==''||row.title!=null||!syncInteger(row.createdAt)||row.createdAt>8.64e15||!syncInteger(row.previousUpdatedAt)||
          row.embedding!=null&&(!Array.isArray(row.embedding)||row.embedding.length>4096||!Array.from(row.embedding).every(x=>typeof x==='number'&&Number.isFinite(x)))||
          row.embeddingModel!=null&&(typeof row.embeddingModel!=='string'||row.embeddingModel.length>256))throw fail();
        parseSyncCipher(row.enc);const archivedDigest=await contentDigest(row);guard();if(archivedDigest!==marker.contentDigest)throw fail();
        entries.push({versionId:id,createdAt:row.createdAt,previousRevision:row.previousUpdatedAt,space:embeddingSpaceOf(row.embeddingModel),dimensions:Array.isArray(row.embedding)?row.embedding.length:0,rollbackAllowed:archivedDigest===digest});
      }catch{guard();invalid++;}
    }
    const after=await deps.read(captured.id);guard();personalRow(after,captured.uid);if(await embeddingIndexViewDigest(after)!==captured.viewDigest)throw fail();guard();
    return{entries,invalid,next:page.tail?{uid:captured.uid,sessionId:captured.id,viewDigest:captured.viewDigest,tail:page.tail}:null};
  },deps.mutation);
}
