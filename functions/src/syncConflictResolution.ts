import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {recordMemorySupersession} from './memorySupersession';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {PERSONAL_REVISION_WRITES_ENABLED} from './personalRevisions';
import {parseSyncCipher,syncInteger} from './mobileSyncImportContract';
import {syncDocumentStateHash,syncStateHash} from './mobileSyncImport';
import {teamRevisionTime} from './teamRevisionContract';
import {parseSyncConflictCommand,parseSyncConflictTarget,parseSyncConflictRequest,syncConflictRequestBytes,type SyncConflictCall,type SyncConflictBase,type SyncConflictOutcome} from './syncConflictContract';
if(!admin.apps.length)admin.initializeApp();
export interface SyncConflictDeps{firestore:FirebaseFirestore.Firestore;now:()=>number}
export const SYNC_CONFLICT_DAILY_LIMIT=200;
const defaults=():SyncConflictDeps=>({firestore:admin.firestore(),now:Date.now});
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Conflict decision unavailable; retain the encrypted request');
function parsed<T>(parser:(value:unknown)=>T,value:unknown){try{return parser(value);}catch{throw fail('invalid-argument');}}
function owns(row:FirebaseFirestore.DocumentSnapshot,uid:string){const data=row.data();return Boolean(data&&data.uid===uid&&data.teamId===null&&data.teamScopeAmbiguous!==true&&data.deletedAt==null&&(data.sharedWithIds==null||Array.isArray(data.sharedWithIds)&&data.sharedWithIds.length===0));}
function personal(row:FirebaseFirestore.DocumentSnapshot,uid:string){if(!owns(row,uid))throw fail('permission-denied');const data=row.data()!;try{parseSyncCipher(data.enc);}catch{throw fail();}const revision=teamRevisionTime(data.updatedAt??data.timestamp);if(data.enc.v!==1||data.text!==''||data.title!=null||revision===null||teamRevisionTime(data.timestamp)===null)throw fail();return{data,revision};}
function conflict(data:FirebaseFirestore.DocumentData){if(!Array.isArray(data.tags)||data.tags.length>100||data.tags.some((tag:unknown)=>typeof tag!=='string'||tag.length>200)||!data.tags.includes('sync-conflict')&&typeof data.conflictReason!=='string')throw fail();}
export async function executeSyncConflictPreparation(uid:string,value:unknown,deps=defaults()):Promise<SyncConflictBase>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const input=parsed(parseSyncConflictTarget,value),db=deps.firestore;
  return db.runTransaction(async tx=>{if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const a=await tx.get(db.doc('sessions/'+input.conflictId)),c=personal(a,uid);conflict(c.data);
    if(syncStateHash(c.data)!==input.conflictViewDigest)throw fail('aborted');let originalHash:string|null=null,originalRevision:number|null=null;
    if(input.action==='apply'){if(c.data.originalMemoryId!==input.originalId)throw fail('aborted');const b=await tx.get(db.doc('sessions/'+input.originalId)),o=personal(b,uid);if(syncStateHash(o.data)!==input.originalViewDigest)throw fail('aborted');originalHash=syncDocumentStateHash(b);originalRevision=o.revision;}
    return{ownerUid:uid,conflictId:input.conflictId,conflictHash:syncDocumentStateHash(a),conflictRevision:c.revision,originalId:input.originalId,originalHash,originalRevision,action:input.action};});
}
export async function executeSyncConflict(uid:string,value:unknown,mode:'apply'|'status'|'cancel',deps=defaults()):Promise<SyncConflictOutcome>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const input=parsed(parseSyncConflictRequest,value),b=input.baseline;if(b.ownerUid!==uid)throw fail('permission-denied');if(!['apply','status','cancel'].includes(mode))throw fail('invalid-argument');
  const db=deps.firestore,digest=hash(syncConflictRequestBytes(input)),ref=db.doc('syncConflictDecisions/'+input.operationId),base:SyncConflictOutcome={operationId:input.operationId,digest,status:'unknown',revision:null,createdAt:null};
  return db.runTransaction(async tx=>{if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const known=await tx.get(ref);
    if(known.exists){const row=known.data()!;if(row.v!==1||row.uid!==uid||row.operationId!==input.operationId||row.digest!==digest||!['committed','cancelled'].includes(row.status)||!syncInteger(row.createdAt)||row.createdAt<1||(row.status==='committed'?!syncInteger(row.revision):row.revision!==null))throw fail('permission-denied');if(mode==='apply'&&row.status!=='committed')throw fail();return{...base,status:row.status,revision:row.revision,createdAt:row.createdAt};}
    const cRef=db.doc('sessions/'+b.conflictId),c=await tx.get(cRef),oRef=b.originalId?db.doc('sessions/'+b.originalId):null,o=oRef?await tx.get(oRef):null;
    if(!owns(c,uid)||o&&!owns(o,uid)){if(mode==='apply')throw fail('permission-denied');return{...base,status:'revoked'};}if(mode==='status')return base;
    const now=deps.now();if(!syncInteger(now)||now<1)throw fail();const owner={v:1,uid,conflictId:b.conflictId,originalId:b.originalId,action:b.action};
    if(mode==='cancel'){const result={...base,status:'cancelled' as const,createdAt:now};tx.create(ref,{...owner,...result});return result;}
    const received=personal(c,uid);conflict(received.data);if(syncDocumentStateHash(c)!==b.conflictHash||received.revision!==b.conflictRevision)throw fail('aborted');
    const original=o?personal(o,uid):null;if(o&&(syncDocumentStateHash(o)!==b.originalHash||original!.revision!==b.originalRevision||received.data.originalMemoryId!==b.originalId))throw fail('aborted');
    const revision=Math.max(now,received.revision+1,(original?.revision??0)+1);if(!syncInteger(revision))throw fail();
    const day=new Date(now).toISOString().slice(0,10),budgetRef=db.doc('syncConflictBudgets/'+hash(uid)+'_'+day),quota=(await tx.get(budgetRef)).data();if(quota&&(quota.v!==1||quota.uid!==uid||quota.day!==day||!syncInteger(quota.operations)))throw fail();if(Number(quota?.operations??0)>=SYNC_CONFLICT_DAILY_LIMIT)throw fail('resource-exhausted');
    const eventRef=db.doc('syncConflictEvents/'+input.operationId),cArchive=cRef.collection('versions').doc('sync-conflict-'+input.operationId),oArchive=oRef?.collection('versions').doc('sync-conflict-'+input.operationId);const occupied=await tx.getAll(eventRef,cArchive,...(oArchive?[oArchive]:[]));if(occupied.some(row=>row.exists))throw fail('already-exists');
    const archive=(data:FirebaseFirestore.DocumentData)=>({...data,previousUpdatedAt:data.updatedAt??data.timestamp,createdAt:revision,editorUid:uid});
    tx.create(cArchive,archive(received.data));if(original&&oArchive&&oRef){tx.create(oArchive,archive(original.data));tx.update(oRef,{enc:received.data.enc,text:'',title:null,tags:received.data.tags.filter((tag:string)=>tag!=='sync-conflict'),category:received.data.category??null,embedding:null,embeddingModel:null,semanticClusterId:null,nodes:null,links:null,generatedPrompt:null,generatedImagePrompt:null,updatedAt:revision,resolvedFromConflictId:b.conflictId});}
    if(original&&oArchive&&b.originalId)recordMemorySupersession(tx,db,uid,{operationId:input.operationId,memoryId:b.originalId,
      previousRevision:original.revision,revision,versionId:oArchive.id,source:'sync-conflict'});
    if(b.action==='keep-both')tx.update(cRef,{tags:received.data.tags.filter((tag:string)=>tag!=='sync-conflict'),originalMemoryId:admin.firestore.FieldValue.delete(),conflictReason:admin.firestore.FieldValue.delete(),updatedAt:revision});
    else tx.update(cRef,{deletedAt:revision,deletedByDeviceId:'desktop',updatedAt:revision});
    const result={...base,status:'committed' as const,revision,createdAt:now};tx.create(ref,{...owner,...result});tx.create(eventRef,{...owner,operationId:input.operationId,digest,archivePaths:[cArchive.path,...(oArchive?[oArchive.path]:[])],createdAt:now});tx.set(budgetRef,{v:1,uid,day,operations:Number(quota?.operations??0)+1,updatedAt:now});return result;
  });
}
export async function executeSyncConflictCall(uid:string,mode:SyncConflictCall,value:unknown,deps=defaults()){if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const command=parsed(value=>parseSyncConflictCommand(mode,value),value);if(command.actorUid!==uid)throw fail('permission-denied');return mode==='prepare'?executeSyncConflictPreparation(uid,command.request,deps):executeSyncConflict(uid,command.request,mode,deps);}
function callable(mode:SyncConflictCall){return functions.region('europe-west1').runWith({memory:'512MB',timeoutSeconds:60}).https.onCall(async(value,context)=>{if(!context.auth?.uid)throw fail('unauthenticated');const uid=context.auth.uid,command=parsed(value=>parseSyncConflictCommand(mode,value),value);if(command.actorUid!==uid)throw fail('permission-denied');if(mode==='apply'&&!PERSONAL_REVISION_WRITES_ENABLED)throw fail();try{if(!(await consumeServerRateLimit('uid:'+uid,{bucket:'sync-conflict-'+mode,max:60,windowMs:60000})).allowed)throw fail('resource-exhausted');return mode==='prepare'?executeSyncConflictPreparation(uid,command.request):executeSyncConflict(uid,command.request,mode);}catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}});}
export const prepareSyncConflictDecision=callable('prepare'),applySyncConflictDecision=callable('apply'),getSyncConflictDecisionStatus=callable('status'),cancelSyncConflictDecision=callable('cancel');
