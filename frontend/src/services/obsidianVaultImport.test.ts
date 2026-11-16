import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},auth:{},db:{}}));
const state=vi.hoisted(()=>({uid:'alice',ready:true,enabled:true,pending:false,epoch:0,captured:[] as unknown[],beforePrepare:async()=>{}}));
vi.mock('./obsidianImportRecovery',()=>({startCapturedObsidianImport:async(uid:string,prepare:(guard:()=>void)=>Promise<{plan:unknown;result:unknown}>,outer:(()=>void)|undefined)=>{
  if(!state.enabled||state.pending)throw Error('Synthetic closed/pending');const epoch=state.epoch;const guard=()=>{if(state.uid!==uid||state.epoch!==epoch||!state.ready)throw Error('Synthetic account/vault changed');outer?.();};
  guard();await state.beforePrepare();guard();const captured=await prepare(guard);guard();state.captured.push(captured);return captured.result;
}}));
import {buildObsidianImportPlan,importObsidianVault,importParsedObsidianNotes,MAX_OBSIDIAN_NOTE_CHARS} from './obsidianVaultImport';
import {parseObsidianMarkdown} from './obsidianVaultParse';
import {buildEncryptedMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic} from './memoryCrypto';
import type {CapturedObsidianImport} from './obsidianImportRecovery';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const notes=()=>[parseObsidianMarkdown('One.md','Synthetic one [[Two]]'),parseObsidianMarkdown('Two.md','Synthetic two [[One]]')];
beforeEach(()=>{state.uid='alice';state.ready=true;state.enabled=true;state.pending=false;state.epoch=0;state.captured=[];state.beforePrepare=async()=>{};setMemoryCryptoMnemonic(words);});afterEach(()=>setMemoryCryptoMnemonic(null));
it('builds a complete encrypted plan with one undirected wikilink and connection-free creation records',async()=>{
  const result=await importParsedObsidianNotes('alice',notes());expect(result.imported).toBe(2);expect(result.linked).toBe(1);const captured=state.captured[0] as CapturedObsidianImport;
  expect(captured.plan.edges).toHaveLength(1);expect(captured.plan.edges[0].kind).toBe('wikilink');expect(captured.plan.memories.every(item=>(item.metadata.connections as unknown[]).length===0)).toBe(true);
  expect(JSON.stringify(captured.plan)).not.toContain('Synthetic one');expect((await decryptMemoryEnvelope(captured.plan.memories[0].enc)).text).toContain('Synthetic one');
});
it('captures all folder hubs, parent pairs, taxonomy and original note content before dispatch',async()=>{
  const input=[parseObsidianMarkdown('B Projetos/One.md','Synthetic first [[Two]]'),parseObsidianMarkdown('B Projetos/Two.md','Synthetic second')];
  const captured=await buildObsidianImportPlan(input,{sourceTag:'starter-universe',batchPrefix:'starter'});expect(captured.plan.source).toBe('starter-universe');expect(captured.result.hubIds).toHaveLength(1);expect(captured.plan.memories).toHaveLength(3);
  expect(captured.plan.edges.filter(edge=>edge.kind==='parent')).toHaveLength(2);expect(captured.result.linked).toBe(1);expect(captured.plan.memories[1].metadata.taxonomyLane).toBe('B');
});
it('closed gate or existing journal fails before reading selected files or sealing notes',async()=>{
  const text=vi.fn(async()=>'Synthetic');const file={name:'One.md',size:9,text} as unknown as File;state.enabled=false;
  await expect(importObsidianVault('alice',[file])).rejects.toThrow();state.enabled=true;state.pending=true;await expect(importObsidianVault('alice',[file])).rejects.toThrow();expect(text).not.toHaveBeenCalled();expect(state.captured).toHaveLength(0);
});
it('an account/vault transition during the first file stops subsequent file reads and dispatch',async()=>{
  for(const mode of ['account','vault']){
    state.epoch=0;const second=vi.fn(async()=>'Synthetic second');const first={name:'One.md',size:9,text:async()=>{state.epoch++;if(mode==='account'){state.uid='bob';state.uid='alice';}else{state.ready=false;state.ready=true;}return'Synthetic first';}} as unknown as File;
    await expect(importObsidianVault('alice',[first,{name:'Two.md',size:9,text:second} as unknown as File])).rejects.toThrow('changed');expect(second).not.toHaveBeenCalled();expect(state.captured).toHaveLength(0);
  }
});
it('whole notes/topology are validated before encryption: duplicate paths, malformed aliases and oversized text cannot partially seal',async()=>{
  for(const input of [[notes()[0],notes()[0]],[{...notes()[0],frontmatter:{...notes()[0].frontmatter,aliases:null}}],[{...notes()[0],content:'x'.repeat(MAX_OBSIDIAN_NOTE_CHARS+1)}]]){
    const encrypt=vi.fn(buildEncryptedMemoryFields);await expect(buildObsidianImportPlan(input as ReturnType<typeof notes>,{},undefined,{id:()=>crypto.randomUUID(),encrypt})).rejects.toThrow();expect(encrypt).not.toHaveBeenCalled();
  }
});
it('caller mutation after invocation cannot alter captured plaintext or add existing foreign/team memories to the plan',async()=>{
  const input=notes();state.beforePrepare=async()=>{input[1].content='Synthetic changed after capture';};const result=await importParsedObsidianNotes('alice',input);expect(result.imported).toBe(2);
  const captured=state.captured[0] as CapturedObsidianImport;expect((await decryptMemoryEnvelope(captured.plan.memories[1].enc)).text).toContain('Synthetic two');expect(captured.plan.memories).toHaveLength(2);
});
it('a scope change during sealing propagates before a plan can be admitted',async()=>{
  let current=true;const guard=()=>{if(!current)throw Error('Synthetic vault changed');};let calls=0;
  await expect(buildObsidianImportPlan(notes(),{},guard,{id:()=>crypto.randomUUID(),encrypt:async(text,title)=>{calls++;const sealed=await buildEncryptedMemoryFields(text,title);current=false;return sealed;}})).rejects.toThrow('vault changed');expect(calls).toBe(1);
});
