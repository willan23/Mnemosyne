import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {recordMemorySupersession} from './memorySupersession';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {TEAM_WRITES_ENABLED} from './teams';
import {PERSONAL_REVISION_WRITES_ENABLED} from './personalRevisions';
import {teamRevisionAccess,teamRevisionParent} from './teamRevisions';
import {TEAM_REVISION_ARCHIVE_FIELDS,parseTeamRevisionCipher,teamRevisionTime} from './teamRevisionContract';
import {canonicalSyncState,syncInteger} from './mobileSyncImportContract';
import {syncDocumentStateHash,syncStateHash} from './mobileSyncImport';
import {memoryEditRequestBytes,parseMemoryEditCommand,parseMemoryEditTarget,parseMemoryEditRequest,type MemoryEditCall,type MemoryEditBaseline,type MemoryEditOutcome,type MemoryEditRequest} from './memoryEditContract';
if(!admin.apps.length)admin.initializeApp();
export const MEMORY_EDIT_DAILY_LIMITS={operations:200,cipherBytes:20*1024*1024,teamOperations:1000,teamCipherBytes:100*1024*1024} as const;
export interface MemoryEditCommitContext{before:FirebaseFirestore.DocumentData;after:FirebaseFirestore.DocumentData;versionId:string}
export interface MemoryEditServerDeps{
  firestore:FirebaseFirestore.Firestore;now:()=>number;
  /** Trusted server hook: all admission reads precede writes; its finalizer writes in this same transaction. */
  authorize?:(tx:FirebaseFirestore.Transaction,input:MemoryEditRequest,digest:string,receipt:FirebaseFirestore.DocumentData|undefined)=>Promise<((outcome:MemoryEditOutcome,context:MemoryEditCommitContext)=>void)|undefined>;
}
const defaults=():MemoryEditServerDeps=>({firestore:admin.firestore(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Memory change unavailable; preserve the encrypted draft and pending request');
function parsed<T>(parse:(value:unknown)=>T,value:unknown):T{try{return parse(value);}catch{throw fail('invalid-argument');}}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const ARCHIVE_FIELDS=[...TEAM_REVISION_ARCHIVE_FIELDS,'color','scale','orbitRadius','orbitSpeed'] as const;
function personal(snapshot:FirebaseFirestore.DocumentSnapshot,uid:string){
  const row=snapshot.data();if(!snapshot.exists||!row||row.uid!==uid||row.teamId!==null||row.teamScopeAmbiguous===true||row.deletedAt!=null||teamRevisionTime(row.timestamp)===null||teamRevisionTime(row.updatedAt??row.timestamp)===null||['nodes','links','generatedPrompt','generatedImagePrompt'].some(key=>row[key]!=null)||row.learning!=null&&(typeof row.learning!=='object'||Array.isArray(row.learning))||row.sharedWithIds!=null&&(!Array.isArray(row.sharedWithIds)||!row.sharedWithIds.every(attachmentActorIdValid)))throw fail('permission-denied');
  if(row.enc!=null){const enc=parsed(parseTeamRevisionCipher,row.enc);if(enc.v!==1||row.text!==''||row.title!=null)throw fail();}
  else if(typeof row.text!=='string'||row.title!=null&&typeof row.title!=='string')throw fail();return row;
}
export async function executeMemoryEditPreparation(uid:string,value:unknown,deps=defaults()):Promise<MemoryEditBaseline>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const target=parsed(parseMemoryEditTarget,value),db=deps.firestore;
  return db.runTransaction(tx=>inspectMemoryEditBaseline(tx,db,uid,target));
}
/** Shared snapshot-bound admission for trusted server protocols; never exposed as an unbound callable. */
export async function inspectMemoryEditBaseline(tx:FirebaseFirestore.Transaction,db:FirebaseFirestore.Firestore,uid:string,target:import('./memoryEditContract').MemoryEditTarget):Promise<MemoryEditBaseline>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');
    const access=target.teamId===null?null:await teamRevisionAccess(tx,db,uid,target.teamId);if(access?.revoked)throw fail('permission-denied');
    const snapshot=await tx.get(db.doc(`sessions/${target.sessionId}`));
    if(target.teamId===null){const row=personal(snapshot,uid);return{...target,kind:'personal',authorUid:uid,ownerUid:uid,stateHash:syncDocumentStateHash(snapshot),stateDigest:syncStateHash(row),revision:teamRevisionTime(row.updatedAt??row.timestamp)!,teamStateHash:null,epochStateHash:null,keyEpoch:null,keyId:null,priorKeyEpoch:null,priorKeyId:null};}
    if(!access||access.revoked)throw fail('permission-denied');const before=teamRevisionParent(snapshot,target.teamId,access.row.activeKeyEpoch);if(before.priorKeyEpoch>access.row.activeKeyEpoch||!await liveAccountInTransaction(tx,db,before.row.uid,false))throw fail('permission-denied');
    return{...target,kind:'team',authorUid:before.row.uid,ownerUid:access.row.ownerUid,stateHash:syncDocumentStateHash(snapshot),stateDigest:syncStateHash(before.row),revision:teamRevisionTime(before.row.updatedAt??before.row.timestamp)!,teamStateHash:syncDocumentStateHash(access.team),epochStateHash:syncDocumentStateHash(access.epoch),keyEpoch:access.row.activeKeyEpoch,keyId:access.row.activeKeyId,priorKeyEpoch:before.priorKeyEpoch,priorKeyId:before.priorKeyId};
}
function receiptOutcome(row:FirebaseFirestore.DocumentData,uid:string,input:MemoryEditRequest,digest:string):MemoryEditOutcome{
  const base=input.baseline;if(row.v!==1||row.uid!==uid||row.authorUid!==base.authorUid||row.ownerUid!==base.ownerUid||row.operationId!==input.operationId||row.sessionId!==base.sessionId||row.teamId!==base.teamId||row.operation!==input.operation||row.digest!==digest||!['committed','cancelled'].includes(row.status)||!syncInteger(row.createdAt)||row.createdAt<1||(row.status==='committed'?(!syncInteger(row.revision)||row.revision<=base.revision):row.revision!==null))throw fail('permission-denied');
  return{operationId:input.operationId,sessionId:base.sessionId,teamId:base.teamId,operation:input.operation,digest,status:row.status,revision:row.revision,createdAt:row.createdAt};
}
export async function executeMemoryEdit(uid:string,value:unknown,mode:'apply'|'status'|'cancel',deps=defaults()):Promise<MemoryEditOutcome>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const input=parsed(parseMemoryEditRequest,value),base=input.baseline;if(!['apply','status','cancel'].includes(mode))throw fail('invalid-argument');if(base.kind==='personal'&&base.authorUid!==uid)throw fail('permission-denied');const db=deps.firestore,digest=hash(memoryEditRequestBytes(input)),receiptRef=db.doc('memoryEdits/'+input.operationId);
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const receipt=await tx.get(receiptRef);
    const finalize=deps.authorize?await deps.authorize(tx,input,digest,receipt.data()):undefined;
    if(receipt.exists){const result=receiptOutcome(receipt.data()!,uid,input,digest);if(mode==='apply'&&result.status!=='committed')throw fail();return result;}
    const result:MemoryEditOutcome={operationId:input.operationId,sessionId:base.sessionId,teamId:base.teamId,operation:input.operation,digest,status:'unknown',revision:null,createdAt:null};
    const access=base.kind==='team'?await teamRevisionAccess(tx,db,uid,base.teamId!):null;
    const authorLive=await liveAccountInTransaction(tx,db,base.authorUid,false),ownerLive=await liveAccountInTransaction(tx,db,base.ownerUid,false);
    if(access?.revoked||!authorLive||!ownerLive){if(mode==='apply')throw fail('permission-denied');return{...result,status:'revoked'};}
    if(mode==='status')return result;const now=deps.now();if(!syncInteger(now)||now<1)throw fail();
    if(mode==='cancel'){const cancelled={...result,status:'cancelled' as const,createdAt:now};tx.create(receiptRef,{v:1,uid,authorUid:base.authorUid,ownerUid:base.ownerUid,...cancelled});return cancelled;}
    if(base.kind==='team'){if(!access||access.revoked)throw fail();if(input.operation==='delete'&&uid!==access.row.ownerUid)throw fail('permission-denied');if((await tx.get(db.doc('config/teamSecurity'))).data()?.writesEnabled!==true)throw fail();}
    const sessionRef=db.doc('sessions/'+base.sessionId),snapshot=await tx.get(sessionRef),before=base.kind==='personal'?personal(snapshot,uid):teamRevisionParent(snapshot,base.teamId!,access&&!access.revoked?access.row.activeKeyEpoch:-1).row;
    if(syncDocumentStateHash(snapshot)!==base.stateHash||syncStateHash(before)!==base.stateDigest||before.uid!==base.authorUid||teamRevisionTime(before.updatedAt??before.timestamp)!==base.revision)throw fail('aborted');
    if(before.enc!=null&&canonicalSyncState(before.enc)!==canonicalSyncState(input.priorEnc))throw fail('aborted');
    if(base.kind==='team'){if(!access||access.revoked||(before.keyEpoch??1)!==base.priorKeyEpoch||(before.keyId??null)!==base.priorKeyId||syncDocumentStateHash(access.team)!==base.teamStateHash||syncDocumentStateHash(access.epoch)!==base.epochStateHash||access.row.ownerUid!==base.ownerUid||access.row.activeKeyEpoch!==base.keyEpoch||access.row.activeKeyId!==base.keyId)throw fail('aborted');}
    const versionRef=sessionRef.collection('versions').doc('memory-edit-'+input.operationId),eventRef=db.doc('memoryEditEvents/'+input.operationId);if((await tx.get(versionRef)).exists||(await tx.get(eventRef)).exists)throw fail('already-exists');
    const day=new Date(now).toISOString().slice(0,10),userRef=db.doc('memoryEditBudgets/'+hash(JSON.stringify([uid,base.teamId]))+'_'+day),teamRef=base.teamId?db.doc('memoryEditTeamBudgets/'+hash(base.teamId)+'_'+day):null;
    const userSnapshot=await tx.get(userRef),teamSnapshot=teamRef?await tx.get(teamRef):null,cipherBytes=Buffer.byteLength(input.priorEnc.ct)+Buffer.byteLength(input.enc?.ct??'');
    const budget=(snapshot:FirebaseFirestore.DocumentSnapshot|null,actor:boolean)=>{const row=snapshot?.data();if(row&&(row.v!==1||row.teamId!==base.teamId||row.day!==day||actor&&row.uid!==uid||!syncInteger(row.operations)||!syncInteger(row.cipherBytes)))throw fail();return{operations:Number(row?.operations??0)+1,cipherBytes:Number(row?.cipherBytes??0)+cipherBytes};};
    const user=budget(userSnapshot,true),team=teamRef?budget(teamSnapshot,false):null;if(user.operations>MEMORY_EDIT_DAILY_LIMITS.operations||user.cipherBytes>MEMORY_EDIT_DAILY_LIMITS.cipherBytes||team&&(team.operations>MEMORY_EDIT_DAILY_LIMITS.teamOperations||team.cipherBytes>MEMORY_EDIT_DAILY_LIMITS.teamCipherBytes))throw fail('resource-exhausted');
    const revision=Math.max(now,base.revision+1);if(!syncInteger(revision))throw fail();const metadata=Object.fromEntries(ARCHIVE_FIELDS.filter(key=>before[key]!==undefined).map(key=>[key,before[key]]));
    tx.create(versionRef,{...metadata,uid:before.uid,timestamp:before.timestamp,teamId:base.teamId,text:'',title:null,enc:input.priorEnc,...(base.kind==='team'?{keyEpoch:base.priorKeyEpoch,keyId:base.priorKeyId}:{}),previousUpdatedAt:before.updatedAt??before.timestamp,createdAt:revision,editorUid:uid});
    const changes=input.operation==='edit'?{enc:input.enc,...input.metadata,...(base.kind==='team'?{keyEpoch:base.keyEpoch,keyId:base.keyId}:{}),...(before.learning?{learning:{...before.learning,revisedAt:revision}}:{})}:{enc:input.priorEnc,deletedAt:revision};
    const update={...changes,text:'',title:null,updatedAt:revision,lastVersionId:versionRef.id,nodes:null,links:null,generatedPrompt:null,generatedImagePrompt:null};
    tx.update(sessionRef,update);
    if(input.operation==='edit')recordMemorySupersession(tx,db,uid,{operationId:input.operationId,memoryId:base.sessionId,
      previousRevision:base.revision,revision,versionId:versionRef.id,source:'memory-edit'});
    const committed={...result,status:'committed' as const,revision,createdAt:now};tx.create(receiptRef,{v:1,uid,authorUid:base.authorUid,ownerUid:base.ownerUid,...committed});tx.create(eventRef,{v:1,uid,authorUid:base.authorUid,ownerUid:base.ownerUid,sessionId:base.sessionId,teamId:base.teamId,operation:input.operation,versionId:versionRef.id,createdAt:now,revision});tx.set(userRef,{v:1,uid,teamId:base.teamId,day,...user,updatedAt:now});if(teamRef&&team)tx.set(teamRef,{v:1,teamId:base.teamId,day,...team,updatedAt:now});finalize?.(committed,{before,after:{...before,...update},versionId:versionRef.id});return committed;
  });
}
function bound(uid:string,mode:MemoryEditCall,value:unknown){if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const command=parsed(input=>parseMemoryEditCommand(mode,input),value);if(command.actorUid!==uid)throw fail('permission-denied');return command;}
export async function executeMemoryEditCall(uid:string,mode:MemoryEditCall,value:unknown,deps=defaults()){const command=bound(uid,mode,value);return mode==='prepare'?executeMemoryEditPreparation(uid,command.request,deps):executeMemoryEdit(uid,command.request,mode,deps);}
function callable(mode:MemoryEditCall){return functions.region('europe-west1').https.onCall(async(value,context)=>{if(!context.auth?.uid)throw fail('unauthenticated');const uid=context.auth.uid,command=bound(uid,mode,value);if(mode==='apply'&&!(('baseline' in command.request&&command.request.baseline.kind==='team')?TEAM_WRITES_ENABLED:PERSONAL_REVISION_WRITES_ENABLED))throw fail();
  try{if(!(await consumeServerRateLimit('uid:'+uid,{bucket:'memory-edit-'+mode,max:mode==='apply'?60:120,windowMs:60000})).allowed)throw fail('resource-exhausted');return mode==='prepare'?executeMemoryEditPreparation(uid,command.request):executeMemoryEdit(uid,command.request,mode);}catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
});}
export const prepareMemoryEdit=callable('prepare'),applyMemoryEdit=callable('apply'),getMemoryEditStatus=callable('status'),cancelMemoryEdit=callable('cancel');
