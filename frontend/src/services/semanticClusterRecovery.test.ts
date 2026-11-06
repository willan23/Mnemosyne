import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},auth:{}}));
import {encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic,isMemoryCryptoReady} from './memoryCrypto';
import {applySemanticClusterBatch,recoverSemanticClusters,cancelPendingSemanticClusters,prepareSemanticClusterComponent,semanticClusterGraphHash,type SemanticClusterDeps} from './semanticClusterRecovery';
import type {StoredSemanticClusterRequest} from './semanticClusterStore';
import {semanticClusterRequestBytes,type SemanticClusterPrepared,type SemanticClusterRequest,type SemanticClusterOutcome} from '../../../functions/src/semanticClusterContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const operationId='11111111-1111-4111-8111-111111111111',prepared:SemanticClusterPrepared={authority:{teamId:null,ownerUid:'alice',teamStateHash:null,epochStateHash:null,keyEpoch:null,keyId:null},dependencies:[{sessionId:'a',authorUid:'alice',stateHash:'a'.repeat(64)}]},patches=[{sessionId:'a',semanticClusterId:'synthetic'}];
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
let uid:string,enabled:boolean,generation:number,stored:Map<string,StoredSemanticClusterRequest>,listeners:Set<()=>void>,teamListeners:Set<()=>void>,receipt:SemanticClusterOutcome|undefined,deps:SemanticClusterDeps;
let loseAck:boolean,failStatus:boolean,refuseDelete:boolean;
const call=vi.fn(),id=vi.fn();
beforeEach(()=>{
  uid='alice';enabled=true;generation=1;stored=new Map();listeners=new Set();teamListeners=new Set();receipt=undefined;loseAck=false;failStatus=false;refuseDelete=false;setMemoryCryptoMnemonic(words);call.mockReset();id.mockReset();id.mockReturnValue(operationId);
  call.mockImplementation(async(mode,command:{actorUid:string;request:unknown})=>{
    expect(command.actorUid).toBe('alice');if(mode==='prepare')return structuredClone(prepared);
    const request=command.request as SemanticClusterRequest,digest=await hash(semanticClusterRequestBytes(request)),base={operationId:request.operationId,teamId:null,digest,status:'unknown' as const,changed:null,dependencyUpdates:null,createdAt:null};
    if(mode==='status'){if(failStatus)throw Error('Status unavailable');return receipt??base;}
    expect(stored.has('alice')).toBe(true);
    receipt=mode==='apply'?{...base,status:'committed',changed:1,dependencyUpdates:[{sessionId:'a',stateHash:'b'.repeat(64)}],createdAt:1000}:{...base,status:'cancelled',createdAt:1000};
    if(mode==='apply'&&loseAck)throw Error('Lost acknowledgement');return receipt;
  });
  deps={enabled:()=>enabled,id,store:{get:async uid=>structuredClone(stored.get(uid)),compareExchange:async(uid,expected,next,guard)=>{guard();expect(stored.has(uid)?JSON.stringify(stored.get(uid)):null).toBe(expected);if(next)stored.set(uid,structuredClone(next));else{if(refuseDelete)throw Error('Removal unavailable');stored.delete(uid);}}},exclusive:async(_name,work)=>work(),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,call,generation:()=>generation,observe:changed=>{teamListeners.add(changed);return()=>{teamListeners.delete(changed);};},mutation:{uid:()=>uid,ready:isMemoryCryptoReady,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}}};
});
afterEach(()=>{setMemoryCryptoMnemonic(null);expect(listeners.size).toBe(0);expect(teamListeners.size).toBe(0);});
it('seals an account-bound request with real AES before any outbound admission and removes only exact confirmed bytes',async()=>{
  const rpc=deps.call;deps.call=async(mode,command)=>{if(mode!=='prepare'){const row=stored.get('alice')!;expect(row.revision).toBe(operationId);expect(JSON.stringify(row)).not.toContain('synthetic');expect(JSON.parse((await decryptMemoryEnvelope(row.enc)).text)).toMatchObject({uid:'alice',request:{operationId,patches}});}return rpc(mode,command);};
  const result=await applySemanticClusterBatch('alice',prepared,patches,()=>{},deps);expect(result.dependencyUpdates).toEqual([{sessionId:'a',stateHash:'b'.repeat(64)}]);expect(stored.size).toBe(0);expect(call.mock.calls.map(row=>row[0])).toEqual(['status','apply','status']);
});
it('lost acknowledgement is recovered with admission closed, retaining nonce and no new calculation',async()=>{
  loseAck=true;await expect(applySemanticClusterBatch('alice',prepared,patches,()=>{},deps)).rejects.toThrow('Lost');const bytes=JSON.stringify(stored.get('alice'));enabled=false;call.mockClear();expect(await recoverSemanticClusters('alice',()=>{},deps)).toEqual(receipt);expect(call.mock.calls.map(row=>row[0])).toEqual(['status','status']);expect(id).toHaveBeenCalledOnce();expect(bytes).toContain(operationId);expect(stored.size).toBe(0);
});
it('unknown pending requests prevent replacement and can be cancelled with admission closed',async()=>{
  failStatus=true;await expect(applySemanticClusterBatch('alice',prepared,patches,()=>{},deps)).rejects.toThrow();const bytes=JSON.stringify(stored.get('alice'));call.mockClear();await expect(applySemanticClusterBatch('alice',prepared,patches,()=>{},deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();enabled=false;failStatus=false;await expect(recoverSemanticClusters('alice',()=>{},deps)).rejects.toThrow();expect(JSON.stringify(stored.get('alice'))).toBe(bytes);expect((await cancelPendingSemanticClusters('alice',()=>{},deps)).status).toBe('cancelled');expect(stored.size).toBe(0);
});
it.each(['account','vault','team','outer'] as const)('a latched %s transition during encryption prevents RPC and preserves journal safety',async change=>{
  let active=true;const encrypt=deps.encrypt;deps.encrypt=async fields=>{const enc=await encrypt(fields);if(change==='account'){uid='bob';listeners.forEach(callback=>callback());uid='alice';}if(change==='vault'){listeners.forEach(callback=>callback());}if(change==='team'){teamListeners.forEach(callback=>callback());}if(change==='outer')active=false;return enc;};await expect(applySemanticClusterBatch('alice',prepared,patches,()=>{if(!active)throw Error('Retired');},deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();expect(stored.size).toBe(0);
});
it('malformed journal header binding or terminal version deltas cannot erase the pending request',async()=>{
  failStatus=true;await expect(applySemanticClusterBatch('alice',prepared,patches,()=>{},deps)).rejects.toThrow();const original=structuredClone(stored.get('alice')!);stored.set('alice',{...original,revision:'22222222-2222-4222-8222-222222222222'});failStatus=false;call.mockClear();await expect(recoverSemanticClusters('alice',()=>{},deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();stored.set('alice',original);const rpc=deps.call;deps.call=async(mode,command)=>{const row=await rpc(mode,command) as SemanticClusterOutcome;return mode==='apply'?{...row,dependencyUpdates:[{sessionId:'foreign',stateHash:'b'.repeat(64)}]}:row;};await expect(recoverSemanticClusters('alice',()=>{},deps)).rejects.toThrow();expect(stored.get('alice')).toEqual(original);
});
it('terminal deletion failure or replacement journal bytes preserve requests and other accounts',async()=>{
  refuseDelete=true;await expect(applySemanticClusterBatch('alice',prepared,patches,()=>{},deps)).rejects.toThrow();const original=stored.get('alice')!;stored.set('bob',{...original,uid:'bob'});refuseDelete=false;const rpc=deps.call;deps.call=async(mode,command)=>{const result=await rpc(mode,command);stored.set('alice',{...original,revision:'replacement'});return result;};await expect(recoverSemanticClusters('alice',()=>{},deps)).rejects.toThrow();expect(stored.get('alice')?.revision).toBe('replacement');expect(stored.get('bob')?.uid).toBe('bob');
});
it('preparation captures graphs by value, validates projected hashes and computes scoped clusters only after admission',async()=>{
  const raw={uid:'alice',teamId:null,connections:[]},graphs=[{id:'a',uid:'alice',teamId:null,connections:[],semanticClusterId:null,graphHash:await semanticClusterGraphHash('a',raw)}];const rpc=deps.call;deps.call=async(mode,command)=>{graphs[0].connections.push('changed' as never);return rpc(mode,command);};const result=await prepareSemanticClusterComponent({uid:'alice',teamId:null,graphs},deps);expect(result.patches[0].semanticClusterId).toMatch(/^semantic:scope-.*:solo-/);expect(call.mock.calls[0][1].request.views[0].graphHash).toBe(await semanticClusterGraphHash('a',raw));expect(stored.size).toBe(0);
});
