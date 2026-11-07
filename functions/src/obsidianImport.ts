import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {memoriesUsedInCurrentPeriod,nextUsageAfterMemoryCreate} from './usage';
import {canonicalSyncState,syncHashValid,syncInteger} from './mobileSyncImportContract';
import {personalConnectionDocument} from './personalConnections';
import {MAX_PERSONAL_CONNECTIONS} from './personalConnectionContract';
import {OBSIDIAN_CREATE_BATCH_SIZE,OBSIDIAN_LINK_BATCH_SIZE,obsidianPlanBatches,obsidianPlanBytes,obsidianBatchBytes,parseObsidianImportPlan,parseObsidianImportBatch,parseObsidianImportIdentity,
  type ObsidianImportIdentity,type ObsidianImportStatus} from './obsidianImportContract';
if(!admin.apps.length)admin.initializeApp();
/** Opens with the complete client journal, account/rules/usage and device/cost pilots. */
export const OBSIDIAN_IMPORT_WRITES_ENABLED=false;
export const CAPSULE_IMPORT_WRITES_ENABLED=false;
export const OBSIDIAN_DAILY_LIMITS={imports:10,memories:1500,bytes:20*1024*1024} as const;
export interface ObsidianImportDeps{firestore:FirebaseFirestore.Firestore;now:()=>number}
const defaults=():ObsidianImportDeps=>({firestore:admin.firestore(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Encrypted vault import unavailable');
const hash=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
export const obsidianPlanDigest=(value:unknown)=>hash(obsidianPlanBytes(parseObsidianImportPlan(value)));
function status(data:Record<string,unknown>,uid:string,input:ObsidianImportIdentity):ObsidianImportStatus{
  if(data.v!==1||data.uid!==uid||data.importId!==input.importId||data.planDigest!==input.planDigest||!['pending','complete','cancelled'].includes(String(data.status))||
    ![data.nextBatch,data.createdCount,data.linkedCount,data.memoryCount,data.edgeCount].every(syncInteger)||Number(data.memoryCount)>300||Number(data.edgeCount)>11325||
    !Array.isArray(data.batchHashes)||data.batchHashes.some(value=>!syncHashValid(value))||!syncInteger(data.createdAt)||data.createdAt<1)throw fail('permission-denied');
  const creates=Math.ceil(Number(data.memoryCount)/OBSIDIAN_CREATE_BATCH_SIZE);const total=creates+Math.ceil(Number(data.edgeCount)/OBSIDIAN_LINK_BATCH_SIZE);
  if(data.batchHashes.length!==total||Number(data.nextBatch)>total||data.createdCount!==Math.min(Number(data.nextBatch)*OBSIDIAN_CREATE_BATCH_SIZE,Number(data.memoryCount))||
    data.linkedCount!==Math.min(Math.max(0,Number(data.nextBatch)-creates)*OBSIDIAN_LINK_BATCH_SIZE,Number(data.edgeCount))||
    (data.memoryCount===0?(data.status!=='cancelled'||data.source!==null||data.edgeCount!==0):!['obsidian-vault','starter-universe','capsule-import'].includes(String(data.source)))||
    (data.status==='complete'&&data.nextBatch!==total)||(data.status==='pending'&&data.nextBatch===total))throw fail('permission-denied');
  return{...input,status:data.status as ObsidianImportStatus['status'],nextBatch:Number(data.nextBatch),createdCount:Number(data.createdCount),linkedCount:Number(data.linkedCount),memoryCount:Number(data.memoryCount),edgeCount:Number(data.edgeCount)};
}
const unknown=(input:ObsidianImportIdentity):ObsidianImportStatus=>({...input,status:'unknown',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:0,edgeCount:0});
async function quota(tx:FirebaseFirestore.Transaction,db:FirebaseFirestore.Firestore,uid:string,profile:Record<string,unknown>,count:number,now:number){
  const [config,entitlement]=await tx.getAll(db.doc('config/monetization'),db.doc(`entitlements/${uid}`));
  if(config.data()?.mode==='paid'&&!['pro','sovereign'].includes(entitlement.data()?.effectiveTier)&&memoriesUsedInCurrentPeriod(profile.usage,new Date(now))+count>30)throw fail('resource-exhausted');
}
export async function executeObsidianImport(uid:string,value:unknown,mode:'begin'|'apply'|'status'|'cancel',deps=defaults(),family?:'obsidian'|'capsule'):Promise<ObsidianImportStatus>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');
  let plan:ReturnType<typeof parseObsidianImportPlan>|undefined;let batch:ReturnType<typeof parseObsidianImportBatch>|undefined;let input:ObsidianImportIdentity;
  try{
    if(mode==='begin'){plan=parseObsidianImportPlan(value);input={importId:plan.importId,planDigest:hash(obsidianPlanBytes(plan))};}
    else if(mode==='apply'){batch=parseObsidianImportBatch(value);input={importId:batch.importId,planDigest:batch.planDigest};}
    else if(mode==='status'||mode==='cancel')input=parseObsidianImportIdentity(value);else throw fail();
  }catch{throw fail('invalid-argument');}
  const db=deps.firestore;const ref=db.doc(`obsidianImports/${input.importId}`);
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');
    const [root,profile]=await tx.getAll(ref,db.doc(`users/${uid}`));
    const before=root.exists?status(root.data()!,uid,input):unknown(input);
    if(family&&(mode==='begin'||mode==='apply')&&((plan?.source??root.data()?.source)==='capsule-import')!==(family==='capsule'))throw fail('permission-denied');
    if(mode==='status')return before;
    if(mode==='begin'&&root.exists){if(before.status==='cancelled')throw fail();return before;}
    const now=deps.now();if(!syncInteger(now)||now<1)throw fail();
    if(mode==='cancel'){
      if(before.status==='complete'||before.status==='cancelled')return before;
      const result:ObsidianImportStatus={...before,status:'cancelled'};
      if(root.exists)tx.update(ref,{status:'cancelled',updatedAt:now});else tx.create(ref,{v:1,uid,...result,source:null,batchHashes:[],createdAt:now,updatedAt:now});return result;
    }
    if(mode==='begin'&&plan){
      const capsule=plan.capsule?.shareId?await capsuleShare(tx,db,plan.capsule.shareId,now):null;
      const day=new Date(now).toISOString().slice(0,10);const budgetRef=db.doc(`obsidianImportBudgets/${hash(uid)}_${day}`);const budget=await tx.get(budgetRef);const data=budget.data();
      if(data&&(data.v!==1||data.uid!==uid||data.day!==day||![data.imports,data.memories,data.bytes].every(syncInteger)))throw fail();
      const bytes=Buffer.byteLength(JSON.stringify(plan));const consumed={imports:Number(data?.imports??0)+1,memories:Number(data?.memories??0)+plan.memories.length,bytes:Number(data?.bytes??0)+bytes};
      if(consumed.imports>OBSIDIAN_DAILY_LIMITS.imports||consumed.memories>OBSIDIAN_DAILY_LIMITS.memories||consumed.bytes>OBSIDIAN_DAILY_LIMITS.bytes)throw fail('resource-exhausted');
      await quota(tx,db,uid,profile.data()!,plan.memories.length,now);
      const refs=plan.memories.flatMap(item=>[db.doc(`sessions/${item.sessionId}`),db.doc(`memoryCreationReceipts/${item.sessionId}`),db.doc(`memoryUsageReceipts/${item.sessionId}`)]);
      const collisions=await tx.getAll(...refs);if(collisions.some(snapshot=>snapshot.exists))throw fail('already-exists');
      const batches=obsidianPlanBatches(plan);const result:ObsidianImportStatus={...before,status:'pending',memoryCount:plan.memories.length,edgeCount:plan.edges.length};
      tx.create(ref,{v:1,uid,...result,source:plan.source,...(plan.source==='capsule-import'?{capsule}:{}),batchHashes:batches.map(item=>hash(obsidianBatchBytes(item))),createdAt:now,updatedAt:now});
      tx.set(budgetRef,{v:1,uid,day,...consumed,updatedAt:now});return result;
    }
    if(!root.exists||!batch)throw fail('not-found');
    const batchDigest=hash(obsidianBatchBytes(batch));const priorRef=ref.collection('batches').doc(String(batch.batchIndex));const prior=await tx.get(priorRef);
    if(prior.exists){if(prior.data()?.v!==1||prior.data()?.uid!==uid||prior.data()?.digest!==batchDigest)throw fail('permission-denied');return before;}
    if(before.status!=='pending'||before.nextBatch!==batch.batchIndex||root.data()!.batchHashes[batch.batchIndex]!==batchDigest)throw fail('aborted');
    const creates=Math.ceil(before.memoryCount/OBSIDIAN_CREATE_BATCH_SIZE);
    if((batch.batchIndex<creates)!==(batch.phase==='create'))throw fail('invalid-argument');
    const capsuleSource=root.data()!.source==='capsule-import';
    const capturedCapsule=root.data()!.capsule;
    let share:Awaited<ReturnType<typeof capsuleShare>>|null=null;
    if(capsuleSource){
      if(before.edgeCount!==0||batch.phase!=='create'||batch.memories.some(item=>item.role!=='note'||item.metadata.parentId!==null))throw fail('permission-denied');
      if(capturedCapsule!==null){
        if(!capturedCapsule||Object.keys(capturedCapsule).sort().join(',')!=='cipherDigest,ownerUid,shareId')throw fail('permission-denied');
        share=await capsuleShare(tx,db,capturedCapsule.shareId,now);
        if(canonicalSyncState(share)!==canonicalSyncState(capturedCapsule))throw fail('aborted');
      }
    }
    const completes=before.nextBatch+1===root.data()!.batchHashes.length;
    const noticeRef=db.doc(`capsuleImportNotices/${input.importId}`);
    if(completes&&share&&share.ownerUid!==uid&&(await tx.get(noticeRef)).exists)throw fail('already-exists');
    if(batch.phase==='create'){
      await quota(tx,db,uid,profile.data()!,batch.memories.length,now);
      const refs=batch.memories.flatMap(item=>[db.doc(`sessions/${item.sessionId}`),db.doc(`memoryCreationReceipts/${item.sessionId}`),db.doc(`memoryUsageReceipts/${item.sessionId}`)]);
      const collisions=await tx.getAll(...refs);if(collisions.some(snapshot=>snapshot.exists))throw fail('already-exists');
      let usage=profile.data()?.usage;
      for(let index=0;index<batch.memories.length;index++){
        const item=batch.memories[index];const sessionRef=db.doc(`sessions/${item.sessionId}`);usage=nextUsageAfterMemoryCreate(usage,new Date(now));
        tx.create(sessionRef,{...item.metadata,uid,teamId:null,text:'',title:null,enc:item.enc,timestamp:now,updatedAt:now,attachments:null,creationReceiptId:item.sessionId,
          processingMethod:`learned:${root.data()!.source}+links-only`,learning:{schemaVersion:1,source:root.data()!.source,modality:'text',learnedAt:now,batchId:input.importId,attachmentCount:0}});
        tx.create(db.doc(`memoryCreationReceipts/${item.sessionId}`),{v:1,kind:'obsidian-import',uid,teamId:null,sessionId:item.sessionId,importId:input.importId,planDigest:input.planDigest,index:batch.batchIndex*OBSIDIAN_CREATE_BATCH_SIZE+index,encDigest:hash(canonicalSyncState(item.enc)),status:'committed',createdAt:now});
        tx.create(db.doc(`memoryUsageReceipts/${item.sessionId}`),{v:1,uid,sessionId:item.sessionId,...usage as object,createdAt:now});
      }
      tx.update(profile.ref,{usage:{...usage as object,updatedAt:now}});
    }else{
      const ids=[...new Set(batch.edges.flatMap(item=>[item.sourceId,item.targetId]))];const snapshots=await tx.getAll(...ids.map(id=>db.doc(`sessions/${id}`)));
      const receipts=await tx.getAll(...ids.map(id=>db.doc(`memoryCreationReceipts/${id}`)));const old=snapshots.map(snapshot=>personalConnectionDocument(snapshot,uid));
      for(let index=0;index<ids.length;index++){
        const receipt=receipts[index].data();if(!receipt||receipt.v!==1||receipt.kind!=='obsidian-import'||receipt.uid!==uid||receipt.teamId!==null||receipt.status!=='committed'||!syncInteger(receipt.index)||receipt.index>=before.memoryCount||receipt.sessionId!==ids[index]||receipt.importId!==input.importId||receipt.planDigest!==input.planDigest||receipt.encDigest!==hash(canonicalSyncState(old[index].enc)))throw fail('aborted');
      }
      const positions=new Map(ids.map((id,index)=>[id,index]));const connections=old.map(data=>[...data.connections as string[]]);
      for(const edge of batch.edges){
        const source=positions.get(edge.sourceId)!;const target=positions.get(edge.targetId)!;
        if(edge.kind==='parent'&&old[source].parentId!==edge.targetId&&old[target].parentId!==edge.sourceId)throw fail('aborted');
        if(!connections[source].includes(edge.targetId))connections[source].push(edge.targetId);if(!connections[target].includes(edge.sourceId))connections[target].push(edge.sourceId);
      }
      if(connections.some(value=>value.length>MAX_PERSONAL_CONNECTIONS))throw fail('resource-exhausted');
      const histories=snapshots.map(snapshot=>snapshot.ref.collection('versions').doc(`obsidian-${hash(`${input.importId}:${batch!.batchIndex}`)}`));
      const historySnapshots=await tx.getAll(...histories);const changed=connections.map((value,index)=>value.length!==(old[index].connections as string[]).length);
      if(historySnapshots.some((snapshot,index)=>changed[index]&&snapshot.exists))throw fail('already-exists');
      for(let index=0;index<ids.length;index++){
        if(!changed[index])continue;const revision=Math.max(now,Number(old[index].updatedAt??old[index].timestamp)+1);if(!syncInteger(revision))throw fail();
        tx.create(histories[index],{...snapshots[index].data()!,previousUpdatedAt:old[index].updatedAt??old[index].timestamp,createdAt:revision,editorUid:uid});
        tx.update(snapshots[index].ref,{connections:connections[index],updatedAt:revision});
      }
    }
    const result:ObsidianImportStatus={...before,nextBatch:before.nextBatch+1,createdCount:before.createdCount+batch.memories.length,linkedCount:before.linkedCount+batch.edges.length,
      status:completes?'complete':'pending'};
    if(completes&&share){
      tx.update(db.doc(`shares/${share.shareId}`),{importCount:admin.firestore.FieldValue.increment(1),lastImportedAt:now});
      if(share.ownerUid!==uid)tx.create(noticeRef,{ownerUid:share.ownerUid,shareId:share.shareId,importerUid:uid,itemCount:before.memoryCount,titleHint:null,read:false,createdAt:now,importId:input.importId,planDigest:input.planDigest});
    }
    tx.create(priorRef,{v:1,uid,digest:batchDigest,createdAt:now});tx.update(ref,{...result,updatedAt:now});return result;
  });
}
async function capsuleShare(tx:FirebaseFirestore.Transaction,db:FirebaseFirestore.Firestore,shareId:unknown,now:number){
  if(!attachmentActorIdValid(shareId))throw fail('invalid-argument');
  const data=(await tx.get(db.doc(`shares/${shareId}`))).data();
  const cipher=data?.ciphertext;
  if(!data||data.revokedAt!=null||data.encrypted!==true||!data.ciphertext||typeof data.ciphertext!=='object'||Array.isArray(data.ciphertext)||
    Object.keys(cipher).sort().join(',')!=='alg,data,iv,salt,v'||cipher.v!==1||cipher.alg!=='AES-GCM-PBKDF2'||
    !['salt','iv','data'].every(key=>typeof cipher[key]==='string'&&cipher[key].length>8&&cipher[key].length<=2_000_000)||Buffer.byteLength(JSON.stringify(cipher))>2_100_000||
    !await liveAccountInTransaction(tx,db,data.uid,false)||(data.expiresAt!=null&&(!syncInteger(data.expiresAt)||data.expiresAt<=now))||
    (data.importCount!=null&&(!syncInteger(data.importCount)||data.importCount>=Number.MAX_SAFE_INTEGER)))throw fail();
  return{shareId,ownerUid:String(data.uid),cipherDigest:hash(canonicalSyncState(data.ciphertext))};
}
function callable(mode:'begin'|'apply'|'status'|'cancel',family:'obsidian'|'capsule'='obsidian'){
  return functions.region('europe-west1').https.onCall(async(value,context)=>{
    if(!context.auth?.uid)throw fail('unauthenticated');
    try{if(mode==='begin')parseObsidianImportPlan(value);else if(mode==='apply')parseObsidianImportBatch(value);else parseObsidianImportIdentity(value);}catch{throw fail('invalid-argument');}
    if((mode==='begin'||mode==='apply')&&!(family==='capsule'?CAPSULE_IMPORT_WRITES_ENABLED:OBSIDIAN_IMPORT_WRITES_ENABLED))throw fail();
    try{
      if(!(await consumeServerRateLimit(`uid:${context.auth.uid}`,{bucket:`obsidian-import-${mode}`,max:mode==='begin'?6:120,windowMs:60000})).allowed)throw fail('resource-exhausted');
      return await executeObsidianImport(context.auth.uid,value,mode,defaults(),family);
    }catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
  });
}
export const beginObsidianImport=callable('begin');export const applyObsidianImportBatch=callable('apply');
export const getObsidianImportStatus=callable('status');export const cancelObsidianImport=callable('cancel');
export const beginCapsuleImport=callable('begin','capsule');export const applyCapsuleImportBatch=callable('apply','capsule');
