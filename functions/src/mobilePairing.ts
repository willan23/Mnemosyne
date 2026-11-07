import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {createHash,createPublicKey} from 'node:crypto';
import {liveAccountInTransaction} from './accountAccess';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {consumeServerRateLimit} from './rateLimit';
import {canonicalSyncState} from './mobileSyncImportContract';
import {PAIRING_TTL_MS,PAIRING_DAILY_INVITES,parsePairingCommand,pairingCommandBytes,pairingPublicKey,pairingDigestValid,pairingTimeValid,type PairingCommand,type PairingOutcome,type PairingPublicKey} from './mobilePairingContract';

if(!admin.apps.length)admin.initializeApp();
/** Enrollment stays closed until client key recovery and the device pilot are verified. */
export const MOBILE_PAIRING_ENABLED=false;
export interface MobilePairingDeps{firestore:FirebaseFirestore.Firestore;auth:Pick<admin.auth.Auth,'getUser'>;now:()=>number;enabled:()=>boolean}
const defaults=():MobilePairingDeps=>({firestore:admin.firestore(),auth:admin.auth(),now:Date.now,enabled:()=>MOBILE_PAIRING_ENABLED});
const fail=(code:functions.https.FunctionsErrorCode='failed-precondition')=>new functions.https.HttpsError(code,'Mobile pairing unavailable');
const digest=(value:unknown)=>createHash('sha256').update(canonicalSyncState(value)).digest('hex');
export const mobilePairingCommandDigest=(command:PairingCommand)=>createHash('sha256').update(pairingCommandBytes(command)).digest('hex');
function commandFor(uid:string,value:unknown){
  if(!attachmentActorIdValid(uid))throw fail('unauthenticated');let input:PairingCommand;try{input=parsePairingCommand(value);}catch{throw fail('invalid-argument');}
  if(input.actorUid!==uid)throw fail('permission-denied');return input;
}
/** Node validates the actual curve point, beyond the transport shape. */
function validateKey(key:PairingPublicKey){try{const result=createPublicKey({key,format:'jwk'});if(result.asymmetricKeyType!=='ec'||result.asymmetricKeyDetails?.namedCurve!=='prime256v1'||canonicalSyncState(pairingPublicKey(result.export({format:'jwk'})))!==canonicalSyncState(key))throw Error();}catch{throw fail('invalid-argument');}}
function basePair(data:FirebaseFirestore.DocumentData,uid:string,id:string){
  if(data.version!==2||data.ownerUid!==uid||data.pairingId!==id||!pairingDigestValid(data.creationDigest)||
    !['pending','accepted','cancelled','trusted'].includes(data.status)||!pairingTimeValid(data.createdAt)||data.expiresAt!==data.createdAt+PAIRING_TTL_MS)throw fail('permission-denied');
  if(data.cancelledBeforeCreation===true){
    if(data.status!=='cancelled'||data.cancelledAt!==data.createdAt||Object.keys(data).sort().join(',')!==['version','ownerUid','pairingId','status','creationDigest','createdAt','expiresAt','cancelledAt','updatedAt','cancelledBeforeCreation'].sort().join(','))throw fail('permission-denied');
    return;
  }
  try{
    const creation=parsePairingCommand({v:1,actorUid:uid,action:'create',pairingId:id,desktopDeviceName:data.desktopDeviceName,desktopPublicKeyJwk:data.desktopPublicKeyJwk});
    if(mobilePairingCommandDigest(creation)!==data.creationDigest)throw Error();
    if(creation.action==='create')validateKey(creation.desktopPublicKeyJwk);
    if(data.status==='pending'&&data.acceptanceDigest!=null)throw Error();
    if(data.status==='trusted'&&(!pairingDigestValid(data.trustDigest)||!pairingTimeValid(data.trustedAt)))throw Error();
    if(data.status!=='trusted'&&data.trustDigest!=null)throw Error();
    if(data.acceptanceDigest){
      const acceptance=parsePairingCommand({v:1,actorUid:uid,action:'accept',pairingId:id,creationDigest:data.creationDigest,expiresAt:data.expiresAt,mobileDeviceId:data.mobileDeviceId,mobileDeviceName:data.mobileDeviceName,mobilePublicKeyJwk:data.mobilePublicKeyJwk,encryptedHandshake:data.encryptedHandshake});
      if(mobilePairingCommandDigest(acceptance)!==data.acceptanceDigest||!pairingTimeValid(data.acceptedAt)||data.acceptedAt<data.createdAt||data.acceptedAt>=data.expiresAt)throw Error();
    }else if(data.status==='accepted'||data.status==='trusted')throw Error();
  }catch{throw fail('permission-denied');}
}
function ownedDevice(data:FirebaseFirestore.DocumentData,uid:string,id:string){if(data.ownerUid!==uid||data.deviceId!==id||!['active','revoked'].includes(data.status))throw fail('permission-denied');}
/** Status is current state, not an instruction to recreate or roll back a missing device. */
export async function executeMobilePairing(uid:string,value:unknown,mode:'apply'|'status',deps=defaults()):Promise<PairingOutcome>{
  const input=commandFor(uid,value);if(!['apply','status'].includes(mode))throw fail('invalid-argument');
  if('desktopPublicKeyJwk'in input)validateKey(input.desktopPublicKeyJwk);if(input.action==='accept')validateKey(input.mobilePublicKeyJwk);
  let user:admin.auth.UserRecord;try{user=await deps.auth.getUser(uid);if(user.uid!==uid||user.disabled)throw Error();}catch{throw fail('permission-denied');}
  const db=deps.firestore,commandDigest=mobilePairingCommandDigest(input),id=input.action==='revoke'?input.deviceId:input.pairingId;
  const empty:PairingOutcome={v:1,actorUid:uid,action:input.action,id,commandDigest,status:'unknown',createdAt:null,expiresAt:null,deviceId:null,changed:false};
  return db.runTransaction(async tx=>{
    const now=deps.now();if(!pairingTimeValid(now))throw fail();
    if(!await liveAccountInTransaction(tx,db,uid))throw fail('permission-denied');
    if(input.action==='revoke'){
      const ref=db.doc(`trustedDevices/${input.deviceId}`),snapshot=await tx.get(ref);if(!snapshot.exists){if(mode==='status')return empty;throw fail('not-found');}
      const device=snapshot.data()!;ownedDevice(device,uid,input.deviceId);const result={...empty,status:device.status as 'active'|'revoked',deviceId:input.deviceId};
      if(mode==='status'||device.status==='revoked')return result;
      // Revocation is a security action and remains available while enrollment is closed.
      tx.update(ref,{status:'revoked',revokedAt:now,updatedAt:now});return{...result,status:'revoked',changed:true};
    }
    const ref=db.doc(`devicePairings/${input.pairingId}`),snapshot=await tx.get(ref);
    if(!snapshot.exists){
      if(mode==='status')return empty;if(input.action!=='create'&&input.action!=='cancel')throw fail('not-found');if(input.action==='create'&&!deps.enabled()||!pairingTimeValid(now+PAIRING_TTL_MS))throw fail();
      const day=Math.floor(now/86400000),budgetRef=db.doc(`users/${uid}/mobilePairingBudgets/${day}`),budget=await tx.get(budgetRef),counter=budget.data();
      if(counter&&(counter.uid!==uid||counter.day!==day||!Number.isSafeInteger(counter.created)||counter.created<0))throw fail();
      if((counter?.created??0)>=PAIRING_DAILY_INVITES)throw fail('resource-exhausted');
      if(input.action==='cancel'){
        // A durable tombstone serializes with a delayed creation. It consumes one new-ID reservation.
        tx.create(ref,{version:2,ownerUid:uid,pairingId:id,status:'cancelled',creationDigest:input.creationDigest,createdAt:now,expiresAt:now+PAIRING_TTL_MS,cancelledAt:now,updatedAt:now,cancelledBeforeCreation:true});
        tx.set(budgetRef,{uid,day,created:(counter?.created??0)+1});return{...empty,status:'cancelled',createdAt:now,expiresAt:now+PAIRING_TTL_MS,changed:true};
      }
      const data={version:2,ownerUid:uid,pairingId:id,status:'pending',desktopDeviceName:input.desktopDeviceName,desktopPublicKeyJwk:input.desktopPublicKeyJwk,creationDigest:commandDigest,createdAt:now,expiresAt:now+PAIRING_TTL_MS,updatedAt:now};
      tx.create(ref,data);tx.set(budgetRef,{uid,day,created:(counter?.created??0)+1});return{...empty,status:'pending',createdAt:now,expiresAt:data.expiresAt,changed:true};
    }
    const data=snapshot.data()!;basePair(data,uid,input.pairingId);
    const result:PairingOutcome={...empty,status:data.status==='pending'||data.status==='accepted'?(data.expiresAt<=now?'expired':data.status):data.status,createdAt:data.createdAt,expiresAt:data.expiresAt,deviceId:typeof data.mobileDeviceId==='string'?data.mobileDeviceId:null};
    if(input.action==='create'){if(data.creationDigest!==commandDigest)throw fail('already-exists');return result;}
    if(input.action==='cancel'){
      if(data.creationDigest!==input.creationDigest)throw fail('permission-denied');if(mode==='status'||data.status==='cancelled')return result;if(data.status==='trusted')throw fail();
      tx.update(ref,{status:'cancelled',cancelledAt:now,updatedAt:now});return{...result,status:'cancelled',changed:true};
    }
    if(input.action==='accept'){
      if(data.creationDigest!==input.creationDigest||data.expiresAt!==input.expiresAt)throw fail('permission-denied');
      if(data.acceptanceDigest){if(data.acceptanceDigest!==commandDigest)throw fail('already-exists');return result;}
      if(mode==='status')return result;if(!deps.enabled()||data.status!=='pending'||data.expiresAt<=now||now<data.createdAt)throw fail();
      const device=await tx.get(db.doc(`trustedDevices/${input.mobileDeviceId}`));if(device.exists)throw fail('already-exists');
      tx.update(ref,{status:'accepted',mobileDeviceId:input.mobileDeviceId,mobileDeviceName:input.mobileDeviceName,mobilePublicKeyJwk:input.mobilePublicKeyJwk,encryptedHandshake:input.encryptedHandshake,acceptedAt:now,acceptanceDigest:commandDigest,updatedAt:now});
      return{...result,status:'accepted',deviceId:input.mobileDeviceId,changed:true};
    }
    if(data.acceptanceDigest!==input.acceptanceDigest||!pairingDigestValid(data.acceptanceDigest)||!data.mobileDeviceId)throw fail('permission-denied');
    const deviceRef=db.doc(`trustedDevices/${data.mobileDeviceId}`),deviceSnapshot=await tx.get(deviceRef);
    if(data.trustDigest){
      if(data.trustDigest!==commandDigest)throw fail('already-exists');if(data.status!=='trusted')throw fail();if(!deviceSnapshot.exists)return{...result,status:'unavailable'};
      const device=deviceSnapshot.data()!;ownedDevice(device,uid,data.mobileDeviceId);
      if(device.pairingId!==id||device.pairingDigest!==commandDigest||digest(pairingPublicKey(device.publicKeyJwk))!==digest(pairingPublicKey(data.mobilePublicKeyJwk))||digest(pairingPublicKey(device.desktopPublicKeyJwk))!==digest(input.desktopPublicKeyJwk))throw fail('permission-denied');
      return{...result,status:device.status as 'active'|'revoked'};
    }
    if(mode==='status')return result;if(!deps.enabled()||data.status!=='accepted'||data.expiresAt<=now||now<data.acceptedAt)throw fail();if(deviceSnapshot.exists)throw fail('already-exists');
    validateKey(pairingPublicKey(data.mobilePublicKeyJwk));
    tx.create(deviceRef,{deviceId:data.mobileDeviceId,ownerUid:uid,name:data.mobileDeviceName,status:'active',pairedAt:now,pairingId:id,publicKeyJwk:data.mobilePublicKeyJwk,desktopPublicKeyJwk:input.desktopPublicKeyJwk,pairingDigest:commandDigest,createdAt:now,updatedAt:now});
    tx.update(ref,{status:'trusted',trustDigest:commandDigest,trustedAt:now,updatedAt:now});return{...result,status:'active',changed:true};
  });
}
function callable(mode:'apply'|'status'){return functions.region('europe-west1').https.onCall(async(value,context)=>{
  const uid=context.auth?.uid;if(!uid)throw fail('unauthenticated');const input=commandFor(uid,value);
  try{if(!(await consumeServerRateLimit(`uid:${uid}`,{bucket:'mobile-pairing',max:30,windowMs:60000})).allowed)throw fail('resource-exhausted');return await executeMobilePairing(uid,input,mode);}catch(error){if(error instanceof functions.https.HttpsError)throw error;throw fail();}
});}
export const mutateMobilePairing=callable('apply');
export const getMobilePairingMutationStatus=callable('status');
