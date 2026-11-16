import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {reserveCommsDeliveryBudgets} from './commsDelivery';
import {assertActiveCommsP2PSession,type CommsP2PServerDeps} from './commsP2PSignaling';
import {parseCommsP2PContentAdmission,parseCommsP2PContentLookup,parseCommsP2PContentOutcome,type CommsP2PContentAdmission,type CommsP2PContentDescriptor,type CommsP2PContentOutcome} from './commsP2PContentContract';
if(!admin.apps.length)admin.initializeApp();
export const COMMS_P2P_CONTENT_ENABLED=false;
const defaults=():CommsP2PServerDeps=>({firestore:admin.firestore(),auth:admin.auth(),now:Date.now}),fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'P2P content operation unavailable');
async function account(uid:string,deps:CommsP2PServerDeps){try{const user=await deps.auth.getUser(uid);if(user.uid!==uid||user.disabled)throw Error();}catch{throw fail('permission-denied');}}
function stored(data:FirebaseFirestore.DocumentData,input:CommsP2PContentDescriptor):CommsP2PContentOutcome {
  for(const[key,value]of Object.entries(input))if(data[key]!==value)throw fail('permission-denied');if(data.v!==1||!['admitted','received','cancelled'].includes(data.status))throw fail();return parseCommsP2PContentOutcome({requestId:input.requestId,digest:input.digest,status:data.status,createdAt:data.createdAt,updatedAt:data.updatedAt,roomId:data.roomId},input);
}
export async function executeCommsP2PContent(uid:string,value:unknown,mode:'admit'|'status'|'cancel'|'ack',deps=defaults()):Promise<CommsP2PContentOutcome>{
  let admission:CommsP2PContentAdmission|null=null,actorUid:string,input:CommsP2PContentDescriptor;
  try{if(mode==='admit'){admission=parseCommsP2PContentAdmission(value);actorUid=admission.actorUid;input=admission.packet;}else if(['status','cancel','ack'].includes(mode)){const lookup=parseCommsP2PContentLookup(value);actorUid=lookup.actorUid;input=lookup.packet;}else throw Error();}catch{throw fail('invalid-argument');}
  if(actorUid!==uid||['admit','cancel'].includes(mode)&&uid!==input.senderUid||mode==='ack'&&uid!==input.recipientUid)throw fail('permission-denied');await account(uid,deps);if(mode==='admit')await account(input.recipientUid,deps);const db=deps.firestore,ref=db.doc(`commsP2PContentReceipts/${input.requestId}`);
  // Auth verification of the sender also protects fresh ACKs. A known receipt can be confirmed historically.
  let senderEnabled=true;if(mode==='ack'){try{await account(input.senderUid,deps);}catch{senderEnabled=false;}}
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const snapshot=await tx.get(ref),known=snapshot.exists?stored(snapshot.data()!,input):null,other=uid===input.senderUid?input.recipientUid:input.senderUid;
    const absent:CommsP2PContentOutcome={requestId:input.requestId,digest:input.digest,status:'unknown',roomId:null,createdAt:null,updatedAt:null};
    if(!known&&(await tx.get(db.doc(`accountDeletions/${other}`))).exists){if(mode==='admit'||mode==='ack')throw fail('permission-denied');return{...absent,status:'revoked'};}
    if(mode==='status')return known??absent;if(mode==='cancel'&&known&&['received','cancelled'].includes(known.status))return known;if(mode==='ack'&&known?.status==='received')return known;
    const now=deps.now();if(!Number.isSafeInteger(now)||now<1||known?.updatedAt!=null&&now<known.updatedAt)throw fail();
    if(mode==='cancel'){
      const budgets=!known?await reserveCommsDeliveryBudgets(tx,input.senderUid,input.recipientUid,now,0,db,false):[];const result={...absent,status:'cancelled' as const,roomId:known?.roomId??null,createdAt:known?.createdAt??now,updatedAt:now};tx.set(ref,{v:1,...input,status:'cancelled',roomId:result.roomId,createdAt:result.createdAt,updatedAt:now});for(const row of budgets)tx.set(row.ref,row.data);return result;
    }
    if(mode==='ack'){
      if(!known||known.status!=='admitted'||!senderEnabled||!await liveAccountInTransaction(tx,db,input.senderUid))throw fail('permission-denied');tx.update(ref,{status:'received',updatedAt:now});return{...known,status:'received',updatedAt:now};
    }
    if(!admission||known?.status==='cancelled')throw fail();if(known?.status==='received')return known;
    await assertActiveCommsP2PSession(tx,admission.session,deps,now);if(known?.roomId===admission.session.roomId)return known;
    const budgets=!known?await reserveCommsDeliveryBudgets(tx,input.senderUid,input.recipientUid,now,input.bytes,db,true):[];const result={...absent,status:'admitted' as const,roomId:admission.session.roomId,createdAt:known?.createdAt??now,updatedAt:now};
    if(known)tx.update(ref,{roomId:result.roomId,updatedAt:now});else tx.create(ref,{v:1,...input,status:'admitted',roomId:result.roomId,createdAt:now,updatedAt:now});for(const row of budgets)tx.set(row.ref,row.data);return result;
  });
}
function callable(mode:'admit'|'status'|'cancel'|'ack'){return functions.region('europe-west1').https.onCall(async(value,context)=>{const uid=context.auth?.uid;if(!uid)throw fail('unauthenticated');let parsed;try{parsed=mode==='admit'?parseCommsP2PContentAdmission(value):parseCommsP2PContentLookup(value);}catch{throw fail('invalid-argument');}if(parsed.actorUid!==uid||['admit','cancel'].includes(mode)&&parsed.packet.senderUid!==uid||mode==='ack'&&parsed.packet.recipientUid!==uid)throw fail('permission-denied');if(mode==='admit'&&!COMMS_P2P_CONTENT_ENABLED)throw fail();try{if(!(await consumeServerRateLimit(`uid:${uid}`,{bucket:'comms-p2p-content-'+mode,max:mode==='admit'||mode==='cancel'?10:60,windowMs:60000})).allowed||!(await consumeServerRateLimit('project:comms-p2p-content',{bucket:'comms-p2p-content-'+mode+'-project',max:mode==='admit'||mode==='cancel'?100:600,windowMs:60000})).allowed)throw fail('resource-exhausted');return await executeCommsP2PContent(uid,value,mode);}catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}});}
export const admitCommsP2PContent=callable('admit'),getCommsP2PContentStatus=callable('status'),cancelCommsP2PContent=callable('cancel'),acknowledgeCommsP2PContent=callable('ack');
