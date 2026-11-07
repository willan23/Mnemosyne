import {canonicalSyncState, syncHashValid, syncIdValid, syncInteger} from './mobileSyncImportContract';

export interface SyncPublicationRequest {
  envelopeId: string; deviceId: string; direction: 'desktop-to-mobile'|'mobile-to-desktop';
  payloadType: 'memory-snapshot'|'memory-delta'; senderPublicKeyJwk: JsonWebKey;
  encryptedPayload: {iv:string;data:string}; memoryCount:number; tombstoneIds:string[];
  expiresAt:number; expectedDeviceHash:string;
}
export interface SyncPublicationOutcome {
  envelopeId:string;digest:string;status:'unknown'|'published'|'cancelled';createdAt:number|null;
  delivery:'none'|'queued'|'pending'|'complete'|'expired'|'cancelled'|'unavailable';
  imported:number;conflicts:number;
}
const invalid=()=>new Error('Invalid encrypted sync publication');
function record(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw invalid();
  return value as Record<string,unknown>;
}
export function parseSyncPublicKey(value:unknown):JsonWebKey {
  const data=record(value);
  if(Object.keys(data).some(key=>!['kty','crv','x','y','ext','key_ops'].includes(key))||data.kty!=='EC'||data.crv!=='P-256'||
    typeof data.x!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.x)||typeof data.y!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.y)||
    ('ext'in data&&typeof data.ext!=='boolean')||('key_ops'in data&&(!Array.isArray(data.key_ops)||data.key_ops.length!==0)))throw invalid();
  return JSON.parse(JSON.stringify(data)) as JsonWebKey;
}
export function syncDeviceState(value:unknown,uid:string,deviceId:string) {
  const data=record(value);
  if(!syncIdValid(deviceId)||data.ownerUid!==uid||data.deviceId!==deviceId||data.status!=='active')throw invalid();
  return {ownerUid:uid,deviceId,status:'active',publicKeyJwk:parseSyncPublicKey(data.publicKeyJwk),desktopPublicKeyJwk:parseSyncPublicKey(data.desktopPublicKeyJwk)};
}
export function parseSyncPublication(value:unknown):SyncPublicationRequest {
  const data=record(value);
  if(Object.keys(data).sort().join(',')!==['envelopeId','deviceId','direction','payloadType','senderPublicKeyJwk','encryptedPayload','memoryCount','tombstoneIds','expiresAt','expectedDeviceHash'].sort().join(',')||
    !syncIdValid(data.envelopeId)||!syncIdValid(data.deviceId)||!['desktop-to-mobile','mobile-to-desktop'].includes(String(data.direction))||
    !['memory-snapshot','memory-delta'].includes(String(data.payloadType))||(data.direction==='mobile-to-desktop'&&data.payloadType!=='memory-delta')||
    !syncHashValid(data.expectedDeviceHash)||!syncInteger(data.expiresAt)||!syncInteger(data.memoryCount)||data.memoryCount>2500||
    !Array.isArray(data.tombstoneIds)||data.tombstoneIds.length>data.memoryCount||data.tombstoneIds.some(id=>!syncIdValid(id))||new Set(data.tombstoneIds).size!==data.tombstoneIds.length)throw invalid();
  const cipher=record(data.encryptedPayload);
  if(Object.keys(cipher).sort().join(',')!=='data,iv'||typeof cipher.iv!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(cipher.iv)||
    typeof cipher.data!=='string'||cipher.data.length<24||cipher.data.length>900000||cipher.data.length%4===1||!/^[A-Za-z0-9_-]+$/.test(cipher.data))throw invalid();
  return {envelopeId:data.envelopeId,deviceId:data.deviceId,direction:data.direction as SyncPublicationRequest['direction'],payloadType:data.payloadType as SyncPublicationRequest['payloadType'],
    senderPublicKeyJwk:parseSyncPublicKey(data.senderPublicKeyJwk),encryptedPayload:{iv:cipher.iv,data:cipher.data},memoryCount:data.memoryCount,tombstoneIds:[...data.tombstoneIds] as string[],expiresAt:data.expiresAt,expectedDeviceHash:data.expectedDeviceHash};
}
export const syncPublicationBytes=(request:SyncPublicationRequest)=>canonicalSyncState(request);
