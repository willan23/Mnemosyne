import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash,createPublicKey} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {publicProfile} from './commsContacts';
import {parseCommsDeliveryRequest,parseCommsDeliveryDescriptor,parseCommsDeliveryAck,commsDeliveryRequestBytes,commsTransmissionBytes,commsBase64Size,type CommsDeliveryRequest,type CommsDeliveryDescriptor,type CommsDeliveryOutcome} from './commsDeliveryContract';
if(!admin.apps.length)admin.initializeApp();
export const COMMS_DELIVERY_WRITES_ENABLED=false;
export const COMMS_DELIVERY_DAILY_LIMITS=Object.freeze({senderRequests:100,senderBytes:20*1024*1024,recipientRequests:100,recipientBytes:20*1024*1024,projectRequests:1000,projectBytes:200*1024*1024});
export interface CommsDeliveryServerDeps {firestore:FirebaseFirestore.Firestore;auth:Pick<admin.auth.Auth,'getUser'>;now:()=>number}
const defaults=():CommsDeliveryServerDeps=>({firestore:admin.firestore(),auth:admin.auth(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Comms delivery operation unavailable');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const commsDeliveryBudgetId=(kind:'sender'|'recipient'|'project',uid:string|null,day:string)=>kind==='project'?`project_${day}`:`${kind}_${hash(uid!)}_${day}`;
async function account(uid:string,deps:CommsDeliveryServerDeps){if(!attachmentActorIdValid(uid))throw fail('unauthenticated');try{const user=await deps.auth.getUser(uid);if(user.uid!==uid||user.disabled)throw Error();}catch{throw fail();}}
async function active(tx:FirebaseFirestore.Transaction,uid:string,deps:CommsDeliveryServerDeps){if(!await liveAccountInTransaction(tx,deps.firestore,uid))throw fail('permission-denied');}
function outcome(data:FirebaseFirestore.DocumentData,input:CommsDeliveryDescriptor,uid:string):CommsDeliveryOutcome {
  if(data.v!==1||data.requestId!==input.requestId||data.senderId!==uid||data.recipientId!==input.recipientUid||data.senderFingerprint!==input.senderFingerprint||data.recipientFingerprint!==input.recipientFingerprint||data.digest!==input.digest||!['sent','received','cancelled'].includes(data.status)||!Number.isSafeInteger(data.createdAt)||data.createdAt<1||!Number.isSafeInteger(data.updatedAt)||data.updatedAt<data.createdAt)throw fail('permission-denied');
  return{requestId:input.requestId,digest:input.digest,status:data.status,createdAt:data.createdAt,updatedAt:data.updatedAt};
}
function transmission(data:FirebaseFirestore.DocumentData|undefined,id:string,uid:string,input:CommsDeliveryDescriptor){
  if(!data||data.v!==2||data.senderId!==uid||data.recipientId!==input.recipientUid||data.deliveryDigest!==input.digest||hash(commsTransmissionBytes(id,data))!==input.digest||!['sent','received'].includes(data.status)||!Number.isSafeInteger(data.timestamp)||data.timestamp<1)throw fail();
}
export async function reserveCommsDeliveryBudgets(tx:FirebaseFirestore.Transaction,uid:string,recipient:string,now:number,size:number,db:FirebaseFirestore.Firestore,delivering:boolean){
  const day=new Date(now).toISOString().slice(0,10),kinds:('sender'|'recipient'|'project')[]=delivering?['sender','recipient','project']:['sender','project'];
  const rows=kinds.map(kind=>({kind,uid:kind==='project'?null:kind==='sender'?uid:recipient,ref:db.doc(`commsDeliveryBudgets/${commsDeliveryBudgetId(kind,kind==='sender'?uid:recipient,day)}`)}));
  const snaps=await tx.getAll(...rows.map(row=>row.ref));return rows.map((row,index)=>{
    const prior=snaps[index].data();if(prior&&(prior.v!==1||prior.kind!==row.kind||prior.uid!==row.uid||prior.day!==day||!Number.isSafeInteger(prior.requests)||prior.requests<0||!Number.isSafeInteger(prior.bytes)||prior.bytes<0))throw fail();
    const requests=Number(prior?.requests??0)+1,bytes=Number(prior?.bytes??0)+size,maxRequests=COMMS_DELIVERY_DAILY_LIMITS[`${row.kind}Requests`],maxBytes=COMMS_DELIVERY_DAILY_LIMITS[`${row.kind}Bytes`];
    if(requests>maxRequests||bytes>maxBytes)throw fail('resource-exhausted');return{ref:row.ref,data:{v:1,kind:row.kind,uid:row.uid,day,requests,bytes,updatedAt:now}};
  });
}
export async function executeCommsDelivery(uid:string,value:unknown,mode:'create'|'status'|'cancel',deps=defaults()):Promise<CommsDeliveryOutcome>{
  let request:CommsDeliveryRequest|null=null,input:CommsDeliveryDescriptor;
  try{if(mode==='create'){request=parseCommsDeliveryRequest(value);const{envelope,...descriptor}=request;input={...descriptor,digest:hash(commsDeliveryRequestBytes(request))};}else if(mode==='status'||mode==='cancel')input=parseCommsDeliveryDescriptor(value);else throw Error();}catch{throw fail('invalid-argument');}
  if(input.senderUid!==uid)throw fail('permission-denied');await account(uid,deps);if(mode==='create')await account(input.recipientUid,deps);
  const db=deps.firestore,ref=db.doc(`commsDeliveryRequests/${input.requestId}`),payloadRef=db.doc(`transmissions/${input.requestId}`);
  return db.runTransaction(async tx=>{
    await active(tx,uid,deps);const receipt=await tx.get(ref);let result:CommsDeliveryOutcome;
    if(receipt.exists){result=outcome(receipt.data()!,input,uid);if(mode==='create'&&result.status==='cancelled')throw fail();if(mode!=='cancel'||result.status!=='sent')return result;}
    else{result={requestId:input.requestId,digest:input.digest,status:'unknown',createdAt:null,updatedAt:null};
      // A permanent deletion marker already prevents every future create. Do not recreate references to a purged recipient.
      if((await tx.get(db.doc(`accountDeletions/${input.recipientUid}`))).exists){if(mode==='create')throw fail('permission-denied');return{...result,status:'revoked'};}
      if(mode==='status')return result;
    }
    const now=deps.now();if(!Number.isSafeInteger(now)||now<1||result.updatedAt!==null&&now<result.updatedAt)throw fail();
    const payload=await tx.get(payloadRef);
    if(mode==='cancel'){
      if(payload.exists){if(!receipt.exists)throw fail();transmission(payload.data(),input.requestId,uid,input);if(payload.data()?.status!=='sent')throw fail();}
      const budget=!receipt.exists?await reserveCommsDeliveryBudgets(tx,uid,input.recipientUid,now,0,db,false):[];
      const cancelled={...result,status:'cancelled' as const,createdAt:result.createdAt??now,updatedAt:now};
      if(receipt.exists)tx.update(ref,{status:'cancelled',updatedAt:now});else tx.create(ref,{v:1,requestId:input.requestId,senderId:uid,recipientId:input.recipientUid,senderFingerprint:input.senderFingerprint,recipientFingerprint:input.recipientFingerprint,digest:input.digest,status:'cancelled',createdAt:now,updatedAt:now});
      if(payload.exists)tx.delete(payloadRef);for(const row of budget)tx.set(row.ref,row.data);return cancelled;
    }
    if(payload.exists||!request)throw fail('already-exists');await active(tx,input.recipientUid,deps);
    const[from,fromPublic,to,toPublic]=await tx.getAll(db.doc(`users/${uid}`),db.doc(`publicProfiles/${uid}`),db.doc(`users/${input.recipientUid}`),db.doc(`publicProfiles/${input.recipientUid}`));
    const sender=publicProfile(uid,from,fromPublic),recipient=publicProfile(input.recipientUid,to,toPublic);
    if(sender.fingerprint!==input.senderFingerprint||recipient.fingerprint!==input.recipientFingerprint)throw fail('aborted');
    if(commsBase64Size(request.envelope.encryptedKey,256,512)!==Number(createPublicKey(recipient.publicKeyPem).asymmetricKeyDetails?.modulusLength)/8)throw fail('invalid-argument');
    const budget=await reserveCommsDeliveryBudgets(tx,uid,input.recipientUid,now,Buffer.byteLength(commsDeliveryRequestBytes(request),'utf8'),db,true);
    tx.create(ref,{v:1,requestId:input.requestId,senderId:uid,recipientId:input.recipientUid,senderFingerprint:input.senderFingerprint,recipientFingerprint:input.recipientFingerprint,digest:input.digest,status:'sent',createdAt:now,updatedAt:now});
    tx.create(payloadRef,{v:2,senderId:uid,recipientId:input.recipientUid,senderFingerprint:input.senderFingerprint,recipientFingerprint:input.recipientFingerprint,deliveryDigest:input.digest,...request.envelope,timestamp:now,status:'sent'});
    for(const row of budget)tx.set(row.ref,row.data);return{...result,status:'sent',createdAt:now,updatedAt:now};
  });
}
export async function executeCommsDeliveryAck(uid:string,value:unknown,deps=defaults()):Promise<{transmissionId:string;digest:string;status:'received';updatedAt:number}>{
  let input;try{input=parseCommsDeliveryAck(value);}catch{throw fail('invalid-argument');}if(input.recipientUid!==uid)throw fail('permission-denied');await account(uid,deps);await account(input.senderUid,deps);
  const db=deps.firestore,payloadRef=db.doc(`transmissions/${input.transmissionId}`);
  return db.runTransaction(async tx=>{
    await active(tx,uid,deps);await active(tx,input.senderUid,deps);const data=(await tx.get(payloadRef)).data();
    if(!data||data.senderId!==input.senderUid||data.recipientId!==uid||!['sent','received'].includes(data.status))throw fail('permission-denied');
    let digest;try{digest=hash(commsTransmissionBytes(input.transmissionId,data));}catch{throw fail();}if(digest!==input.digest||data.v===2&&data.deliveryDigest!==input.digest)throw fail('permission-denied');
    const ref=db.doc(`commsDeliveryRequests/${input.transmissionId}`),receipt=data.v===2?await tx.get(ref):null;
    if(receipt){const descriptor=parseCommsDeliveryDescriptor({requestId:input.transmissionId,senderUid:input.senderUid,recipientUid:uid,senderFingerprint:data.senderFingerprint,recipientFingerprint:data.recipientFingerprint,digest:input.digest}),stored=outcome(receipt.data()??{},descriptor,input.senderUid);if(stored.status!==data.status||stored.createdAt!==data.timestamp)throw fail();}
    if(data.status==='received'){if(!Number.isSafeInteger(data.receivedAt)||data.receivedAt<data.timestamp||receipt&&receipt.data()?.updatedAt!==data.receivedAt)throw fail();return{transmissionId:input.transmissionId,digest:input.digest,status:'received',updatedAt:data.receivedAt};}
    const now=deps.now();if(!Number.isSafeInteger(now)||now<data.timestamp)throw fail();
    tx.update(payloadRef,{status:'received',receivedAt:now});if(receipt)tx.update(ref,{status:'received',updatedAt:now});return{transmissionId:input.transmissionId,digest:input.digest,status:'received',updatedAt:now};
  });
}
function callable(mode:'create'|'status'|'cancel'|'ack'){
  return functions.region('europe-west1').https.onCall(async(value,context)=>{
    const uid=context.auth?.uid;if(!uid)throw fail('unauthenticated');let capturedUid:string;
    try{capturedUid=mode==='create'?parseCommsDeliveryRequest(value).senderUid:mode==='ack'?parseCommsDeliveryAck(value).recipientUid:parseCommsDeliveryDescriptor(value).senderUid;}catch{throw fail('invalid-argument');}
    if(capturedUid!==uid)throw fail('permission-denied');
    if(mode==='create'&&!COMMS_DELIVERY_WRITES_ENABLED)throw fail();
    try{const mutation=mode==='create'||mode==='cancel';if(!(await consumeServerRateLimit(`uid:${uid}`,{bucket:`comms-delivery-${mode}`,max:mutation?10:60,windowMs:60000})).allowed||!(await consumeServerRateLimit('project:comms-delivery',{bucket:`comms-delivery-${mode}-project`,max:mutation?100:300,windowMs:60000})).allowed)throw fail('resource-exhausted');
      return mode==='ack'?await executeCommsDeliveryAck(uid,value):await executeCommsDelivery(uid,value,mode);
    }catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
  });
}
export const createCommsDelivery=callable('create'),getCommsDeliveryStatus=callable('status'),cancelCommsDelivery=callable('cancel'),acknowledgeCommsDelivery=callable('ack');
