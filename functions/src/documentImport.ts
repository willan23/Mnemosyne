import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {memoriesUsedInCurrentPeriod,nextUsageAfterMemoryCreate} from './usage';
import {canonicalSyncState,syncHashValid,syncInteger} from './mobileSyncImportContract';
import {attachmentDescriptor,readAttachmentUploadRecord,touchAttachmentReference,type UploadRecord} from './attachmentUploads';
import {attachmentIdValid} from './attachmentEnvelope';
import {personalConnectionDocument} from './personalConnections';
import {MAX_PERSONAL_CONNECTIONS} from './personalConnectionContract';
import {DOCUMENT_CREATE_BATCH_SIZE,DOCUMENT_LINK_BATCH_SIZE,documentPlanBatches,documentPlanBytes,documentBatchBytes,parseDocumentImportPlan,parseDocumentImportBatch,parseDocumentImportIdentity,
  type DocumentImportIdentity,type DocumentImportStatus} from './documentImportContract';
if(!admin.apps.length)admin.initializeApp();
/** Opens with the complete client journal, account/rules/usage and device/cost pilots. */
export const DOCUMENT_IMPORT_WRITES_ENABLED=false;
export const DOCUMENT_DAILY_LIMITS={imports:10,memories:3400,bytes:20*1024*1024} as const;
export interface DocumentImportDeps{firestore:FirebaseFirestore.Firestore;now:()=>number}
const defaults=():DocumentImportDeps=>({firestore:admin.firestore(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Encrypted document import unavailable');
const hash=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
export const documentPlanDigest=(value:unknown)=>hash(documentPlanBytes(parseDocumentImportPlan(value)));
function status(data:Record<string,unknown>,uid:string,input:DocumentImportIdentity):DocumentImportStatus{
  if(data.v!==1||data.uid!==uid||data.importId!==input.importId||data.planDigest!==input.planDigest||!['pending','complete','cancelled'].includes(String(data.status))||
    ![data.nextBatch,data.createdCount,data.linkedCount,data.memoryCount,data.edgeCount].every(syncInteger)||Number(data.memoryCount)>340||Number(data.edgeCount)>339||
    !Array.isArray(data.batchHashes)||data.batchHashes.some(value=>!syncHashValid(value))||!syncInteger(data.createdAt)||data.createdAt<1||!Array.isArray(data.attachments)||data.attachments.length>20||
    data.attachments.some(item=>!item||Object.keys(item).sort().join(',')!=='headerDigest,id'||!attachmentIdValid(item.id)||!syncHashValid(item.headerDigest))||new Set(data.attachments.map(item=>item.id)).size!==data.attachments.length)throw fail('permission-denied');
  const creates=Math.ceil(Number(data.memoryCount)/DOCUMENT_CREATE_BATCH_SIZE);const total=creates+Math.ceil(Number(data.edgeCount)/DOCUMENT_LINK_BATCH_SIZE);
  if(data.batchHashes.length!==total||Number(data.nextBatch)>total||data.createdCount!==Math.min(Number(data.nextBatch)*DOCUMENT_CREATE_BATCH_SIZE,Number(data.memoryCount))||
    data.linkedCount!==Math.min(Math.max(0,Number(data.nextBatch)-creates)*DOCUMENT_LINK_BATCH_SIZE,Number(data.edgeCount))||
    (data.memoryCount===0&&(data.status!=='cancelled'||data.attachments.length!==0||data.edgeCount!==0))||
    (data.status==='complete'&&data.nextBatch!==total)||(data.status==='pending'&&data.nextBatch===total))throw fail('permission-denied');
  return{...input,status:data.status as DocumentImportStatus['status'],nextBatch:Number(data.nextBatch),createdCount:Number(data.createdCount),linkedCount:Number(data.linkedCount),memoryCount:Number(data.memoryCount),edgeCount:Number(data.edgeCount)};
}
const unknown=(input:DocumentImportIdentity):DocumentImportStatus=>({...input,status:'unknown',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:0,edgeCount:0});
async function quota(tx:FirebaseFirestore.Transaction,db:FirebaseFirestore.Firestore,uid:string,profile:Record<string,unknown>,count:number,now:number,hasAttachments=false){
  const [config,entitlement]=await tx.getAll(db.doc('config/monetization'),db.doc(`entitlements/${uid}`));
  if(hasAttachments&&config.data()?.mode==='paid'&&entitlement.data()?.canUploadAttachments!==true)throw fail('permission-denied');
  if(config.data()?.mode==='paid'&&!['pro','sovereign'].includes(entitlement.data()?.effectiveTier)&&memoriesUsedInCurrentPeriod(profile.usage,new Date(now))+count>30)throw fail('resource-exhausted');
}
export async function executeDocumentImport(uid:string,value:unknown,mode:'begin'|'apply'|'status'|'cancel',deps=defaults()):Promise<DocumentImportStatus>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');
  let plan:ReturnType<typeof parseDocumentImportPlan>|undefined;let batch:ReturnType<typeof parseDocumentImportBatch>|undefined;let input:DocumentImportIdentity;
  try{
    if(mode==='begin'){plan=parseDocumentImportPlan(value);input={importId:plan.importId,planDigest:hash(documentPlanBytes(plan))};}
    else if(mode==='apply'){batch=parseDocumentImportBatch(value);input={importId:batch.importId,planDigest:batch.planDigest};}
    else if(mode==='status'||mode==='cancel')input=parseDocumentImportIdentity(value);else throw fail();
  }catch{throw fail('invalid-argument');}
  const db=deps.firestore;const ref=db.doc(`documentImports/${input.importId}`);
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');
    const [root,profile]=await tx.getAll(ref,db.doc(`users/${uid}`));
    const before=root.exists?status(root.data()!,uid,input):unknown(input);
    if(mode==='status')return before;
    if(mode==='begin'&&root.exists){if(before.status==='cancelled')throw fail();return before;}
    const now=deps.now();if(!syncInteger(now)||now<1)throw fail();
    if(mode==='cancel'){
      if(before.status==='complete'||before.status==='cancelled')return before;
      const result:DocumentImportStatus={...before,status:'cancelled'};
      if(root.exists)tx.update(ref,{status:'cancelled',updatedAt:now});else tx.create(ref,{v:1,uid,...result,attachments:[],batchHashes:[],createdAt:now,updatedAt:now});return result;
    }
    if(mode==='begin'&&plan){
      const day=new Date(now).toISOString().slice(0,10);const budgetRef=db.doc(`documentImportBudgets/${hash(uid)}_${day}`);const budget=await tx.get(budgetRef);const data=budget.data();
      if(data&&(data.v!==1||data.uid!==uid||data.day!==day||![data.imports,data.memories,data.bytes].every(syncInteger)))throw fail();
      const bytes=Buffer.byteLength(JSON.stringify(plan));const consumed={imports:Number(data?.imports??0)+1,memories:Number(data?.memories??0)+plan.memories.length,bytes:Number(data?.bytes??0)+bytes};
      if(consumed.imports>DOCUMENT_DAILY_LIMITS.imports||consumed.memories>DOCUMENT_DAILY_LIMITS.memories||consumed.bytes>DOCUMENT_DAILY_LIMITS.bytes)throw fail('resource-exhausted');
      await quota(tx,db,uid,profile.data()!,plan.memories.length,now,plan.attachments.length>0);
      const refs=plan.memories.flatMap(item=>[db.doc(`sessions/${item.sessionId}`),db.doc(`memoryCreationReceipts/${item.sessionId}`),db.doc(`memoryUsageReceipts/${item.sessionId}`)]);
      const collisions=await tx.getAll(...refs);if(collisions.some(snapshot=>snapshot.exists))throw fail('already-exists');
      const batches=documentPlanBatches(plan);const result:DocumentImportStatus={...before,status:'pending',memoryCount:plan.memories.length,edgeCount:plan.edges.length};
      tx.create(ref,{v:1,uid,...result,attachments:plan.attachments,batchHashes:batches.map(item=>hash(documentBatchBytes(item))),createdAt:now,updatedAt:now});
      tx.set(budgetRef,{v:1,uid,day,...consumed,updatedAt:now});return result;
    }
    if(!root.exists||!batch)throw fail('not-found');
    const batchDigest=hash(documentBatchBytes(batch));const priorRef=ref.collection('batches').doc(String(batch.batchIndex));const prior=await tx.get(priorRef);
    if(prior.exists){if(prior.data()?.v!==1||prior.data()?.uid!==uid||prior.data()?.digest!==batchDigest)throw fail('permission-denied');return before;}
    if(before.status!=='pending'||before.nextBatch!==batch.batchIndex||root.data()!.batchHashes[batch.batchIndex]!==batchDigest)throw fail('aborted');
    const creates=Math.ceil(before.memoryCount/DOCUMENT_CREATE_BATCH_SIZE);
    if((batch.batchIndex<creates)!==(batch.phase==='create'))throw fail('invalid-argument');
    if(batch.phase==='create'){
      await quota(tx,db,uid,profile.data()!,batch.memories.length,now,batch.memories.some(item=>item.attachmentIds.length>0));
      const refs=batch.memories.flatMap(item=>[db.doc(`sessions/${item.sessionId}`),db.doc(`memoryCreationReceipts/${item.sessionId}`),db.doc(`memoryUsageReceipts/${item.sessionId}`)]);
      const collisions=await tx.getAll(...refs);if(collisions.some(snapshot=>snapshot.exists))throw fail('already-exists');
      const attachmentIds=[...new Set(batch.memories.flatMap(item=>item.attachmentIds))];
      const records:UploadRecord[]=[];
      if(attachmentIds.length){
        const security=(await tx.get(db.doc('config/attachmentSecurity'))).data();
        if(security?.writesEnabled!==true||typeof security.bucket!=='string'||!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(security.bucket))throw fail('permission-denied');
        const uploads=await tx.getAll(...attachmentIds.map(id=>db.doc('attachmentUploads/'+id)));
        for(let index=0;index<uploads.length;index++){
          const record=readAttachmentUploadRecord(uploads[index].data(),attachmentIds[index]);
          const expected=(root.data()!.attachments as Array<{id:string;headerDigest:string}>).find(item=>item.id===record.header.id);
          if(!expected||record.digest!==expected.headerDigest||record.uid!==uid||record.header.scope.kind!=='personal'||record.header.scope.uid!==uid||record.status!=='ready'||record.bucket!==security.bucket)throw fail('permission-denied');
          records.push(record);
        }
      }
      const byId=new Map(records.map(record=>[record.header.id,record]));
      // Read every upload before writing; the same registry update serializes creation with purge.
      records.forEach(record=>touchAttachmentReference(tx,db,record,now));
      let usage=profile.data()?.usage;
      for(let index=0;index<batch.memories.length;index++){
        const item=batch.memories[index];const sessionRef=db.doc(`sessions/${item.sessionId}`);usage=nextUsageAfterMemoryCreate(usage,new Date(now));
        tx.create(sessionRef,{...item.metadata,uid,teamId:null,text:'',title:null,enc:item.enc,timestamp:now,updatedAt:now,attachments:item.attachmentIds.length?item.attachmentIds.map(id=>attachmentDescriptor(byId.get(id)!)):null,creationReceiptId:item.sessionId,
          learning:{...item.metadata.learning as object,learnedAt:now}});
        tx.create(db.doc(`memoryCreationReceipts/${item.sessionId}`),{v:1,kind:'document-import',uid,teamId:null,sessionId:item.sessionId,importId:input.importId,planDigest:input.planDigest,index:batch.batchIndex*DOCUMENT_CREATE_BATCH_SIZE+index,encDigest:hash(canonicalSyncState(item.enc)),status:'committed',createdAt:now});
        tx.create(db.doc(`memoryUsageReceipts/${item.sessionId}`),{v:1,uid,sessionId:item.sessionId,...usage as object,createdAt:now});
      }
      tx.update(profile.ref,{usage:{...usage as object,updatedAt:now}});
    }else{
      const ids=[...new Set(batch.edges.flatMap(item=>[item.sourceId,item.targetId]))];const snapshots=await tx.getAll(...ids.map(id=>db.doc(`sessions/${id}`)));
      const receipts=await tx.getAll(...ids.map(id=>db.doc(`memoryCreationReceipts/${id}`)));const old=snapshots.map(snapshot=>personalConnectionDocument(snapshot,uid));
      for(let index=0;index<ids.length;index++){
        const receipt=receipts[index].data();if(!receipt||receipt.v!==1||receipt.kind!=='document-import'||receipt.uid!==uid||receipt.teamId!==null||receipt.status!=='committed'||!syncInteger(receipt.index)||receipt.index>=before.memoryCount||receipt.sessionId!==ids[index]||receipt.importId!==input.importId||receipt.planDigest!==input.planDigest||receipt.encDigest!==hash(canonicalSyncState(old[index].enc)))throw fail('aborted');
      }
      const positions=new Map(ids.map((id,index)=>[id,index]));const connections=old.map(data=>[...data.connections as string[]]);
      for(const edge of batch.edges){
        const source=positions.get(edge.sourceId)!;const target=positions.get(edge.targetId)!;
        if(old[source].parentId!==edge.targetId&&old[target].parentId!==edge.sourceId)throw fail('aborted');
        if(!connections[source].includes(edge.targetId))connections[source].push(edge.targetId);if(!connections[target].includes(edge.sourceId))connections[target].push(edge.sourceId);
      }
      if(connections.some(value=>value.length>MAX_PERSONAL_CONNECTIONS))throw fail('resource-exhausted');
      const histories=snapshots.map(snapshot=>snapshot.ref.collection('versions').doc(`document-${hash(`${input.importId}:${batch!.batchIndex}`)}`));
      const historySnapshots=await tx.getAll(...histories);const changed=connections.map((value,index)=>value.length!==(old[index].connections as string[]).length);
      if(historySnapshots.some((snapshot,index)=>changed[index]&&snapshot.exists))throw fail('already-exists');
      for(let index=0;index<ids.length;index++){
        if(!changed[index])continue;const revision=Math.max(now,Number(old[index].updatedAt??old[index].timestamp)+1);if(!syncInteger(revision))throw fail();
        tx.create(histories[index],{...snapshots[index].data()!,previousUpdatedAt:old[index].updatedAt??old[index].timestamp,createdAt:revision,editorUid:uid});
        tx.update(snapshots[index].ref,{connections:connections[index],updatedAt:revision});
      }
    }
    const result:DocumentImportStatus={...before,nextBatch:before.nextBatch+1,createdCount:before.createdCount+batch.memories.length,linkedCount:before.linkedCount+batch.edges.length,
      status:before.nextBatch+1===root.data()!.batchHashes.length?'complete':'pending'};
    tx.create(priorRef,{v:1,uid,digest:batchDigest,createdAt:now});tx.update(ref,{...result,updatedAt:now});return result;
  });
}
function callable(mode:'begin'|'apply'|'status'|'cancel'){
  return functions.region('europe-west1').https.onCall(async(value,context)=>{
    if(!context.auth?.uid)throw fail('unauthenticated');
    try{if(mode==='begin')parseDocumentImportPlan(value);else if(mode==='apply')parseDocumentImportBatch(value);else parseDocumentImportIdentity(value);}catch{throw fail('invalid-argument');}
    if((mode==='begin'||mode==='apply')&&!DOCUMENT_IMPORT_WRITES_ENABLED)throw fail();
    try{
      if(!(await consumeServerRateLimit(`uid:${context.auth.uid}`,{bucket:`document-import-${mode}`,max:mode==='begin'?6:120,windowMs:60000})).allowed)throw fail('resource-exhausted');
      return await executeDocumentImport(context.auth.uid,value,mode);
    }catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
  });
}
export const beginDocumentImport=callable('begin');export const applyDocumentImportBatch=callable('apply');
export const getDocumentImportStatus=callable('status');export const cancelDocumentImport=callable('cancel');
