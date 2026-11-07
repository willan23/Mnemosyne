import type {EncryptedMemoryEnvelope} from './memoryCrypto';
export interface StoredTeamHistoryChange{v:1;uid:string;teamId:string;revision:string;enc:EncryptedMemoryEnvelope}
export interface TeamHistoryChangeStore{
  get:(uid:string,teamId:string)=>Promise<StoredTeamHistoryChange|undefined>;
  compareExchange:(uid:string,teamId:string,expected:string|null,next:StoredTeamHistoryChange|null,guard:()=>void)=>Promise<void>;
  teams:(uid:string,limit:number,after?:string)=>Promise<string[]>;
}
const fail=()=>Error('Não foi possível confirmar o pedido cifrado do histórico.');
async function open(){return new Promise<IDBDatabase>((resolve,reject)=>{let blocked=false;const request=indexedDB.open('mnemosyne-team-history-changes-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('requests');request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result);};request.onerror=()=>reject(fail());request.onblocked=()=>{blocked=true;reject(fail());};});}
async function transaction<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await open();try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction('requests',mode),request=work(tx.objectStore('requests'));tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(fail());});}finally{db.close();}}
export const teamHistoryChangeStore:TeamHistoryChangeStore={
  get:(uid,teamId)=>transaction('readonly',store=>store.get([uid,teamId])),
  compareExchange:async(uid,teamId,expected,next,guard)=>{const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('requests','readwrite'),store=tx.objectStore('requests'),request=store.get([uid,teamId]);request.onsuccess=()=>{try{guard();if((request.result?JSON.stringify(request.result):null)!==expected)throw fail();if(next===null)store.delete([uid,teamId]);else store.put(next,[uid,teamId]);}catch{tx.abort();}};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(fail());});}finally{db.close();}},
  teams:async(uid,limit,after)=>{if(!uid||!Number.isSafeInteger(limit)||limit<1||limit>50||after!==undefined&&(!after||after.includes('/')))throw fail();const keys=await transaction('readonly',store=>store.getAllKeys(IDBKeyRange.bound(after?[uid,after]:[uid],[uid,[]],Boolean(after),true),limit));return keys.map(key=>{if(!Array.isArray(key)||key.length!==2||key[0]!==uid||typeof key[1]!=='string'||!key[1]||key[1].includes('/'))throw fail();return key[1];});},
};
export async function clearTeamHistoryChangeRequests(uid:string,guard:()=>void){if(!uid)throw fail();guard();await transaction('readwrite',store=>{guard();return store.delete(IDBKeyRange.bound([uid],[uid,[]],false,true));});guard();}
