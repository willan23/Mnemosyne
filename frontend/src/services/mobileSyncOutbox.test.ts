import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {queuePersonalSyncDelta,recoverPendingSyncOutbox,cancelPendingSyncOutbox,mobileSyncOutboxKey,mobileSyncIndexKey,type SyncOutboxDeps} from './mobileSyncOutbox';
import {canonicalSyncState} from '../../../functions/src/mobileSyncImportContract';
import type {SyncPublicationRequest,SyncPublicationOutcome} from '../../../functions/src/mobileSyncPublicationContract';
import type {SessionData} from '../hooks/useSessions';
const publicKey={kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'B'.repeat(43),ext:true,key_ops:[]};
const enc={v:1 as const,iv:'A'.repeat(16),ct:'B'.repeat(32)};
const memory=(id='note',updatedAt=20):SessionData=>({id,uid:'alice',text:'Synthetic private text',title:'Synthetic private title',timestamp:10,updatedAt,tags:['Synthetic']});
const hash=(value:unknown)=>createHash('sha256').update(canonicalSyncState(value)).digest('hex');
function fixture(){
  const storage=new Map<string,string>();const journals=new Map<string,string>();let cipherId=0;let envelopeId=0;
  let uid:string|null='alice';let ready=true;let enabled=true;let changed=()=>{};let observed:((value:unknown)=>void)|undefined;
  let known:SyncPublicationOutcome|null=null;let loseAck=false;
  const device={ownerUid:'alice',deviceId:'phone',status:'active',publicKeyJwk:publicKey,desktopPublicKeyJwk:publicKey};
  const requests:SyncPublicationRequest[]=[];const payloads:unknown[]=[];const stop=vi.fn();
  const deps:SyncOutboxDeps={enabled:()=>enabled,id:()=>`envelope-${++envelopeId}`,now:()=>1000,
    storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);},removeItem:key=>{storage.delete(key);}},exclusive:async(_key,work)=>work(),
    device:vi.fn(async()=>device),observeDevice:vi.fn((_id,callback)=>{observed=callback;return stop;}),digest:vi.fn(async value=>hash(value)),
    encryptJournal:async value=>{const cipher={...enc,ct:String(++cipherId).padEnd(32,'B')};journals.set(cipher.ct,value.text);return cipher;},
    decryptJournal:async cipher=>({text:journals.get(cipher.ct)!,title:null}),
    seal:vi.fn(async value=>{payloads.push(structuredClone(value));return {senderPublicKeyJwk:publicKey,encryptedPayload:{iv:'A'.repeat(16),data:String(payloads.length).padEnd(32,'B')}};}),
    mutation:{uid:()=>uid,ready:()=>ready,subscribe:callback=>{changed=callback;return ()=>{};}},
    call:vi.fn(async(mode,request)=>{
      if(mode==='status')return known?{...known}:{envelopeId:request.envelopeId,digest:hash(request),status:'unknown',createdAt:null,delivery:'none',imported:0,conflicts:0};
      if(mode==='cancel'){
        if(known&&['pending','complete'].includes(known.delivery))return {...known};
        known={envelopeId:request.envelopeId,digest:hash(request),status:'cancelled',createdAt:1000,delivery:'cancelled',imported:0,conflicts:0};return {...known};
      }
      requests.push(structuredClone(request));known={envelopeId:request.envelopeId,digest:hash(request),status:'published',createdAt:1000,delivery:'queued',imported:0,conflicts:0};
      if(loseAck){loseAck=false;throw new Error('Synthetic lost ACK');}return {...known};
    })};
  const key=mobileSyncOutboxKey('alice','phone','desktop-to-mobile');const indexKey=mobileSyncIndexKey('alice','phone','desktop-to-mobile');
  const run=(sessions=[memory()])=>queuePersonalSyncDelta('alice','phone','desktop-to-mobile',sessions,undefined,deps);
  const recover=()=>recoverPendingSyncOutbox('alice','phone','desktop-to-mobile',deps);
  const cancel=()=>cancelPendingSyncOutbox('alice','phone','desktop-to-mobile',deps);
  return {deps,storage,journals,requests,payloads,key,indexKey,device,stop,run,recover,cancel,
    loseAck:()=>{loseAck=true;},gate:(value:boolean)=>{enabled=value;},account:(value:string|null)=>{uid=value;changed();},vault:(value:boolean)=>{ready=value;changed();},
    deviceChanged:(value:unknown)=>observed?.(value),delivery:(delivery:SyncPublicationOutcome['delivery'],imported=0,conflicts=0)=>{known={...known!,delivery,imported,conflicts};},
    resetServer:()=>{known=null;},readLocal:(key:string)=>JSON.parse(journals.get(JSON.parse(storage.get(key)!).ct)!) as Record<string,unknown>};
}
it('published ciphertext retains its encrypted journal; only aggregate import completion advances the per-memory index',async()=>{
  const f=fixture();expect(await f.run()).toMatchObject({delivery:'queued',imported:0});expect(f.storage.has(f.key)).toBe(true);expect(f.storage.has(f.indexKey)).toBe(false);
  expect(JSON.stringify(f.requests)).not.toContain('Synthetic');expect(f.storage.get(f.key)).not.toContain('alice');expect(f.stop).toHaveBeenCalledOnce();
  await expect(f.run()).rejects.toThrow();expect(f.requests).toHaveLength(1);
  f.delivery('pending',0,0);expect(await f.recover()).toMatchObject({delivery:'pending'});expect(f.storage.has(f.indexKey)).toBe(false);
  f.delivery('complete',1);expect(await f.recover()).toMatchObject({delivery:'complete',imported:1});expect(f.storage.has(f.key)).toBe(false);
  expect(f.readLocal(f.indexKey)).toMatchObject({uid:'alice',entries:[{id:'note',digest:expect.stringMatching(/^[a-f0-9]{64}$/)}]});
  expect(await f.run()).toEqual({envelopeId:null,delivery:'unchanged',imported:0,conflicts:0});expect(f.requests).toHaveLength(1);
});
it('same-revision edits, equal timestamps and older late-arriving changes are selected by content after acknowledgement',async()=>{
  const f=fixture();await f.run();f.delivery('complete',1);await f.recover();f.resetServer();
  await f.run([{...memory(),text:'Synthetic edited at the same revision'},memory('same-time',20),memory('late-old',15)]);
  expect(f.payloads[1]).toMatchObject({since:0,cursor:20,changes:[{memory:{id:'note',updatedAt:20}},{memory:{id:'same-time',updatedAt:20}},{memory:{id:'late-old',updatedAt:15}}]});
});
it('lost publication ACK confirms the same ID/cipher without regenerating, and a genuinely unknown receipt retries the saved request',async()=>{
  const f=fixture();f.loseAck();await expect(f.run()).rejects.toThrow();const original=f.requests[0];
  expect(await f.recover()).toMatchObject({delivery:'queued',envelopeId:original.envelopeId});expect(f.requests).toHaveLength(1);expect(f.payloads).toHaveLength(1);
  f.resetServer();await f.recover();expect(f.requests).toEqual([original,original]);expect(f.payloads).toHaveLength(1);
});
it('index acknowledgement survives a failed journal removal and recovery does not increment or rewrite it',async()=>{
  const f=fixture();await f.run();f.delivery('complete',1);const remove=f.deps.storage.removeItem;
  f.deps.storage.removeItem=()=>{throw new Error('Synthetic denied');};await expect(f.recover()).rejects.toThrow();const index=f.storage.get(f.indexKey);
  expect(index).toBeDefined();expect(f.storage.has(f.key)).toBe(true);f.deps.storage.removeItem=remove;
  await f.recover();expect(f.storage.get(f.indexKey)).toBe(index);expect(f.storage.has(f.key)).toBe(false);expect(f.requests).toHaveLength(1);
});
it('closed gate permits confirmation/cancellation but never publishes an unknown checkpoint or captures new data',async()=>{
  const f=fixture();await f.run();f.gate(false);await expect(f.run()).rejects.toThrow('temporariamente em validação');
  f.resetServer();await expect(f.recover()).rejects.toThrow();expect(f.requests).toHaveLength(1);
  expect(await f.cancel()).toMatchObject({delivery:'cancelled'});expect(f.storage.has(f.key)).toBe(false);expect(f.storage.has(f.indexKey)).toBe(false);
  const done=fixture();await done.run();done.delivery('complete',1);done.gate(false);vi.mocked(done.deps.device).mockRejectedValue(new Error('Synthetic revoked'));
  expect(await done.recover()).toMatchObject({delivery:'complete'});expect(done.storage.has(done.key)).toBe(false);
});
it('cancel during a partial import preserves recovery; expiry is not an import acknowledgement',async()=>{
  const f=fixture();await f.run();f.delivery('pending');expect(await f.cancel()).toMatchObject({delivery:'pending'});
  expect(f.storage.has(f.key)).toBe(true);expect(f.storage.has(f.indexKey)).toBe(false);
  f.delivery('expired');expect(await f.recover()).toMatchObject({delivery:'expired'});expect(f.storage.has(f.key)).toBe(true);
  expect(await f.cancel()).toMatchObject({delivery:'cancelled'});expect(f.storage.has(f.indexKey)).toBe(false);
});
it('validates every personal record before sealing or publication, and filters team/shared/foreign locked data',async()=>{
  for(const patch of [{id:'a/b'},{title:7},{connections:['bad/path']},{updatedAt:Infinity},{tags:[5]},{timestamp:undefined},{updatedAt:0}]){
    const f=fixture();await expect(f.run([memory(),{...memory('last'),...patch} as SessionData])).rejects.toThrow();expect(f.payloads).toHaveLength(0);expect(f.requests).toHaveLength(0);expect(f.storage.size).toBe(0);
  }
  const f=fixture();await f.run([memory(),{...memory('foreign'),uid:'bob',encLocked:true},{...memory('team'),teamId:'crew',encLocked:true},{...memory('shared'),sharedWithIds:['bob'],encLocked:true}]);
  expect(f.requests[0].memoryCount).toBe(1);expect(f.payloads[0]).toMatchObject({changes:[{memory:{id:'note'}}]});
  const locked=fixture();await expect(locked.run([{...memory(),encLocked:true}])).rejects.toThrow();expect(locked.requests).toHaveLength(0);
});
it('account/vault round trips and observed device revocation remain latched through sealing',async()=>{
  for(const type of ['account','vault','device']){
    const f=fixture();const seal=f.deps.seal;f.deps.seal=async(...args)=>{
      if(type==='account'){f.account('bob');f.account('alice');}else if(type==='vault'){f.vault(false);f.vault(true);}else{f.deviceChanged({...f.device,status:'revoked'});f.deviceChanged(f.device);}
      return seal(...args);
    };await expect(f.run()).rejects.toThrow();expect(f.storage.size).toBe(0);expect(f.requests).toHaveLength(0);expect(f.stop).toHaveBeenCalledOnce();
  }
});
it('storage refusal or failed read-back prevents any publication',async()=>{
  for(const refuses of [true,false]){
    const f=fixture();f.deps.storage.setItem=()=>{if(refuses)throw new Error('Synthetic quota');};await expect(f.run()).rejects.toThrow();expect(f.requests).toHaveLength(0);expect(f.deps.call).not.toHaveBeenCalled();
  }
});
it('transplanted UID/channel journals, wrong vault and a malformed terminal reply cannot erase recovery',async()=>{
  const foreign=fixture();await foreign.run();const raw=foreign.storage.get(foreign.key)!;const bobKey=mobileSyncOutboxKey('bob','phone','desktop-to-mobile');foreign.storage.set(bobKey,raw);foreign.account('bob');
  await expect(recoverPendingSyncOutbox('bob','phone','desktop-to-mobile',foreign.deps)).rejects.toThrow();expect(foreign.storage.get(bobKey)).toBe(raw);expect(foreign.deps.call).toHaveBeenCalledTimes(2);
  foreign.account('alice');const other=mobileSyncOutboxKey('alice','other','desktop-to-mobile');foreign.storage.set(other,raw);
  await expect(recoverPendingSyncOutbox('alice','other','desktop-to-mobile',foreign.deps)).rejects.toThrow();expect(foreign.storage.get(other)).toBe(raw);
  foreign.deps.decryptJournal=async()=>{throw new Error('Synthetic wrong key');};await expect(foreign.recover()).rejects.toThrow();expect(foreign.storage.get(foreign.key)).toBe(raw);
  for(const patch of [{digest:'f'.repeat(64)},{imported:2},{uid:'bob'},{createdAt:null},{status:'unknown'}]){
    const f=fixture();await f.run();f.delivery('complete',1);const call=f.deps.call;f.deps.call=async(mode,request)=>({...await call(mode,request) as object,...patch});
    await expect(f.recover()).rejects.toThrow();expect(f.storage.has(f.key)).toBe(true);expect(f.storage.has(f.indexKey)).toBe(false);
  }
});
it('concurrent index/journal replacement during encryption is not overwritten or cleared',async()=>{
  for(const replace of ['index','journal']){
    const f=fixture();await f.run();f.delivery('complete',1);const encrypt=f.deps.encryptJournal;
    f.deps.encryptJournal=async value=>{const result=await encrypt(value);f.storage.set(replace==='index'?f.indexKey:f.key,'Synthetic replacement');return result;};
    await expect(f.recover()).rejects.toThrow();expect(f.storage.get(replace==='index'?f.indexKey:f.key)).toBe('Synthetic replacement');expect(f.storage.has(f.key)).toBe(true);
  }
});
it('a publication reply after logout cannot clear recovery or report success',async()=>{
  const f=fixture();const call=f.deps.call;f.deps.call=async(mode,request)=>{const result=await call(mode,request);if(mode==='publish'){f.account(null);f.account('alice');}return result;};
  await expect(f.run()).rejects.toThrow();expect(f.storage.has(f.key)).toBe(true);expect(f.storage.has(f.indexKey)).toBe(false);expect(f.requests).toHaveLength(1);
  expect(await f.recover()).toMatchObject({delivery:'queued'});
});
it('a replacement checkpoint during a queued reply is preserved and cannot be reported as the original confirmed publication',async()=>{
  const f=fixture();await f.run();const call=f.deps.call;f.deps.call=async(mode,request)=>{const result=await call(mode,request);f.storage.set(f.key,'Synthetic replacement');return result;};
  await expect(f.recover()).rejects.toThrow();expect(f.storage.get(f.key)).toBe('Synthetic replacement');expect(f.storage.has(f.indexKey)).toBe(false);
});
