import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash,createPublicKey} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {verifiedAuthEmail} from './authEmail';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {isCommsContactPairRemoving} from './commsContactRemovalContract';
import {parseCommsRecipientLookup,parseCommsContactRequest,parseCommsContactResponse,parseCommsContactCommand,commsContactRequestBytes,type CommsContactCall,type CommsContactCommand,type CommsRecipient,type CommsContactRequest,type CommsContactOutcome} from './commsContactContract';
if(!admin.apps.length)admin.initializeApp();
export const COMMS_CONTACT_WRITES_ENABLED=false;
export const COMMS_CONTACT_DAILY_LIMIT=20;
export interface CommsContactServerDeps {firestore:FirebaseFirestore.Firestore;auth:Pick<admin.auth.Auth,'getUser'|'getUserByEmail'>;now:()=>number}
const defaults=():CommsContactServerDeps=>({firestore:admin.firestore(),auth:admin.auth(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Comms contact operation unavailable');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const commsContactPairId=(a:string,b:string)=>hash(JSON.stringify([a,b].sort()));
async function account(uid:string,deps:CommsContactServerDeps){if(!attachmentActorIdValid(uid))throw fail('unauthenticated');try{const user=await deps.auth.getUser(uid);if(user.uid!==uid||user.disabled)throw Error();return user;}catch{throw fail('failed-precondition');}}
async function active(tx:FirebaseFirestore.Transaction,uid:string,deps:CommsContactServerDeps){if(!await liveAccountInTransaction(tx,deps.firestore,uid))throw fail('permission-denied');}
export const verifiedCommsEmail=verifiedAuthEmail;
export function publicProfile(uid:string,user:FirebaseFirestore.DocumentSnapshot,profile:FirebaseFirestore.DocumentSnapshot):CommsRecipient {
  const data=profile.data(),pem=data?.publicKeyPem;
  if(!user.exists||!profile.exists||user.data()?.uid!=null&&user.data()?.uid!==uid||data?.uid!==uid||user.data()?.publicKeyPem!==pem||typeof pem!=='string'||pem.length>2000)throw fail();
  try{const key=createPublicKey(pem),bits=key.asymmetricKeyDetails?.modulusLength;if(key.asymmetricKeyType!=='rsa'||!bits||bits<2048||bits>4096||key.asymmetricKeyDetails?.publicExponent!==BigInt(65537)||pem!==`-----BEGIN PUBLIC KEY-----\n${key.export({type:'spki',format:'der'}).toString('base64')}\n-----END PUBLIC KEY-----`)throw Error();}catch{throw fail();}
  const displayName=typeof data?.displayName==='string'&&data.displayName.trim()?data.displayName.trim().slice(0,120):uid.slice(0,120);
  return{uid,displayName,publicKeyPem:pem,fingerprint:hash(pem)};
}
export async function executeCommsRecipientLookup(uid:string,value:unknown,deps=defaults()):Promise<CommsRecipient>{
  let input;try{input=parseCommsRecipientLookup(value);}catch{throw fail('invalid-argument');}await account(uid,deps);let target=input.lookup;
  if(input.lookup.includes('@')){try{
    const user=await deps.auth.getUserByEmail(input.lookup);if(!verifiedCommsEmail(user,input.lookup))throw Error();target=user.uid;
    // Verify the UID record again before Firestore admission; never trust an unverified address claim.
    if(!verifiedCommsEmail(await account(target,deps),input.lookup))throw Error();
  }catch{throw fail();}}
  else await account(target,deps);if(target===uid)throw fail();
  return deps.firestore.runTransaction(async tx=>{await active(tx,uid,deps);await active(tx,target,deps);const[user,profile]=await tx.getAll(deps.firestore.doc(`users/${target}`),deps.firestore.doc(`publicProfiles/${target}`));return publicProfile(target,user,profile);});
}
function storedOutcome(data:FirebaseFirestore.DocumentData,input:CommsContactRequest,digest:string,uid:string):CommsContactOutcome {
  if(data.v!==2||data.fromUid!==uid||data.toUid!==input.recipientUid||data.digest!==digest||data.recipientFingerprint!==input.recipientFingerprint||!['pending','accepted','rejected','cancelled'].includes(data.status)||!Number.isSafeInteger(data.createdAt)||data.createdAt<1||!Number.isSafeInteger(data.updatedAt)||data.updatedAt<data.createdAt)throw fail('permission-denied');
  return{requestId:input.requestId,digest,status:data.status,createdAt:data.createdAt,updatedAt:data.updatedAt};
}
async function admission(tx:FirebaseFirestore.Transaction,uid:string,now:number,db:FirebaseFirestore.Firestore){
  const day=new Date(now).toISOString().slice(0,10),ref=db.doc(`commsContactBudgets/${hash(uid)}_${day}`),budget=(await tx.get(ref)).data();
  if(budget&&(budget.uid!==uid||budget.day!==day||budget.v!==1||!Number.isSafeInteger(budget.requests)||budget.requests<0))throw fail();const requests=Number(budget?.requests??0)+1;if(requests>COMMS_CONTACT_DAILY_LIMIT)throw fail('resource-exhausted');return{ref,data:{v:1,uid,day,requests,updatedAt:now}};
}
export function validCommsContactPair(pair:FirebaseFirestore.DocumentData,uid:string,other:string){return pair.v===1&&Array.isArray(pair.memberUids)&&pair.memberUids.length===2&&pair.memberUids.includes(uid)&&pair.memberUids.includes(other)&&[uid,other].includes(pair.fromUid)&&[uid,other].includes(pair.toUid)&&pair.fromUid!==pair.toUid&&typeof pair.requestId==='string'&&['pending','accepted','rejected','cancelled'].includes(pair.status);}
async function legacyActivePair(tx:FirebaseFirestore.Transaction,db:FirebaseFirestore.Firestore,uid:string,other:string,exclude?:string){
  const queries=[[uid,other],[other,uid]].map(([fromUid,toUid])=>db.collection('friendRequests').where('fromUid','==',fromUid).where('toUid','==',toUid).where('status','in',['pending','accepted']).limit(51));
  const rows=await Promise.all(queries.map(q=>tx.get(q)));if(rows.some(row=>row.size>50))throw fail();
  for(const snapshot of rows)for(const document of snapshot.docs){const data=document.data();if(!['pending','accepted','rejected','cancelled'].includes(data.status))throw fail();if(document.id!==exclude&&['pending','accepted'].includes(data.status))return true;}return false;
}
export async function executeCommsContact(uid:string,value:unknown,mode:'create'|'status'|'cancel',deps=defaults()):Promise<CommsContactOutcome>{
  let input;try{input=parseCommsContactRequest(value);}catch{throw fail('invalid-argument');}if(!['create','status','cancel'].includes(mode)||uid===input.recipientUid)throw fail('invalid-argument');await account(uid,deps);
  const db=deps.firestore,digest=hash(commsContactRequestBytes(input)),requestRef=db.doc(`friendRequests/${input.requestId}`),pairRef=db.doc(`commsContactPairs/${commsContactPairId(uid,input.recipientUid)}`);
  const revokedRecovery=()=>db.runTransaction(async tx=>{
    await active(tx,uid,deps);
    // Missing profile/Auth alone is insufficient to discard a durable intent.
    // requireProfile=false isolates permanent markers and the deleting state.
    if(await liveAccountInTransaction(tx,db,input.recipientUid,false))return null;
    const existing=await tx.get(requestRef),outcome=existing.exists?storedOutcome(existing.data()!,input,digest,uid):{requestId:input.requestId,digest,status:'unknown' as const,createdAt:null,updatedAt:null};
    if(mode==='create')throw fail('permission-denied');return{...outcome,status:'revoked' as const};
  });
  const initialRevocation=await revokedRecovery();if(initialRevocation)return initialRevocation;
  try{await account(input.recipientUid,deps);}catch(error){const lateRevocation=await revokedRecovery();if(lateRevocation)return lateRevocation;throw error;}
  return db.runTransaction(async tx=>{
    await active(tx,uid,deps);const existing=await tx.get(requestRef);let result:CommsContactOutcome;
    if(existing.exists)result=storedOutcome(existing.data()!,input,digest,uid);
    else result={requestId:input.requestId,digest,status:'unknown',createdAt:null,updatedAt:null};
    if(!await liveAccountInTransaction(tx,db,input.recipientUid,false)){if(mode==='create')throw fail('permission-denied');return{...result,status:'revoked'};}
    await active(tx,input.recipientUid,deps);
    if(existing.exists){if(mode==='create'&&result.status==='cancelled')throw fail();if(mode!=='cancel'||result.status!=='pending')return result;}
    else if(mode==='status')return result;
    const now=deps.now();if(!Number.isSafeInteger(now)||now<1||result.updatedAt!==null&&now<result.updatedAt)throw fail();
    const pair=(await tx.get(pairRef)).data();
    if(pair&&!validCommsContactPair(pair,uid,input.recipientUid))throw fail();
    if(isCommsContactPairRemoving(pair))throw fail('aborted');
    if(mode==='cancel'){
      const budget=!existing.exists?await admission(tx,uid,now,db):null;
      const cancelled={...result,status:'cancelled' as const,createdAt:result.createdAt??now,updatedAt:now};
      if(existing.exists)tx.update(requestRef,{status:'cancelled',updatedAt:now});else tx.create(requestRef,{v:2,fromUid:uid,toUid:input.recipientUid,fromLabel:uid.slice(0,120),toLabel:input.recipientUid.slice(0,120),recipientFingerprint:input.recipientFingerprint,digest,status:'cancelled',createdAt:now,updatedAt:now});
      if(pair?.requestId===input.requestId)tx.update(pairRef,{status:'cancelled',updatedAt:now});if(budget)tx.set(budget.ref,budget.data);return cancelled;
    }
    if(pair&&['pending','accepted'].includes(pair.status))throw fail('already-exists');
    if(!pair&&await legacyActivePair(tx,db,uid,input.recipientUid))throw fail('already-exists');
    const[sender,senderProfile,target,targetProfile]=await tx.getAll(db.doc(`users/${uid}`),db.doc(`publicProfiles/${uid}`),db.doc(`users/${input.recipientUid}`),db.doc(`publicProfiles/${input.recipientUid}`));
    const from=publicProfile(uid,sender,senderProfile),to=publicProfile(input.recipientUid,target,targetProfile);if(to.fingerprint!==input.recipientFingerprint)throw fail('aborted');
    const budget=await admission(tx,uid,now,db);
    const pending={...result,status:'pending' as const,createdAt:now,updatedAt:now};
    tx.create(requestRef,{v:2,fromUid:uid,toUid:input.recipientUid,fromLabel:from.displayName,toLabel:to.displayName,recipientFingerprint:input.recipientFingerprint,digest,status:'pending',createdAt:now,updatedAt:now});
    tx.set(pairRef,{v:1,memberUids:[uid,input.recipientUid].sort(),fromUid:uid,toUid:input.recipientUid,requestId:input.requestId,status:'pending',updatedAt:now});tx.set(budget.ref,budget.data);return pending;
  });
}
export async function executeCommsContactResponse(uid:string,value:unknown,deps=defaults()):Promise<{requestId:string;status:'accepted'|'rejected';updatedAt:number}>{
  let input;try{input=parseCommsContactResponse(value);}catch{throw fail('invalid-argument');}await account(uid,deps);
  const db=deps.firestore,ref=db.doc(`friendRequests/${input.requestId}`);
  // Capture the sender for Auth verification, then compare the same immutable authority in the transaction.
  const initial=(await ref.get()).data();if(initial?.toUid!==uid||!attachmentActorIdValid(initial?.fromUid)||initial.fromUid===uid)throw fail('permission-denied');await account(initial.fromUid,deps);
  return db.runTransaction(async tx=>{await active(tx,uid,deps);await active(tx,initial.fromUid,deps);const data=(await tx.get(ref)).data();
    if(!data||data.toUid!==uid||data.fromUid!==initial.fromUid||!['pending','accepted','rejected'].includes(data.status)||!Number.isSafeInteger(data.updatedAt))throw fail('permission-denied');
    if(data.status===input.status)return{...input,updatedAt:data.updatedAt};if(data.status!=='pending')throw fail('aborted');
    const pairRef=db.doc(`commsContactPairs/${commsContactPairId(uid,data.fromUid)}`),pair=(await tx.get(pairRef)).data();
    if(pair&&!validCommsContactPair(pair,uid,data.fromUid))throw fail();
    if(isCommsContactPairRemoving(pair))throw fail('aborted');
    if(pair&&pair.requestId!==input.requestId&&['pending','accepted'].includes(pair.status))throw fail('aborted');
    if(input.status==='accepted'&&(!pair||pair.requestId!==input.requestId)&&await legacyActivePair(tx,db,uid,data.fromUid,input.requestId))throw fail('aborted');
    const now=deps.now();if(!Number.isSafeInteger(now)||now<data.updatedAt)throw fail();tx.update(ref,{status:input.status,updatedAt:now});
    tx.set(pairRef,{v:1,memberUids:[uid,data.fromUid].sort(),fromUid:data.fromUid,toUid:uid,requestId:input.requestId,status:input.status,updatedAt:now});return{...input,updatedAt:now};
  });
}
function boundCommand(uid:string,value:unknown,mode:CommsContactCall):CommsContactCommand {
  let command;try{command=parseCommsContactCommand(value,mode);}catch{throw fail('invalid-argument');}
  if(command.actorUid!==uid)throw fail('permission-denied');return command;
}
function dispatch(uid:string,command:CommsContactCommand,mode:CommsContactCall,deps:CommsContactServerDeps){
  return mode==='lookup'?executeCommsRecipientLookup(uid,command.request,deps):mode==='respond'?executeCommsContactResponse(uid,command.request,deps):executeCommsContact(uid,command.request,mode,deps);
}
/** Same bound transport dispatcher used by callables and integration fixtures. */
export async function executeCommsContactCall(uid:string,value:unknown,mode:CommsContactCall,deps=defaults()){
  const command=boundCommand(uid,value,mode);return dispatch(uid,command,mode,deps);
}
function callable(mode:CommsContactCall){
  return functions.region('europe-west1').https.onCall(async(value,context)=>{
    const uid=context.auth?.uid;if(!uid)throw fail('unauthenticated');const command=boundCommand(uid,value,mode);
    if(['create','respond'].includes(mode)&&!COMMS_CONTACT_WRITES_ENABLED)throw fail();
    try{if(!(await consumeServerRateLimit(`uid:${uid}`,{bucket:`comms-contact-${mode}`,max:mode==='lookup'?20:120,windowMs:60000})).allowed)throw fail('resource-exhausted');
      if(mode==='lookup'&&!(await consumeServerRateLimit('project:comms-recipient',{bucket:'comms-recipient-project',max:200,windowMs:60000})).allowed)throw fail('resource-exhausted');
      return dispatch(uid,command,mode,defaults());
    }catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
  });
}
export const lookupCommsRecipient=callable('lookup'),createCommsContactRequest=callable('create'),getCommsContactRequestStatus=callable('status'),cancelCommsContactRequest=callable('cancel'),respondCommsContactRequest=callable('respond');
