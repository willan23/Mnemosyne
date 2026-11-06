import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{}}));
import {removeAcceptedCommsContact,continueCommsContactRemoval,cancelCommsContactRemoval,commsContactRemovalPendingKey,type CommsContactRemovalClientDeps} from './commsContactRemoval';
import {setMemoryCryptoMnemonic,encryptMemoryFields,decryptMemoryEnvelope} from './memoryCrypto';
import {commsContactRemovalBytes,type CommsContactRemovalRequest,type CommsContactRemovalOutcome} from '../../../functions/src/commsContactRemovalContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'],id='11111111-1111-4111-8111-111111111111',key=commsContactRemovalPendingKey('alice');
const selected={peerUid:'bob',anchorId:'old-accepted',anchorUpdatedAt:2};
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
beforeEach(()=>setMemoryCryptoMnemonic(words));
function fixture(){
  const records=new Map<string,string>(),listeners=new Set<()=>void>();
  const state={uid:'alice',ready:true,enabled:true,receipt:null as CommsContactRemovalOutcome|null,begins:0,advances:0,loseAck:false,failBegin:false,failStage:false,storageChanged:()=>{},duringStatus:undefined as undefined|(()=>void)};
  const storage:Storage={get length(){return records.size;},key:index=>[...records.keys()][index]??null,getItem:k=>records.get(k)??null,setItem:(k,value)=>{if(state.failStage)throw Error('Synthetic stage failure');records.set(k,value);},removeItem:k=>records.delete(k),clear:()=>records.clear()};
  const call=vi.fn(async(mode:string,value:unknown)=>{
    const input=value as CommsContactRemovalRequest,base:CommsContactRemovalOutcome={requestId:input.requestId,digest:await hash(commsContactRemovalBytes(input)),status:'unknown',removedCount:0,createdAt:null,updatedAt:null};
    if(mode==='status'){state.duringStatus?.();return state.receipt??base;}
    if(mode==='cancel'){if(state.receipt)return state.receipt;state.receipt={...base,status:'cancelled',removedCount:0,createdAt:1000,updatedAt:1000};return state.receipt;}
    expect(records.get(key)).toBeTruthy();if(mode==='begin'){state.begins++;if(state.failBegin)throw Error('Synthetic begin failure');state.receipt={...base,status:'pending',removedCount:25,createdAt:1000,updatedAt:1000};}
    else{state.advances++;const count=Math.min(61,(state.receipt?.removedCount??0)+25);state.receipt={...base,status:count===61?'complete':'pending',removedCount:count,createdAt:1000,updatedAt:1001};}
    if(state.loseAck)throw Error('Synthetic ACK loss');return state.receipt;
  });
  const deps:CommsContactRemovalClientDeps={enabled:()=>state.enabled,storage,id:vi.fn(()=>id),exclusive:async(_key,work)=>work(),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,call,
    mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:changed=>{listeners.add(changed);return()=>listeners.delete(changed);}},observeStorage:(_uid,changed)=>{state.storageChanged=changed;return()=>{state.storageChanged=()=>{};};}};
  return{records,listeners,state,deps,call};
}
it('closed admission creates no UUID, encrypted journal or RPC',async()=>{
  const f=fixture();f.state.enabled=false;await expect(removeAcceptedCommsContact('alice',selected,()=>{},f.deps)).rejects.toThrow();expect(f.deps.id).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();expect(f.records.size).toBe(0);
});
it('stages only a UID-bound encrypted removal, advances one batch and clears it only after completion',async()=>{
  const f=fixture();expect((await removeAcceptedCommsContact('alice',selected,()=>{},f.deps)).removedCount).toBe(25);const raw=f.records.get(key)!;expect(raw).not.toContain(selected.anchorId);expect(raw).not.toContain('peerUid');expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['ct','iv','v']);
  expect(JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text)).toEqual({v:1,uid:'alice',request:{requestId:id,actorUid:'alice',...selected}});
  f.state.enabled=false;expect((await continueCommsContactRemoval('alice',()=>{},f.deps)).removedCount).toBe(50);expect(f.records.get(key)).toBe(raw);
  expect((await continueCommsContactRemoval('alice',()=>{},f.deps)).status).toBe('complete');expect(f.records.has(key)).toBe(false);expect(f.state.begins).toBe(1);expect(f.state.advances).toBe(2);
});
it('lost begin ACK keeps the same nonce/cipher and continuation with admission closed does not begin again',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(removeAcceptedCommsContact('alice',selected,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key);f.state.enabled=false;f.state.loseAck=false;
  expect((await continueCommsContactRemoval('alice',()=>{},f.deps)).removedCount).toBe(50);expect(f.records.get(key)).toBe(raw);expect(f.state.begins).toBe(1);expect(f.deps.id).toHaveBeenCalledOnce();
});
it('a pending removal refuses a different peer and an unknown intent stays encrypted when admission closes',async()=>{
  const f=fixture();f.state.failBegin=true;await expect(removeAcceptedCommsContact('alice',selected,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key);
  await expect(removeAcceptedCommsContact('alice',{...selected,peerUid:'carol'},()=>{},f.deps)).rejects.toThrow();expect(f.state.begins).toBe(1);f.state.enabled=false;
  await expect(continueCommsContactRemoval('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);
});
it.each(['account','coffer','caller','storage'] as const)('retired %s context preserves the cipher and rejects late removal state',async mode=>{
  const f=fixture();await removeAcceptedCommsContact('alice',selected,()=>{},f.deps);const raw=f.records.get(key);let live=true;
  f.state.duringStatus=()=>{if(mode==='account'){f.state.uid='carol';for(const callback of f.listeners)callback();f.state.uid='alice';}if(mode==='coffer'){f.state.ready=false;for(const callback of f.listeners)callback();f.state.ready=true;}if(mode==='caller')live=false;if(mode==='storage')f.state.storageChanged();};
  await expect(continueCommsContactRemoval('alice',()=>{if(!live)throw Error('Retired');},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);expect(f.state.advances).toBe(0);expect(f.listeners.size).toBe(0);
});
it('wrong coffer, transplanted journal, failed stage and initial storage read send no removal',async()=>{
  const f=fixture();f.state.failStage=true;await expect(removeAcceptedCommsContact('alice',selected,()=>{},f.deps)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();f.state.failStage=false;
  await removeAcceptedCommsContact('alice',selected,()=>{},f.deps);const raw=f.records.get(key)!;f.records.set(commsContactRemovalPendingKey('bob'),raw);f.state.uid='bob';const calls=f.call.mock.calls.length;
  await expect(continueCommsContactRemoval('bob',()=>{},f.deps)).rejects.toThrow();expect(f.call.mock.calls.length).toBe(calls);f.state.uid='alice';setMemoryCryptoMnemonic([...words].reverse());await expect(continueCommsContactRemoval('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);
  const g=fixture(),stop=vi.fn();g.deps.observeStorage=()=>stop;g.deps.storage.getItem=()=>{throw Error('Synthetic read failure');};await expect(continueCommsContactRemoval('alice',()=>{},g.deps)).rejects.toThrow();expect(stop).toHaveBeenCalledOnce();expect(g.listeners.size).toBe(0);
});
it('malformed/foreign server receipts preserve the journal and never advance',async()=>{
  const f=fixture();await removeAcceptedCommsContact('alice',selected,()=>{},f.deps);const raw=f.records.get(key);
  for(const patch of[{digest:'f'.repeat(64)},{requestId:'22222222-2222-4222-8222-222222222222'},{removedCount:-1},{status:'unknown',removedCount:25},{extra:'hidden'}]){
    f.call.mockResolvedValueOnce({...f.state.receipt,...patch});await expect(continueCommsContactRemoval('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);
  }expect(f.state.advances).toBe(0);
});
it('revoked peer is terminal and cross-tab lock refusal creates no second intent',async()=>{
  const f=fixture();await removeAcceptedCommsContact('alice',selected,()=>{},f.deps);f.state.receipt={...f.state.receipt!,status:'revoked'};
  expect((await continueCommsContactRemoval('alice',()=>{},f.deps)).status).toBe('revoked');expect(f.records.has(key)).toBe(false);
  const g=fixture();g.deps.exclusive=async()=>{throw Error('Synthetic held lock');};await expect(removeAcceptedCommsContact('alice',selected,()=>{},g.deps)).rejects.toThrow();expect(g.records.size).toBe(0);expect(g.call).not.toHaveBeenCalled();
});
it('cancels a non-admitted intent with the gate closed, preserving an already admitted removal',async()=>{
  const f=fixture();f.state.failBegin=true;await expect(removeAcceptedCommsContact('alice',selected,()=>{},f.deps)).rejects.toThrow();f.state.enabled=false;
  expect((await cancelCommsContactRemoval('alice',()=>{},f.deps)).status).toBe('cancelled');expect(f.records.has(key)).toBe(false);expect(f.state.advances).toBe(0);
  const g=fixture();await removeAcceptedCommsContact('alice',selected,()=>{},g.deps);const raw=g.records.get(key);g.state.enabled=false;expect((await cancelCommsContactRemoval('alice',()=>{},g.deps)).status).toBe('pending');expect(g.records.get(key)).toBe(raw);expect(g.state.advances).toBe(0);
});
