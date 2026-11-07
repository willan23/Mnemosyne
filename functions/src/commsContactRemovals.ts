import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {COMMS_CONTACT_WRITES_ENABLED,commsContactPairId,validCommsContactPair} from './commsContacts';
import {compareCommsDocumentIds} from './commsListContract';
import {parseCommsContactRemovalRequest,parseCommsContactRemovalOutcome,commsContactRemovalBytes,isCommsContactPairRemoving,COMMS_CONTACT_REMOVAL_PAGE_SIZE,type CommsContactRemovalRequest,type CommsContactRemovalOutcome} from './commsContactRemovalContract';
if(!admin.apps.length)admin.initializeApp();
export interface CommsContactRemovalDeps {firestore:FirebaseFirestore.Firestore;auth:Pick<admin.auth.Auth,'getUser'>;now:()=>number}
type Mode='begin'|'status'|'advance'|'cancel';
const defaults=():CommsContactRemovalDeps=>({firestore:admin.firestore(),auth:admin.auth(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Contact removal unavailable');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function stored(data:FirebaseFirestore.DocumentData,input:CommsContactRemovalRequest,digest:string,uid:string){
  if(data.v!==1||data.requestId!==input.requestId||data.actorUid!==uid||data.peerUid!==input.peerUid||data.anchorId!==input.anchorId||data.anchorUpdatedAt!==input.anchorUpdatedAt||data.digest!==digest||!['pending','complete','cancelled'].includes(data.status))throw fail('permission-denied');
  try{return parseCommsContactRemovalOutcome({requestId:input.requestId,digest:data.digest,status:data.status,removedCount:data.removedCount,createdAt:data.createdAt,updatedAt:data.updatedAt},input,digest);}catch{throw fail();}
}
/** Each transaction retires at most 25 active relationships. The pair lock makes
 * continuation independent of client timestamps or a cutoff/backfill. */
export async function executeCommsContactRemoval(uid:string,value:unknown,mode:Mode,deps=defaults()):Promise<CommsContactRemovalOutcome>{
  let input;try{input=parseCommsContactRemovalRequest(value);}catch{throw fail('invalid-argument');}
  if(input.actorUid!==uid)throw fail('permission-denied');
  if(!attachmentActorIdValid(uid)||uid===input.peerUid||!['begin','status','advance','cancel'].includes(mode))throw fail('invalid-argument');
  try{const actor=await deps.auth.getUser(uid);if(actor.uid!==uid||actor.disabled)throw fail('permission-denied');}catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
  const db=deps.firestore,digest=hash(commsContactRemovalBytes(input)),receiptRef=db.doc(`commsContactRemovals/${input.requestId}`),pairRef=db.doc(`commsContactPairs/${commsContactPairId(uid,input.peerUid)}`);
  const empty=(status:'unknown'|'revoked'):CommsContactRemovalOutcome=>({requestId:input.requestId,digest,status,removedCount:0,createdAt:null,updatedAt:null});
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');
    const peerLive=await liveAccountInTransaction(tx,db,input.peerUid),receipt=(await tx.get(receiptRef)).data();
    const prior=receipt?stored(receipt,input,digest,uid):null;
    // Permanent peer revocation can never recreate pair/receipt references.
    if(!peerLive)return prior?{...prior,status:'revoked'}:empty('revoked');
    if(prior?.status==='cancelled'&&mode==='begin')throw fail('aborted');
    if(prior?.status==='complete'||prior?.status==='cancelled'||mode==='status'||prior&&['begin','cancel'].includes(mode))return prior??empty('unknown');
    if(mode==='cancel'){
      const now=deps.now();if(!Number.isSafeInteger(now)||now<1)throw fail();
      const outcome:CommsContactRemovalOutcome={requestId:input.requestId,digest,status:'cancelled',removedCount:0,createdAt:now,updatedAt:now};
      tx.create(receiptRef,{v:1,actorUid:uid,peerUid:input.peerUid,anchorId:input.anchorId,anchorUpdatedAt:input.anchorUpdatedAt,...outcome});return outcome;
    }
    if(!prior&&mode==='advance')throw fail();
    const pair=(await tx.get(pairRef)).data();if(pair&&!validCommsContactPair(pair,uid,input.peerUid))throw fail();
    if(isCommsContactPairRemoving(pair)&&pair?.removalRequestId!==input.requestId)throw fail('already-exists');
    if(prior&&pair?.removalRequestId!==input.requestId)throw fail('aborted');
    let anchor:FirebaseFirestore.DocumentData|undefined;
    if(!prior){
      anchor=(await tx.get(db.doc(`friendRequests/${input.anchorId}`))).data();
      if(!anchor||anchor.status!=='accepted'||anchor.updatedAt!==input.anchorUpdatedAt||![uid,input.peerUid].includes(anchor.fromUid)||![uid,input.peerUid].includes(anchor.toUid)||anchor.fromUid===anchor.toUid)throw fail('aborted');
    }
    const queries=[[uid,input.peerUid],[input.peerUid,uid]].map(([fromUid,toUid])=>db.collection('friendRequests').where('fromUid','==',fromUid).where('toUid','==',toUid)
      .where('status','in',['pending','accepted']).orderBy(admin.firestore.FieldPath.documentId()).limit(COMMS_CONTACT_REMOVAL_PAGE_SIZE+1).select('fromUid','toUid','status','createdAt','updatedAt'));
    const pages=await Promise.all(queries.map(query=>tx.get(query))),merged=[...new Map(pages.flatMap(page=>page.docs).map(doc=>[doc.id,doc])).values()].sort((a,b)=>compareCommsDocumentIds(a.id,b.id));
    const candidates=merged.slice(0,COMMS_CONTACT_REMOVAL_PAGE_SIZE);if(!prior&&!candidates.length)throw fail();
    const now=deps.now();if(!Number.isSafeInteger(now)||now<1||prior?.updatedAt!==undefined&&prior.updatedAt!==null&&now<prior.updatedAt)throw fail();
    for(const doc of candidates){const data=doc.data();if(![uid,input.peerUid].includes(data.fromUid)||![uid,input.peerUid].includes(data.toUid)||data.fromUid===data.toUid||!['pending','accepted'].includes(data.status))throw fail();}
    const outcome:CommsContactRemovalOutcome={requestId:input.requestId,digest,status:merged.length>COMMS_CONTACT_REMOVAL_PAGE_SIZE?'pending':'complete',removedCount:(prior?.removedCount??0)+candidates.length,createdAt:prior?.createdAt??now,updatedAt:now};
    parseCommsContactRemovalOutcome(outcome,input,digest);
    for(const doc of candidates){const data=doc.data(),valid=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0?Number(value):now;tx.update(doc.ref,{status:'cancelled',updatedAt:Math.max(now,valid(data.createdAt),valid(data.updatedAt))});}
    const lock=outcome.status==='pending'?input.requestId:null;
    if(pair)tx.update(pairRef,{removalRequestId:lock,...(outcome.status==='complete'?{status:'cancelled',updatedAt:now}:{})});
    else tx.create(pairRef,{v:1,memberUids:[uid,input.peerUid].sort(),fromUid:anchor!.fromUid,toUid:anchor!.toUid,requestId:input.anchorId,status:outcome.status==='complete'?'cancelled':'accepted',updatedAt:now,removalRequestId:lock});
    const data={v:1,actorUid:uid,peerUid:input.peerUid,anchorId:input.anchorId,anchorUpdatedAt:input.anchorUpdatedAt,...outcome};if(prior)tx.set(receiptRef,data);else tx.create(receiptRef,data);
    return outcome;
  });
}
function callable(mode:Mode){return functions.region('europe-west1').https.onCall(async(value,context)=>{
  if(!context.auth?.uid)throw fail('unauthenticated');let input;try{input=parseCommsContactRemovalRequest(value);}catch{throw fail('invalid-argument');}
  if(input.actorUid!==context.auth.uid)throw fail('permission-denied');
  if(mode==='begin'&&!COMMS_CONTACT_WRITES_ENABLED)throw fail();
  try{
    if(!(await consumeServerRateLimit(`uid:${context.auth.uid}`,{bucket:'comms-contact-removal',max:60,windowMs:60000})).allowed||!(await consumeServerRateLimit('project:comms-contact-removal',{bucket:'comms-contact-removal-project',max:600,windowMs:60000})).allowed)throw fail('resource-exhausted');
    return await executeCommsContactRemoval(context.auth.uid,input,mode);
  }catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
});}
export const beginCommsContactRemoval=callable('begin'),getCommsContactRemovalStatus=callable('status'),advanceCommsContactRemoval=callable('advance'),cancelCommsContactRemoval=callable('cancel');
