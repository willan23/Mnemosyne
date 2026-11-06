import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {changePersonalConnection,recoverPendingPersonalConnection,cancelPendingPersonalConnection,personalConnectionCheckpointKey,type PersonalConnectionClientDeps} from './personalConnections';
import {encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic} from './memoryCrypto';
import {parsePersonalConnectionRequest,personalConnectionRequestBytes,type PersonalConnectionRequest,type PersonalConnectionOutcome} from '../../../functions/src/personalConnectionContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const id='11111111-1111-4111-8111-111111111111';
async function outcome(request:PersonalConnectionRequest,status:PersonalConnectionOutcome['status']):Promise<PersonalConnectionOutcome>{
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(personalConnectionRequestBytes(request)))),n=>n.toString(16).padStart(2,'0')).join('');
  return{operationId:request.operationId,digest:hash,status,changed:status==='committed',createdAt:status==='unknown'?null:1000};
}
function fixture(){
  const storage=new Map<string,string>();const receipts=new Map<string,PersonalConnectionOutcome>();
  const state={uid:'alice',ready:true,enabled:true,listener:()=>undefined as void};
  const deps:PersonalConnectionClientDeps={enabled:()=>state.enabled,id:vi.fn(()=>id),storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);},removeItem:key=>{storage.delete(key);}},
    exclusive:async(_name,work)=>work(),encryptJournal:vi.fn(encryptMemoryFields),decryptJournal:vi.fn(decryptMemoryEnvelope),
    mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:callback=>{state.listener=callback;return vi.fn();}},
    call:vi.fn(async(mode,value)=>{
      if(mode==='prepare')return{...value,sourceHash:'a'.repeat(64),targetHash:'b'.repeat(64)};
      const request=parsePersonalConnectionRequest(value);if(mode==='apply'||mode==='cancel')receipts.set(request.operationId,await outcome(request,mode==='apply'?'committed':'cancelled'));
      return receipts.get(request.operationId)??outcome(request,'unknown');
    })};
  return{deps,state,storage,receipts};
}
const start=(deps:PersonalConnectionClientDeps,guard?:()=>void)=>changePersonalConnection('alice','source','target','link',guard,deps);
beforeEach(()=>{vi.clearAllMocks();setMemoryCryptoMnemonic(words);});afterEach(()=>setMemoryCryptoMnemonic(null));
it('stores a real encrypted UID-bound plan before mutation and double confirms the durable receipt before clearing it',async()=>{
  const f=fixture();const call=f.deps.call;f.deps.call=vi.fn(async(mode,request)=>{
    if(mode!=='prepare'){
      expect(f.storage.size).toBe(1);expect([...f.storage.values()][0]).not.toContain('source');expect([...f.storage.values()][0]).not.toContain('alice');
      const text=(await decryptMemoryEnvelope(JSON.parse([...f.storage.values()][0]))).text;expect(JSON.parse(text)).toMatchObject({v:1,uid:'alice',request});
    }
    return call(mode,request);
  });
  await expect(start(f.deps)).resolves.toMatchObject({status:'committed',operationId:id});expect(f.storage.size).toBe(0);
  expect(vi.mocked(f.deps.call).mock.calls.map(([mode])=>mode)).toEqual(['prepare','status','apply','status']);expect(f.deps.id).toHaveBeenCalledOnce();
});
it('lost apply ACK recovers the original receipt with a closed writing gate, no second preparation, ID or mutation',async()=>{
  const f=fixture();const call=f.deps.call;f.deps.call=vi.fn(async(mode,request)=>{const result=await call(mode,request);if(mode==='apply')throw Error('Synthetic lost ACK');return result;});
  await expect(start(f.deps)).rejects.toThrow();const raw=[...f.storage.values()][0];expect(raw).not.toContain(id);
  await expect(start(f.deps)).rejects.toMatchObject({reason:'pending'});f.state.enabled=false;
  vi.mocked(call).mockClear();f.deps.call=vi.fn(call);await expect(recoverPendingPersonalConnection('alice',f.deps)).resolves.toMatchObject({status:'committed'});
  expect(vi.mocked(f.deps.call).mock.calls.map(([mode])=>mode)).toEqual(['status','status']);expect(f.deps.encryptJournal).toHaveBeenCalledOnce();expect(f.storage.size).toBe(0);
});
it('unknown cancellation leaves a durable cancellation result and keeps exactly the original request',async()=>{
  const f=fixture();const call=f.deps.call;let original:unknown;
  f.deps.call=vi.fn(async(mode,request)=>{if(mode==='status'){original=request;throw Error('Synthetic unavailable');}return call(mode,request);});
  await expect(start(f.deps)).rejects.toThrow();f.state.enabled=false;f.deps.call=vi.fn(async(mode,request)=>{expect(request).toEqual(original);return call(mode,request);});
  await expect(recoverPendingPersonalConnection('alice',f.deps)).rejects.toMatchObject({reason:'pending'});expect(f.storage.size).toBe(1);
  vi.mocked(f.deps.call).mockClear();await expect(cancelPendingPersonalConnection('alice',f.deps)).resolves.toMatchObject({status:'cancelled',changed:false});
  expect(vi.mocked(f.deps.call).mock.calls.map(([mode])=>mode)).toEqual(['status','cancel','status']);expect(f.storage.size).toBe(0);
});
it.each(['closed','owner','locked','write','readback','lock'] as const)('refuses %s before mutation and retains any written checkpoint',async mode=>{
  const f=fixture();if(mode==='closed')f.state.enabled=false;if(mode==='owner')f.state.uid='bob';if(mode==='locked')f.state.ready=false;
  if(mode==='write')f.deps.storage.setItem=()=>{throw Error('Synthetic failed');};if(mode==='readback')f.deps.storage.setItem=()=>undefined;
  if(mode==='lock')f.deps.exclusive=async()=>{throw Error('Synthetic busy');};
  await expect(start(f.deps)).rejects.toThrow();expect(vi.mocked(f.deps.call).mock.calls.some(([mode])=>mode==='apply')).toBe(false);
  if(['closed','owner','locked','lock'].includes(mode))expect(f.deps.call).not.toHaveBeenCalled();
});
it.each(['prepare','encrypt','status','apply','confirm'] as const)('latches account/vault transitions at %s and never clears the journal or continues later calls',async stage=>{
  const f=fixture();const change=()=>{f.state.uid='bob';f.state.listener();f.state.uid='alice';};
  if(stage==='encrypt'){f.deps.encryptJournal=async input=>{const result=await encryptMemoryFields(input);change();return result;};}
  else{const call=f.deps.call;let statuses=0;f.deps.call=vi.fn(async(mode,request)=>{const result=await call(mode,request);if(mode==='status')statuses++;
    if(mode===stage||(stage==='confirm'&&mode==='status'&&statuses===2))change();return result;});}
  await expect(start(f.deps)).rejects.toThrow();
  expect(f.storage.size).toBe(['prepare','encrypt'].includes(stage)?0:1);
  if(['prepare','encrypt','status'].includes(stage))expect(vi.mocked(f.deps.call).mock.calls.some(([mode])=>mode==='apply')).toBe(false);
});
it('a corrupt, wrong-vault or transplanted UID journal fails before RPC; journal replacement during status survives',async()=>{
  for(const mode of ['corrupt','vault','uid','replace']){
    const f=fixture();const call=f.deps.call;f.deps.call=vi.fn(async(mode,request)=>{if(mode==='status')throw Error('Synthetic unavailable');return call(mode,request);});await expect(start(f.deps)).rejects.toThrow();
    const key=personalConnectionCheckpointKey('alice');const raw=f.storage.get(key)!;
    if(mode==='corrupt')f.storage.set(key,'{}');if(mode==='vault')setMemoryCryptoMnemonic([...words].reverse());
    if(mode==='uid'){
      const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);journal.uid='bob';f.storage.set(key,JSON.stringify(await encryptMemoryFields({text:JSON.stringify(journal)})));
    }
    f.deps.call=vi.fn(async(mode,request)=>{const result=await call(mode,request);if(mode==='status')f.storage.set(key,'replacement');return result;});
    await expect(recoverPendingPersonalConnection('alice',f.deps)).rejects.toThrow();expect(f.storage.size).toBe(1);
    if(mode!=='replace')expect(f.deps.call).not.toHaveBeenCalled();else{expect(f.storage.get(key)).toBe('replacement');expect(f.deps.call).toHaveBeenCalledOnce();}
    setMemoryCryptoMnemonic(words);
  }
});
it('mismatched, nonterminal or forged confirmation never removes the recovery plan',async()=>{
  for(const patch of [{digest:'f'.repeat(64)},{operationId:'other'},{changed:'yes'},{createdAt:null},{status:'unknown',changed:false,createdAt:null},{uid:'alice'}]){
    const f=fixture();const call=f.deps.call;let statuses=0;f.deps.call=vi.fn(async(mode,request)=>{const result=await call(mode,request);if(mode==='status'&&++statuses===2)return{...result as object,...patch};return result;});
    await expect(start(f.deps)).rejects.toThrow();expect(f.storage.size).toBe(1);
  }
});
