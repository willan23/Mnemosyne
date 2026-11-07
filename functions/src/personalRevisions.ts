import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {recordMemorySupersession} from './memorySupersession';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {canonicalSyncState,parseSyncCipher,syncInteger} from './mobileSyncImportContract';
import {syncDocumentStateHash,syncStateHash} from './mobileSyncImport';
import {parsePersonalRevisionTarget,parsePersonalRevisionRequest,personalRevisionRequestBytes,type PersonalRevisionBaseline,type PersonalRevisionOutcome} from './personalRevisionContract';
if(!admin.apps.length)admin.initializeApp();
export const PERSONAL_REVISION_WRITES_ENABLED=false;
export const PERSONAL_REVISION_DAILY_LIMITS={revisions:200,cipherBytes:20*1024*1024} as const;
export interface PersonalRevisionServerDeps {firestore:FirebaseFirestore.Firestore;now:()=>number}
const defaults=():PersonalRevisionServerDeps=>({firestore:admin.firestore(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Encrypted revision unavailable');
function personal(snapshot:FirebaseFirestore.DocumentSnapshot,uid:string){
  const data=snapshot.data();if(!snapshot.exists||!data||data.uid!==uid||data.teamId!==null||data.teamScopeAmbiguous===true||data.deletedAt!=null||
    (data.sharedWithIds!=null&&(!Array.isArray(data.sharedWithIds)||data.sharedWithIds.length!==0)))throw fail('permission-denied');
  if(!syncInteger(data.updatedAt??data.timestamp)||!syncInteger(data.timestamp)||(data.learning!=null&&(typeof data.learning!=='object'||Array.isArray(data.learning))))throw fail();
  if(data.enc!=null){try{parseSyncCipher(data.enc);}catch{throw fail();}if(data.text!==''||data.title!=null)throw fail();}
  else if(typeof data.text!=='string'||(data.title!=null&&typeof data.title!=='string'))throw fail();
  return data;
}
export async function executePersonalRevisionPreparation(uid:string,value:unknown,deps=defaults()):Promise<PersonalRevisionBaseline>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');let input;try{input=parsePersonalRevisionTarget(value);}catch{throw fail('invalid-argument');}
  const db=deps.firestore;return db.runTransaction(async tx=>{if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');
    const snapshot=await tx.get(db.doc(`sessions/${input.sessionId}`));const before=personal(snapshot,uid);
    return{sessionId:input.sessionId,stateHash:syncDocumentStateHash(snapshot),stateDigest:syncStateHash(before),revision:Number(before.updatedAt??before.timestamp)};
  });
}
export async function executePersonalRevision(uid:string,value:unknown,mode:'apply'|'status'|'cancel',deps=defaults()):Promise<PersonalRevisionOutcome>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');let input;try{input=parsePersonalRevisionRequest(value);}catch{throw fail('invalid-argument');}if(!['apply','status','cancel'].includes(mode))throw fail('invalid-argument');
  const digest=createHash('sha256').update(personalRevisionRequestBytes(input)).digest('hex');const db=deps.firestore;const receiptRef=db.doc(`personalRevisions/${input.operationId}`);
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const receipt=await tx.get(receiptRef);
    if(receipt.exists){const data=receipt.data()!;if(data.v!==1||data.uid!==uid||data.operationId!==input.operationId||data.sessionId!==input.baseline.sessionId||data.digest!==digest||
      !['committed','cancelled'].includes(data.status)||!syncInteger(data.createdAt)||data.createdAt<1||(data.status==='committed'?(!syncInteger(data.revision)||data.revision<=input.baseline.revision):data.revision!==null))throw fail('permission-denied');
      if(mode==='apply'&&data.status==='cancelled')throw fail();return{operationId:input.operationId,sessionId:input.baseline.sessionId,digest,status:data.status,revision:data.revision,createdAt:data.createdAt};}
    const result:PersonalRevisionOutcome={operationId:input.operationId,sessionId:input.baseline.sessionId,digest,status:'unknown',revision:null,createdAt:null};if(mode==='status')return result;
    const now=deps.now();if(!syncInteger(now)||now<1)throw fail();
    if(mode==='cancel'){const cancelled:PersonalRevisionOutcome={...result,status:'cancelled',createdAt:now};tx.create(receiptRef,{v:1,uid,...cancelled});return cancelled;}
    const ref=db.doc(`sessions/${input.baseline.sessionId}`);const snapshot=await tx.get(ref);const before=personal(snapshot,uid);
    if(syncDocumentStateHash(snapshot)!==input.baseline.stateHash||syncStateHash(before)!==input.baseline.stateDigest||(before.updatedAt??before.timestamp)!==input.baseline.revision)throw fail('aborted');
    if(before.enc!=null&&canonicalSyncState(before.enc)!==canonicalSyncState(input.priorEnc))throw fail('aborted');
    const versionRef=ref.collection('versions').doc(`revision-${input.operationId}`);if((await tx.get(versionRef)).exists)throw fail('already-exists');
    const day=new Date(now).toISOString().slice(0,10),budgetRef=db.doc(`personalRevisionBudgets/${createHash('sha256').update(uid).digest('hex')}_${day}`);const budget=(await tx.get(budgetRef)).data();
    if(budget&&(budget.v!==1||budget.uid!==uid||budget.day!==day||![budget.revisions,budget.cipherBytes].every(syncInteger)))throw fail();
    const consumed={revisions:Number(budget?.revisions??0)+1,cipherBytes:Number(budget?.cipherBytes??0)+Buffer.byteLength(input.enc.ct)+Buffer.byteLength(input.priorEnc.ct)};
    if(consumed.revisions>PERSONAL_REVISION_DAILY_LIMITS.revisions||consumed.cipherBytes>PERSONAL_REVISION_DAILY_LIMITS.cipherBytes)throw fail('resource-exhausted');
    const revision=Math.max(now,input.baseline.revision+1);if(!syncInteger(revision))throw fail();
    const metadata=Object.fromEntries(['tags','category','attachments','embedding','embeddingModel','connections','semanticClusterId','position','importance','celestialType','processingMethod'].filter(key=>before[key]!==undefined).map(key=>[key,before[key]]));
    tx.create(versionRef,{...metadata,text:'',title:null,enc:input.priorEnc,attachments:before.attachments??null,previousUpdatedAt:input.baseline.revision,createdAt:revision,editorUid:uid});
    tx.update(ref,{text:'',title:null,enc:input.enc,...input.metadata,updatedAt:revision,learning:{...before.learning,revisedAt:revision},nodes:null,links:null,generatedPrompt:null,generatedImagePrompt:null});
    recordMemorySupersession(tx,db,uid,{operationId:input.operationId,memoryId:input.baseline.sessionId,
      previousRevision:input.baseline.revision,revision,versionId:versionRef.id,source:'personal-revision'});
    const committed:PersonalRevisionOutcome={...result,status:'committed',revision,createdAt:now};tx.create(receiptRef,{v:1,uid,...committed});tx.set(budgetRef,{v:1,uid,day,...consumed,updatedAt:now});return committed;
  });
}
function callable(mode:'prepare'|'apply'|'status'|'cancel'){
  return functions.region('europe-west1').https.onCall(async(value,context)=>{
    if(!context.auth?.uid)throw fail('unauthenticated');try{if(mode==='prepare')parsePersonalRevisionTarget(value);else parsePersonalRevisionRequest(value);}catch{throw fail('invalid-argument');}
    if(mode==='apply'&&!PERSONAL_REVISION_WRITES_ENABLED)throw fail();
    try{if(!(await consumeServerRateLimit(`uid:${context.auth.uid}`,{bucket:`personal-revision-${mode}`,max:mode==='apply'?60:120,windowMs:60000})).allowed)throw fail('resource-exhausted');
      return mode==='prepare'?executePersonalRevisionPreparation(context.auth.uid,value):executePersonalRevision(context.auth.uid,value,mode);
    }catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
  });
}
export const preparePersonalRevision=callable('prepare'),applyPersonalRevision=callable('apply'),getPersonalRevisionStatus=callable('status'),cancelPersonalRevision=callable('cancel');
