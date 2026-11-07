import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
vi.mock('../engines/CognitiveEngine',()=>({cognitiveEngine:{processMemory:vi.fn()}}));
import {buildCapsuleImportPlan,importCapsuleRecoverably,type CapsuleImportBuildDeps} from './capsuleImportRecovery';
import {captureCapsuleItems,decodeCapsulePack,encodeCapsulePack,CAPSULE_PACK_MARKER} from './capsuleService';
import {recoverPendingObsidianImport,obsidianImportCheckpointKey,type ObsidianImportRecoveryDeps} from './obsidianImportRecovery';
import {buildEncryptedMemoryFields,decryptMemoryEnvelope,encryptMemoryFields,setMemoryCryptoKeyForTests} from './memoryCrypto';
import {obsidianPlanBytes,obsidianPlanBatches,type ObsidianImportPlan,type ObsidianImportStatus,type ObsidianImportBatch,type ObsidianImportIdentity} from '../../../functions/src/obsidianImportContract';
import type {SessionData} from '../hooks/useSessions';
import {CURRENT_EMBEDDING_SPACE} from './embeddingModel';
const pack=(count=13)=>encodeCapsulePack(Array.from({length:count},(_,index)=>({text:`SYNTHETIC_PRIVATE_CAPSULE_673 ${index} á漢🙂`,title:`Title ${index}`,tags:['synthetic']})));
function buildDeps(){let id=0;return{id:()=>`synthetic-${++id}`,encrypt:vi.fn(buildEncryptedMemoryFields),process:vi.fn(async()=>({embedding:[.1],embeddingModel:'synthetic-local',position:[0,0,0],celestialType:'planet',importance:.5})) as unknown as CapsuleImportBuildDeps['process']};}
beforeEach(async()=>{vi.clearAllMocks();localStorage.clear();setMemoryCryptoKeyForTests(await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']));});
afterEach(()=>{setMemoryCryptoKeyForTests(null);vi.restoreAllMocks();});
it('strict pack parsing refuses invalid items, extra fields, empty/oversized UTF8 payloads and excessive item counts',()=>{
  expect(decodeCapsulePack(pack(150))?.items).toHaveLength(150);
  for(const items of [[],Array(151).fill({text:'x'}),[{text:''}],[{text:5}],[{text:'x',tags:[1]}],[{text:'x',uid:'alice'}],[{text:'漢'.repeat(40001)}]])expect(()=>captureCapsuleItems(items)).toThrow();
  for(const data of [{v:1,type:'pack',createdAt:1,items:[{text:'x'}],ownerUid:'alice'},{v:1,type:'pack',createdAt:0,items:[{text:'x'}]}, {v:1,type:'pack',createdAt:1,items:[{text:'x',tags:['x'.repeat(129)]}]}])expect(decodeCapsulePack(CAPSULE_PACK_MARKER+'\n'+JSON.stringify(data))).toBeNull();
  expect(decodeCapsulePack('ordinary text')).toBeNull();expect(decodeCapsulePack(CAPSULE_PACK_MARKER+'\n{')).toBeNull();expect(()=>encodeCapsulePack(Array.from({length:20},()=>({text:'a'.repeat(100000)})))).toThrow();
});
it('captures all stable IDs and encrypted text/title before admission, preserves metadata and uses only owned readable candidates',async()=>{
  const deps=buildDeps();const payload={text:pack(2),shareId:'public-share',ownerUid:'forged-owner'};
  const sessions=[{id:'own',uid:'alice',text:'Own',timestamp:1,updatedAt:1},{id:'foreign',uid:'bob'},{id:'team',uid:'alice',teamId:'crew'},{id:'shared',uid:'alice',sharedWithIds:['bob']},{id:'locked',uid:'alice',encLocked:true},{id:'deleted',uid:'alice',deletedAt:1}] as SessionData[];
  vi.mocked(deps.process).mockImplementationOnce(async()=>{payload.text='replacement';sessions[0].text='replacement';return{embedding:[.1],embeddingModel:'synthetic-local'} as never;});
  const captured=await buildCapsuleImportPlan('alice',payload,sessions,undefined,deps);expect(captured.plan.source).toBe('capsule-import');expect(captured.plan.capsule).toEqual({shareId:'public-share'});expect(captured.plan.memories.map(x=>x.sessionId)).toEqual(['synthetic-2','synthetic-3']);
  expect([...vi.mocked(deps.process).mock.calls[0][1]].map(x=>x.id)).toEqual(['own']);expect([...vi.mocked(deps.process).mock.calls[1][1]].map(x=>x.id)).toEqual(['own','synthetic-2']);
  expect(JSON.stringify(captured.plan)).not.toContain('SYNTHETIC_PRIVATE_CAPSULE_673');expect(JSON.stringify(captured.plan)).not.toContain('forged-owner');
  expect((await decryptMemoryEnvelope(captured.plan.memories[0].enc)).text).toContain('SYNTHETIC_PRIVATE_CAPSULE_673 0');expect(captured.plan.memories[0].metadata.tags).toContain('synthetic');expect(captured.plan.edges).toEqual([]);
});
it('single-text capsules use the same plan, reject malformed sources and can retain content after harmless local inference failure',async()=>{
  const deps=buildDeps();vi.mocked(deps.process).mockRejectedValueOnce(Error('SYNTHETIC_PRIVATE_ERROR'));const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const result=await buildCapsuleImportPlan('alice',{text:'Synthetic body',titleHint:'Synthetic title'},[],undefined,deps);expect(result.result.imported).toBe(1);expect(result.plan.capsule).toEqual({shareId:null});expect(warn).toHaveBeenCalledWith('Não foi possível enriquecer a cápsula localmente.');
  expect((await decryptMemoryEnvelope(result.plan.memories[0].enc)).text).toBe('Synthetic title\n\nSynthetic body');
  for(const payload of [{text:''},{text:'x',shareId:'../x'},{text:CAPSULE_PACK_MARKER+'\n{}'},{text:'x',titleHint:'漢'.repeat(1001)}])await expect(buildCapsuleImportPlan('alice',payload,[],undefined,deps)).rejects.toThrow();
});
it('copies a semantic base once and reuses fixed growing prefixes without reading its plaintext or attachments',async()=>{
  const deps=buildDeps(),source={id:'own',uid:'alice',embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE,position:[1,2,3]} as SessionData;
  for(const key of ['text','title','attachments','enc'])Object.defineProperty(source,key,{get(){throw Error('Existing content read');}});
  await buildCapsuleImportPlan('alice',{text:pack(3)},[source],undefined,deps);const calls=vi.mocked(deps.process).mock.calls;
  expect(calls.map(call=>[...call[1]].length)).toEqual([1,2,3]);const first=[...calls[0][1]][0];expect(first).toBe([...calls[2][1]][0]);expect(first.embedding).not.toBe(source.embedding);
  expect(calls.every(call=>typeof call[2]?.assertCurrent==='function')).toBe(true);expect(Object.hasOwn(first,'text')).toBe(false);
});
it('a key retirement inside inference rejects the batch before encryption even when the caller guard stays valid',async()=>{
  const deps=buildDeps();vi.mocked(deps.process).mockImplementationOnce(async()=>{setMemoryCryptoKeyForTests(null);throw Error('Synthetic model unavailable');});
  await expect(buildCapsuleImportPlan('alice',{text:pack(2)},[],()=>{},deps)).rejects.toThrow('semantic_write_unavailable');expect(deps.encrypt).not.toHaveBeenCalled();
});
it.each(['inference','seal'])('context loss during %s rejects the whole captured plan before any server call',async stage=>{
  const deps=buildDeps();let current=true;const guard=()=>{if(!current)throw Error('Synthetic changed');};
  if(stage==='inference')vi.mocked(deps.process).mockImplementationOnce(async()=>{current=false;return{} as never;});
  else vi.mocked(deps.encrypt).mockImplementationOnce(async(...args)=>{const result=await buildEncryptedMemoryFields(...args);current=false;return result;});
  await expect(buildCapsuleImportPlan('alice',{text:pack(2)},[],guard,deps)).rejects.toThrow('changed');
  expect(deps.encrypt).toHaveBeenCalledTimes(stage==='inference'?0:1);
});
function recoveryFixture(){
  const storage=new Map<string,string>(),created=new Map<string,unknown>();let server:ObsidianImportStatus|null=null,plan:ObsidianImportPlan|null=null;
  const current={uid:'alice',ready:true,enabled:true,listener:()=>{}};let lose='apply';let registrations=0;
  const digest=async(p:ObsidianImportPlan)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(obsidianPlanBytes(p)))),b=>b.toString(16).padStart(2,'0')).join('');
  const deps:ObsidianImportRecoveryDeps={enabled:()=>current.enabled,blocked:()=>false,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v);},removeItem:k=>{storage.delete(k);}},exclusive:async(_name,work)=>work(),encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,
    mutation:{uid:()=>current.uid,ready:()=>current.ready,subscribe:listener=>{current.listener=listener;return()=>{};}},call:vi.fn(async(mode,value,source)=>{
      expect(source).toBe('capsule-import');expect(JSON.stringify(value)).not.toContain('SYNTHETIC_PRIVATE_CAPSULE_673');
      if(mode==='begin'){plan=value as ObsidianImportPlan;server={importId:plan.importId,planDigest:await digest(plan),status:'pending',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:plan.memories.length,edgeCount:0};}
      if(mode==='apply'){const batch=value as ObsidianImportBatch;expect(batch.batchIndex).toBe(server!.nextBatch);for(const item of batch.memories){expect(created.has(item.sessionId)).toBe(false);created.set(item.sessionId,item.enc);}
        const complete=batch.batchIndex+1===obsidianPlanBatches(plan!).length;if(complete)registrations++;server={...server!,nextBatch:batch.batchIndex+1,createdCount:server!.createdCount+batch.memories.length,status:complete?'complete':'pending'};
        if(lose===mode){lose='';throw Error('Synthetic lost ACK');}}
      if(mode==='cancel')server={...server!,status:'cancelled'};
      return server?{...server}:{...value as ObsidianImportIdentity,status:'unknown',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:0,edgeCount:0};
    })};
  return{storage,created,deps,current,registrationCount:()=>registrations};
}
it('recovers a whole real encrypted pack after lost first-batch ACK without new IDs, inference or a second final registration',async()=>{
  const f=recoveryFixture(),deps=buildDeps();await expect(importCapsuleRecoverably('alice',{text:pack(),shareId:'public-share'},[],undefined,f.deps,deps)).rejects.toThrow();expect(f.created.size).toBe(10);
  const raw=f.storage.get(obsidianImportCheckpointKey('alice'))!;expect(raw).not.toContain('SYNTHETIC_PRIVATE_CAPSULE_673');const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);const ids=journal.plan.memories.map((m:ObsidianImportPlan['memories'][number])=>m.sessionId);
  await expect(importCapsuleRecoverably('alice',{text:pack()},[],undefined,f.deps,deps)).rejects.toMatchObject({reason:'pending'});expect(deps.process).toHaveBeenCalledTimes(13);
  const outcome=await recoverPendingObsidianImport('alice',f.deps);expect(outcome.status.status).toBe('complete');expect(outcome.importedConfirmed).toBe(13);expect([...f.created.keys()]).toEqual(ids);expect(f.registrationCount()).toBe(1);expect(f.storage.size).toBe(0);
});
it('closed capsule gate rejects before inference and a failed terminal confirmation retains the full journal for closed-gate recovery',async()=>{
  const f=recoveryFixture(),deps=buildDeps();f.current.enabled=false;await expect(importCapsuleRecoverably('alice',{text:pack(1)},[],undefined,f.deps,deps)).rejects.toMatchObject({reason:'closed'});expect(deps.process).not.toHaveBeenCalled();
  f.current.enabled=true;await expect(importCapsuleRecoverably('alice',{text:pack(1)},[],undefined,f.deps,deps)).rejects.toThrow();expect(f.created.size).toBe(1);f.current.enabled=false;
  expect((await recoverPendingObsidianImport('alice',f.deps)).status.status).toBe('complete');expect(f.registrationCount()).toBe(1);expect(f.storage.size).toBe(0);
});
