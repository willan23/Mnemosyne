import {attachmentActorIdValid,attachmentIdValid} from '../../../functions/src/attachmentEnvelope';
import {isEncryptedMemoryEnvelope,type EncryptedMemoryEnvelope} from './memoryCrypto';
export interface StoredCommsP2PPacket {v:1;uid:string;requestId:string;digest:string;bytes:number;createdAt:number;acknowledgedAt:number|null;enc:EncryptedMemoryEnvelope}
/** Opaque native index position; it gives no authority to read/write a packet. */
export interface CommsP2PInboxCursor {uid:string;key:IDBValidKey}
export interface CommsP2PInboxPage {rows:StoredCommsP2PPacket[];next:CommsP2PInboxCursor|null;scanned:number;unavailable:number}
export interface CommsP2PInboxStore {get:(uid:string,id:string)=>Promise<StoredCommsP2PPacket|undefined>;compareExchange:(uid:string,id:string,expected:string|null,next:StoredCommsP2PPacket,guard:()=>void)=>Promise<void>;page:(uid:string,after:CommsP2PInboxCursor|null)=>Promise<CommsP2PInboxPage>;clear:(uid:string,guard:()=>void)=>Promise<void>}
const unavailable=()=>new Error('Não foi possível confirmar a cápsula P2P local.');
const scope=(uid:string,id?:string)=>{if(!attachmentActorIdValid(uid)||id!==undefined&&!attachmentIdValid(id))throw unavailable();};
export function parseStoredCommsP2PPacket(value:unknown,uid:string,id?:string):StoredCommsP2PPacket {
  scope(uid,id);if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();const row=value as StoredCommsP2PPacket;if(Object.keys(row).sort().join(',')!=='acknowledgedAt,bytes,createdAt,digest,enc,requestId,uid,v'||row.v!==1||row.uid!==uid||!attachmentIdValid(row.requestId)||id!==undefined&&row.requestId!==id||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest)||!Number.isSafeInteger(row.bytes)||row.bytes<64||row.bytes>600*1024||!Number.isSafeInteger(row.createdAt)||row.createdAt<1||row.acknowledgedAt!==null&&(!Number.isSafeInteger(row.acknowledgedAt)||row.acknowledgedAt<row.createdAt)||!isEncryptedMemoryEnvelope(row.enc)||Object.keys(row.enc).sort().join(',')!=='ct,iv,v'||JSON.stringify(row.enc).length>1000000)throw unavailable();return structuredClone(row);
}
function cursor(value:CommsP2PInboxCursor|null,uid:string){
  if(value===null)return;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='key,uid'||value.uid!==uid||!Array.isArray(value.key)||value.key.length!==3||value.key[0]!==uid)throw unavailable();
  try{indexedDB.cmp(value.key,value.key);}catch{throw unavailable();}
}
const ownRange=(uid:string)=>IDBKeyRange.bound([uid],[uid+'\u0000'],false,true);
async function open(){return new Promise<IDBDatabase>((resolve,reject)=>{let blocked=false;const request=indexedDB.open('mnemosyne-comms-p2p-inbox-v1',1);request.onupgradeneeded=()=>{const store=request.result.createObjectStore('packets',{keyPath:['uid','requestId']});store.createIndex('timeline',['uid','createdAt','requestId']);};request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result);};request.onerror=()=>reject(unavailable());request.onblocked=()=>{blocked=true;reject(unavailable());};});}
export const commsP2PInboxStore:CommsP2PInboxStore={
  get:async(uid,id)=>{scope(uid,id);const db=await open();try{return await new Promise<StoredCommsP2PPacket|undefined>((resolve,reject)=>{const tx=db.transaction('packets','readonly'),request=tx.objectStore('packets').get([uid,id]);tx.oncomplete=()=>{try{resolve(request.result===undefined?undefined:parseStoredCommsP2PPacket(request.result,uid,id));}catch{reject(unavailable());}};tx.onerror=tx.onabort=()=>reject(unavailable());});}finally{db.close();}},
  compareExchange:async(uid,id,expected,value,guard)=>{scope(uid,id);const next=parseStoredCommsP2PPacket(value,uid,id);guard();const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('packets','readwrite'),store=tx.objectStore('packets'),request=store.get([uid,id]);request.onsuccess=()=>{try{guard();const raw=request.result===undefined?null:JSON.stringify(parseStoredCommsP2PPacket(request.result,uid,id));if(raw!==expected)throw unavailable();store.put(next);}catch{tx.abort();}};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(unavailable());});}finally{db.close();}guard();},
  page:async(uid,after)=>{
    scope(uid);const position=after===null?null:structuredClone(after);cursor(position,uid);const db=await open();
    try{return await new Promise<CommsP2PInboxPage>((resolve,reject)=>{
      const tx=db.transaction('packets','readonly'),range=position?IDBKeyRange.bound([uid],position.key,false,true):ownRange(uid),request=tx.objectStore('packets').index('timeline').openCursor(range,'prev'),rows:StoredCommsP2PPacket[]=[];
      let scanned=0,missing=0,more=false,last:CommsP2PInboxCursor|null=null;
      request.onsuccess=()=>{try{
        const current=request.result;if(!current)return;if(scanned===10){more=true;return;}
        last={uid,key:structuredClone(current.key)};cursor(last,uid);scanned++;
        try{rows.push(parseStoredCommsP2PPacket(current.value,uid));}catch{missing++;}
        current.continue();
      }catch{tx.abort();}};
      tx.oncomplete=()=>resolve({rows,next:more?last:null,scanned,unavailable:missing});
      tx.onerror=tx.onabort=()=>reject(unavailable());
    });}finally{db.close();}
  },
  clear:async(uid,guard)=>{scope(uid);guard();const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('packets','readwrite');try{guard();tx.objectStore('packets').delete(ownRange(uid));}catch{tx.abort();}tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(unavailable());});}finally{db.close();}guard();},
};
