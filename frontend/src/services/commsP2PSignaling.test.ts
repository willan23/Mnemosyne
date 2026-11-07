import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {setMemoryCryptoMnemonic,encryptMemoryFields,decryptMemoryEnvelope} from './memoryCrypto';
import {mutateCommsP2PSignal,recoverCommsP2PSignal,cancelCommsP2PSignal,closeStoredCommsP2PSession,reconcileStoredCommsP2PSession,commsP2PPendingKey,commsP2PSessionKey,commsP2PHash,readCommsP2PSignal,watchCommsP2PSignal,type CommsP2PClientDeps} from './commsP2PSignaling';
import {commsP2PMutationBytes,commsP2POfferBytes,type CommsP2PMutation,type CommsP2POutcome} from '../../../functions/src/commsP2PContract';
vi.mock('../firebase',()=>({default:{}}));vi.mock('firebase/functions',()=>({getFunctions:vi.fn(),httpsCallable:vi.fn()}));
const id='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222',offer={type:'offer' as const,sdp:'v=0 synthetic SDP'},words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const key=commsP2PPendingKey('alice'),sessionKey=commsP2PSessionKey('alice');
async function fixture(){
  const records=new Map<string,string>(),state={uid:'alice',ready:true,enabled:true,lostAck:false,failApply:false,receipt:null as CommsP2POutcome|null,applies:0},input={roomId:id,callerUid:'alice',calleeUid:'bob',callerFingerprint:'a'.repeat(64),calleeFingerprint:'b'.repeat(64),offerDigest:await commsP2PHash(commsP2POfferBytes(offer)),kind:'create' as const,signal:{...offer}};
  let change=()=>{},tick=()=>{},storageChange=()=>{};const storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>records.set(key,value),removeItem:(key:string)=>records.delete(key)} as unknown as Storage;
  const call=vi.fn(async(mode:string,value:unknown)=>{const input=value as CommsP2PMutation&{digest:string};if(mode==='status')return state.receipt??{operationId:input.operationId,digest:input.digest,status:'unknown',roomStatus:'unknown',createdAt:null,updatedAt:null};if(mode==='read')return{...input,status:'offer',createdAt:1000,updatedAt:1000,expiresAt:601000,offer,answer:null,candidates:[]};
    if(mode==='apply'){state.applies++;expect(records.has(key)).toBe(true);if(state.failApply)throw Error();state.receipt={operationId:input.operationId,digest:await commsP2PHash(commsP2PMutationBytes(input)),status:'applied',roomStatus:input.kind==='create'?'offer':'active',createdAt:1000,updatedAt:1000};if(state.lostAck){state.lostAck=false;throw Error();}return state.receipt;}
    state.receipt={operationId:input.operationId,digest:input.digest,status:'cancelled',roomStatus:'closed',createdAt:1000,updatedAt:1000};return state.receipt;
  });
  const deps:CommsP2PClientDeps={enabled:()=>state.enabled,storage,id:()=>operationId,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,exclusive:async(_name,work)=>work(),call:call as CommsP2PClientDeps['call'],observeStorage:(_uid,listener)=>{storageChange=listener;return()=>{};},mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:listener=>{change=listener;return()=>{};}},setInterval:fn=>{tick=fn as()=>void;return 1;},clearInterval:vi.fn()};
  return{records,state,input,deps,call,change:()=>change(),storageChange:()=>storageChange(),tick:()=>tick()};
}
beforeEach(()=>setMemoryCryptoMnemonic(words));afterEach(()=>{setMemoryCryptoMnemonic(null);vi.clearAllMocks();});
it('writes an encrypted exact request before RPC and retains a guarded session handle after confirmation',async()=>{
  const f=await fixture();expect((await mutateCommsP2PSignal('alice',f.input,()=>{},f.deps)).status).toBe('applied');expect(f.records.has(key)).toBe(false);const raw=f.records.get(sessionKey)!;expect(raw).toBeTruthy();expect(raw.includes('sdp')).toBe(false);const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);expect(journal.request.operationId).toBe(id);expect(journal.request.actorUid).toBe('alice');await expect(mutateCommsP2PSignal('alice',{...f.input,roomId:operationId},()=>{},f.deps)).rejects.toThrow();expect(f.state.applies).toBe(1);
});
it('recovers a lost acknowledgement with a closed gate without publishing another room',async()=>{
  const f=await fixture();f.state.lostAck=true;await expect(mutateCommsP2PSignal('alice',f.input,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;f.state.enabled=false;expect((await recoverCommsP2PSignal('alice',()=>{},f.deps)).status).toBe('applied');expect(f.state.applies).toBe(1);expect(f.records.get(sessionKey)).toBe(raw);expect(f.records.has(key)).toBe(false);
});
it('unknown closed-gate recovery preserves the request and cancellation uses only a descriptor',async()=>{
  const f=await fixture();f.state.failApply=true;await expect(mutateCommsP2PSignal('alice',f.input,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;f.state.enabled=false;await expect(recoverCommsP2PSignal('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);expect((await cancelCommsP2PSignal('alice',()=>{},f.deps)).status).toBe('cancelled');const request=f.call.mock.calls.find(row=>row[0]==='cancel')?.[1] as Record<string,unknown>;expect(request.actorUid).toBe('alice');expect(request.signal).toBeUndefined();expect(f.records.has(key)).toBe(false);
});
it('closes the stored room after local peer loss without requiring the creation gate',async()=>{
  const f=await fixture();await mutateCommsP2PSignal('alice',f.input,()=>{},f.deps);f.state.receipt=null;f.state.enabled=false;expect((await closeStoredCommsP2PSession('alice',()=>{},f.deps)).roomStatus).toBe('closed');expect(f.state.applies).toBe(1);expect(f.records.has(sessionKey)).toBe(false);expect(f.records.has(key)).toBe(false);expect(f.call.mock.calls.find(row=>row[0]==='cancel')?.[1]).toMatchObject({kind:'close',roomId:id,operationId});
});
it('wrong coffer, storage transplant and observed account round trip cannot clear or replay a pending signal',async()=>{
  const f=await fixture();f.state.failApply=true;await expect(mutateCommsP2PSignal('alice',f.input,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;setMemoryCryptoMnemonic([...words].reverse());await expect(recoverCommsP2PSignal('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);setMemoryCryptoMnemonic(words);
  const real=f.deps.call;let finish!:(value:unknown)=>void;f.deps.call=async()=>new Promise(resolve=>finish=resolve);const pending=recoverCommsP2PSignal('alice',()=>{},f.deps);await vi.waitFor(()=>expect(finish).toBeDefined());f.state.uid='carol';f.change();f.state.uid='alice';finish({});await expect(pending).rejects.toThrow();expect(f.records.get(key)).toBe(raw);f.deps.call=real;
  f.records.set(commsP2PPendingKey('bob'),raw);f.state.uid='bob';await expect(recoverCommsP2PSignal('bob',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(commsP2PPendingKey('bob'))).toBe(raw);
});
it('failed session-handle write preserves the remotely applied pending journal',async()=>{
  const f=await fixture(),set=f.deps.storage.setItem;f.deps.storage.setItem=(key,value)=>{if(key===sessionKey)throw Error();set(key,value);};await expect(mutateCommsP2PSignal('alice',f.input,()=>{},f.deps)).rejects.toThrow();expect(f.state.applies).toBe(1);expect(f.records.has(key)).toBe(true);expect(f.records.has(sessionKey)).toBe(false);
});
it('an admitted caller can journal a candidate and update the same stored-session binding',async()=>{
  const f=await fixture();await mutateCommsP2PSignal('alice',f.input,()=>{},f.deps);f.state.receipt=null;const result=await mutateCommsP2PSignal('alice',{...f.input,kind:'candidate',signal:{candidate:'candidate:synthetic',sdpMid:'0',sdpMLineIndex:0,usernameFragment:'test'}},()=>{},f.deps);expect(result.status).toBe('applied');expect(f.state.applies).toBe(2);const stored=JSON.parse((await decryptMemoryEnvelope(JSON.parse(f.records.get(sessionKey)!))).text);expect(stored.request.kind).toBe('candidate');expect(stored.request.roomId).toBe(id);
});
it('read validates the offer digest and captured participant before publishing session data',async()=>{
  const f=await fixture(),binding={...f.input,actorUid:'alice'};const {kind,signal,...base}=binding;expect(kind).toBe('create');expect(signal.type).toBe('offer');expect((await readCommsP2PSignal('alice',base,()=>{},f.deps)).offer).toEqual(offer);f.deps.call=async()=>({...base,status:'offer',createdAt:1000,updatedAt:1000,expiresAt:601000,offer:{type:'offer',sdp:'changed'},answer:null,candidates:[]});await expect(readCommsP2PSignal('alice',base,()=>{},f.deps)).rejects.toThrow();
});
it('an observer serializes reads and stopped callbacks cannot publish session or failure',async()=>{
  const f=await fixture();let finish!:(value:unknown)=>void;f.deps.call=async()=>new Promise(resolve=>finish=resolve);const changed=vi.fn(),failed=vi.fn(),{kind,signal,...base}=f.input;expect(kind).toBe('create');expect(signal.type).toBe('offer');const stop=watchCommsP2PSignal('alice',{...base,actorUid:'alice'},()=>{},changed,failed,f.deps);await vi.waitFor(()=>expect(finish).toBeDefined());f.tick();stop();finish({});await Promise.resolve();await Promise.resolve();expect(changed).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();expect(f.deps.clearInterval).toHaveBeenCalledOnce();
});
it('authoritative terminal room reconciliation removes only the session handle without another write',async()=>{
  for(const roomStatus of ['closed','expired','unknown','revoked'] as const){
    const f=await fixture();await mutateCommsP2PSignal('alice',f.input,()=>{},f.deps);const raw=f.records.get(sessionKey);f.state.enabled=false;
    f.records.set('mnemosyne:comms-p2p-content:v1:alice','Synthetic encrypted pending packet');f.state.receipt={...f.state.receipt!,roomStatus};
    expect((await reconcileStoredCommsP2PSession('alice',()=>{},f.deps))?.roomStatus).toBe(roomStatus);expect(raw).toBeTruthy();expect(f.records.has(sessionKey)).toBe(false);expect(f.records.get('mnemosyne:comms-p2p-content:v1:alice')).toBe('Synthetic encrypted pending packet');expect(f.state.applies).toBe(1);expect(f.call.mock.calls.some(row=>row[0]==='cancel')).toBe(false);
  }
});
it('active rooms and pending signaling remain guarded during reconciliation',async()=>{
  const f=await fixture();await mutateCommsP2PSignal('alice',f.input,()=>{},f.deps);const raw=f.records.get(sessionKey)!;
  expect((await reconcileStoredCommsP2PSession('alice',()=>{},f.deps))?.roomStatus).toBe('offer');expect(f.records.get(sessionKey)).toBe(raw);
  f.records.set(key,raw);await expect(reconcileStoredCommsP2PSession('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(sessionKey)).toBe(raw);expect(f.records.get(key)).toBe(raw);
});
it('late terminal status after account ABA or local handle replacement cannot clear the handle',async()=>{
  const f=await fixture();await mutateCommsP2PSignal('alice',f.input,()=>{},f.deps);const raw=f.records.get(sessionKey)!;let finish!:(value:unknown)=>void;
  f.deps.call=async()=>new Promise(resolve=>{finish=resolve;});const pending=reconcileStoredCommsP2PSession('alice',()=>{},f.deps);await vi.waitFor(()=>expect(finish).toBeDefined());f.state.uid='carol';f.change();f.state.uid='alice';finish({...f.state.receipt!,roomStatus:'closed'});await expect(pending).rejects.toThrow();expect(f.records.get(sessionKey)).toBe(raw);
  const second=reconcileStoredCommsP2PSession('alice',()=>{},f.deps);const previous=finish;await vi.waitFor(()=>expect(finish).not.toBe(previous));f.records.set(sessionKey,'Synthetic replacement');finish({...f.state.receipt!,roomStatus:'closed'});await expect(second).rejects.toThrow();expect(f.records.get(sessionKey)).toBe('Synthetic replacement');
});
