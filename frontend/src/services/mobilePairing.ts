import QRCode from 'qrcode';
import {onAuthStateChanged} from 'firebase/auth';
import {collection,doc,getDocFromServer,onSnapshot,query,where,type Unsubscribe} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import app,{auth,db} from '../firebase';
import {MOBILE_PAIRING_ENABLED} from '../config/releaseGates';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {saveMobileSyncCredential,type MobileSyncCredential} from './mobileDeviceKeyStore';
import {generatePairingKey,pairingPrivateKey,encryptPairingHandshake,decryptPairingHandshake,pairingBase64,pairingDecode} from './mobilePairingCrypto';
import {canonicalSyncState} from '../../../functions/src/mobileSyncImportContract';
import {parsePairingCommand,parsePairingOutcome,pairingCommandBytes,pairingPublicKey,pairingRecord,pairingDigestValid,pairingTimeValid,PAIRING_TTL_MS,type PairingCommand,type PairingOutcome} from '../../../functions/src/mobilePairingContract';

type Create=Extract<PairingCommand,{action:'create'}>;type Accept=Extract<PairingCommand,{action:'accept'}>;type Trust=Extract<PairingCommand,{action:'trust'}>;
export type MobilePairingStatus='pending'|'accepted'|'trusted'|'cancelled'|'expired';
export interface MobilePairingPayload{version:2;creation:Create;creationDigest:string;createdAt:number;expiresAt:number}
export interface MobilePairingInvite{pairingId:string;pairingUri:string;qrDataUrl:string;expiresAt:number;creationDigest:string;privateKey:CryptoKey}
export interface EncryptedPairingPayload{iv:string;data:string}
export interface MobilePairingRecord{version:number;pairingId:string;ownerUid:string;status:MobilePairingStatus;expiresAt:number;createdAt:number;creationDigest:string;acceptanceDigest?:string;desktopDeviceName:string;desktopPublicKeyJwk:JsonWebKey;mobileDeviceId?:string;mobileDeviceName?:string;mobilePublicKeyJwk?:JsonWebKey;encryptedHandshake?:EncryptedPairingPayload}
export interface TrustedDevice{deviceId:string;ownerUid:string;name:string;status:'active'|'revoked';pairedAt:number;revokedAt?:number;pairingId?:string;publicKeyJwk?:JsonWebKey;desktopPublicKeyJwk?:JsonWebKey}
type Journal={v:2;uid:string;role:'desktop'|'mobile';creation:Create;privateKeyJwk:JsonWebKey;payload:MobilePairingPayload|null;acceptance:Accept|null;trust:Trust|null;saved:boolean;cancelRequested:boolean};
export class MobilePairingError extends Error{constructor(){super('Não foi possível confirmar o emparelhamento. A chave e o pedido cifrados foram conservados; desbloqueia o cofre e retoma ou cancela o pedido.');}}
const fail=()=>new MobilePairingError();
export const mobilePairingJournalKey=(uid:string,role:Journal['role'])=>`mnemosyne:mobile-pairing:v2:${encodeURIComponent(uid)}:${role}`;
const archivePrefix=(uid:string)=>`mnemosyne:mobile-pairing-archive:v2:${encodeURIComponent(uid)}:`;
export function hasPendingMobilePairing(uid:string,role:Journal['role']){try{return localStorage.getItem(mobilePairingJournalKey(uid,role))!==null;}catch{return true;}}
export interface MobilePairingDeps{
  enabled:()=>boolean;uid:()=>string|null;observeAuth:(changed:(uid:string|null)=>void)=>()=>void;observeStorage?:(uid:string,changed:()=>void)=>()=>void;mutation?:PersonalMemoryMutationDeps;
  storage:Storage;exclusive:typeof withClipCaptureLock;id:()=>string;now:()=>number;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;
  generate:typeof generatePairingKey;open:typeof pairingPrivateKey;seal:typeof encryptPairingHandshake;unseal:typeof decryptPairingHandshake;
  hash:(value:string)=>Promise<string>;qr:(uri:string)=>Promise<string>;call:(input:PairingCommand,mode:'apply'|'status')=>Promise<unknown>;
  readPairing:(id:string)=>Promise<unknown>;readDevice:(id:string)=>Promise<unknown>;saveCredential:(value:MobileSyncCredential,guard:()=>void)=>Promise<void>;
}
const defaults=():MobilePairingDeps=>({enabled:()=>MOBILE_PAIRING_ENABLED,uid:()=>auth.currentUser?.uid??null,observeAuth:changed=>onAuthStateChanged(auth,user=>changed(user?.uid??null)),storage:localStorage,exclusive:withClipCaptureLock,
  observeStorage:(uid,changed)=>{const listener=(event:StorageEvent)=>{if(event.key===null||event.key===mobilePairingJournalKey(uid,'desktop')||event.key===mobilePairingJournalKey(uid,'mobile'))changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
  id:()=>pairingBase64(crypto.getRandomValues(new Uint8Array(18))),now:Date.now,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,generate:generatePairingKey,open:pairingPrivateKey,seal:encryptPairingHandshake,unseal:decryptPairingHandshake,
  hash:async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join(''),
  qr:uri=>QRCode.toDataURL(uri,{errorCorrectionLevel:'M',margin:1,width:260,color:{dark:'#0f172a',light:'#f8fafc'}}),
  call:async(input,mode)=>(await httpsCallable(getFunctions(app,'europe-west1'),mode==='apply'?'mutateMobilePairing':'getMobilePairingMutationStatus')(input)).data,
  readPairing:async id=>{const row=await getDocFromServer(doc(db,'devicePairings',id));return row.exists()?row.data():null;},readDevice:async id=>{const row=await getDocFromServer(doc(db,'trustedDevices',id));return row.exists()?row.data():null;},saveCredential:saveMobileSyncCredential});
const exact=(data:Record<string,unknown>,fields:string[])=>{if(Object.keys(data).sort().join(',')!==fields.sort().join(','))throw fail();};
function payload(value:unknown):MobilePairingPayload{
  const data=pairingRecord(value);exact(data,['version','creation','creationDigest','createdAt','expiresAt']);const creation=parsePairingCommand(data.creation);
  if(data.version!==2||creation.action!=='create'||!pairingDigestValid(data.creationDigest)||!pairingTimeValid(data.createdAt)||data.expiresAt!==data.createdAt+PAIRING_TTL_MS)throw fail();
  return{version:2,creation,creationDigest:data.creationDigest,createdAt:data.createdAt,expiresAt:data.expiresAt as number};
}
export function parseMobilePairingUri(uri:string):MobilePairingPayload{
  try{if(typeof uri!=='string'||uri.length>4096)throw fail();const url=new URL(uri);
    if(url.protocol!=='mnemosyne:'||url.hostname!=='pair'||url.username||url.password||url.port||url.hash||url.pathname&&url.pathname!=='/'||[...url.searchParams.keys()].join(',')!=='payload')throw fail();
    const encoded=url.searchParams.get('payload');if(!encoded||!/^[A-Za-z0-9_-]+$/.test(encoded))throw fail();return payload(JSON.parse(pairingDecode(encoded)));
  }catch{throw fail();}
}
async function read(raw:string,uid:string,role:Journal['role'],guard:()=>void,deps:MobilePairingDeps):Promise<Journal>{
  try{if(raw.length>32768)throw fail();const cipher:unknown=JSON.parse(raw);if(!isEncryptedMemoryEnvelope(cipher))throw fail();const decoded=await deps.decrypt(cipher);guard();if(decoded.text.length>24000)throw fail();
    const data=pairingRecord(JSON.parse(decoded.text));exact(data,['v','uid','role','creation','privateKeyJwk','payload','acceptance','trust','saved','cancelRequested']);const creation=parsePairingCommand(data.creation);
    if(data.v!==2||data.uid!==uid||data.role!==role||creation.action!=='create'||creation.actorUid!==uid||typeof data.saved!=='boolean'||typeof data.cancelRequested!=='boolean')throw fail();
    const body:Journal={v:2,uid,role,creation,privateKeyJwk:JSON.parse(JSON.stringify(pairingRecord(data.privateKeyJwk))),payload:data.payload===null?null:payload(data.payload),acceptance:data.acceptance===null?null:parsePairingCommand(data.acceptance) as Accept,trust:data.trust===null?null:parsePairingCommand(data.trust) as Trust,saved:data.saved,cancelRequested:data.cancelRequested};
    if(body.payload&&(canonicalSyncState(body.payload.creation)!==canonicalSyncState(creation)||body.payload.creationDigest!==await deps.hash(pairingCommandBytes(creation))))throw fail();guard();
    if(role==='desktop'&&body.acceptance!==null||role==='mobile'&&(!body.acceptance||body.acceptance.action!=='accept'||!body.payload||body.trust!==null))throw fail();
    if(body.acceptance&&(!body.payload||body.acceptance.actorUid!==uid||body.acceptance.pairingId!==creation.pairingId||body.acceptance.creationDigest!==body.payload.creationDigest||body.acceptance.expiresAt!==body.payload.expiresAt))throw fail();
    if(body.trust&&(body.trust.action!=='trust'||body.trust.actorUid!==uid||body.trust.pairingId!==creation.pairingId))throw fail();
    return body;
  }catch{guard();throw fail();}
}
async function write(key:string,baseline:string|null,body:Journal,guard:()=>void,deps:MobilePairingDeps){
  const text=JSON.stringify(body),cipher=await deps.encrypt({text});guard();if(!isEncryptedMemoryEnvelope(cipher))throw fail();const checked=await deps.decrypt(cipher);guard();if(checked.text!==text||deps.storage.getItem(key)!==baseline)throw fail();
  const raw=JSON.stringify(cipher);guard();if(deps.storage.getItem(key)!==baseline)throw fail();deps.storage.setItem(key,raw);guard();if(deps.storage.getItem(key)!==raw)throw fail();return raw;
}
async function archive(uid:string,role:Journal['role'],raw:string,guard:()=>void,deps:MobilePairingDeps){
  const key=archivePrefix(uid)+role+':'+await deps.hash(raw);guard();const old=deps.storage.getItem(key);if(old!==null){if(old!==raw)throw fail();return;}
  let count=0;for(let index=0;index<deps.storage.length;index++)if(deps.storage.key(index)?.startsWith(archivePrefix(uid)))count++;if(count>=100)throw fail();
  guard();if(deps.storage.getItem(mobilePairingJournalKey(uid,role))!==raw)throw fail();deps.storage.setItem(key,raw);guard();if(deps.storage.getItem(key)!==raw)throw fail();
}
async function call(input:PairingCommand,mode:'apply'|'status',guard:()=>void,deps:MobilePairingDeps){
  const captured=parsePairingCommand(input),digest=await deps.hash(pairingCommandBytes(captured));guard();let value:unknown;try{value=await deps.call(captured,mode);}catch{guard();throw fail();}guard();try{return parsePairingOutcome(value,captured,digest,mode);}catch{throw fail();}
}
async function submit(input:PairingCommand,guard:()=>void,deps:MobilePairingDeps):Promise<PairingOutcome>{
  const current=await call(input,'status',guard,deps);
  const done=input.action==='create'?current.status!=='unknown':input.action==='accept'?['accepted','trusted'].includes(current.status):input.action==='trust'?['active','revoked','unavailable'].includes(current.status):input.action==='cancel'?current.status==='cancelled':current.status==='revoked';
  if(done)return current;
  if(['create','accept','trust'].includes(input.action)&&(!deps.enabled()||['cancelled','expired'].includes(current.status)))throw fail();
  return call(input,'apply',guard,deps);
}
async function locked<T>(uid:string,outer:()=>void,deps:MobilePairingDeps,work:(guard:()=>void)=>Promise<T>){
  let retired=false;const stop=deps.observeStorage?.(uid,()=>{retired=true;});
  try{return await withPersonalMemoryMutation(uid,context=>deps.exclusive(`mnemosyne:mobile-pairing:v2:${encodeURIComponent(uid)}`,async()=>{const guard=()=>{outer();context.assertCurrent();if(retired)throw fail();};guard();return work(guard);}),deps.mutation);}catch{throw fail();}finally{retired=true;stop?.();}
}
const ownLabel=(value:string)=>Array.from(value.slice(0,120),char=>{const code=char.charCodeAt(0);return code<32||code===127?' ':char;}).join('').trim()||'Mobile';
async function acceptedDevice(body:Journal,status:'active'|'revoked',guard:()=>void,deps:MobilePairingDeps){
  if(!body.acceptance)throw fail();const device=pairingRecord(await deps.readDevice(body.acceptance.mobileDeviceId));guard();
  if(device.ownerUid!==body.uid||device.deviceId!==body.acceptance.mobileDeviceId||device.pairingId!==body.creation.pairingId||device.status!==status||canonicalSyncState(pairingPublicKey(device.publicKeyJwk))!==canonicalSyncState(body.acceptance.mobilePublicKeyJwk))throw fail();
}
async function retireForRenewal(body:Journal,guard:()=>void,deps:MobilePairingDeps){
  const creationDigest=await deps.hash(pairingCommandBytes(body.creation));guard();const command:PairingCommand={v:1,actorUid:body.uid,action:'cancel',pairingId:body.creation.pairingId,creationDigest},current=await call(command,'status',guard,deps);
  if(current.status==='trusted'){
    const pair=pairingRecord(await deps.readPairing(body.creation.pairingId));guard();if(pair.version!==2||pair.ownerUid!==body.uid||pair.pairingId!==body.creation.pairingId||pair.creationDigest!==creationDigest||typeof pair.mobileDeviceId!=='string')throw fail();
    const value=await deps.readDevice(pair.mobileDeviceId);guard();if(value===null||value===undefined)return;const device=pairingRecord(value);
    if(device.ownerUid!==body.uid||device.deviceId!==pair.mobileDeviceId||device.pairingId!==body.creation.pairingId||device.status!=='revoked'||canonicalSyncState(pairingPublicKey(device.publicKeyJwk))!==canonicalSyncState(pairingPublicKey(pair.mobilePublicKeyJwk)))throw fail();return;
  }
  if((await submit(command,guard,deps)).status!=='cancelled')throw fail();
}
export async function createMobilePairingInvite(uid:string,desktopDeviceName=navigator.userAgent.slice(0,120),outer:()=>void=()=>{},deps=defaults()):Promise<MobilePairingInvite>{
  return locked(uid,outer,deps,async guard=>{
    const key=mobilePairingJournalKey(uid,'desktop');let raw=deps.storage.getItem(key);const valid=()=>{guard();if(deps.storage.getItem(key)!==raw)throw fail();};let body=raw===null?null:await read(raw,uid,'desktop',valid,deps);valid();
    if(body){
      if(body.cancelRequested)await retireForRenewal(body,valid,deps);
      const status=await call(body.creation,'status',valid,deps);
      if(['cancelled','expired','trusted'].includes(status.status)){if(!deps.enabled())throw fail();if(status.status==='expired')await retireForRenewal(body,valid,deps);await archive(uid,'desktop',raw!,valid,deps);body=null;}
    }
    if(!body){
      if(!deps.enabled())throw fail();const generated=await deps.generate(valid);valid();const creation=parsePairingCommand({v:1,actorUid:uid,action:'create',pairingId:deps.id(),desktopDeviceName:ownLabel(desktopDeviceName),desktopPublicKeyJwk:generated.publicKeyJwk}) as Create;
      body={v:2,uid,role:'desktop',creation,privateKeyJwk:JSON.parse(JSON.stringify(generated.privateKeyJwk)),payload:null,acceptance:null,trust:null,saved:false,cancelRequested:false};raw=await write(key,raw,body,guard,deps);
    }
    const privateKey=await deps.open(body.privateKeyJwk,body.creation.desktopPublicKeyJwk,valid);valid();const status=await submit(body.creation,valid,deps);if(!['pending','accepted'].includes(status.status)||status.createdAt===null||status.expiresAt===null)throw fail();
    const invite:MobilePairingPayload={version:2,creation:body.creation,creationDigest:status.commandDigest,createdAt:status.createdAt,expiresAt:status.expiresAt};
    if(body.payload&&canonicalSyncState(body.payload)!==canonicalSyncState(invite))throw fail();if(!body.payload){body={...body,payload:invite};raw=await write(key,raw,body,guard,deps);}
    const pairingUri='mnemosyne://pair?payload='+pairingBase64(new TextEncoder().encode(JSON.stringify(invite))),qrDataUrl=await deps.qr(pairingUri);valid();
    return{pairingId:body.creation.pairingId,pairingUri,qrDataUrl,expiresAt:invite.expiresAt,creationDigest:invite.creationDigest,privateKey};
  });
}
export async function acceptMobilePairingInvite(pairingUri:string,mobileDeviceName=navigator.userAgent.slice(0,120),outer:()=>void=()=>{},deps=defaults()):Promise<MobileSyncCredential>{
  const uid=deps.uid();if(!uid)throw fail();return locked(uid,outer,deps,async guard=>{
    const key=mobilePairingJournalKey(uid,'mobile');let raw=deps.storage.getItem(key);const valid=()=>{guard();if(deps.storage.getItem(key)!==raw)throw fail();};let body=raw===null?null:await read(raw,uid,'mobile',valid,deps);valid();const source=pairingUri?parseMobilePairingUri(pairingUri):body?.payload;if(!source||source.creation.actorUid!==uid||source.creationDigest!==await deps.hash(pairingCommandBytes(source.creation)))throw fail();valid();
    if(body&&canonicalSyncState(body.payload)!==canonicalSyncState(source)){
      if(!body.saved){if(!body.acceptance)throw fail();const previous=await call(body.acceptance,'status',valid,deps);
        if(previous.status==='expired')await retireForRenewal(body,valid,deps);
        else if(previous.status!=='cancelled'){if(!body.cancelRequested||previous.status!=='trusted')throw fail();await acceptedDevice(body,'revoked',valid,deps);}}
      await archive(uid,'mobile',raw!,valid,deps);body=null;
    }
    if(!body){
      if(!deps.enabled()||source.expiresAt<=deps.now())throw fail();const generated=await deps.generate(valid);valid();const mobileDeviceId=deps.id(),name=ownLabel(mobileDeviceName);
      const handshake={v:2,pairingId:source.creation.pairingId,ownerUid:uid,mobileDeviceId,mobileDeviceName:name,creationDigest:source.creationDigest},encryptedHandshake=await deps.seal(handshake,generated.privateKey,source.creation.desktopPublicKeyJwk,valid);valid();
      const acceptance=parsePairingCommand({v:1,actorUid:uid,action:'accept',pairingId:source.creation.pairingId,creationDigest:source.creationDigest,expiresAt:source.expiresAt,mobileDeviceId,mobileDeviceName:name,mobilePublicKeyJwk:generated.publicKeyJwk,encryptedHandshake}) as Accept;
      body={v:2,uid,role:'mobile',creation:source.creation,privateKeyJwk:JSON.parse(JSON.stringify(generated.privateKeyJwk)),payload:source,acceptance,trust:null,saved:false,cancelRequested:false};raw=await write(key,raw,body,guard,deps);
    }
    if(!body.acceptance)throw fail();const acceptance=body.acceptance;await deps.open(body.privateKeyJwk,acceptance.mobilePublicKeyJwk,valid);valid();
    if(body.cancelRequested){
      const cancel:PairingCommand={v:1,actorUid:uid,action:'cancel',pairingId:body.creation.pairingId,creationDigest:source.creationDigest},status=await call(cancel,'status',valid,deps);
      // Explicit recovery may reopen a local key for an already active grant; it never undoes a server cancellation/revocation.
      if(pairingUri===''&&status.status==='trusted'){await acceptedDevice(body,'active',valid,deps);await archive(uid,'mobile',raw!,valid,deps);body={...body,cancelRequested:false};raw=await write(key,raw,body,guard,deps);}
      else{await submit(cancel,valid,deps);throw fail();}
    }
    const result=await submit(acceptance,valid,deps);if(!['accepted','trusted'].includes(result.status)||result.deviceId!==acceptance.mobileDeviceId)throw fail();
    const credential:MobileSyncCredential={ownerUid:uid,deviceId:acceptance.mobileDeviceId,pairingId:body.creation.pairingId,deviceName:acceptance.mobileDeviceName,privateKeyJwk:JSON.parse(JSON.stringify(body.privateKeyJwk)),savedAt:body.payload!.createdAt};
    await deps.saveCredential(credential,valid);valid();if(!body.saved){body={...body,saved:true};raw=await write(key,raw,body,guard,deps);}valid();return credential;
  });
}
export async function trustAcceptedMobilePairing(uid:string,record:MobilePairingRecord,desktopSyncPublicKeyJwk:JsonWebKey,outer:()=>void=()=>{},deps=defaults()):Promise<TrustedDevice>{
  const captured=JSON.parse(JSON.stringify(record)) as MobilePairingRecord,desktopKey=pairingPublicKey(desktopSyncPublicKeyJwk);
  return locked(uid,outer,deps,async guard=>{
    const key=mobilePairingJournalKey(uid,'desktop');let raw=deps.storage.getItem(key);if(raw===null)throw fail();const valid=()=>{guard();if(deps.storage.getItem(key)!==raw)throw fail();};let body=await read(raw,uid,'desktop',valid,deps);valid();
    if(body.cancelRequested||!body.payload||captured.version!==2||captured.ownerUid!==uid||captured.pairingId!==body.creation.pairingId||captured.creationDigest!==body.payload.creationDigest||captured.expiresAt!==body.payload.expiresAt||!['accepted','trusted'].includes(captured.status)||canonicalSyncState(pairingPublicKey(captured.desktopPublicKeyJwk))!==canonicalSyncState(body.creation.desktopPublicKeyJwk))throw fail();
    const acceptance=parsePairingCommand({v:1,actorUid:uid,action:'accept',pairingId:captured.pairingId,creationDigest:captured.creationDigest,expiresAt:captured.expiresAt,mobileDeviceId:captured.mobileDeviceId,mobileDeviceName:captured.mobileDeviceName,mobilePublicKeyJwk:captured.mobilePublicKeyJwk,encryptedHandshake:captured.encryptedHandshake}) as Accept;
    if(captured.acceptanceDigest!==await deps.hash(pairingCommandBytes(acceptance)))throw fail();valid();const privateKey=await deps.open(body.privateKeyJwk,body.creation.desktopPublicKeyJwk,valid),handshake=await deps.unseal(acceptance.encryptedHandshake,privateKey,acceptance.mobilePublicKeyJwk,valid);valid();
    const expected={v:2,pairingId:captured.pairingId,ownerUid:uid,mobileDeviceId:acceptance.mobileDeviceId,mobileDeviceName:acceptance.mobileDeviceName,creationDigest:captured.creationDigest};if(canonicalSyncState(handshake)!==canonicalSyncState(expected))throw fail();
    const trust=parsePairingCommand({v:1,actorUid:uid,action:'trust',pairingId:captured.pairingId,acceptanceDigest:captured.acceptanceDigest,desktopPublicKeyJwk:desktopKey}) as Trust;
    if(body.trust&&canonicalSyncState(body.trust)!==canonicalSyncState(trust))throw fail();if(!body.trust){body={...body,trust};raw=await write(key,raw,body,guard,deps);}
    const result=await submit(trust,valid,deps);if(result.status!=='active'||result.deviceId!==acceptance.mobileDeviceId)throw fail();const device=pairingRecord(await deps.readDevice(result.deviceId));valid();
    if(device.ownerUid!==uid||device.deviceId!==result.deviceId||device.pairingId!==captured.pairingId||device.status!=='active'||device.pairingDigest!==result.commandDigest||canonicalSyncState(pairingPublicKey(device.publicKeyJwk))!==canonicalSyncState(acceptance.mobilePublicKeyJwk)||canonicalSyncState(pairingPublicKey(device.desktopPublicKeyJwk))!==canonicalSyncState(desktopKey)||!pairingTimeValid(device.pairedAt)||deps.storage.getItem(key)!==raw)throw fail();
    return{deviceId:result.deviceId,ownerUid:uid,name:acceptance.mobileDeviceName,status:'active',pairedAt:device.pairedAt,pairingId:captured.pairingId,publicKeyJwk:acceptance.mobilePublicKeyJwk,desktopPublicKeyJwk:desktopKey};
  });
}
async function cancelWithGuard(uid:string,pairingId:string,guard:()=>void,deps:MobilePairingDeps):Promise<void>{
    let creationDigest:string|null=null;
    for(const role of['desktop','mobile'] as const){const key=mobilePairingJournalKey(uid,role),raw=deps.storage.getItem(key);if(raw===null)continue;const body=await read(raw,uid,role,guard,deps);guard();if(body.creation.pairingId!==pairingId)continue;creationDigest=await deps.hash(pairingCommandBytes(body.creation));guard();if(!body.cancelRequested)await write(key,raw,{...body,cancelRequested:true},guard,deps);}
    if(!creationDigest){const record=pairingRecord(await deps.readPairing(pairingId));guard();if(record.version!==2||record.ownerUid!==uid||record.pairingId!==pairingId||!pairingDigestValid(record.creationDigest))throw fail();creationDigest=record.creationDigest;}
    const result=await submit({v:1,actorUid:uid,action:'cancel',pairingId,creationDigest},guard,deps);if(result.status!=='cancelled')throw fail();
}
export async function cancelMobilePairingInvite(pairingId:string,outer:()=>void=()=>{},deps=defaults()):Promise<void>{
  const uid=deps.uid();if(!uid)throw fail();return locked(uid,outer,deps,guard=>cancelWithGuard(uid,pairingId,guard,deps));
}
export async function cancelRetainedMobilePairing(uid:string,role:Journal['role'],outer:()=>void=()=>{},deps=defaults()):Promise<void>{
  return locked(uid,outer,deps,async guard=>{const raw=deps.storage.getItem(mobilePairingJournalKey(uid,role));if(raw===null)throw fail();const body=await read(raw,uid,role,guard,deps);guard();await cancelWithGuard(uid,body.creation.pairingId,guard,deps);});
}
/** Security revocation remains usable with a locked vault; account changes stay latched. */
export async function revokeTrustedDevice(deviceId:string,outer:()=>void=()=>{},deps=defaults()):Promise<void>{
  const uid=deps.uid();if(!uid)throw fail();let retired=false;const stop=deps.observeAuth(current=>{if(current!==uid)retired=true;});const guard=()=>{outer();if(retired||deps.uid()!==uid)throw fail();};
  try{guard();const result=await submit({v:1,actorUid:uid,action:'revoke',deviceId},guard,deps);guard();if(result.status!=='revoked')throw fail();}catch{throw fail();}finally{retired=true;stop();}
}
export function watchMobilePairingInvite(pairingId:string,onChange:(record:MobilePairingRecord|null)=>void,failed:()=>void=()=>{}):Unsubscribe{
  const uid=auth.currentUser?.uid;if(!uid){onChange(null);return()=>{};}let live=true;const stopAuth=onAuthStateChanged(auth,user=>{if(user?.uid!==uid){live=false;onChange(null);}});
  const stop=onSnapshot(doc(db,'devicePairings',pairingId),{includeMetadataChanges:true},snapshot=>{if(!live||auth.currentUser?.uid!==uid||snapshot.metadata.fromCache)return;const data=snapshot.exists()?snapshot.data():null;onChange(data?.ownerUid===uid&&data.pairingId===pairingId?data as MobilePairingRecord:null);},()=>{if(live)failed();});
  return()=>{live=false;stopAuth();stop();};
}
export function watchTrustedDevices(uid:string,onChange:(devices:TrustedDevice[])=>void,failed:()=>void=()=>{}):Unsubscribe{
  if(auth.currentUser?.uid!==uid){onChange([]);return()=>{};}let live=true;const stopAuth=onAuthStateChanged(auth,user=>{if(user?.uid!==uid){live=false;onChange([]);}});
  const stop=onSnapshot(query(collection(db,'trustedDevices'),where('ownerUid','==',uid)),{includeMetadataChanges:true},snapshot=>{if(!live||auth.currentUser?.uid!==uid||snapshot.metadata.fromCache)return;const devices=snapshot.docs.map(row=>row.data()).filter(data=>data.ownerUid===uid&&typeof data.deviceId==='string'&&['active','revoked'].includes(data.status)) as TrustedDevice[];onChange(devices.sort((a,b)=>b.pairedAt-a.pairedAt));},()=>{if(live)failed();});
  return()=>{live=false;stopAuth();stop();};
}
