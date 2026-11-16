import {importPublicKey,rsaEncrypt,rsaDecrypt,encryptBytesAesGcm} from '../utils/crypto';
import {COMMS_DELIVERY_MAX_TEXT_BYTES,COMMS_DELIVERY_MAX_ATTACHMENT_BYTES,COMMS_DELIVERY_MAX_WIRE_BYTES,COMMS_DELIVERY_MAX_CIPHER_BYTES} from '../../../functions/src/commsDeliveryContract';
import {parseCommsP2PSdp,parseCommsP2PIce} from '../../../functions/src/commsP2PContract';

export const COMMS_MAX_MESSAGE_BYTES=COMMS_DELIVERY_MAX_TEXT_BYTES;
export const COMMS_MAX_ATTACHMENT_BYTES=COMMS_DELIVERY_MAX_ATTACHMENT_BYTES;
export const COMMS_MAX_ENVELOPE_BYTES=COMMS_DELIVERY_MAX_WIRE_BYTES;
const MAX_PAYLOAD_BYTES=COMMS_DELIVERY_MAX_CIPHER_BYTES;
export class CommsTransportError extends Error {constructor(){super('Não foi possível validar ou transmitir a cápsula.');}}
export interface CommsEnvelope {encryptedKey:string;encryptedPayload:string;payloadIv:string;hasAttachment:boolean;attachmentName:string|null}
export interface CommsAttachment {name:string;type:string;size:number;dataUrl:string}
export interface CommsComposition {message:string;attachment:File|null;publicKeyPem:string;fingerprint:string}
const fail=():never=>{throw new CommsTransportError();};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail();
const exact=(value:Record<string,unknown>,keys:string[])=>{if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail();};
const bytesToBase64=(bytes:Uint8Array)=>{const chunks:string[]=[];for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));return btoa(chunks.join(''));};
function bytes(value:unknown,minimum:number,maximum:number):Uint8Array<ArrayBuffer> {
  if(typeof value!=='string'||value.length>4*Math.ceil(maximum/3)||value.length%4!==0||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return fail();
  let binary:string;try{binary=atob(value);}catch{return fail();}
  if(binary.length<minimum||binary.length>maximum||btoa(binary)!==value)return fail();
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
const textBytes=(value:unknown,maximum:number)=>{if(typeof value!=='string'||value.length>maximum||new TextEncoder().encode(value).length>maximum)fail();return value as string;};
const name=(value:unknown)=>{if(typeof value!=='string'||value.length<1||value.length>180||/[/\\]/.test(value)||Array.from(value).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))fail();return value as string;};
const mime=(value:unknown)=>{if(typeof value!=='string'||value.length>120||!/^[-a-z0-9]+\/[-a-z0-9.+]+$/.test(value))fail();return value as string;};
export function validateCommsComposition(input:CommsComposition):void {
  const message=textBytes(input.message,COMMS_MAX_MESSAGE_BYTES);if(!message.trim()&&!input.attachment)fail();
  if(typeof input.publicKeyPem!=='string'||input.publicKeyPem.length>2000||!/^[a-f0-9]{64}$/.test(input.fingerprint))fail();
  if(input.attachment){if(!Number.isSafeInteger(input.attachment.size)||input.attachment.size<0||input.attachment.size>COMMS_MAX_ATTACHMENT_BYTES)fail();name(input.attachment.name);mime(input.attachment.type||'application/octet-stream');}
}
export function validateCommsEnvelope(value:unknown):void {
  const data=object(value);if(new TextEncoder().encode(JSON.stringify(data)).length>COMMS_MAX_ENVELOPE_BYTES)fail();
  if(data.encryptedData!==undefined){if(data.encryptedKey!==undefined||data.encryptedPayload!==undefined||data.payloadIv!==undefined)fail();bytes(data.encryptedData,256,512);return;}
  bytes(data.encryptedKey,256,512);bytes(data.encryptedPayload,16,MAX_PAYLOAD_BYTES);bytes(data.payloadIv,12,12);
  if(typeof data.hasAttachment!=='boolean'||(data.hasAttachment?typeof data.attachmentName!=='string':data.attachmentName!==null))fail();
  if(data.hasAttachment)name(data.attachmentName);
}
export async function encryptCommsEnvelope(input:CommsComposition,guard:()=>void):Promise<CommsEnvelope> {
  // Copy primitives/File handle before the first asynchronous boundary.
  const captured={...input};guard();validateCommsComposition(captured);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(captured.publicKeyPem));guard();
  if(Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')!==captured.fingerprint)fail();
  const publicKey=await importPublicKey(captured.publicKeyPem);guard();
  const algorithm=publicKey.algorithm as RsaHashedKeyAlgorithm;
  if(algorithm.name!=='RSA-OAEP'||algorithm.hash.name!=='SHA-256'||algorithm.modulusLength<2048||algorithm.modulusLength>4096||bytesToBase64(algorithm.publicExponent)!=='AQAB')fail();
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);guard();
  const raw=await crypto.subtle.exportKey('raw',key);guard();const encryptedKey=await rsaEncrypt(bytesToBase64(new Uint8Array(raw)),publicKey);guard();
  let attachment:Record<string,unknown>|null=null;
  if(captured.attachment){const original=await captured.attachment.arrayBuffer();guard();if(original.byteLength!==captured.attachment.size||original.byteLength>COMMS_MAX_ATTACHMENT_BYTES)fail();const sealed=await encryptBytesAesGcm(original,key);guard();attachment={name:captured.attachment.name,type:captured.attachment.type||'application/octet-stream',size:original.byteLength,iv:sealed.iv,data:bytesToBase64(new Uint8Array(sealed.cipherBytes))};}
  const plain=new TextEncoder().encode(JSON.stringify({message:captured.message,attachment}));if(plain.byteLength+16>MAX_PAYLOAD_BYTES)fail();
  const sealed=await encryptBytesAesGcm(plain.buffer as ArrayBuffer,key);guard();
  const result={encryptedKey,encryptedPayload:bytesToBase64(new Uint8Array(sealed.cipherBytes)),payloadIv:sealed.iv,hasAttachment:attachment!==null,attachmentName:captured.attachment?.name??null};validateCommsEnvelope(result);guard();return result;
}
export async function decryptCommsEnvelope(value:unknown,privateKey:CryptoKey,guard:()=>void):Promise<{message:string;attachment:CommsAttachment|null}> {
  guard();validateCommsEnvelope(value);const data=object(value);
  if(data.encryptedData!==undefined){const message=await rsaDecrypt(data.encryptedData as string,privateKey);guard();return{message:textBytes(message,COMMS_MAX_MESSAGE_BYTES),attachment:null};}
  const raw=await rsaDecrypt(data.encryptedKey as string,privateKey);guard();const key=await crypto.subtle.importKey('raw',bytes(raw,32,32),{name:'AES-GCM'},false,['decrypt']);guard();
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(data.payloadIv,12,12)},key,bytes(data.encryptedPayload,16,MAX_PAYLOAD_BYTES));guard();
  let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}catch{return fail();}const payload=object(parsed);exact(payload,['message','attachment']);const message=textBytes(payload.message,COMMS_MAX_MESSAGE_BYTES);
  if(payload.attachment===null){if(data.hasAttachment!==false)fail();return{message,attachment:null};}
  if(data.hasAttachment!==true)fail();const attachment=object(payload.attachment);exact(attachment,['name','type','size','iv','data']);const filename=name(attachment.name),type=mime(attachment.type);if(filename!==data.attachmentName||!Number.isSafeInteger(attachment.size)||(attachment.size as number)<0||(attachment.size as number)>COMMS_MAX_ATTACHMENT_BYTES)fail();
  const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(attachment.iv,12,12)},key,bytes(attachment.data,16,COMMS_MAX_ATTACHMENT_BYTES+16));guard();if(decoded.byteLength!==attachment.size)fail();
  // Downloads receive an inert MIME type; untrusted transmitted MIME cannot become a navigable HTML/SVG data URL.
  const safeType=/^(image\/(png|jpeg|gif|webp)|text\/plain|application\/pdf)$/.test(type)?type:'application/octet-stream';
  return{message,attachment:{name:filename,type:safeType,size:decoded.byteLength,dataUrl:`data:${safeType};base64,${bytesToBase64(new Uint8Array(decoded))}`}};
}
export function parseCommsP2PMessage(value:unknown,senderId:string,recipientId:string):Record<string,unknown> {
  if(typeof value!=='string'||value.length>COMMS_MAX_ENVELOPE_BYTES||new TextEncoder().encode(value).length>COMMS_MAX_ENVELOPE_BYTES)fail();
  let parsed:unknown;try{parsed=JSON.parse(value as string);}catch{return fail();}const data=object(parsed);
  exact(data,['type','senderId','recipientId','encryptedKey','encryptedPayload','payloadIv','hasAttachment','attachmentName','timestamp','status']);
  if(data.type!=='mnemosyne-transmission'||data.senderId!==senderId||data.recipientId!==recipientId||data.status!=='p2p'||!Number.isSafeInteger(data.timestamp)||(data.timestamp as number)<0)fail();validateCommsEnvelope(data);return data;
}
export function validateCommsSdp(value:unknown,type:'offer'|'answer'):ReturnType<typeof parseCommsP2PSdp> {try{return parseCommsP2PSdp(value,type);}catch{return fail();}}
export function validateCommsIce(value:unknown):ReturnType<typeof parseCommsP2PIce> {try{return parseCommsP2PIce(value);}catch{return fail();}}
