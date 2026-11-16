import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {buildPersonalResearchContext,saveWebResearchMemory,type WebResearchMemoryDeps} from './webResearchMemory';
import {createPersonalMemory,recoverAttachedMemoryCreation,type AttachedMemoryRecoveryDeps} from './attachedMemoryRecovery';
import {buildEncryptedMemoryFields,decryptMemoryEnvelope,encryptMemoryFields,setMemoryCryptoKeyForTests} from './memoryCrypto';
import {canonicalAttachedMemoryJson,type AttachedMemoryInput} from '../../../functions/src/attachedMemoryContract';
import type {SessionData} from '../hooks/useSessions';
import type {WebResearchResult} from './webResearchService';
import {CURRENT_EMBEDDING_SPACE} from './embeddingModel';
vi.mock('../firebase',()=>({default:{},db:{},auth:{currentUser:{uid:'alice'}}}));
vi.mock('../config/releaseGates',async importOriginal=>({...await importOriginal<typeof import('../config/releaseGates')>(),PERSONAL_MEMORY_CREATION_ENABLED:true}));
const result:WebResearchResult={query:'Synthetic research',mode:'private-local',summary:'SYNTHETIC_PRIVATE_RESEARCH_411',main_ideas:['Synthetic idea'],key_concepts:['synthetic'],suggested_memories:[],local_comparisons:[],
  sources:[{title:'Synthetic source',url:'https://example.org/source',snippet:'Synthetic snippet',summary:'Synthetic summary',status:'read'}]};
const memories=[{id:'own',uid:'alice',teamId:null,text:'Synthetic original personal'}, {id:'foreign',uid:'bob',teamId:null,text:'Synthetic foreign'},
  {id:'team',uid:'alice',teamId:'crew',text:'Synthetic team'}, {id:'shared',uid:'alice',sharedWithIds:['bob'],text:'Synthetic shared'},
  {id:'locked',uid:'alice',encLocked:true}, {id:'deleted',uid:'alice',deletedAt:1}] as SessionData[];
function fixture(){
  const current={uid:'alice',ready:true,policy:'never-cloud',pending:false};let changed=()=>{};
  const deps:WebResearchMemoryDeps={context:{uid:()=>current.uid,ready:()=>current.ready,policy:()=>current.policy,generation:()=>0,team:async()=>null,subscribe:callback=>{changed=callback;return()=>{};}},
    enabled:vi.fn(),pending:()=>current.pending,semantic:vi.fn(async()=>({embedding:[1],embeddingModel:'synthetic-local'})) as unknown as WebResearchMemoryDeps['semantic'],
    create:vi.fn(async()=>({id:'synthetic-id'})),now:()=>1900000000000};
  return{deps,current,changed:()=>changed(),save:(value=result)=>saveWebResearchMemory({uid:'alice',result:value,sessions:memories},deps)};
}
beforeEach(async()=>{setMemoryCryptoKeyForTests(await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']));});
afterEach(()=>{setMemoryCryptoKeyForTests(null);vi.restoreAllMocks();});
it('captures result and personal candidates and preserves source metadata through durable creation under never-cloud',async()=>{
  const f=fixture();const input=structuredClone(result);vi.mocked(f.deps.semantic).mockImplementationOnce(async()=>{input.summary='Synthetic replacement';input.mode='contextual';return{embedding:[1],embeddingModel:'synthetic-local'} as never;});
  expect(await f.save(input)).toEqual({id:'synthetic-id'});expect(vi.mocked(f.deps.semantic).mock.calls[0][1].map(memory=>memory.id)).toEqual(['own']);
  expect(f.deps.create).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',text:expect.stringContaining(result.summary),metadata:expect.objectContaining({connections:[],webResearch:{mode:'private-local',savedAt:1900000000000}})}),undefined,expect.any(Function));
});
it('copies only candidate metadata and current vectors, then forwards the captured context guard to inference',async()=>{
  const f=fixture(),source={id:'own',uid:'alice',embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE,position:[1,2,3]} as SessionData;
  for(const key of ['text','title','attachments','enc'])Object.defineProperty(source,key,{get(){throw Error('Existing content read');}});
  await saveWebResearchMemory({uid:'alice',result,sessions:[source]},f.deps);const call=vi.mocked(f.deps.semantic).mock.calls[0];
  const captured=[...call[1]][0];expect(captured.embedding).not.toBe(source.embedding);expect(captured.embedding).toEqual([1,0]);expect(Object.hasOwn(captured,'text')).toBe(false);
  expect(call[2]?.assertCurrent).toEqual(expect.any(Function));expect(f.deps.create).toHaveBeenCalledOnce();
});
it('closed creation and an existing journal refuse semantic work and persistence',async()=>{
  for(const mode of ['gate','pending']){const f=fixture();if(mode==='gate')vi.mocked(f.deps.enabled).mockImplementationOnce(()=>{throw Error('Synthetic closed');});else f.current.pending=true;
    await expect(f.save()).rejects.toThrow();expect(f.deps.semantic).not.toHaveBeenCalled();expect(f.deps.create).not.toHaveBeenCalled();}
});
it('account away/back, vault and policy changes during enrichment block the writer',async()=>{
  for(const mode of ['account','vault','policy']){const f=fixture();vi.mocked(f.deps.semantic).mockImplementationOnce(async()=>{
    if(mode==='account'){f.current.uid='bob';f.changed();f.current.uid='alice';}if(mode==='vault')f.current.ready=false;if(mode==='policy')f.current.policy='allow-cloud';
    return{} as never;});await expect(f.save()).rejects.toThrow(/mudou/);expect(f.deps.create).not.toHaveBeenCalled();}
});
it('a harmless local semantic failure may save the original result and logs only a fixed message',async()=>{
  const f=fixture();const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});vi.mocked(f.deps.semantic).mockRejectedValueOnce(Error('SYNTHETIC_PRIVATE_DIAGNOSTIC'));
  await f.save();expect(warn).toHaveBeenCalledWith('Web research memory saved without local semantic enrichment.');
  expect(f.deps.create).toHaveBeenCalledWith(expect.objectContaining({metadata:expect.objectContaining({embedding:null,processingMethod:'web-research'})}),undefined,expect.any(Function));
});
it('the outer panel guard reaches the creator and late context loss does not report a saved memory',async()=>{
  const f=fixture();let valid=true;vi.mocked(f.deps.create).mockImplementationOnce(async(_proposal,_deps,guard)=>{valid=false;guard!();return{id:'unused'};});
  await expect(saveWebResearchMemory({uid:'alice',result,sessions:memories,assertCurrent:()=>{if(!valid)throw Error('Synthetic panel closed');}},f.deps)).rejects.toThrow('panel closed');
  const late=fixture();vi.mocked(late.deps.create).mockImplementationOnce(async()=>{late.current.uid='bob';return{id:'created'};});await expect(late.save()).rejects.toThrow(/mudou/);
});
it('UTF-8 contextual memory selection excludes other scopes and stays within per-memory and total budgets',()=>{
  const long=Array.from({length:8},(_,index)=>({id:`own-${index}`,uid:'alice',teamId:null,title:'Synthetic',text:'á漢🙂'.repeat(1000)})) as SessionData[];
  const selected=[...long,...memories];const context=buildPersonalResearchContext(selected,'alice',selected.map(memory=>memory.id));
  expect(context.length).toBeGreaterThanOrEqual(6);expect(context.length).toBeLessThanOrEqual(8);expect(context.every(text=>new TextEncoder().encode(text).length<=2000)).toBe(true);
  expect(new TextEncoder().encode(context.join('')).length<=12000).toBe(true);expect(context.some(text=>/foreign|shared|team/.test(text))).toBe(false);
  expect(context.every(text=>!/[\uD800-\uDBFF]$/.test(text))).toBe(true);
});
it('lost create ACK preserves a real encrypted research journal and recovers the exact request without another inference or memory',async()=>{
  const f=fixture();const storage=new Map<string,string>();const receipts=new Map<string,unknown>();let id=0;
  const outcome=async(request:AttachedMemoryInput)=>({sessionId:request.sessionId,digest:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalAttachedMemoryJson(request)))),byte=>byte.toString(16).padStart(2,'0')).join(''),status:'committed',createdAt:1900000000000});
  const creation:AttachedMemoryRecoveryDeps={storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);},removeItem:key=>{storage.delete(key);}},
    uid:()=>f.current.uid,ready:()=>f.current.ready,policy:()=>f.current.policy as 'never-cloud',generation:()=>0,id:()=>{id++;return'11111111-1111-4111-8111-111111111111';},
    subscribe:()=>()=>{},exclusive:async(_name,work)=>work(),prepare:async proposal=>({teamId:null,keyEpoch:null,keyId:null,enc:(await buildEncryptedMemoryFields(proposal.text,proposal.title)).enc}),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,
    create:vi.fn(async request=>{receipts.set(request.sessionId,await outcome(request));throw Error('Synthetic lost ACK');}),status:vi.fn(async request=>receipts.get(request.sessionId)),cancel:vi.fn(),forgetUploads:vi.fn()};
  f.deps.create=(proposal,_unused,guard)=>createPersonalMemory(proposal,creation,guard);f.deps.pending=()=>storage.size>0;
  await expect(f.save()).rejects.toThrow(/confirmação/);expect(storage.size).toBe(1);const raw=[...storage.values()][0];expect(raw).not.toContain(result.summary);
  const request=vi.mocked(creation.create).mock.calls[0][0];expect(request.metadata.webResearch).toEqual({mode:'private-local',savedAt:1900000000000});
  expect((await decryptMemoryEnvelope(request.enc)).text).toContain(result.summary);
  await expect(f.save()).rejects.toThrow(/pendente/);expect(f.deps.semantic).toHaveBeenCalledOnce();
  expect((await recoverAttachedMemoryCreation('alice',creation)).status).toBe('committed');expect(creation.create).toHaveBeenCalledOnce();expect(id).toBe(1);expect(receipts.size).toBe(1);expect(storage.size).toBe(0);
});
