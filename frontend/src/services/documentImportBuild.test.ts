import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},auth:{},db:{}}));
import {buildDocumentImportPlan,type DocumentPlanBuildDeps} from './documentImportBuild';
import {buildEncryptedMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic} from './memoryCrypto';
import {sealAttachment,attachmentKeyWrapper} from './attachmentCrypto';
import {attachmentBytesDigest} from './attachmentUploadCheckpoint';
import type {SessionData} from '../hooks/useSessions';
import {CURRENT_EMBEDDING_SPACE} from './embeddingModel';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const cognitive={embedding:[.1,.2],embeddingModel:'local-test',celestialType:'planet' as const,connections:['ignored-neighbor'],semanticClusterId:'local-test',position:[1,2,3] as [number,number,number],importance:.6};
function file(path:string,content='SYNTHETIC_DOCUMENT_CONTENT_743',mime='text/plain'){
  const value=new File([content],path.split('/').at(-1)!,{type:mime});Object.defineProperty(value,'webkitRelativePath',{value:path});
  Object.defineProperty(value,'arrayBuffer',{value:async()=>new TextEncoder().encode(content).buffer});return value;
}
function fixture(){
  const state={policy:'never-cloud' as 'never-cloud'|'allow-cloud'|'confirm-cloud',attachments:false,valid:true};
  const deps:DocumentPlanBuildDeps={id:vi.fn(()=>crypto.randomUUID()),now:()=>1000,policy:()=>state.policy,attachmentsEnabled:()=>state.attachments,
    extract:vi.fn(async()=>({text:'SYNTHETIC_DOCUMENT_CONTENT_743',method:'Synthetic local'})),encrypt:vi.fn(buildEncryptedMemoryFields),process:vi.fn(async()=>structuredClone(cognitive)),prepareAttachment:vi.fn()};
  const guard=()=>{if(!state.valid)throw Error('Synthetic scope changed');};return{state,deps,guard};
}
beforeEach(()=>{vi.clearAllMocks();setMemoryCryptoMnemonic(words);});afterEach(()=>{setMemoryCryptoMnemonic(null);vi.restoreAllMocks();});
it('reuses one semantic metadata capture for the whole document plan without reading existing plaintext or attachments',async()=>{
  const f=fixture(),source={id:'own',uid:'alice',embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE,position:[1,2,3]} as SessionData;
  for(const key of ['text','title','attachments','enc'])Object.defineProperty(source,key,{get(){throw Error('Existing content read');}});
  const result=await buildDocumentImportPlan('alice',[file('a.txt'),file('b.txt')],[source],f.guard,f.deps);
  expect(result.plan.memories).toHaveLength(3);const calls=vi.mocked(f.deps.process).mock.calls;expect(calls).toHaveLength(3);expect(calls[0][1]).toBe(calls[2][1]);
  expect([...calls[0][1]][0].embedding).not.toBe(source.embedding);expect(calls.every(call=>typeof call[2]?.assertCurrent==='function')).toBe(true);
});
it('yields during hub placement and preserves the previous distance formula, then refuses a retired placement',async()=>{
  vi.spyOn(Math,'random').mockReturnValue(.5);const existing=Array.from({length:128},(_,i)=>({id:'sun'+i,uid:'alice',celestialType:'sun',position:[0,0,0]} as SessionData));
  const f=fixture();f.deps.yieldTask=vi.fn(async()=>{});const result=await buildDocumentImportPlan('alice',[file('a.txt')],existing,f.guard,f.deps);
  expect(vi.mocked(f.deps.yieldTask)).toHaveBeenCalledTimes(3);const radius=50+30+128*12;expect(result.plan.memories[0].metadata.position).toEqual([-radius,0,radius*Math.sin(Math.PI)]);
  const denied=fixture();let yields=0;denied.deps.yieldTask=vi.fn(async()=>{if(++yields===3)denied.state.valid=false;});
  await expect(buildDocumentImportPlan('alice',[file('a.txt')],existing,denied.guard,denied.deps)).rejects.toThrow('scope changed');expect(denied.deps.process).not.toHaveBeenCalled();expect(denied.deps.encrypt).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
it('captures every memory/file UUID before analysis, seals text and titles, preserves local semantics and builds flat document relationships',async()=>{
  const f=fixture();const extract=f.deps.extract;f.deps.extract=vi.fn(async(file,guard)=>{expect(f.deps.id).toHaveBeenCalledTimes(6);return extract(file,guard);});
  const result=await buildDocumentImportPlan('alice',[file('a.txt'),file('b.txt')],[],f.guard,f.deps);expect(result.plan.memories).toHaveLength(3);expect(result.plan.edges).toHaveLength(2);expect(result.uploads).toEqual([]);
  const hub=result.plan.memories[0];for(const document of result.plan.memories.slice(1)){expect(document.metadata.parentId).toBe(hub.sessionId);expect(document.metadata.connections).toEqual([]);expect(document.metadata.embedding).toEqual(cognitive.embedding);}
  for(const memory of result.plan.memories){const opened=await decryptMemoryEnvelope(memory.enc);expect(opened.text).toContain(memory.role==='hub'?'Sistema solar':'SYNTHETIC_DOCUMENT_CONTENT_743');expect(JSON.stringify(memory)).not.toContain('SYNTHETIC_DOCUMENT_CONTENT_743');}
  expect(f.deps.prepareAttachment).not.toHaveBeenCalled();expect(f.deps.process).toHaveBeenCalledTimes(3);expect(result.result).toEqual({batchId:result.plan.importId,imported:2,hubId:hub.sessionId});
});
it('mixed loose files and nested paths keep distinct root hubs and complete reciprocal parent pairs with no orphan folder',async()=>{
  const f=fixture();const result=await buildDocumentImportPlan('alice',[file('loose.txt'),file('project/src/a.ts'),file('project/readme.txt')],[],f.guard,f.deps);
  const {memories,edges}=result.plan;const hubs=memories.filter(item=>item.role==='hub');expect(hubs).toHaveLength(3);expect(memories).toHaveLength(6);expect(edges).toHaveLength(4);
  const loose=memories[3];expect(loose.metadata.parentId).toBe(hubs[0].sessionId);expect(memories[4].metadata.parentId).toBe(hubs[2].sessionId);expect(memories[5].metadata.parentId).toBe(hubs[1].sessionId);expect(hubs[2].metadata.parentId).toBe(hubs[1].sessionId);
});
it('captures only unlocked personal semantic context, without linking suggested vector neighbors into the import',async()=>{
  const f=fixture();const existing=[{id:'own',uid:'alice',teamId:null,text:'Synthetic personal',timestamp:1},{id:'foreign',uid:'bob',teamId:null,text:'Synthetic foreign'},
    {id:'team',uid:'alice',teamId:'crew',text:'Synthetic team'},{id:'locked',uid:'alice',teamId:null,encLocked:true,text:'Synthetic locked'}] as unknown as SessionData[];
  await buildDocumentImportPlan('alice',[file('a.txt')],existing,f.guard,f.deps);for(const [,candidates]of vi.mocked(f.deps.process).mock.calls)expect(candidates.map(item=>item.id)).toEqual(['own']);
});
it('preserves locally encrypted originals in a manifest shared by their direct hub and document; local prep failures are never silently dropped',async()=>{
  const f=fixture();f.state.policy='allow-cloud';f.state.attachments=true;const key=attachmentKeyWrapper(await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']));
  f.deps.prepareAttachment=vi.fn(async(input,guard)=>{const sealed=await sealAttachment({uid:input.uid,id:input.id,scope:{kind:'personal',uid:input.uid},name:input.file.name,mimeType:input.file.type,bytes:new Uint8Array(await input.file.arrayBuffer())},key,guard);
    return{id:input.id,header:sealed.header,bytesDigest:await attachmentBytesDigest(sealed.bytes)};});
  const result=await buildDocumentImportPlan('alice',[file('a.txt')],[],f.guard,f.deps);expect(result.uploads).toHaveLength(1);expect(result.plan.attachments[0].id).toBe(result.uploads[0].id);
  for(const memory of result.plan.memories)expect(memory.attachmentIds).toEqual([result.uploads[0].id]);
  f.deps.prepareAttachment=vi.fn(async()=>{throw Error('Synthetic local persistence failure');});await expect(buildDocumentImportPlan('alice',[file('a.txt')],[],f.guard,f.deps)).rejects.toThrow('local persistence failure');
});
it('never-cloud text imports make no original preparations while nontext files fail before any local draft or server work',async()=>{
  const f=fixture();f.state.attachments=true;await buildDocumentImportPlan('alice',[file('a.txt')],[],f.guard,f.deps);expect(f.deps.prepareAttachment).not.toHaveBeenCalled();
  await expect(buildDocumentImportPlan('alice',[file('a.pdf','%PDF-synthetic','application/pdf')],[],f.guard,f.deps)).rejects.toThrow('exige um anexo cifrado');expect(f.deps.prepareAttachment).not.toHaveBeenCalled();
});
it('rejects traversal, duplicates, deep paths, empty files and file-count overflow before reading or sealing anything',async()=>{
  for(const input of [[file('../a.txt')],[file('a.txt'),file('a.txt')],[file(Array(17).fill('dir').join('/')+'/a.txt')],[file('a.txt','')],Array.from({length:21},(_,i)=>file(i+'.txt'))]){
    const f=fixture();await expect(buildDocumentImportPlan('alice',input,[],f.guard,f.deps)).rejects.toThrow();expect(f.deps.extract).not.toHaveBeenCalled();expect(f.deps.encrypt).not.toHaveBeenCalled();expect(f.deps.prepareAttachment).not.toHaveBeenCalled();
  }
});
it.each(['extract','semantic','encrypt','policy'] as const)('a transition during %s aborts local preparation before publishing a plan',async stage=>{
  const f=fixture();if(stage==='extract'||stage==='policy')f.deps.extract=vi.fn(async()=>{if(stage==='policy')f.state.policy='allow-cloud';else f.state.valid=false;return{text:'Synthetic',method:'local'};});
  if(stage==='semantic')f.deps.process=vi.fn(async()=>{f.state.valid=false;return cognitive;});if(stage==='encrypt')f.deps.encrypt=vi.fn(async(...args)=>{const result=await buildEncryptedMemoryFields(...args);f.state.valid=false;return result;});
  await expect(buildDocumentImportPlan('alice',[file('a.txt')],[],f.guard,f.deps)).rejects.toThrow();
});
