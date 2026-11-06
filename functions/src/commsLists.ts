import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash} from 'node:crypto';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {parseCommsListRequest,parseCommsListPage,projectCommsListRow,commsListBinding,compareCommsDocumentIds,COMMS_LIST_PAGE_SIZE,COMMS_LIST_MAX_RESPONSE_BYTES,type CommsListRequest,type CommsListPage,type CommsListRow} from './commsListContract';
import {commsTransmissionBytes} from './commsDeliveryContract';
import {publicProfile,commsContactPairId,verifiedCommsEmail} from './commsContacts';
import {isCommsContactPairRemoving} from './commsContactRemovalContract';
import type {CommsRecipient} from './commsContactContract';
import {attachmentActorIdValid} from './attachmentEnvelope';
if(!admin.apps.length)admin.initializeApp();
export interface CommsListServerDeps {firestore:FirebaseFirestore.Firestore;auth:Pick<admin.auth.Auth,'getUser'> & Partial<Pick<admin.auth.Auth,'getUserByEmail'>>}
const defaults=():CommsListServerDeps=>({firestore:admin.firestore(),auth:admin.auth()}),fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Comms page unavailable');
async function enabled(uid:string,deps:CommsListServerDeps){try{const user=await deps.auth.getUser(uid);return user.uid===uid&&!user.disabled;}catch(error){if((error as{code?:string})?.code==='auth/user-not-found')return false;throw fail();}}
function acceptedRelation(input:CommsListRequest,id:string,data:FirebaseFirestore.DocumentData|undefined){
  if(!data)throw fail();const kind=data.fromUid===input.uid?'contact-out':'contact-in';
  const row=projectCommsListRow({...input,kind,after:null},id,data);if(row.data.status!=='accepted')throw fail();
  return{row,peer:String(row.data[kind==='contact-out'?'toUid':'fromUid'])};
}
/** Merge two bounded, status-filtered directions into one ID cursor. Historical
 * accepted requests remain visible without creating pair/backfill records. */
async function acceptedDirectory(input:CommsListRequest,deps:CommsListServerDeps,targetUid?:string,emailBinding?:string):Promise<CommsListPage>{
  const uid=input.uid,db=deps.firestore;
  const queries=['fromUid','toUid'].map(field=>{let query=db.collection('friendRequests').where(field,'==',uid).where('status','==','accepted')
    .orderBy(admin.firestore.FieldPath.documentId()).limit(COMMS_LIST_PAGE_SIZE+1);if(targetUid)query=query.where(field==='fromUid'?'toUid':'fromUid','==',targetUid);if(input.after)query=query.startAfter(input.after.id);return query;});
  const initial=await db.runTransaction(async tx=>{if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');return Promise.all(queries.map(query=>tx.get(query)));});
  const merged=[...new Map(initial.flatMap(page=>page.docs).map(doc=>[doc.id,doc])).values()].sort((a,b)=>compareCommsDocumentIds(a.id,b.id));
  const candidates=merged.slice(0,COMMS_LIST_PAGE_SIZE),actors=new Set<string>();
  for(const doc of candidates){try{actors.add(acceptedRelation(input,doc.id,doc.data()).peer);}catch{/* Count invalid owned records without exposing participants. */}}
  const auth=new Map(await Promise.all([...actors].map(async actor=>[actor,await enabled(actor,deps)] as const)));if(!await enabled(uid,deps))throw fail('permission-denied');
  if(emailBinding){try{const user=await deps.auth.getUser(targetUid!);if(user.uid!==targetUid||!verifiedCommsEmail(user,emailBinding))throw fail();}catch{throw fail();}}
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const profiles=new Map<string,CommsRecipient|null>();
    for(const actor of actors){
      profiles.set(actor,null);if(!auth.get(actor)||!await liveAccountInTransaction(tx,db,actor))continue;
      if(isCommsContactPairRemoving((await tx.get(db.doc(`commsContactPairs/${commsContactPairId(uid,actor)}`))).data()))continue;
      const [user,profile]=await tx.getAll(db.doc(`users/${actor}`),db.doc(`publicProfiles/${actor}`));
      try{profiles.set(actor,publicProfile(actor,user,profile));}catch{/* Invalid current key/profile excludes only this accepted peer. */}
    }
    const current=candidates.length?await tx.getAll(...candidates.map(doc=>doc.ref)):[],rows:CommsListRow[]=[];
    let unavailable=0,scanned=0,last:string|null=input.after?.id??null,bytes=1024,truncated=false;
    for(const doc of current){let row:CommsListRow|null=null;
      try{const relation=acceptedRelation(input,doc.id,doc.data()),profile=profiles.get(relation.peer);
        if(profile){const {fromUid,toUid,createdAt,updatedAt}=relation.row.data;row=projectCommsListRow(input,doc.id,{fromUid,toUid,status:'accepted',createdAt,updatedAt,...profile});}
      }catch{row=null;}
      const size=row?Buffer.byteLength(JSON.stringify(row),'utf8'):0;if(bytes+size>COMMS_LIST_MAX_RESPONSE_BYTES-1024){truncated=true;break;}
      bytes+=size;scanned++;last=doc.id;if(row)rows.push(row);else unavailable++;
    }
    const next=(truncated||merged.length>COMMS_LIST_PAGE_SIZE)&&last?{uid,kind:input.kind,id:last,...(input.kind==='contact-search'?{lookup:input.lookup!,targetUid:targetUid!}:{})}:null;
    return parseCommsListPage({uid,kind:input.kind,rows,next,unavailable,scanned},input);
  });
}
export async function executeCommsList(uid:string,value:unknown,deps=defaults()):Promise<CommsListPage>{
  let input;try{input=parseCommsListRequest(value);}catch{throw fail('invalid-argument');}if(input.uid!==uid)throw fail('permission-denied');if(!await enabled(uid,deps))throw fail('permission-denied');if(input.kind==='contact-directory')return acceptedDirectory(input,deps);
  if(input.kind==='contact-search'){
    const db=deps.firestore;
    await db.runTransaction(async tx=>{if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');});
    const empty=async()=>{if(!await enabled(uid,deps))throw fail('permission-denied');await db.runTransaction(async tx=>{if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');});return parseCommsListPage({uid,kind:input.kind,rows:[],next:null,unavailable:0,scanned:0},input);};
    let target=input.lookup!;const emailBinding=target.includes('@')?target:undefined;
    if(emailBinding){try{if(!deps.auth.getUserByEmail)throw fail();const user=await deps.auth.getUserByEmail(emailBinding);if(!verifiedCommsEmail(user,emailBinding))throw fail();const current=await deps.auth.getUser(user.uid);if(current.uid!==user.uid||!verifiedCommsEmail(current,emailBinding))throw fail();target=user.uid;}catch(error){if((error as{code?:string})?.code==='auth/user-not-found')return empty();throw fail();}}
    if(!attachmentActorIdValid(target))throw fail();
    if(input.after?.targetUid!==undefined&&target!==input.after.targetUid)throw fail('aborted');
    if(target===uid)return empty();
    return acceptedDirectory(input,deps,target,emailBinding);
  }
  const binding=commsListBinding(input.kind),db=deps.firestore;
  // ID ordering includes old records with no sortable timestamp, and needs no new composite index.
  let query=db.collection(binding.collection).where(binding.owner,'==',uid).orderBy(admin.firestore.FieldPath.documentId()).limit(COMMS_LIST_PAGE_SIZE+1);if(input.after)query=query.startAfter(input.after.id);
  const page=await db.runTransaction(async tx=>{if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');return tx.get(query);});
  const candidates=page.docs.slice(0,COMMS_LIST_PAGE_SIZE),actors=new Set<string>();for(const doc of candidates){try{const row=projectCommsListRow(input,doc.id,doc.data());actors.add(String(row.data[binding.other]));}catch{/* Count unavailable records without returning malformed data. */}}
  const auth=new Map(await Promise.all([...actors].map(async actor=>[actor,await enabled(actor,deps)] as const)));if(!await enabled(uid,deps))throw fail('permission-denied');
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');const live=new Map<string,boolean>();for(const actor of actors)live.set(actor,auth.get(actor)===true&&await liveAccountInTransaction(tx,db,actor));
    const current=candidates.length?await tx.getAll(...candidates.map(doc=>doc.ref)):[];const rows:CommsListRow[]=[];let unavailable=0,scanned=0,last:string|null=input.after?.id??null,truncated=false,bytes=1024;
    for(const doc of current){let row:CommsListRow|null=null;try{row=projectCommsListRow(input,doc.id,doc.data());if(!live.get(String(row.data[binding.other])))row=null;else if(input.kind.startsWith('relay-')&&row.data.v===2&&createHash('sha256').update(commsTransmissionBytes(doc.id,row.data)).digest('hex')!==row.data.deliveryDigest)row=null;}catch{row=null;}
      const size=row?Buffer.byteLength(JSON.stringify(row),'utf8'):0;if(bytes+size>COMMS_LIST_MAX_RESPONSE_BYTES-1024){truncated=true;break;}bytes+=size;scanned++;last=doc.id;if(row)rows.push(row);else unavailable++;
    }
    const next=(truncated||page.size>COMMS_LIST_PAGE_SIZE)&&last?{uid,kind:input.kind,id:last}:null;return parseCommsListPage({uid,kind:input.kind,rows,next,unavailable,scanned},input);
  });
}
export const listCommsPage=functions.region('europe-west1').https.onCall(async(value,context)=>{
  const uid=context.auth?.uid;if(!uid)throw fail('unauthenticated');let input;try{input=parseCommsListRequest(value);}catch{throw fail('invalid-argument');}if(input.uid!==uid)throw fail('permission-denied');
  try{if(!(await consumeServerRateLimit(`uid:${uid}`,{bucket:'comms-page',max:60,windowMs:60000})).allowed||!(await consumeServerRateLimit('project:comms-page',{bucket:'comms-page-project',max:600,windowMs:60000})).allowed)throw fail('resource-exhausted');return await executeCommsList(uid,input);}catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
});
