import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {liveAccountInTransaction} from './accountAccess';
import {consumeServerRateLimit} from './rateLimit';
import {canonicalSyncState,syncInteger} from './mobileSyncImportContract';
import {MOBILE_SYNC_IMPORT_ENABLED,syncStateHash} from './mobileSyncImport';
import {parseSyncPublication,syncDeviceState,type SyncPublicationRequest,type SyncPublicationOutcome} from './mobileSyncPublicationContract';
if(!admin.apps.length)admin.initializeApp();
export interface SyncPublicationDeps {firestore:FirebaseFirestore.Firestore;now:()=>number}
const defaults=():SyncPublicationDeps=>({firestore:admin.firestore(),now:Date.now});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Encrypted sync publication unavailable');
/** Operational limits, independent of plan/AI consent; a replay consumes neither limit again. */
export const SYNC_DAILY_ENVELOPES=100;
export const SYNC_DAILY_CIPHER_BYTES=20*1024*1024;
function ownedReceipt(data:Record<string,unknown>,uid:string,input:SyncPublicationRequest,digest:string) {
  if((data.v!==1&&data.v!==2)||data.uid!==uid||data.envelopeId!==input.envelopeId||data.deviceId!==input.deviceId||data.direction!==input.direction||data.digest!==digest||
    (data.v===2&&data.payloadDigest!==syncStateHash(input.encryptedPayload))||
    !syncInteger(data.createdAt)||data.createdAt<1)throw fail('permission-denied');
}
function sourceMatches(data:Record<string,unknown>,uid:string,input:SyncPublicationRequest) {
  if(data.ownerUid!==uid||data.deviceId!==input.deviceId||data.direction!==input.direction||data.payloadType!==input.payloadType||data.memoryCount!==input.memoryCount||data.expiresAt!==input.expiresAt||
    canonicalSyncState(data.senderPublicKeyJwk)!==canonicalSyncState(input.senderPublicKeyJwk)||canonicalSyncState(data.encryptedPayload)!==canonicalSyncState(input.encryptedPayload)||
    canonicalSyncState(data.tombstoneIds)!==canonicalSyncState(input.tombstoneIds))throw fail('permission-denied');
}
function importProgress(data:Record<string,unknown>,uid:string,input:SyncPublicationRequest) {
  if(data.v!==1||data.uid!==uid||data.envelopeId!==input.envelopeId||data.deviceId!==input.deviceId||data.direction!==input.direction||data.payloadDigest!==syncStateHash(input.encryptedPayload)||
    data.memoryCount!==input.memoryCount||!syncInteger(data.cursor)||data.cursor>input.memoryCount||!syncInteger(data.imported)||!syncInteger(data.conflicts)||data.imported+data.conflicts>data.cursor||
    !['pending','complete'].includes(String(data.status))||(data.status==='complete')!==(data.cursor===input.memoryCount))throw fail('permission-denied');
  return {delivery:data.status as 'pending'|'complete',imported:data.imported,conflicts:data.conflicts};
}
/** Publication, daily admission and immutable receipt commit together. Cancellation serializes with first import. */
export async function executeSyncPublication(uid:string,value:unknown,mode:'publish'|'status'|'cancel',deps=defaults()):Promise<SyncPublicationOutcome> {
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');
  let input:SyncPublicationRequest;try{input=parseSyncPublication(value);}catch{throw fail('invalid-argument');}
  if(!['publish','status','cancel'].includes(mode))throw fail('invalid-argument');
  const db=deps.firestore;const now=deps.now();if(!syncInteger(now)||now<1)throw fail();const digest=syncStateHash(input);
  const receiptRef=db.doc(`mobileSyncPublications/${input.envelopeId}`);const cancellationRef=db.doc(`mobileSyncPublicationCancellations/${input.envelopeId}`);const envelopeRef=db.doc(`mobileSyncEnvelopes/${input.envelopeId}`);
  return db.runTransaction(async tx=>{
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');
    const [receipt,cancellation,envelope,progress]=await tx.getAll(receiptRef,cancellationRef,envelopeRef,db.doc(`mobileSyncImports/${input.envelopeId}`));
    if(receipt.exists)ownedReceipt(receipt.data()!,uid,input,digest);
    if(cancellation.exists)ownedReceipt(cancellation.data()!,uid,input,digest);
    const unknown:SyncPublicationOutcome={envelopeId:input.envelopeId,digest,status:'unknown',createdAt:null,delivery:'none',imported:0,conflicts:0};
    if(cancellation.exists){if(progress.exists)throw fail();if(mode==='publish')throw fail();return {...unknown,status:receipt.exists?'published':'cancelled',createdAt:receipt.exists?receipt.data()!.createdAt:cancellation.data()!.createdAt,delivery:'cancelled'};}
    if(receipt.exists){
      let outcome:SyncPublicationOutcome={...unknown,status:'published',createdAt:receipt.data()!.createdAt,delivery:'unavailable'};
      if(progress.exists)outcome={...outcome,...importProgress(progress.data()!,uid,input)};
      else if(envelope.exists){sourceMatches(envelope.data()!,uid,input);const data=envelope.data()!;
        if(data.status==='queued')outcome.delivery=data.expiresAt<=now?'expired':'queued';
        else if(data.status==='failed'&&data.error==='expired')outcome.delivery='expired';
        else throw fail();
      }
      // A receipt confirms historical publication. Never recreate missing ciphertext or re-send a changed request.
      if(mode!=='cancel'||progress.exists||!envelope.exists)return outcome;
      tx.create(cancellationRef,{v:2,uid,envelopeId:input.envelopeId,deviceId:input.deviceId,direction:input.direction,digest,payloadDigest:syncStateHash(input.encryptedPayload),createdAt:now});
      tx.update(envelopeRef,{status:'failed',error:'cancelled',updatedAt:admin.firestore.Timestamp.fromMillis(now)});
      return {...outcome,delivery:'cancelled'};
    }
    if(envelope.exists||progress.exists)throw fail('already-exists');
    if(mode==='status')return unknown;
    if(mode==='cancel'){
      tx.create(cancellationRef,{v:2,uid,envelopeId:input.envelopeId,deviceId:input.deviceId,direction:input.direction,digest,payloadDigest:syncStateHash(input.encryptedPayload),createdAt:now});
      return {...unknown,status:'cancelled',createdAt:now,delivery:'cancelled'};
    }
    const device=await tx.get(db.doc(`trustedDevices/${input.deviceId}`));if(!device.exists)throw fail('permission-denied');
    let state:ReturnType<typeof syncDeviceState>;try{state=syncDeviceState(device.data(),uid,input.deviceId);}catch{throw fail('permission-denied');}
    if(syncStateHash(state)!==input.expectedDeviceHash||(input.direction==='mobile-to-desktop'&&canonicalSyncState(input.senderPublicKeyJwk)!==canonicalSyncState(state.publicKeyJwk)))throw fail('permission-denied');
    if(input.expiresAt<=now||input.expiresAt>now+7*86400000)throw fail();
    const day=new Date(now).toISOString().slice(0,10);const budgetRef=db.doc(`mobileSyncBudgets/${uid}_${day}`);const budget=await tx.get(budgetRef);const current=budget.data();
    if(current&&(current.uid!==uid||current.day!==day||!syncInteger(current.envelopes)||!syncInteger(current.bytes)))throw fail();
    const count=Number(current?.envelopes??0);const bytes=Number(current?.bytes??0);const cipherBytes=Buffer.byteLength(JSON.stringify(input.encryptedPayload),'utf8');
    if(count>=SYNC_DAILY_ENVELOPES||bytes+cipherBytes>SYNC_DAILY_CIPHER_BYTES)throw fail('resource-exhausted');
    tx.create(envelopeRef,{ownerUid:uid,deviceId:input.deviceId,direction:input.direction,payloadType:input.payloadType,status:'queued',senderPublicKeyJwk:input.senderPublicKeyJwk,
      encryptedPayload:input.encryptedPayload,memoryCount:input.memoryCount,tombstoneIds:input.tombstoneIds,expiresAt:input.expiresAt,createdAt:admin.firestore.Timestamp.fromMillis(now),updatedAt:admin.firestore.Timestamp.fromMillis(now)});
    tx.create(receiptRef,{v:2,uid,envelopeId:input.envelopeId,deviceId:input.deviceId,direction:input.direction,digest,payloadDigest:syncStateHash(input.encryptedPayload),createdAt:now});
    tx.set(budgetRef,{v:1,uid,day,envelopes:count+1,bytes:bytes+cipherBytes,updatedAt:now});
    return {...unknown,status:'published',createdAt:now,delivery:'queued'};
  });
}
function callable(mode:'publish'|'status'|'cancel') {
  return functions.region('europe-west1').https.onCall(async(value,context)=>{
    if(!context.auth?.uid)throw fail('unauthenticated');try{parseSyncPublication(value);}catch{throw fail('invalid-argument');}
    if(mode==='publish'&&!MOBILE_SYNC_IMPORT_ENABLED)throw fail();
    try{
      if(!(await consumeServerRateLimit(`uid:${context.auth.uid}`,{bucket:`mobile-sync-publication-${mode}`,max:20,windowMs:60000})).allowed)throw fail('resource-exhausted');
      return await executeSyncPublication(context.auth.uid,value,mode);
    }catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
  });
}
export const publishMobileSyncEnvelope=callable('publish');
export const getMobileSyncPublicationStatus=callable('status');
export const cancelMobileSyncPublication=callable('cancel');
