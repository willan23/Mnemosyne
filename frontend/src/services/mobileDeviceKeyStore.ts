import {Capacitor} from '@capacitor/core';
import {KeychainAccess,SecureStorage} from '@aparajita/capacitor-secure-storage';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {pairingPrivateKey} from './mobilePairingCrypto';
import {canonicalSyncState,syncIdValid} from '../../../functions/src/mobileSyncImportContract';
import {pairingPublicKey,pairingRecord,pairingTimeValid} from '../../../functions/src/mobilePairingContract';

export interface MobileSyncCredential{ownerUid:string;deviceId:string;pairingId:string;deviceName:string;privateKeyJwk:JsonWebKey;savedAt:number}
export class MobileCredentialError extends Error{constructor(){super('Não foi possível confirmar a credencial. A credencial anterior e os arquivos foram conservados.');}}
const failure=()=>new MobileCredentialError();
const keyForOwner=(uid:string)=>`credential_${uid}`;let storageReady:Promise<void>|null=null;
async function ready(){if(!storageReady)storageReady=(async()=>{await SecureStorage.setKeyPrefix('mnemosyne_mobile_sync_');if(Capacitor.getPlatform()==='ios')await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);})().catch(error=>{storageReady=null;throw error;});await storageReady;}
export const isNativeSecureStorage=()=>Capacitor.isNativePlatform();
export interface MobileCredentialDeps{
  get:(key:string)=>Promise<unknown>;set:(key:string,value:Record<string,unknown>)=>Promise<void>;remove:(key:string)=>Promise<void>;keys:()=>Promise<string[]>;
  encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;verify:typeof pairingPrivateKey;exclusive:typeof withClipCaptureLock;mutation?:PersonalMemoryMutationDeps;hash:(value:string)=>Promise<string>;
}
const defaults=():MobileCredentialDeps=>({get:async key=>{await ready();return SecureStorage.get(key);},set:async(key,value)=>{await ready();await SecureStorage.set(key,value);},remove:async key=>{await ready();await SecureStorage.remove(key);},keys:async()=>{await ready();return SecureStorage.keys();},encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,verify:pairingPrivateKey,exclusive:withClipCaptureLock,
  hash:async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('')});
function credential(value:unknown,uid:string):MobileSyncCredential{
  const data=pairingRecord(value);if(Object.keys(data).sort().join(',')!=='deviceId,deviceName,ownerUid,pairingId,privateKeyJwk,savedAt'||data.ownerUid!==uid||!syncIdValid(data.deviceId)||!syncIdValid(data.pairingId)||typeof data.deviceName!=='string'||data.deviceName.length>120||!pairingTimeValid(data.savedAt))throw failure();
  return{ownerUid:uid,deviceId:data.deviceId,pairingId:data.pairingId,deviceName:data.deviceName,privateKeyJwk:JSON.parse(JSON.stringify(pairingRecord(data.privateKeyJwk))),savedAt:data.savedAt};
}
async function open(value:unknown,uid:string,guard:()=>void,deps:MobileCredentialDeps){
  if(value===null||value===undefined)return null;const data=pairingRecord(value);let parsed:MobileSyncCredential,legacy=true;
  if(data.v===2){if(Object.keys(data).sort().join(',')!=='enc,v'||!isEncryptedMemoryEnvelope(data.enc))throw failure();const secret=await deps.decrypt(data.enc);guard();if(secret.text.length>12000)throw failure();const body=pairingRecord(JSON.parse(secret.text));if(Object.keys(body).sort().join(',')!=='credential,uid,v'||body.v!==2||body.uid!==uid)throw failure();parsed=credential(body.credential,uid);legacy=false;}
  else parsed=credential(data,uid);
  await deps.verify(parsed.privateKeyJwk,pairingPublicKey({kty:parsed.privateKeyJwk.kty,crv:parsed.privateKeyJwk.crv,x:parsed.privateKeyJwk.x,y:parsed.privateKeyJwk.y}),guard);guard();return{credential:parsed,legacy};
}
async function context<T>(uid:string,outer:()=>void,deps:MobileCredentialDeps,work:(guard:()=>void)=>Promise<T>){try{return await withPersonalMemoryMutation(uid,scope=>deps.exclusive(`mnemosyne:mobile-credential:v2:${encodeURIComponent(uid)}`,async()=>{const guard=()=>{outer();scope.assertCurrent();};guard();return work(guard);}),deps.mutation);}catch{throw failure();}}
export async function inspectMobileSyncCredential(uid:string,outer:()=>void=()=>{},deps=defaults()){
  return context(uid,outer,deps,async guard=>{const value=await deps.get(keyForOwner(uid));guard();const result=await open(value,uid,guard,deps);guard();if(!result)return null;const sourceDigest=await deps.hash(canonicalSyncState(value));guard();return{...result,sourceDigest};});
}
export async function loadMobileSyncCredential(uid:string,outer:()=>void=()=>{},deps=defaults()):Promise<MobileSyncCredential|null>{return(await inspectMobileSyncCredential(uid,outer,deps))?.credential??null;}
export async function saveMobileSyncCredential(value:MobileSyncCredential,outer:()=>void=()=>{},deps=defaults(),expectedSourceDigest?:string):Promise<void>{
  const captured=credential(value,value.ownerUid),uid=captured.ownerUid;
  return context(uid,outer,deps,async guard=>{
    await deps.verify(captured.privateKeyJwk,pairingPublicKey({kty:captured.privateKeyJwk.kty,crv:captured.privateKeyJwk.crv,x:captured.privateKeyJwk.x,y:captured.privateKeyJwk.y}),guard);guard();
    const key=keyForOwner(uid),before=await deps.get(key);guard();if(expectedSourceDigest!==undefined){const source=await deps.hash(canonicalSyncState(before??null));guard();if(source!==expectedSourceDigest)throw failure();}const old=await open(before,uid,guard,deps);guard();
    if(old&&!old.legacy&&canonicalSyncState(old.credential)===canonicalSyncState(captured))return;
    // An old credential (including the exact legacy object/cipher) is durable before replacement.
    if(before!==null&&before!==undefined){
      const snapshot=canonicalSyncState(before);if(snapshot.length>24000)throw failure();const archive='archive_v2:'+encodeURIComponent(uid)+':'+await deps.hash(snapshot);guard();const existing=await deps.get(archive);guard();
      if(existing!==null&&existing!==undefined){const record=pairingRecord(existing);if(!isEncryptedMemoryEnvelope(record.enc))throw failure();const checked=await deps.decrypt(record.enc);guard();if(canonicalSyncState(JSON.parse(checked.text))!==canonicalSyncState({v:2,uid,previous:before}))throw failure();}
      else{const archiveKeys=await deps.keys();guard();if(archiveKeys.filter(key=>key.startsWith('archive_v2:'+encodeURIComponent(uid)+':')).length>=100)throw failure();const enc=await deps.encrypt({text:JSON.stringify({v:2,uid,previous:before})});guard();await deps.set(archive,{v:2,enc});guard();const stored=pairingRecord(await deps.get(archive));guard();if(!isEncryptedMemoryEnvelope(stored.enc)||canonicalSyncState(JSON.parse((await deps.decrypt(stored.enc)).text))!==canonicalSyncState({v:2,uid,previous:before}))throw failure();guard();}
    }
    const enc=await deps.encrypt({text:JSON.stringify({v:2,uid,credential:captured})});guard();const current=await deps.get(key);guard();if(canonicalSyncState(current??null)!==canonicalSyncState(before??null))throw failure();
    await deps.set(key,{v:2,enc});guard();const verified=await open(await deps.get(key),uid,guard,deps);guard();if(!verified||verified.legacy||canonicalSyncState(verified.credential)!==canonicalSyncState(captured))throw failure();
  });
}
/** Explicit user action upgrades the legacy record; the original remains in a vault-encrypted archive. */
export async function protectLegacyMobileSyncCredential(uid:string,sourceDigest:string,outer:()=>void=()=>{},deps=defaults()){const current=await inspectMobileSyncCredential(uid,outer,deps);outer();if(!current||current.sourceDigest!==sourceDigest)throw failure();await saveMobileSyncCredential(current.credential,outer,deps,sourceDigest);}
export async function removeMobileSyncCredential(uid:string,outer:()=>void=()=>{},deps=defaults()):Promise<void>{
  // Account deletion already captures/authorizes this exact UID; cleanup must work after Auth/vault retirement.
  if(!syncIdValid(uid)||uid.includes('\\'))throw failure();const names=await deps.keys();outer();
  for(const name of names)if(name===keyForOwner(uid)||name.startsWith('archive_v2:'+encodeURIComponent(uid)+':')){outer();await deps.remove(name);outer();}
}
