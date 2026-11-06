import {attachmentIdValid,attachmentActorIdValid} from './attachmentEnvelope';
export type CommsIdentityCall='prepare'|'apply'|'status'|'cancel';
export interface CommsIdentityCommand{actorUid:string;request:CommsIdentityRolloverRequest|Record<string,never>}
export interface CommsIdentityBaseline{userStateHash:string;profileStateHash:string;priorFingerprint:string}
export interface CommsIdentityRolloverRequest{operationId:string;baseline:CommsIdentityBaseline;publicKeyPem:string}
export interface CommsIdentityRolloverOutcome{operationId:string;digest:string;fingerprint:string;status:'unknown'|'committed'|'cancelled';current:boolean;createdAt:number|null}
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Invalid identity contract');
}
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function parseCommsIdentityPreparation(value:unknown){exact(value,[]);return{};}
export function parseCommsIdentityBaseline(value:unknown):CommsIdentityBaseline{
  exact(value,['userStateHash','profileStateHash','priorFingerprint']);if(!Object.values(value).every(digest))throw Error('Invalid identity baseline');
  return{userStateHash:value.userStateHash as string,profileStateHash:value.profileStateHash as string,priorFingerprint:value.priorFingerprint as string};
}
export function parseCommsIdentityRollover(value:unknown):CommsIdentityRolloverRequest{
  exact(value,['operationId','baseline','publicKeyPem']);if(!attachmentIdValid(value.operationId)||typeof value.publicKeyPem!=='string'||value.publicKeyPem.length>2000||
    !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/]+={0,2}\n-----END PUBLIC KEY-----$/.test(value.publicKeyPem))throw Error('Invalid public identity');
  return{operationId:value.operationId as string,baseline:parseCommsIdentityBaseline(value.baseline),publicKeyPem:value.publicKeyPem};
}
export const commsIdentityRequestBytes=(value:CommsIdentityRolloverRequest)=>JSON.stringify(parseCommsIdentityRollover(value));
/** Transport authority is bound separately from the stable receipt/journal bytes. */
export function parseCommsIdentityCommand(mode:CommsIdentityCall,value:unknown):CommsIdentityCommand{
  exact(value,['actorUid','request']);if(!attachmentActorIdValid(value.actorUid)||!['prepare','apply','status','cancel'].includes(mode))throw Error('Invalid identity command');
  return{actorUid:value.actorUid as string,request:mode==='prepare'?parseCommsIdentityPreparation(value.request):parseCommsIdentityRollover(value.request)};
}
