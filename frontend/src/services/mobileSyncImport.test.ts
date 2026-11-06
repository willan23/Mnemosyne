import {expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
vi.mock('../firebase', () => ({default:{},db:{},auth:{}}));
import {importPersonalMobileSync, confirmPendingMobileSyncImport, mobileSyncImportCheckpointKey, type MobileSyncImportDeps} from './mobileSyncImport';
import {parseMobileSyncPayload} from './mobileSyncPayload';
import type {MobileSyncEnvelope} from './mobileSync';
import {canonicalSyncState,normalizedSyncMetadata,type SyncImportBatch,type SyncImportStatus} from '../../../functions/src/mobileSyncImportContract';
const hash=(value:unknown)=>createHash('sha256').update(canonicalSyncState(value)).digest('hex');
const enc = {v:1 as const,iv:'A'.repeat(16),ct:'B'.repeat(32)};
const publicKey = {kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'B'.repeat(43),ext:true,key_ops:[]};
const makeMemory = (index:number) => ({id:`memory-${index}`,text:`Synthetic ${index}`,title:'Synthetic title',timestamp:10,updatedAt:20,tags:['Synthetic']});
function fixture(count=1) {
  const source:MobileSyncEnvelope = {id:'envelope',ownerUid:'alice',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-snapshot',status:'queued',senderPublicKeyJwk:publicKey,
    encryptedPayload:{iv:'A'.repeat(16),data:'B'.repeat(32)},memoryCount:count,tombstoneIds:[],expiresAt:Date.now()+100000};
  let payload:unknown = {version:1,ownerUid:'alice',source:'desktop',exportedAt:100,memories:Array.from({length:count},(_,index)=>makeMemory(index))};
  let state:SyncImportStatus = {envelopeId:source.id,payloadDigest:hash(source.encryptedPayload),memoryCount:count,cursor:0,imported:0,conflicts:0,status:'unknown'};
  const storage = new Map<string,string>(); const journals = new Map<string,string>(); let journalId=0;
  let uid:string|null='alice';let ready=true;let changed=()=>{};let observed:((value:unknown)=>void)|undefined;
  const device={deviceId:'phone',ownerUid:'alice',status:'active',publicKeyJwk:publicKey,desktopPublicKeyJwk:publicKey};
  const targets=new Map<string,unknown>(); const plans:SyncImportBatch[]=[]; let loseAck=false; let onPrepare:(()=>void)|undefined;
  const deps:MobileSyncImportDeps = {enabled:()=>true,storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);},removeItem:key=>{storage.delete(key);}},exclusive:async(_key,work)=>work(),
    list:vi.fn(async()=>[{id:source.id,data:source}]),read:vi.fn(async()=>source),device:vi.fn(async()=>device),observeDevice:vi.fn((_id,observe)=>{observed=observe;return vi.fn();}),
    verifyPrivate:vi.fn(async()=>{}),decrypt:vi.fn(async()=>payload),digest:vi.fn(async value=>hash(value)),
    prepare:vi.fn(async()=>({text:'',title:null,enc})),resolve:vi.fn(async()=>({text:'Different synthetic text',title:null})),
    encryptJournal:async value=>{const cipher={...enc,ct:String(++journalId).padEnd(32,'B')};journals.set(cipher.ct,value.text);return cipher;},
    decryptJournal:async cipher=>({text:journals.get(cipher.ct)!,title:null}),
    mutation:{uid:()=>uid,ready:()=>ready,subscribe:callback=>{changed=callback;return ()=>{};}},
    call:vi.fn(async(mode,value)=>{
      if(mode==='status')return {...state};
      if(mode==='prepare') {onPrepare?.();const data=value as {sessionIds:string[]};return {status:{...state},targets:data.sessionIds.map(sessionId=>targets.get(sessionId)??{sessionId,exists:false,stateHash:null,metadataHash:null,revision:null,timestamp:null,deleted:false,enc:null})};}
      const input=value as SyncImportBatch;plans.push(input);
      state={...state,cursor:state.cursor+input.changes.length,imported:state.imported+input.changes.filter(change=>!['skip','conflict'].includes(change.action)).length,
        conflicts:state.conflicts+input.changes.filter(change=>change.action==='conflict').length,status:state.cursor+input.changes.length===count?'complete':'pending'};
      if(state.status==='complete')source.status='pulled';if(loseAck){loseAck=false;throw new Error('Synthetic lost ACK');}return {...state};
    })};
  const run=()=>importPersonalMobileSync('alice','phone','desktop-to-mobile',{...publicKey,d:'C'.repeat(43)},deps);
  return {source,deps,plans,storage,targets,run,key:mobileSyncImportCheckpointKey('alice','phone','desktop-to-mobile'),state:()=>state,setPayload:(value:unknown)=>{payload=value;},
    payload:()=>structuredClone(payload),loseAck:()=>{loseAck=true;},onPrepare:(work:()=>void)=>{onPrepare=work;},
    account:(value:string|null)=>{uid=value;changed();},vault:(value:boolean)=>{ready=value;changed();},deviceChanged:(value:unknown)=>observed?.(value)};
}
it('imports bounded batches with ciphertext only, final aggregate confirmation and verified journal removal',async()=>{
  const f=fixture(23);const result=await f.run();expect(result).toEqual({importedMemories:23,pulledEnvelopes:1,conflicts:0});expect(f.plans.map(plan=>plan.changes.length)).toEqual([10,10,3]);
  expect(f.storage.size).toBe(0);for(const plan of f.plans){expect(JSON.stringify(plan)).not.toContain('Synthetic title');expect(JSON.stringify(plan)).not.toContain('Synthetic 0');expect(plan.changes.every(change=>change.expectedStateHash===null&&change.enc)).toBe(true);}
  expect(f.deps.call).toHaveBeenLastCalledWith('status',expect.objectContaining({envelopeId:'envelope'}));
});
it('lost final ACK retains an encrypted checkpoint; a fresh invocation confirms without decrypting, creating or requiring an active device',async()=>{
  const f=fixture();f.loseAck();await expect(f.run()).rejects.toThrow('aguarda confirmação');expect(f.storage.has(f.key)).toBe(true);expect(f.storage.get(f.key)).not.toContain('envelope');
  vi.mocked(f.deps.device).mockRejectedValue(new Error('Synthetic revoked'));vi.mocked(f.deps.decrypt).mockClear();
  expect(await f.run()).toEqual({importedMemories:1,pulledEnvelopes:1,conflicts:0});expect(f.plans).toHaveLength(1);expect(f.deps.decrypt).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);
});
it('lost partial ACK resumes from the committed cursor instead of resending the first batch',async()=>{
  const f=fixture(12);f.loseAck();await expect(f.run()).rejects.toThrow();expect(f.state().cursor).toBe(10);
  await f.run();expect(f.plans.map(plan=>plan.cursor)).toEqual([0,10]);expect(f.plans[1].changes.map(change=>change.sessionId)).toEqual(['memory-10','memory-11']);
});
it('status-only recovery works with the writing gate closed and a revoked device without starting a batch or decrypting source',async()=>{
  for(const count of [1,12]){
    const f=fixture(count);f.loseAck();await expect(f.run()).rejects.toThrow();f.deps.enabled=()=>false;
    vi.mocked(f.deps.device).mockClear().mockRejectedValue(new Error('Synthetic revoked'));vi.mocked(f.deps.decrypt).mockClear();vi.mocked(f.deps.call).mockClear();
    const result=await confirmPendingMobileSyncImport('alice','phone','desktop-to-mobile',f.deps);
    expect(result.status).toBe(count===1?'complete':'pending');expect(f.storage.has(f.key)).toBe(count!==1);expect(f.plans).toHaveLength(1);
    expect(f.deps.device).not.toHaveBeenCalled();expect(f.deps.decrypt).not.toHaveBeenCalled();expect(f.deps.call).toHaveBeenCalledOnce();expect(f.deps.call).toHaveBeenCalledWith('status',expect.any(Object));
  }
});
it('rejects malformed records anywhere in the full payload before encryption, journal or first mutation',async()=>{
  for(const last of [{...makeMemory(11),uid:'bob'},{...makeMemory(11),teamId:'crew'},{...makeMemory(11),attachments:[]},{...makeMemory(11),updatedAt:Infinity},{...makeMemory(11),id:'memory-0'},{...makeMemory(11),connections:['a/b']}]) {
    const f=fixture(12);const payload=f.payload() as {memories:unknown[]};payload.memories[11]=last;f.setPayload(payload);
    await expect(f.run()).rejects.toThrow();expect(f.plans).toHaveLength(0);expect(f.storage.size).toBe(0);expect(f.deps.prepare).not.toHaveBeenCalled();
  }
});
it('preparation projection is validated before local decryption and writes; foreign authority or malformed cipher cannot enter',async()=>{
  for(const patch of [{uid:'bob'},{enc:{...enc,v:2}},{sessionId:'different'},{stateHash:null},{revision:-1},{metadataHash:undefined},{metadataHash:null},{metadataHash:'invalid'},{metadata:{tags:['Synthetic']}}]) {
    const f=fixture();f.targets.set('memory-0',{sessionId:'memory-0',exists:true,stateHash:'d'.repeat(64),metadataHash:hash(normalizedSyncMetadata({})),revision:50,timestamp:10,deleted:false,enc,...patch});
    await expect(f.run()).rejects.toThrow();expect(f.deps.resolve).not.toHaveBeenCalled();expect(f.plans).toHaveLength(0);expect(f.storage.has(f.key)).toBe(true);
  }
});
it('account/vault transitions are latched across encryption and cannot be undone by immediately returning to the original context',async()=>{
  for(const type of ['account','vault']) {
    const f=fixture();vi.mocked(f.deps.prepare).mockImplementationOnce(async()=>{if(type==='account'){f.account('bob');f.account('alice');}else{f.vault(false);f.vault(true);}return {text:'',title:null,enc};});
    await expect(f.run()).rejects.toThrow();expect(f.plans).toHaveLength(0);expect(f.storage.has(f.key)).toBe(true);
  }
});
it('observed device revocation stays latched; a later active event cannot permit a commit',async()=>{
  const f=fixture();f.onPrepare(()=>{f.deviceChanged({deviceId:'phone',ownerUid:'alice',status:'revoked'});f.deviceChanged({deviceId:'phone',ownerUid:'alice',status:'active',publicKeyJwk:publicKey,desktopPublicKeyJwk:publicKey});});
  await expect(f.run()).rejects.toThrow();expect(f.plans).toHaveLength(0);expect(f.storage.has(f.key)).toBe(true);
});
it('storage failure or ciphertext/source substitution retains the checkpoint and cannot issue apply',async()=>{
  const f=fixture();f.deps.storage.setItem=()=>{throw new Error('Synthetic quota');};await expect(f.run()).rejects.toThrow();expect(f.plans).toHaveLength(0);
  const recover=fixture(12);recover.loseAck();await expect(recover.run()).rejects.toThrow();recover.source.encryptedPayload.data='D'.repeat(32);recover.deps.digest=async()=> 'e'.repeat(64);
  await expect(recover.run()).rejects.toThrow();expect(recover.plans).toHaveLength(1);expect(recover.storage.has(recover.key)).toBe(true);
});
it('newer ciphertext updates, older divergent content becomes a deterministic server conflict, and deleted targets stay deleted',async()=>{
  const f=fixture(3);for(let index=0;index<3;index++)f.targets.set(`memory-${index}`,{sessionId:`memory-${index}`,exists:true,stateHash:'d'.repeat(64),metadataHash:hash(normalizedSyncMetadata({tags:['Synthetic']})),revision:index===0?15:30,timestamp:10,deleted:index===2,enc});
  const result=await f.run();expect(f.plans[0].changes.map(change=>change.action)).toEqual(['update','conflict','skip']);expect(result).toEqual({importedMemories:1,conflicts:1,pulledEnvelopes:1});expect(f.deps.resolve).toHaveBeenCalledTimes(1);
});
it('same text with different metadata at the same or an older revision becomes a conflict; equal metadata alone permits skip',async()=>{
  const changes=[{tags:['Changed']},{category:'Changed'},{connections:['peer']},{semanticClusterId:'Changed'},{position:[1,2,3]},{importance:0.4},{celestialType:'Changed'},{embedding:[0.1,0.2],embeddingModel:'Synthetic'}];
  for(const metadata of changes){for(const revision of [20,30]){
    const f=fixture();const original=makeMemory(0);vi.mocked(f.deps.resolve).mockResolvedValue({text:original.text,title:original.title});
    f.targets.set(original.id,{sessionId:original.id,exists:true,stateHash:'d'.repeat(64),metadataHash:hash(normalizedSyncMetadata({tags:original.tags})),revision,timestamp:10,deleted:false,enc});
    f.setPayload({version:1,ownerUid:'alice',source:'desktop',exportedAt:100,memories:[{...original,...metadata}]});
    const result=await f.run();expect(f.plans[0].changes[0]).toMatchObject({action:'conflict',metadata:{...metadata}});expect(result.conflicts).toBe(1);expect(result.importedMemories).toBe(0);
  }}
  const same=fixture();const original=makeMemory(0);vi.mocked(same.deps.resolve).mockResolvedValue({text:original.text,title:original.title});
  same.targets.set(original.id,{sessionId:original.id,exists:true,stateHash:'d'.repeat(64),metadataHash:hash(normalizedSyncMetadata({tags:original.tags,connections:[],embedding:null,embeddingModel:null})),revision:30,timestamp:10,deleted:false,enc});
  await same.run();expect(same.plans[0].changes[0].action).toBe('skip');expect(same.deps.prepare).not.toHaveBeenCalled();
});
it('a newer metadata-only revision updates and an account change during metadata hashing prevents any apply',async()=>{
  for(const changed of [false,true]){
    const f=fixture();const original=makeMemory(0);vi.mocked(f.deps.resolve).mockResolvedValue({text:original.text,title:original.title});
    f.targets.set(original.id,{sessionId:original.id,exists:true,stateHash:'d'.repeat(64),metadataHash:hash(normalizedSyncMetadata({tags:['Old']})),revision:changed?30:15,timestamp:10,deleted:false,enc});
    if(changed){const digest=f.deps.digest;f.deps.digest=async value=>{if(value&&typeof value==='object'&&'tags' in value){f.account('bob');f.account('alice');}return digest(value);};await expect(f.run()).rejects.toThrow();expect(f.plans).toHaveLength(0);expect(f.storage.has(f.key)).toBe(true);}
    else{await f.run();expect(f.plans[0].changes[0]).toMatchObject({action:'update',metadata:{tags:['Synthetic']}});}
  }
});
it('snapshot tombstones become deletion operations and ambiguous counts/source/cursors are rejected',()=>{
  const f=fixture();const data=f.payload() as {memories:unknown[]};data.memories=[{...makeMemory(0),deletedAt:20}];f.source.tombstoneIds=['memory-0'];
  expect(parseMobileSyncPayload(data,f.source)[0].op).toBe('delete');f.source.tombstoneIds=[];expect(()=>parseMobileSyncPayload(data,f.source)).toThrow();
  const delta={version:1,ownerUid:'alice',source:'desktop',exportedAt:100,deviceId:'phone',since:0,cursor:20,changes:[{op:'upsert',memory:makeMemory(0)}]};f.source.payloadType='memory-delta';
  expect(parseMobileSyncPayload(delta,f.source)).toHaveLength(1);for(const patch of [{cursor:21},{since:20},{deviceId:'other'},{source:'mobile'}])expect(()=>parseMobileSyncPayload({...delta,...patch},f.source)).toThrow();
});
it('closed gate stops before Auth, storage, Firestore and crypto; a replaced checkpoint cannot be cleared by an earlier success',async()=>{
  const f=fixture();f.deps.enabled=()=>false;await expect(f.run()).rejects.toThrow('temporariamente em validação');expect(f.deps.list).not.toHaveBeenCalled();
  const late=fixture();const call=late.deps.call;late.deps.call=async(mode,request)=>{const result=await call(mode,request);if(mode==='apply')late.storage.set(late.key,'Synthetic replacement');return result;};
  await expect(late.run()).rejects.toThrow();expect(late.storage.get(late.key)).toBe('Synthetic replacement');expect(late.plans).toHaveLength(1);
});
it('a malformed or impossible commit response never clears the checkpoint, even if the synthetic server already committed',async()=>{
  for(const patch of [{cursor:0},{imported:0},{payloadDigest:'a'.repeat(64)},{memoryCount:2},{status:'pending'},{uid:'bob'}]) {
    const f=fixture();const call=f.deps.call;f.deps.call=async(mode,request)=>{const result=await call(mode,request);return mode==='apply'?{...(result as object),...patch}:result;};
    await expect(f.run()).rejects.toThrow();expect(f.storage.has(f.key)).toBe(true);expect(f.plans).toHaveLength(1);
  }
});
it('a committed reply arriving after an account transition preserves local recovery and cannot announce success',async()=>{
  const f=fixture();const call=f.deps.call;f.deps.call=async(mode,request)=>{const result=await call(mode,request);if(mode==='apply'){f.account('bob');f.account('alice');}return result;};
  await expect(f.run()).rejects.toThrow();expect(f.storage.has(f.key)).toBe(true);expect(f.state().status).toBe('complete');expect(f.plans).toHaveLength(1);
});
