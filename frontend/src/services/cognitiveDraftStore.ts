import type {EncryptedMemoryEnvelope} from './memoryCrypto';

export interface StoredCognitiveDraft{v:1;uid:string;revision:string;enc:EncryptedMemoryEnvelope}
export interface CognitiveDraftStore{
  get:(uid:string)=>Promise<StoredCognitiveDraft|undefined>;
  compareExchange:(uid:string,expected:string|null,next:StoredCognitiveDraft|null,guard:()=>void)=>Promise<void>;
}
const failure=()=>new Error('Não foi possível confirmar o rascunho local.');
async function open(){return new Promise<IDBDatabase>((resolve,reject)=>{
  let blocked=false;const request=indexedDB.open('mnemosyne-cognitive-drafts-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
  request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result);};
  request.onerror=()=>reject(failure());request.onblocked=()=>{blocked=true;reject(failure());};
});}
export const cognitiveDraftStore:CognitiveDraftStore={
  get:async uid=>{const db=await open();try{return await new Promise<StoredCognitiveDraft|undefined>((resolve,reject)=>{
    const tx=db.transaction('drafts','readonly'),request=tx.objectStore('drafts').get(uid);
    tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(failure());
  });}finally{db.close();}},
  compareExchange:async(uid,expected,next,guard)=>{const db=await open();try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),request=store.get(uid);
    request.onsuccess=()=>{try{guard();if((request.result?JSON.stringify(request.result):null)!==expected)throw failure();
      if(next===null)store.delete(uid);else store.put(next,uid);
    }catch{tx.abort();}};
    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(failure());
  });}finally{db.close();}},
};
/** Elimination is UID exact and never reads/decrypts another account. */
export async function clearCognitiveDraft(uid:string,guard:()=>void){
  guard();const db=await open();try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite');try{guard();tx.objectStore('drafts').delete(uid);}catch{tx.abort();}
    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(failure());
  });}finally{db.close();}guard();
}
