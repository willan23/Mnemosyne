import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash,createPublicKey} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {syncDocumentStateHash} from './mobileSyncImport';
import {syncInteger} from './mobileSyncImportContract';
import {parseCommsIdentityPreparation,parseCommsIdentityRollover,parseCommsIdentityCommand,commsIdentityRequestBytes,type CommsIdentityCall,type CommsIdentityBaseline,type CommsIdentityRolloverOutcome} from './commsIdentityContract';
if(!admin.apps.length)admin.initializeApp();
export const COMMS_IDENTITY_ROLLOVERS_ENABLED=false;
export const COMMS_IDENTITY_DAILY_LIMIT=5;
export interface CommsIdentityServerDeps{firestore:FirebaseFirestore.Firestore;now:()=>number}
const defaults=():CommsIdentityServerDeps=>({firestore:admin.firestore(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Identity rollover unavailable; retain the local encrypted checkpoint');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function fingerprint(pem:unknown){
  if(typeof pem!=='string'||pem.length>2000)throw fail();
  try{const key=createPublicKey(pem),bits=key.asymmetricKeyDetails?.modulusLength;if(key.asymmetricKeyType!=='rsa'||!bits||bits<2048||bits>4096||key.asymmetricKeyDetails?.publicExponent!==BigInt(65537))throw Error();
    const canonical=`-----BEGIN PUBLIC KEY-----\n${key.export({type:'spki',format:'der'}).toString('base64')}\n-----END PUBLIC KEY-----`;if(canonical!==pem)throw Error();
  }catch{throw fail('invalid-argument');}return hash(pem);
}
function pair(user:FirebaseFirestore.DocumentSnapshot,profile:FirebaseFirestore.DocumentSnapshot,uid:string){
  if(!user.exists||!profile.exists||user.data()?.uid!=null&&user.data()?.uid!==uid||profile.data()?.uid!==uid||user.data()?.publicKeyPem!==profile.data()?.publicKeyPem)throw fail();
  return fingerprint(user.data()?.publicKeyPem);
}
export async function executeCommsIdentityPreparation(uid:string,value:unknown,deps=defaults()):Promise<CommsIdentityBaseline>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');try{parseCommsIdentityPreparation(value);}catch{throw fail('invalid-argument');}
  const db=deps.firestore;return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const[user,profile]=await tx.getAll(db.doc(`users/${uid}`),db.doc(`publicProfiles/${uid}`));
    return{userStateHash:syncDocumentStateHash(user),profileStateHash:syncDocumentStateHash(profile),priorFingerprint:pair(user,profile,uid)};
  });
}
export async function executeCommsIdentityRollover(uid:string,value:unknown,mode:'apply'|'status'|'cancel',deps=defaults()):Promise<CommsIdentityRolloverOutcome>{
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');let input;try{input=parseCommsIdentityRollover(value);}catch{throw fail('invalid-argument');}
  if(!['apply','status','cancel'].includes(mode))throw fail('invalid-argument');const next=fingerprint(input.publicKeyPem),digest=hash(commsIdentityRequestBytes(input)),db=deps.firestore,ref=db.doc(`commsIdentityRollovers/${input.operationId}`);
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const receipt=await tx.get(ref);
    if(receipt.exists){const data=receipt.data()!;if(data.v!==1||data.uid!==uid||data.operationId!==input.operationId||data.digest!==digest||data.fingerprint!==next||!['committed','cancelled'].includes(data.status)||!syncInteger(data.createdAt)||data.createdAt<1)throw fail('permission-denied');
      if(mode==='apply'&&data.status==='cancelled')throw fail();const[user,profile]=await tx.getAll(db.doc(`users/${uid}`),db.doc(`publicProfiles/${uid}`));
      return{operationId:input.operationId,digest,fingerprint:next,status:data.status,current:data.status==='committed'&&(user.data()?.uid==null||user.data()?.uid===uid)&&user.data()?.publicKeyPem===input.publicKeyPem&&profile.data()?.uid===uid&&profile.data()?.publicKeyPem===input.publicKeyPem,createdAt:data.createdAt};
    }
    const result:CommsIdentityRolloverOutcome={operationId:input.operationId,digest,fingerprint:next,status:'unknown',current:false,createdAt:null};if(mode==='status')return result;
    const now=deps.now();if(!syncInteger(now)||now<1)throw fail();
    if(mode==='cancel'){const cancelled={...result,status:'cancelled' as const,createdAt:now};tx.create(ref,{v:1,uid,...cancelled});return cancelled;}
    const userRef=db.doc(`users/${uid}`),profileRef=db.doc(`publicProfiles/${uid}`),[user,profile]=await tx.getAll(userRef,profileRef);
    if(syncDocumentStateHash(user)!==input.baseline.userStateHash||syncDocumentStateHash(profile)!==input.baseline.profileStateHash||pair(user,profile,uid)!==input.baseline.priorFingerprint||next===input.baseline.priorFingerprint)throw fail('aborted');
    const day=new Date(now).toISOString().slice(0,10),budgetRef=db.doc(`commsIdentityBudgets/${hash(uid)}_${day}`),budget=(await tx.get(budgetRef)).data();
    if(budget&&(budget.v!==1||budget.uid!==uid||budget.day!==day||!syncInteger(budget.rollovers)))throw fail();const rollovers=Number(budget?.rollovers??0)+1;if(rollovers>COMMS_IDENTITY_DAILY_LIMIT)throw fail('resource-exhausted');
    tx.update(userRef,{publicKeyPem:input.publicKeyPem,publicKeyUpdatedAt:admin.firestore.FieldValue.serverTimestamp()});
    tx.update(profileRef,{publicKeyPem:input.publicKeyPem,publicKeyUpdatedAt:admin.firestore.FieldValue.serverTimestamp()});
    const committed={...result,status:'committed' as const,current:true,createdAt:now};tx.create(ref,{v:1,uid,...committed});tx.set(budgetRef,{v:1,uid,day,rollovers,updatedAt:now});return committed;
  });
}
function boundCommand(uid:string,mode:CommsIdentityCall,value:unknown){
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');let command;try{command=parseCommsIdentityCommand(mode,value);}catch{throw fail('invalid-argument');}
  if(command.actorUid!==uid)throw fail('permission-denied');return command;
}
/** Internal dispatcher shares the callable's captured actor binding; not an HTTP export. */
export async function executeCommsIdentityCall(uid:string,mode:CommsIdentityCall,value:unknown,deps=defaults()){
  const command=boundCommand(uid,mode,value);return mode==='prepare'?executeCommsIdentityPreparation(uid,command.request,deps):executeCommsIdentityRollover(uid,command.request,mode,deps);
}
function callable(mode:CommsIdentityCall){
  return functions.region('europe-west1').https.onCall(async(value,context)=>{
    if(!context.auth?.uid)throw fail('unauthenticated');const uid=context.auth.uid,command=boundCommand(uid,mode,value);
    if(mode==='apply'&&!COMMS_IDENTITY_ROLLOVERS_ENABLED)throw fail();
    try{if(!(await consumeServerRateLimit(`uid:${uid}`,{bucket:`comms-identity-${mode}`,max:mode==='apply'?5:120,windowMs:60000})).allowed)throw fail('resource-exhausted');
      return mode==='prepare'?executeCommsIdentityPreparation(uid,command.request):executeCommsIdentityRollover(uid,command.request,mode);
    }catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
  });
}
export const prepareCommsIdentityRollover=callable('prepare'),applyCommsIdentityRollover=callable('apply'),getCommsIdentityRolloverStatus=callable('status'),cancelCommsIdentityRollover=callable('cancel');
