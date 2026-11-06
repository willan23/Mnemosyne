import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {startCapturedDocumentImport,recoverPendingDocumentImport,cancelPendingDocumentImport,documentImportCheckpointKey,type DocumentImportRecoveryDeps,type CapturedDocumentImport} from './documentImportRecovery';
import {buildDocumentImportPlan} from './documentImportBuild';

import {encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic,buildEncryptedMemoryFields} from './memoryCrypto';

import {documentPlanBytes,documentPlanBatches,parseDocumentImportPlan,type DocumentImportStatus,type DocumentImportIdentity,type DocumentImportBatch} from '../../../functions/src/documentImportContract';
import {sealAttachment,attachmentKeyWrapper} from './attachmentCrypto';
import {attachmentBytesDigest} from './attachmentUploadCheckpoint';
import {encodeAttachmentHeader} from '../../../functions/src/attachmentEnvelope';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
async function hash(plan:CapturedDocumentImport['plan']){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(documentPlanBytes(plan)))),byte=>byte.toString(16).padStart(2,'0')).join('');}
function fixture(count=13){
  const storage=new Map<string,string>();const created=new Map<string,unknown>();const applied=new Set<number>();const state={uid:'alice',ready:true,enabled:true,blocked:false,listener:()=>undefined as void,server:null as DocumentImportStatus|null,plan:null as CapturedDocumentImport['plan']|null};
  const prepare=vi.fn(async(guard:()=>void)=>buildDocumentImportPlan('alice',Array.from({length:count},(_,index)=>new File(['Synthetic'],'Note-'+index+'.txt',{type:'text/plain'})),[],guard,
    {id:()=>crypto.randomUUID(),now:()=>1000,policy:()=> 'never-cloud',attachmentsEnabled:()=>false,extract:async()=>({text:'SYNTHETIC_VAULT_PRIVATE_TEXT_921',method:'Synthetic local'}),
     encrypt:buildEncryptedMemoryFields,process:vi.fn(async()=>{throw Error('Synthetic model unavailable');}),prepareAttachment:vi.fn()}));
  const deps:DocumentImportRecoveryDeps={validateUpload:vi.fn(async()=>{}),resumeUpload:vi.fn(async()=>({status:'ready' as const})),cancelUpload:vi.fn(async()=>{}),forgetUpload:vi.fn(async()=>{}),enabled:()=>state.enabled,blocked:()=>state.blocked,storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);},removeItem:key=>{storage.delete(key);}},
    exclusive:async(_name,work)=>work(),encryptJournal:vi.fn(encryptMemoryFields),decryptJournal:vi.fn(decryptMemoryEnvelope),mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:callback=>{state.listener=callback;return vi.fn();}},
    call:vi.fn(async(mode,value)=>{
      expect(JSON.stringify(value)).not.toContain('SYNTHETIC_VAULT_PRIVATE_TEXT_921');
      if(mode==='begin'){
        const plan=parseDocumentImportPlan(value);state.plan=plan;state.server={importId:plan.importId,planDigest:await hash(plan),status:'pending',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:plan.memories.length,edgeCount:plan.edges.length};
      }else if(mode==='apply'){
        const input=value as DocumentImportBatch;expect(input.batchIndex).toBe(state.server!.nextBatch);expect(applied.has(input.batchIndex)).toBe(false);applied.add(input.batchIndex);
        for(const memory of input.memories){expect(created.has(memory.sessionId)).toBe(false);created.set(memory.sessionId,memory.enc);}
        state.server={...state.server!,nextBatch:input.batchIndex+1,createdCount:state.server!.createdCount+input.memories.length,linkedCount:state.server!.linkedCount+input.edges.length,
          status:input.batchIndex+1===documentPlanBatches(state.plan!).length?'complete':'pending'};
      }else if(mode==='cancel'){
        const identity=value as DocumentImportIdentity;state.server=state.server?{...state.server,status:state.server.status==='complete'?'complete':'cancelled'}:
          {...identity,status:'cancelled',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:0,edgeCount:0};
      }
      return state.server?{...state.server}:{...value as DocumentImportIdentity,status:'unknown',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:0,edgeCount:0};
    })};
  return{storage,created,applied,state,prepare,deps};
}
const start=(f:ReturnType<typeof fixture>,progress?:((done:number,total:number)=>void))=>startCapturedDocumentImport('alice',f.prepare,undefined,progress,f.deps);
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();setMemoryCryptoMnemonic(words);});afterEach(()=>setMemoryCryptoMnemonic(null));
it('captures the whole real encrypted plan before the first server call, confirms every batch and then removes it',async()=>{
  const f=fixture();const call=f.deps.call;f.deps.call=vi.fn(async(mode,value)=>{expect(f.storage.size).toBe(1);const raw=[...f.storage.values()][0];expect(raw).not.toContain('alice');expect(raw).not.toContain('SYNTHETIC_VAULT_PRIVATE_TEXT_921');
    const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);expect(journal.uid).toBe('alice');expect(journal.plan.memories).toHaveLength(14);return call(mode,value);});
  const progress=vi.fn();await expect(start(f,progress)).resolves.toMatchObject({imported:13});expect(f.prepare).toHaveBeenCalledOnce();expect(f.deps.encryptJournal).toHaveBeenCalledOnce();expect(f.created.size).toBe(14);expect(f.storage.size).toBe(0);
  expect(vi.mocked(f.deps.call).mock.calls.map(([mode])=>mode)).toEqual(['status','begin','apply','apply','apply','status']);expect(progress).toHaveBeenLastCalledWith(13,13);
});
it.each(['begin','create','link'] as const)('recovers a lost %s ACK with the same plan, IDs and ciphers and never reapplies confirmed batches',async lost=>{
  const f=fixture();const call=f.deps.call;let failed=false;f.deps.call=vi.fn(async(mode,value)=>{const result=await call(mode,value);const batch=value as DocumentImportBatch;
    if(!failed&&(lost==='begin'?mode==='begin':mode==='apply'&&batch.phase===(lost==='create'?'create':'link'))){failed=true;throw Error('Synthetic lost ACK');}return result;});
  await expect(start(f)).rejects.toThrow();expect(f.storage.size).toBe(1);const raw=[...f.storage.values()][0];const initial=statePlanIds(f);const before=f.applied.size;
  await expect(start(f)).rejects.toMatchObject({reason:'pending'});expect([...f.storage.values()][0]).toBe(raw);
  if(lost==='link')f.state.enabled=false;vi.mocked(call).mockClear();f.deps.call=vi.fn(call);
  await expect(recoverPendingDocumentImport('alice',f.deps)).resolves.toMatchObject({status:{status:'complete'},importedConfirmed:13,linksConfirmed:13});
  expect(statePlanIds(f)).toEqual(initial);expect(f.applied.size).toBe(3);expect(f.created.size).toBe(14);expect(f.prepare).toHaveBeenCalledOnce();expect(f.deps.encryptJournal).toHaveBeenCalledOnce();expect(f.storage.size).toBe(0);
  expect(vi.mocked(f.deps.call).mock.calls.filter(([mode])=>mode==='apply')).toHaveLength(3-before);
});
function statePlanIds(f:ReturnType<typeof fixture>){return f.state.plan!.memories.map(memory=>({id:memory.sessionId,enc:memory.enc}));}
it('a lost terminal status or failed cleanup retains the original plan; a closed gate still allows final confirmation',async()=>{
  for(const mode of ['status','cleanup']){
    const f=fixture(2);const call=f.deps.call;
    if(mode==='status')f.deps.call=vi.fn(async(mode,value)=>{const result=await call(mode,value);if(mode==='status'&&f.state.server?.status==='complete')throw Error('Synthetic status unavailable');return result;});
    else f.deps.storage.removeItem=()=>{throw Error('Synthetic cleanup unavailable');};
    await expect(start(f)).rejects.toThrow();expect(f.storage.size).toBe(1);f.state.enabled=false;vi.mocked(call).mockClear();f.deps.call=vi.fn(call);f.deps.storage.removeItem=key=>{f.storage.delete(key);};
    await expect(recoverPendingDocumentImport('alice',f.deps)).resolves.toMatchObject({status:{status:'complete'}});expect(vi.mocked(f.deps.call).mock.calls.map(([mode])=>mode)).toEqual(['status','status']);expect(f.storage.size).toBe(0);
  }
});
it('partial cancellation keeps confirmed notes, blocks all remaining work and confirms an already complete import',async()=>{
  const f=fixture();const call=f.deps.call;f.deps.call=vi.fn(async(mode,value)=>{const result=await call(mode,value);if(mode==='apply')throw Error('Synthetic lost creation ACK');return result;});
  await expect(start(f)).rejects.toThrow();f.state.enabled=false;vi.mocked(call).mockClear();f.deps.call=vi.fn(call);
  await expect(recoverPendingDocumentImport('alice',f.deps)).rejects.toMatchObject({reason:'pending'});expect(f.storage.size).toBe(1);
  await expect(cancelPendingDocumentImport('alice',f.deps)).resolves.toMatchObject({status:{status:'cancelled'},importedConfirmed:9,linksConfirmed:0});expect(f.created.size).toBe(10);expect(f.storage.size).toBe(0);
});
it.each(['closed','blocked','owner','locked','write','readback','lock'] as const)('rejects %s before admission or mutations',async mode=>{
  const f=fixture(2);if(mode==='closed')f.state.enabled=false;if(mode==='blocked')f.state.blocked=true;if(mode==='owner')f.state.uid='bob';if(mode==='locked')f.state.ready=false;
  if(mode==='write')f.deps.storage.setItem=()=>{throw Error('Synthetic storage failure');};if(mode==='readback')f.deps.storage.setItem=()=>undefined;if(mode==='lock')f.deps.exclusive=async()=>{throw Error('Synthetic busy');};
  await expect(start(f)).rejects.toThrow();expect(f.deps.call).not.toHaveBeenCalled();if(!['write','readback'].includes(mode))expect(f.prepare).not.toHaveBeenCalled();
});
it.each(['prepare','seal','status','begin','apply','progress'] as const)('latches an account or vault transition at %s and conserves all confirmed progress',async stage=>{
  const f=fixture(2);const transition=()=>{f.state.uid='bob';f.state.listener();f.state.uid='alice';};
  if(stage==='prepare'){const prepare=f.prepare;f.prepare=vi.fn(async guard=>{const result=await prepare(guard);transition();return result;});}
  else if(stage==='seal')f.deps.encryptJournal=async value=>{const result=await encryptMemoryFields(value);transition();return result;};
  else if(stage!=='progress'){const call=f.deps.call;f.deps.call=vi.fn(async(mode,value)=>{const result=await call(mode,value);if(mode===stage)transition();return result;});}
  await expect(start(f,stage==='progress'?transition:undefined)).rejects.toThrow();expect(f.storage.size).toBe(['prepare','seal'].includes(stage)?0:1);
  if(['prepare','seal','status','begin'].includes(stage))expect(f.applied.size).toBe(0);
});
it('corrupt journals, wrong vaults and UID transplants fail before RPC; replacing a journal during an await prevents cleanup or later work',async()=>{
  for(const mode of ['corrupt','vault','uid','replace']){
    const f=fixture(2);const call=f.deps.call;f.deps.call=vi.fn(async()=>{throw Error('Synthetic unavailable');});await expect(start(f)).rejects.toThrow();
    const key=documentImportCheckpointKey('alice');const raw=f.storage.get(key)!;
    if(mode==='corrupt')f.storage.set(key,'{}');if(mode==='vault')setMemoryCryptoMnemonic([...words].reverse());
    if(mode==='uid'){const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);journal.uid='bob';f.storage.set(key,JSON.stringify(await encryptMemoryFields({text:JSON.stringify(journal)})));}
    f.deps.call=vi.fn(async(mode,value)=>{const result=await call(mode,value);f.storage.set(key,'replacement');return result;});
    await expect(recoverPendingDocumentImport('alice',f.deps)).rejects.toThrow();expect(f.storage.size).toBe(1);if(mode!=='replace')expect(f.deps.call).not.toHaveBeenCalled();else expect(f.storage.get(key)).toBe('replacement');setMemoryCryptoMnemonic(words);
  }
});
it('forged or inconsistent status does not clear the only recovery plan',async()=>{
  for(const patch of [{planDigest:'f'.repeat(64)},{importId:'other'},{createdCount:999},{nextBatch:999},{status:'complete',nextBatch:0},{uid:'alice'}]){
    const f=fixture(2);const call=f.deps.call;f.deps.call=vi.fn(async(mode,value)=>{const result=await call(mode,value);if(mode==='status'&&f.state.server)return{...result as object,...patch};return result;});
    await expect(start(f)).rejects.toThrow();expect(f.storage.size).toBe(1);
  }
});
async function uploadedFixture(){
  const f=fixture(2);const prepare=f.prepare;const key=attachmentKeyWrapper(await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']));const originals=new Set<string>();const ready=new Set<string>();
  f.prepare=vi.fn(async guard=>{const value=await prepare(guard);for(let i=1;i<value.plan.memories.length;i++){
    const id=crypto.randomUUID();const sealed=await sealAttachment({id,uid:'alice',scope:{kind:'personal',uid:'alice'},bytes:new TextEncoder().encode('Synthetic original '+i),name:'Synthetic-'+i+'.txt',mimeType:'text/plain'},key,guard);
    value.uploads.push({id,header:sealed.header,bytesDigest:await attachmentBytesDigest(sealed.bytes)});originals.add(id);value.plan.attachments.push({id,headerDigest:await attachmentBytesDigest(encodeAttachmentHeader(sealed.header))});
    value.plan.memories[i].attachmentIds=[id];(value.plan.memories[i].metadata.learning as Record<string,unknown>).attachmentCount=1;value.plan.memories[0].attachmentIds.push(id);
  }(value.plan.memories[0].metadata.learning as Record<string,unknown>).attachmentCount=value.uploads.length;value.plan=parseDocumentImportPlan(value.plan);return value;});
  f.deps.validateUpload=vi.fn(async(_uid,upload,guard)=>{guard();if(!originals.has(upload.id))throw Error('Synthetic file absent');});
  f.deps.resumeUpload=vi.fn(async(_uid,upload,guard)=>{guard();ready.add(upload.id);return{status:'ready'};});
  f.deps.forgetUpload=vi.fn(async(_uid,upload,guard)=>{guard();originals.delete(upload.id);});f.deps.cancelUpload=vi.fn(async(_uid,upload,guard)=>{guard();if(!ready.has(upload.id))originals.delete(upload.id);});
  return{...f,originals,ready};
}
it('captures all encrypted original handles before admission, uploads before memory creation and forgets files only after repeated terminal confirmation',async()=>{
  const f=await uploadedFixture();const call=f.deps.call;f.deps.call=vi.fn(async(mode,value)=>{
    const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse([...f.storage.values()][0]))).text);expect(journal.uploads).toHaveLength(2);
    if(mode==='apply')expect(f.ready.size).toBe(2);expect(f.originals.size).toBe(2);return call(mode,value);
  });
  await start(f);expect(f.deps.resumeUpload).toHaveBeenCalledTimes(2);expect(f.deps.forgetUpload).toHaveBeenCalledTimes(2);expect(f.originals.size).toBe(0);expect(f.storage.size).toBe(0);
});
it('a lost upload ACK retains the whole plan and resumes the same file handles before creating any note',async()=>{
  const f=await uploadedFixture();const resume=f.deps.resumeUpload;let failed=false;f.deps.resumeUpload=vi.fn(async(...args)=>{const result=await resume(...args);if(!failed){failed=true;throw Error('Synthetic lost upload ACK');}return result;});
  await expect(start(f)).rejects.toThrow();expect(f.created.size).toBe(0);expect(f.storage.size).toBe(1);const raw=[...f.storage.values()][0];const plan=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);
  await expect(recoverPendingDocumentImport('alice',f.deps)).resolves.toMatchObject({status:{status:'complete'},importedConfirmed:2});expect(f.created.size).toBe(3);expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.state.plan!.memories.map(item=>item.enc)).toEqual(plan.plan.memories.map((item:{enc:unknown})=>item.enc));expect(f.ready.size).toBe(2);
});
it('terminal cleanup failures preserve a resumable whole-plan journal even after some original checkpoints are removed',async()=>{
  const f=await uploadedFixture();const forget=f.deps.forgetUpload;let count=0;f.deps.forgetUpload=vi.fn(async(...args)=>{if(++count===2)throw Error('Synthetic cleanup unavailable');return forget(...args);});
  await expect(start(f)).rejects.toThrow();expect(f.state.server!.status).toBe('complete');expect(f.originals.size).toBe(1);expect(f.storage.size).toBe(1);
  vi.mocked(f.deps.validateUpload).mockClear();vi.mocked(f.deps.resumeUpload).mockClear();f.deps.forgetUpload=forget;f.state.enabled=false;
  await expect(recoverPendingDocumentImport('alice',f.deps)).resolves.toMatchObject({status:{status:'complete'}});expect(f.originals.size).toBe(0);expect(f.deps.validateUpload).not.toHaveBeenCalled();expect(f.deps.resumeUpload).not.toHaveBeenCalled();
});
it('cancellation confirms the root first, cancels pending originals, retains ready originals and conserves the journal if cancellation acknowledgment is lost',async()=>{
  const f=await uploadedFixture();const resume=f.deps.resumeUpload;f.deps.resumeUpload=vi.fn(async(...args)=>{await resume(...args);throw Error('Synthetic lost upload ACK');});
  await expect(start(f)).rejects.toThrow();const cancel=f.deps.cancelUpload;let failed=false;f.deps.cancelUpload=vi.fn(async(...args)=>{expect(f.state.server!.status).toBe('cancelled');await cancel(...args);if(!failed){failed=true;throw Error('Synthetic lost cancel ACK');}});
  await expect(cancelPendingDocumentImport('alice',f.deps)).rejects.toThrow();expect(f.storage.size).toBe(1);f.deps.cancelUpload=cancel;
  await expect(cancelPendingDocumentImport('alice',f.deps)).resolves.toMatchObject({status:{status:'cancelled'},importedConfirmed:0});expect(f.originals.size).toBe(1);expect(f.ready.size).toBe(1);expect(f.created.size).toBe(0);expect(f.deps.forgetUpload).not.toHaveBeenCalled();
});
it('a missing original stops new admission and a swapped manifest stops even status RPC',async()=>{
  for(const mode of ['missing','manifest']){const f=await uploadedFixture();const prepare=f.prepare;f.prepare=vi.fn(async guard=>{const value=await prepare(guard);if(mode==='missing')f.originals.clear();else value.plan.attachments[0].headerDigest='f'.repeat(64);return value;});
    await expect(start(f)).rejects.toThrow();expect(f.deps.call).not.toHaveBeenCalled();expect(f.storage.size).toBe(1);expect(f.deps.resumeUpload).not.toHaveBeenCalled();}
});
it('observed cloud-policy changes remain latched after upload ACK and prevent creating notes or clearing the recovery plan',async()=>{
  const f=await uploadedFixture();let listener=()=>{};f.deps.policy=()=> 'allow-cloud';f.deps.subscribePolicy=callback=>{listener=callback;return vi.fn();};
  const resume=f.deps.resumeUpload;f.deps.resumeUpload=vi.fn(async(...args)=>{const result=await resume(...args);listener();return result;});
  await expect(start(f)).rejects.toThrow();expect(f.ready.size).toBe(1);expect(f.created.size).toBe(0);expect(f.storage.size).toBe(1);expect(f.deps.forgetUpload).not.toHaveBeenCalled();
});
