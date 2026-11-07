import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {PERSONAL_REVISION_WRITES_ENABLED} from './personalRevisions';
import {canonicalSyncState, parseSyncCipher, syncInteger} from './mobileSyncImportContract';
import {syncDocumentStateHash, syncStateHash} from './mobileSyncImport';
import {embeddingIndexRequestBytes, parseEmbeddingIndexCommand, parseEmbeddingIndexRequest, parseEmbeddingIndexTarget,
  type EmbeddingIndexBaseline, type EmbeddingIndexCall, type EmbeddingIndexOutcome, type EmbeddingIndexRequest} from './embeddingIndexContract';

if(!admin.apps.length)admin.initializeApp();
export const EMBEDDING_INDEX_DAILY_LIMITS={operations:2000,vectorBytes:20*1024*1024,archiveBytes:100*1024*1024} as const;
export interface EmbeddingIndexDeps {firestore: FirebaseFirestore.Firestore; now:()=>number}
const defaults=():EmbeddingIndexDeps=>({firestore:admin.firestore(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Index change unavailable; retain the encrypted pending request');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function parsed<T>(parse:(value:unknown)=>T,value:unknown):T {try{return parse(value);}catch{throw fail('invalid-argument');}}

/** Preserve missing/null markers exactly; never relabel an unversioned historic vector. */
function storedIndex(row:FirebaseFirestore.DocumentData) {
  if(row.embedding!=null&&(!Array.isArray(row.embedding)||row.embedding.length>4096||
    !row.embedding.every((x:unknown)=>typeof x==='number'&&Number.isFinite(x))))throw fail();
  if(row.embeddingModel!=null&&(typeof row.embeddingModel!=='string'||row.embeddingModel.length>256))throw fail();
  return Object.fromEntries(['embedding','embeddingModel'].filter(key=>Object.prototype.hasOwnProperty.call(row,key)).map(key=>[key,row[key]]));
}
function contentDigest(row:FirebaseFirestore.DocumentData) {
  return syncStateHash({uid:row.uid,teamId:row.teamId,enc:row.enc,keyEpoch:row.keyEpoch??null,keyId:row.keyId??null});
}
function personal(snapshot:FirebaseFirestore.DocumentSnapshot,uid:string) {
  const row=snapshot.data();
  if(!snapshot.exists||!row||row.uid!==uid||row.teamId!==null||row.teamScopeAmbiguous===true||row.deletedAt!=null||
    row.sharedWithIds!=null&&(!Array.isArray(row.sharedWithIds)||row.sharedWithIds.length!==0))throw fail('permission-denied');
  if(row.text!==''||row.title!=null||!syncInteger(row.timestamp)||!syncInteger(row.updatedAt??row.timestamp))throw fail();
  parsed(parseSyncCipher,row.enc);storedIndex(row);return row;
}
export async function executeEmbeddingIndexPreparation(uid:string,value:unknown,deps=defaults()):Promise<EmbeddingIndexBaseline> {
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const target=parsed(parseEmbeddingIndexTarget,value),db=deps.firestore;
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');
    const snapshot=await tx.get(db.doc('sessions/'+target.sessionId)),row=personal(snapshot,uid),stateDigest=syncStateHash(row);
    if(stateDigest!==target.viewDigest)throw fail('aborted');
    return {sessionId:target.sessionId,ownerUid:uid,stateHash:syncDocumentStateHash(snapshot),stateDigest,
      contentDigest:contentDigest(row),revision:row.updatedAt??row.timestamp};
  });
}
async function budget(tx:FirebaseFirestore.Transaction,db:FirebaseFirestore.Firestore,uid:string,now:number,bytes:number,archiveBytes=0) {
  if(!syncInteger(now)||now<1)throw fail();const day=new Date(now).toISOString().slice(0,10),ref=db.doc('embeddingIndexBudgets/'+hash(uid)+'_'+day),row=(await tx.get(ref)).data();
  if(row&&(row.v!==1||row.uid!==uid||row.day!==day||!syncInteger(row.operations)||!syncInteger(row.vectorBytes)||!syncInteger(row.archiveBytes)))throw fail();
  const next={operations:Number(row?.operations??0)+1,vectorBytes:Number(row?.vectorBytes??0)+bytes,archiveBytes:Number(row?.archiveBytes??0)+archiveBytes};
  if(next.operations>EMBEDDING_INDEX_DAILY_LIMITS.operations||next.vectorBytes>EMBEDDING_INDEX_DAILY_LIMITS.vectorBytes||next.archiveBytes>EMBEDDING_INDEX_DAILY_LIMITS.archiveBytes)throw fail('resource-exhausted');
  return {ref,row:{v:1,uid,day,...next,updatedAt:now}};
}
function knownOutcome(row:FirebaseFirestore.DocumentData,uid:string,input:EmbeddingIndexRequest,digest:string):EmbeddingIndexOutcome {
  if(row.v!==1||row.uid!==uid||row.operationId!==input.operationId||row.sessionId!==input.baseline.sessionId||row.digest!==digest||
    !['committed','cancelled'].includes(row.status)||!syncInteger(row.createdAt)||row.createdAt<1||
    (row.status==='committed'?(!syncInteger(row.revision)||row.revision<=input.baseline.revision||row.versionId!=='embedding-index-'+input.operationId):row.revision!==null||row.versionId!==null))throw fail('permission-denied');
  return {operationId:row.operationId,sessionId:row.sessionId,digest,status:row.status,revision:row.revision,versionId:row.versionId,createdAt:row.createdAt};
}
export async function executeEmbeddingIndexRevision(uid:string,value:unknown,mode:'apply'|'status'|'cancel',deps=defaults()):Promise<EmbeddingIndexOutcome> {
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const input=parsed(parseEmbeddingIndexRequest,value),base=input.baseline;
  if(base.ownerUid!==uid)throw fail('permission-denied');if(!['apply','status','cancel'].includes(mode))throw fail('invalid-argument');
  const db=deps.firestore,digest=hash(embeddingIndexRequestBytes(input)),ref=db.doc('embeddingIndexRevisions/'+input.operationId);
  const empty:EmbeddingIndexOutcome={operationId:input.operationId,sessionId:base.sessionId,digest,status:'unknown',revision:null,versionId:null,createdAt:null};
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const receipt=await tx.get(ref);
    if(receipt.exists){const outcome=knownOutcome(receipt.data()!,uid,input,digest);if(mode==='apply'&&outcome.status!=='committed')throw fail();return outcome;}
    // A durable cancellation seals an absent operation even after its source changed.
    if(mode==='cancel'){
      const now=deps.now(),quota=await budget(tx,db,uid,now,0),outcome={...empty,status:'cancelled' as const,createdAt:now};
      tx.create(ref,{v:1,uid,...outcome});tx.set(quota.ref,quota.row);return outcome;
    }
    const session=db.doc('sessions/'+base.sessionId),snapshot=await tx.get(session);
    let before:FirebaseFirestore.DocumentData;
    try{before=personal(snapshot,uid);}catch(error){if(mode==='status')return {...empty,status:'revoked' as const};throw error;}
    if(mode==='status')return empty;
    if(syncDocumentStateHash(snapshot)!==base.stateHash||syncStateHash(before)!==base.stateDigest||
      contentDigest(before)!==base.contentDigest||(before.updatedAt??before.timestamp)!==base.revision)throw fail('aborted');
    let next:FirebaseFirestore.DocumentData,restoredIndex:FirebaseFirestore.DocumentData|undefined;
    if(input.change.kind==='publish')next={embedding:input.change.vector,embeddingModel:input.change.space};
    else {
      const history=await tx.get(session.collection('versions').doc(input.change.versionId)),old=history.data();
      if(!history.exists||!old||old.uid!==uid||old.teamId!==null||old.embeddingIndex?.v!==1||
        old.embeddingIndex.operationId!==input.change.versionId.slice(16)||old.embeddingIndex.contentDigest!==base.contentDigest||
        contentDigest(old)!==base.contentDigest)throw fail('aborted');
      const restored=storedIndex(old);restoredIndex=restored;
      next=Object.fromEntries(['embedding','embeddingModel'].map(key=>[key,Object.prototype.hasOwnProperty.call(restored,key)?restored[key]:admin.firestore.FieldValue.delete()]));
    }
    const version=session.collection('versions').doc('embedding-index-'+input.operationId);
    if((await tx.get(version)).exists)throw fail('already-exists');const now=deps.now(),revision=Math.max(now,base.revision+1);
    if(!syncInteger(revision))throw fail();const quota=await budget(tx,db,uid,now,Buffer.byteLength(canonicalSyncState(storedIndex(before)))+
      Buffer.byteLength(canonicalSyncState(restoredIndex??next)),Buffer.byteLength(canonicalSyncState(before)));
    // Archive the exact encrypted snapshot; update only index and revision fields.
    tx.create(version,{...before,previousUpdatedAt:base.revision,createdAt:revision,editorUid:uid,
      embeddingIndex:{v:1,operationId:input.operationId,contentDigest:base.contentDigest,kind:input.change.kind}});
    tx.update(session,{...next,updatedAt:revision,lastVersionId:version.id});
    const outcome={...empty,status:'committed' as const,revision,versionId:version.id,createdAt:now};
    tx.create(ref,{v:1,uid,...outcome});tx.set(quota.ref,quota.row);return outcome;
  });
}
export async function executeEmbeddingIndexCall(uid:string,mode:EmbeddingIndexCall,value:unknown,deps=defaults()) {
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const command=parsed(v=>parseEmbeddingIndexCommand(mode,v),value);
  if(command.actorUid!==uid)throw fail('permission-denied');
  return mode==='prepare'?executeEmbeddingIndexPreparation(uid,command.request,deps):executeEmbeddingIndexRevision(uid,command.request,mode,deps);
}
function callable(mode:EmbeddingIndexCall) {
  return functions.region('europe-west1').runWith({enforceAppCheck:true}).https.onCall(async(value,context)=>{
    if(!context.auth?.uid)throw fail('unauthenticated');if(!context.app)throw fail('failed-precondition');
    const uid=context.auth.uid,command=parsed(v=>parseEmbeddingIndexCommand(mode,v),value);if(command.actorUid!==uid)throw fail('permission-denied');
    if(mode==='apply'&&!PERSONAL_REVISION_WRITES_ENABLED)throw fail();
    try{
      if(!(await consumeServerRateLimit('uid:'+uid,{bucket:'embedding-index-'+mode,max:mode==='apply'?60:120,windowMs:60000})).allowed)throw fail('resource-exhausted');
      return mode==='prepare'?executeEmbeddingIndexPreparation(uid,command.request):executeEmbeddingIndexRevision(uid,command.request,mode);
    }catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
  });
}
export const prepareEmbeddingIndexRevision=callable('prepare'),applyEmbeddingIndexRevision=callable('apply'),
  getEmbeddingIndexRevisionStatus=callable('status'),cancelEmbeddingIndexRevision=callable('cancel');
