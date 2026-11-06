import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {recordMemorySupersession} from './memorySupersession';
import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {TEAM_WRITES_ENABLED} from './teams';
import {canonicalSyncState,syncInteger} from './mobileSyncImportContract';
import {syncDocumentStateHash,syncStateHash} from './mobileSyncImport';
import {parseTeamRevisionCommand,parseTeamRevisionTarget,parseTeamRevisionRequest,parseTeamRevisionCipher,teamRevisionTime,teamRevisionRequestBytes,TEAM_REVISION_ARCHIVE_FIELDS,type TeamRevisionCall,type TeamRevisionBaseline,type TeamRevisionRequest,type TeamRevisionOutcome} from './teamRevisionContract';
if(!admin.apps.length)admin.initializeApp();
export const TEAM_REVISION_DAILY_LIMITS={revisions:200,cipherBytes:20*1024*1024,teamRevisions:1000,teamCipherBytes:100*1024*1024} as const;
export interface TeamRevisionServerDeps{firestore:FirebaseFirestore.Firestore;now:()=>number}
const defaults=():TeamRevisionServerDeps=>({firestore:admin.firestore(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Encrypted team revision unavailable; retain the local draft');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function parsed<T>(parse:(value:unknown)=>T,value:unknown):T{try{return parse(value);}catch{throw fail('invalid-argument');}}
export function teamRevisionParent(snapshot:FirebaseFirestore.DocumentSnapshot,teamId:string,activeEpoch:number){
  const row=snapshot.data();if(!snapshot.exists||!row||row.teamId!==teamId||!attachmentActorIdValid(row.uid)||row.deletedAt!=null||row.teamScopeAmbiguous===true||teamRevisionTime(row.timestamp)===null||teamRevisionTime(row.updatedAt??row.timestamp)===null||row.text!==''||row.title!=null||['nodes','links','generatedPrompt','generatedImagePrompt'].some(key=>row[key]!=null))throw fail('permission-denied');
  const enc=parsed(parseTeamRevisionCipher,row.enc),priorKeyEpoch=row.keyEpoch??1,priorKeyId=row.keyId??null;
  if(!syncInteger(activeEpoch)||activeEpoch<1||!syncInteger(priorKeyEpoch)||priorKeyEpoch<1||priorKeyEpoch>activeEpoch||enc.v===2&&!attachmentIdValid(priorKeyId)||enc.v===1&&priorKeyId!==null&&!attachmentIdValid(priorKeyId)||row.learning!=null&&(typeof row.learning!=='object'||Array.isArray(row.learning)))throw fail();
  return{row,enc,priorKeyEpoch,priorKeyId:priorKeyId as string|null};
}
export async function teamRevisionMembership(tx:FirebaseFirestore.Transaction,db:FirebaseFirestore.Firestore,uid:string,teamId:string){
  const [marker,team]=await tx.getAll(db.doc(`teamDeletions/${teamId}`),db.doc(`teams/${teamId}`));const row=team.data();
  if(marker.exists||row?.status==='deleting'||row?.deletedAt!=null)return{revoked:true as const,team};
  if(!row||!Array.isArray(row.memberUids)||!attachmentActorIdValid(row.ownerUid)||!row.memberUids.includes(row.ownerUid))throw fail('permission-denied');
  if(!row.memberUids.includes(uid)||!await liveAccountInTransaction(tx,db,row.ownerUid,false))return{revoked:true as const,team};
  return{revoked:false as const,team,row,epoch:undefined};
}
export async function teamRevisionAccess(tx:FirebaseFirestore.Transaction,db:FirebaseFirestore.Firestore,uid:string,teamId:string){
  const access=await teamRevisionMembership(tx,db,uid,teamId);if(access.revoked)return access;const{team,row}=access;
  if(row.keyRotationStatus!=='active'||row.pendingRotationId!=null||!syncInteger(row.activeKeyEpoch)||row.activeKeyEpoch<1||!attachmentIdValid(row.activeKeyId)||!row.wrappedKeys?.[uid])throw fail();
  const epoch=await tx.get(db.doc(`teams/${teamId}/keyEpochs/${row.activeKeyEpoch}`)),key=epoch.data();if(!epoch.exists||key?.epoch!==row.activeKeyEpoch||key?.keyId!==row.activeKeyId||key?.status!=='active'||!Array.isArray(key.memberUids)||!key.memberUids.includes(uid)||!key.wrappedKeys?.[uid])throw fail();
  return{revoked:false as const,team,epoch,row};
}
export async function executeTeamRevisionPreparation(uid:string,value:unknown,deps=defaults()):Promise<TeamRevisionBaseline>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const input=parsed(parseTeamRevisionTarget,value),db=deps.firestore;
  return db.runTransaction(async tx=>{if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const access=await teamRevisionAccess(tx,db,uid,input.teamId);if(access.revoked)throw fail('permission-denied');
    const snapshot=await tx.get(db.doc(`sessions/${input.sessionId}`)),before=teamRevisionParent(snapshot,input.teamId,access.row.activeKeyEpoch);if(before.priorKeyEpoch>access.row.activeKeyEpoch||!await liveAccountInTransaction(tx,db,before.row.uid,false))throw fail('permission-denied');
    return{...input,authorUid:before.row.uid,ownerUid:access.row.ownerUid,stateHash:syncDocumentStateHash(snapshot),stateDigest:syncStateHash(before.row),revision:teamRevisionTime(before.row.updatedAt??before.row.timestamp)!,teamStateHash:syncDocumentStateHash(access.team),epochStateHash:syncDocumentStateHash(access.epoch),keyEpoch:access.row.activeKeyEpoch,keyId:access.row.activeKeyId,priorKeyEpoch:before.priorKeyEpoch,priorKeyId:before.priorKeyId};
  });
}
function receiptOutcome(data:FirebaseFirestore.DocumentData,uid:string,input:TeamRevisionRequest,digest:string):TeamRevisionOutcome{
  if(data.v!==1||data.uid!==uid||data.authorUid!==input.baseline.authorUid||data.ownerUid!==input.baseline.ownerUid||data.operationId!==input.operationId||data.sessionId!==input.baseline.sessionId||data.teamId!==input.baseline.teamId||data.digest!==digest||!['committed','cancelled'].includes(data.status)||!syncInteger(data.createdAt)||data.createdAt<1||(data.status==='committed'?(!syncInteger(data.revision)||data.revision<=input.baseline.revision):data.revision!==null))throw fail('permission-denied');
  return{operationId:input.operationId,sessionId:data.sessionId,teamId:data.teamId,digest,status:data.status,revision:data.revision,createdAt:data.createdAt};
}
export async function executeTeamRevision(uid:string,value:unknown,mode:'apply'|'status'|'cancel',deps=defaults()):Promise<TeamRevisionOutcome>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const input=parsed(parseTeamRevisionRequest,value);if(!['apply','status','cancel'].includes(mode))throw fail('invalid-argument');const db=deps.firestore,digest=hash(teamRevisionRequestBytes(input)),ref=db.doc(`teamRevisions/${input.operationId}`);
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const receipt=await tx.get(ref);let known:TeamRevisionOutcome|undefined;if(receipt.exists)known=receiptOutcome(receipt.data()!,uid,input,digest);
    const base:TeamRevisionOutcome={operationId:input.operationId,sessionId:input.baseline.sessionId,teamId:input.baseline.teamId,digest,status:'unknown',revision:null,createdAt:null};
    // Terminal owned receipts can be recovered after rotation/removal/cleanup;
    // they do not authorize another content write or a new reference.
    if(known){if(mode==='apply'&&known.status!=='committed')throw fail();return known;}
    const access=await teamRevisionAccess(tx,db,uid,input.baseline.teamId),authorLive=await liveAccountInTransaction(tx,db,input.baseline.authorUid,false),ownerLive=await liveAccountInTransaction(tx,db,input.baseline.ownerUid,false);
    if(access.revoked||!authorLive||!ownerLive){if(mode==='apply')throw fail('permission-denied');return{...base,status:'revoked'};}
    if(mode==='status')return base;const now=deps.now();if(!syncInteger(now)||now<1)throw fail();
    if(mode==='cancel'){const cancelled={...base,status:'cancelled' as const,createdAt:now};tx.create(ref,{v:1,uid,authorUid:input.baseline.authorUid,ownerUid:input.baseline.ownerUid,...cancelled});return cancelled;}
    const security=await tx.get(db.doc('config/teamSecurity'));if(security.data()?.writesEnabled!==true)throw fail();
    const sessionRef=db.doc(`sessions/${input.baseline.sessionId}`),snapshot=await tx.get(sessionRef),before=teamRevisionParent(snapshot,input.baseline.teamId,access.row.activeKeyEpoch);
    if(syncDocumentStateHash(snapshot)!==input.baseline.stateHash||syncStateHash(before.row)!==input.baseline.stateDigest||before.row.uid!==input.baseline.authorUid||teamRevisionTime(before.row.updatedAt??before.row.timestamp)!==input.baseline.revision||before.priorKeyEpoch!==input.baseline.priorKeyEpoch||before.priorKeyId!==input.baseline.priorKeyId||canonicalSyncState(before.enc)!==canonicalSyncState(input.priorEnc)||syncDocumentStateHash(access.team)!==input.baseline.teamStateHash||syncDocumentStateHash(access.epoch)!==input.baseline.epochStateHash||access.row.activeKeyEpoch!==input.baseline.keyEpoch||access.row.activeKeyId!==input.baseline.keyId||access.row.ownerUid!==input.baseline.ownerUid)throw fail('aborted');
    const versionRef=sessionRef.collection('versions').doc(`team-revision-${input.operationId}`),auditRef=db.doc(`teamAudit/revision-${input.operationId}`);if((await tx.get(versionRef)).exists||(await tx.get(auditRef)).exists)throw fail('already-exists');
    const day=new Date(now).toISOString().slice(0,10),userBudget=db.doc(`teamRevisionBudgets/${hash(JSON.stringify([uid,input.baseline.teamId]))}_${day}`),teamBudget=db.doc(`teamRevisionTeamBudgets/${hash(input.baseline.teamId)}_${day}`),[userRow,teamRow]=await tx.getAll(userBudget,teamBudget);
    const cipherBytes=Buffer.byteLength(input.enc.ct)+Buffer.byteLength(input.priorEnc.ct);const budget=(row:FirebaseFirestore.DocumentSnapshot,actor:boolean)=>{const data=row.data();if(data&&(data.v!==1||data.teamId!==input.baseline.teamId||data.day!==day||actor&&data.uid!==uid||!syncInteger(data.revisions)||!syncInteger(data.cipherBytes)))throw fail();return{revisions:Number(data?.revisions??0)+1,cipherBytes:Number(data?.cipherBytes??0)+cipherBytes};};
    const user=budget(userRow,true),team=budget(teamRow,false);if(user.revisions>TEAM_REVISION_DAILY_LIMITS.revisions||user.cipherBytes>TEAM_REVISION_DAILY_LIMITS.cipherBytes||team.revisions>TEAM_REVISION_DAILY_LIMITS.teamRevisions||team.cipherBytes>TEAM_REVISION_DAILY_LIMITS.teamCipherBytes)throw fail('resource-exhausted');
    const revision=Math.max(now,input.baseline.revision+1);if(!syncInteger(revision))throw fail();const metadata=Object.fromEntries(TEAM_REVISION_ARCHIVE_FIELDS.filter(key=>before.row[key]!==undefined).map(key=>[key,before.row[key]]));
    tx.create(versionRef,{...metadata,uid:before.row.uid,timestamp:before.row.timestamp,teamId:input.baseline.teamId,keyEpoch:before.priorKeyEpoch,keyId:before.priorKeyId,text:'',title:null,enc:input.priorEnc,previousUpdatedAt:before.row.updatedAt??before.row.timestamp,createdAt:revision,editorUid:uid});
    tx.update(sessionRef,{text:'',title:null,enc:input.enc,...input.metadata,keyEpoch:input.baseline.keyEpoch,keyId:input.baseline.keyId,updatedAt:revision,lastVersionId:versionRef.id,...(before.row.learning?{learning:{...before.row.learning,revisedAt:revision}}:{}),nodes:null,links:null,generatedPrompt:null,generatedImagePrompt:null});
    recordMemorySupersession(tx,db,uid,{operationId:input.operationId,memoryId:input.baseline.sessionId,
      previousRevision:input.baseline.revision,revision,versionId:versionRef.id,source:'team-revision'});
    const result={...base,status:'committed' as const,revision,createdAt:now};tx.create(ref,{v:1,uid,authorUid:input.baseline.authorUid,ownerUid:input.baseline.ownerUid,...result});tx.create(auditRef,{v:1,type:'memory_revised',actorUid:uid,teamId:input.baseline.teamId,sessionId:input.baseline.sessionId,versionId:versionRef.id,revision,createdAt:now});tx.set(userBudget,{v:1,uid,teamId:input.baseline.teamId,day,...user,updatedAt:now});tx.set(teamBudget,{v:1,teamId:input.baseline.teamId,day,...team,updatedAt:now});return result;
  });
}
function bound(uid:string,mode:TeamRevisionCall,value:unknown){if(!attachmentActorIdValid(uid))throw fail('unauthenticated');const command=parsed(input=>parseTeamRevisionCommand(mode,input),value);if(command.actorUid!==uid)throw fail('permission-denied');return command;}
export async function executeTeamRevisionCall(uid:string,mode:TeamRevisionCall,value:unknown,deps=defaults()){const command=bound(uid,mode,value);return mode==='prepare'?executeTeamRevisionPreparation(uid,command.request,deps):executeTeamRevision(uid,command.request,mode,deps);}
function callable(mode:TeamRevisionCall){return functions.region('europe-west1').https.onCall(async(value,context)=>{if(!context.auth?.uid)throw fail('unauthenticated');const uid=context.auth.uid,command=bound(uid,mode,value);if(mode==='apply'&&!TEAM_WRITES_ENABLED)throw fail();
  try{if(!(await consumeServerRateLimit(`uid:${uid}`,{bucket:`team-revision-${mode}`,max:mode==='apply'?60:120,windowMs:60000})).allowed)throw fail('resource-exhausted');return mode==='prepare'?executeTeamRevisionPreparation(uid,command.request):executeTeamRevision(uid,command.request,mode);}catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
});}
export const prepareTeamRevision=callable('prepare'),applyTeamRevision=callable('apply'),getTeamRevisionStatus=callable('status'),cancelTeamRevision=callable('cancel');
