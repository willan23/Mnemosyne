import {attachmentActorIdValid} from './attachmentEnvelope';
import {canonicalSyncState} from './mobileSyncImportContract';
import {parseSyncPublicKey} from './mobileSyncPublicationContract';

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_DAILY_INVITES = 20;
export type PairingPublicKey = Pick<JsonWebKey, 'kty'|'crv'|'x'|'y'>;
export type PairingCommand = {v:1;actorUid:string} & (
  {action:'create';pairingId:string;desktopDeviceName:string;desktopPublicKeyJwk:PairingPublicKey} |
  {action:'accept';pairingId:string;creationDigest:string;expiresAt:number;mobileDeviceId:string;mobileDeviceName:string;mobilePublicKeyJwk:PairingPublicKey;encryptedHandshake:{iv:string;data:string}} |
  {action:'trust';pairingId:string;acceptanceDigest:string;desktopPublicKeyJwk:PairingPublicKey} |
  {action:'cancel';pairingId:string;creationDigest:string} |
  {action:'revoke';deviceId:string}
);
export interface PairingOutcome {
  v:1;actorUid:string;action:PairingCommand['action'];id:string;commandDigest:string;
  status:'unknown'|'pending'|'accepted'|'trusted'|'cancelled'|'expired'|'active'|'revoked'|'unavailable';
  createdAt:number|null;expiresAt:number|null;deviceId:string|null;changed:boolean;
}
const invalid=()=>new Error('Invalid mobile pairing command');
export function pairingRecord(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw invalid();
  return value as Record<string,unknown>;
}
function fields(data:Record<string,unknown>,names:string[]){if(Object.keys(data).sort().join(',')!==names.sort().join(','))throw invalid();}
export const pairingIdValid=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{24,64}$/.test(value);
export const pairingDigestValid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const pairingTimeValid=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
function name(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.length>120||/[\x00-\x1f\x7f]/.test(value))throw invalid();return value;}
/** Normalize optional WebCrypto flags, never accepting private material or usage extensions. */
export function pairingPublicKey(value:unknown):PairingPublicKey{
  const key=parseSyncPublicKey(value);return{kty:'EC',crv:'P-256',x:key.x,y:key.y};
}
export function parsePairingCommand(value:unknown):PairingCommand{
  const data=pairingRecord(value);if(data.v!==1||!attachmentActorIdValid(data.actorUid))throw invalid();
  const base={v:1 as const,actorUid:data.actorUid};
  if(data.action==='revoke'){fields(data,['v','actorUid','action','deviceId']);if(!attachmentActorIdValid(data.deviceId))throw invalid();return{...base,action:'revoke',deviceId:data.deviceId};}
  if(!pairingIdValid(data.pairingId))throw invalid();const pairingId=data.pairingId;
  if(data.action==='create'){fields(data,['v','actorUid','action','pairingId','desktopDeviceName','desktopPublicKeyJwk']);return{...base,action:'create',pairingId,desktopDeviceName:name(data.desktopDeviceName),desktopPublicKeyJwk:pairingPublicKey(data.desktopPublicKeyJwk)};}
  if(data.action==='cancel'){fields(data,['v','actorUid','action','pairingId','creationDigest']);if(!pairingDigestValid(data.creationDigest))throw invalid();return{...base,action:'cancel',pairingId,creationDigest:data.creationDigest};}
  if(data.action==='trust'){fields(data,['v','actorUid','action','pairingId','acceptanceDigest','desktopPublicKeyJwk']);if(!pairingDigestValid(data.acceptanceDigest))throw invalid();return{...base,action:'trust',pairingId,acceptanceDigest:data.acceptanceDigest,desktopPublicKeyJwk:pairingPublicKey(data.desktopPublicKeyJwk)};}
  if(data.action==='accept'){
    fields(data,['v','actorUid','action','pairingId','creationDigest','expiresAt','mobileDeviceId','mobileDeviceName','mobilePublicKeyJwk','encryptedHandshake']);
    if(!pairingDigestValid(data.creationDigest)||!pairingTimeValid(data.expiresAt)||!pairingIdValid(data.mobileDeviceId))throw invalid();
    const cipher=pairingRecord(data.encryptedHandshake);fields(cipher,['iv','data']);
    if(typeof cipher.iv!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(cipher.iv)||typeof cipher.data!=='string'||cipher.data.length<24||cipher.data.length>4096||!/^[A-Za-z0-9_-]+$/.test(cipher.data))throw invalid();
    return{...base,action:'accept',pairingId,creationDigest:data.creationDigest,expiresAt:data.expiresAt,mobileDeviceId:data.mobileDeviceId,mobileDeviceName:name(data.mobileDeviceName),mobilePublicKeyJwk:pairingPublicKey(data.mobilePublicKeyJwk),encryptedHandshake:{iv:cipher.iv,data:cipher.data}};
  }
  throw invalid();
}
export const pairingCommandBytes=(command:PairingCommand)=>canonicalSyncState(parsePairingCommand(command));
/** A response may confirm only this account/command. Status calls cannot claim mutations. */
export function parsePairingOutcome(value:unknown,command:PairingCommand,expectedDigest:string,mode:'apply'|'status'):PairingOutcome{
  const input=parsePairingCommand(command),data=pairingRecord(value),id=input.action==='revoke'?input.deviceId:input.pairingId;
  fields(data,['v','actorUid','action','id','commandDigest','status','createdAt','expiresAt','deviceId','changed']);
  const states={create:['unknown','pending','accepted','trusted','cancelled','expired'],accept:['unknown','pending','accepted','trusted','cancelled','expired'],trust:['unknown','pending','accepted','trusted','cancelled','expired','active','revoked','unavailable'],cancel:['unknown','pending','accepted','trusted','cancelled','expired'],revoke:['unknown','active','revoked']};
  if(!pairingDigestValid(expectedDigest)||data.v!==1||data.actorUid!==input.actorUid||data.action!==input.action||data.id!==id||data.commandDigest!==expectedDigest||typeof data.status!=='string'||!states[input.action].includes(data.status)||typeof data.changed!=='boolean'||!['apply','status'].includes(mode)||mode==='status'&&data.changed)throw invalid();
  if(data.status==='unknown'){if(data.createdAt!==null||data.expiresAt!==null||data.deviceId!==null||data.changed)throw invalid();}
  else if(input.action==='revoke'){if(data.createdAt!==null||data.expiresAt!==null||data.deviceId!==id)throw invalid();}
  else{
    if(!pairingTimeValid(data.createdAt)||data.expiresAt!==data.createdAt+PAIRING_TTL_MS||!pairingTimeValid(data.expiresAt)||data.deviceId!==null&&!pairingIdValid(data.deviceId))throw invalid();
    if(['accepted','trusted','active','revoked','unavailable'].includes(data.status)&&!pairingIdValid(data.deviceId))throw invalid();
  }
  const changedStates={create:'pending',accept:'accepted',trust:'active',cancel:'cancelled',revoke:'revoked'};
  if(data.changed&&data.status!==changedStates[input.action])throw invalid();
  return{v:1,actorUid:input.actorUid,action:input.action,id,commandDigest:expectedDigest,status:data.status as PairingOutcome['status'],createdAt:data.createdAt as number|null,expiresAt:data.expiresAt as number|null,deviceId:data.deviceId as string|null,changed:data.changed};
}
