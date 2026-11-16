import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('../firebase',()=>({db:{},auth:{},default:{}}));
import {reviewEmbeddingStorage,applyEmbeddingStoragePlan,resetEmbeddingStorageProgress,embeddingStorageCursorKey,EMBEDDING_STORAGE_PAGE_LIMIT,type EmbeddingStorageDeps} from './embeddingStorageManagement';
import {buildEncryptedMemoryFields,setMemoryCryptoMnemonic,isMemoryCryptoReady,encryptMemoryFields,decryptMemoryEnvelope,resolveMemoryDocFields} from './memoryCrypto';
import {embeddingIndexViewDigest} from './embeddingIndexRecovery';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
let owner:string,enabled:boolean,pending:boolean,rows:Map<string,Record<string,unknown>>,storage:Map<string,string>,listeners:Set<()=>void>,observers:Set<()=>void>,deps:EmbeddingStorageDeps;
const scope=()=>({signal:new AbortController().signal,assertCurrent:()=>{}}),key=embeddingStorageCursorKey('alice');
beforeEach(async()=>{
  setMemoryCryptoMnemonic(words);owner='alice';enabled=true;pending=false;rows=new Map();storage=new Map();listeners=new Set();observers=new Set();
  for(const id of ['note-1','note-2','note-3'])rows.set(id,{uid:'alice',teamId:null,timestamp:1,updatedAt:10,...await buildEncryptedMemoryFields('Synthetic private '+id,'Synthetic title '+id),embedding:id==='note-3'?'[1,0]':[1,0]});
  deps={enabled:()=>enabled,pending:()=>pending,storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);},removeItem:key=>{storage.delete(key);}},exclusive:async(_key,run)=>run(),observe:(_key,changed)=>{observers.add(changed);return()=>{observers.delete(changed);};},
    mutation:{uid:()=>owner,ready:isMemoryCryptoReady,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}},
    page:vi.fn(async(_uid,after)=>{const page=[...rows].filter(([id])=>after===null||id>after).map(([id,data])=>({id,data:structuredClone(data)}));return{rows:page,nextCursor:page.length?page[page.length-1].id:null};}),read:vi.fn(async id=>structuredClone(rows.get(id))),
    capture:vi.fn(async input=>({sessionId:input.id,ownerUid:'alice',stateHash:'a'.repeat(64),stateDigest:await embeddingIndexViewDigest(rows.get(input.id)!),contentDigest:'b'.repeat(64),revision:10})),
    compact:vi.fn(async input=>{const row=rows.get(input.id)!;row.embedding=JSON.stringify(row.embedding);row.updatedAt=11;return{operationId:'11111111-1111-4111-8111-111111111111',sessionId:input.id,digest:'c'.repeat(64),status:'committed',revision:11,versionId:'embedding-index-11111111-1111-4111-8111-111111111111',createdAt:11};}),
    encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,label:async row=>(await resolveMemoryDocFields(row)).title??''};
});
afterEach(()=>{setMemoryCryptoMnemonic(null);expect(listeners.size).toBe(0);expect(observers.size).toBe(0);});
it('reviews a bounded page with local labels and no mutation before confirmation',async()=>{
  const before=JSON.stringify([...rows]),plan=await reviewEmbeddingStorage('alice',scope(),deps);
  expect(plan.scanned).toBe(3);expect(plan.skipped).toBe(1);expect(plan.items.map(r=>r.id)).toEqual(['note-1','note-2']);expect(plan.items[0].label).toBe('Synthetic title note-1');
  expect(deps.compact).not.toHaveBeenCalled();expect(storage.size).toBe(0);expect(JSON.stringify([...rows])).toBe(before);expect(Object.isFrozen(plan.items[0].baseline)).toBe(true);
  expect(JSON.stringify(vi.mocked(deps.capture).mock.calls)).not.toContain('Synthetic private');
});
it('rejects foreign, team, oversized, duplicate or invalid pages before vector inspection',async()=>{
  const original=structuredClone(rows.get('note-1')!);let vectorReads=0;
  for(const data of [{...original,uid:'bob'},{...original,teamId:'team'}]){Object.defineProperty(data,'embedding',{get:()=>{vectorReads++;throw Error('Vector read before scope');}});vi.mocked(deps.page).mockResolvedValueOnce({rows:[{id:'foreign',data}],nextCursor:null});await expect(reviewEmbeddingStorage('alice',scope(),deps)).rejects.toThrow();}expect(vectorReads).toBe(0);
  for(const page of [{rows:Array.from({length:EMBEDDING_STORAGE_PAGE_LIMIT+1},(_,index)=>({id:'n'+index,data:original})),nextCursor:null},{rows:[{id:'same',data:original},{id:'same',data:original}],nextCursor:null},{rows:[{id:'note-1',data:original}],nextCursor:'foreign'}]){vi.mocked(deps.page).mockResolvedValueOnce(page);await expect(reviewEmbeddingStorage('alice',scope(),deps)).rejects.toThrow();}
  expect(deps.capture).not.toHaveBeenCalled();expect(deps.compact).not.toHaveBeenCalled();
});
it('skips shared, deleted, malformed and already compact notes without decrypting them',async()=>{
  rows.get('note-1')!.sharedWithIds=['bob'];rows.get('note-2')!.deletedAt=11;deps.label=vi.fn(async()=>{throw Error('Unexpected decryption');});
  const plan=await reviewEmbeddingStorage('alice',scope(),deps);expect(plan.items).toHaveLength(0);expect(deps.label).not.toHaveBeenCalled();expect(deps.capture).not.toHaveBeenCalled();
});
it('validates the full reviewed batch before writing and stores only an encrypted owner-bound cursor',async()=>{
  const plan=await reviewEmbeddingStorage('alice',scope(),deps),order:string[]=[];const read=deps.read,compact=deps.compact;deps.read=async id=>{order.push('read:'+id);return read(id);};deps.compact=async input=>{order.push('compact:'+input.id);return compact(input);};const progress=vi.fn();
  expect(await applyEmbeddingStoragePlan(plan,{...scope(),onProgress:progress},deps)).toEqual({completed:2,scanned:3,finished:false});expect(order).toEqual(['read:note-1','read:note-2','compact:note-1','compact:note-2']);expect(progress.mock.calls).toEqual([[1,2],[2,2]]);
  const raw=storage.get(key)!;expect(raw).not.toContain('note-3');expect(raw).not.toContain('Synthetic');expect(JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text)).toEqual({v:1,uid:'alice',lastId:'note-3'});
  await reviewEmbeddingStorage('alice',scope(),deps);expect(deps.page).toHaveBeenLastCalledWith('alice','note-3');
});
it('a stale later note prevents every write in that reviewed batch',async()=>{
  const plan=await reviewEmbeddingStorage('alice',scope(),deps);rows.get('note-2')!.updatedAt=12;await expect(applyEmbeddingStoragePlan(plan,scope(),deps)).rejects.toThrow();expect(deps.compact).not.toHaveBeenCalled();expect(storage.size).toBe(0);
});
it('partial failure keeps the old page and blocks review until pending recovery; completed notes are skipped on resume',async()=>{
  const plan=await reviewEmbeddingStorage('alice',scope(),deps),compact=deps.compact;deps.compact=vi.fn(async input=>{if(input.id==='note-2'){pending=true;throw Error('Synthetic pending request');}return compact(input);});
  await expect(applyEmbeddingStoragePlan(plan,scope(),deps)).rejects.toThrow('pending request');expect(storage.size).toBe(0);expect(rows.get('note-1')!.embedding).toBe('[1,0]');await expect(reviewEmbeddingStorage('alice',scope(),deps)).rejects.toThrow();
  pending=false;vi.mocked(compact).mockClear();deps.compact=compact;const resumed=await reviewEmbeddingStorage('alice',scope(),deps);expect(resumed.items.map(r=>r.id)).toEqual(['note-2']);await applyEmbeddingStoragePlan(resumed,scope(),deps);expect(deps.compact).toHaveBeenCalledOnce();expect(vi.mocked(deps.compact).mock.calls[0][0].id).toBe('note-2');
});
it('cursor replacement or a forged review never starts a mutation',async()=>{
  const plan=await reviewEmbeddingStorage('alice',scope(),deps);await expect(applyEmbeddingStoragePlan({...plan},scope(),deps)).rejects.toThrow();storage.set(key,'foreign replacement');await expect(applyEmbeddingStoragePlan(plan,scope(),deps)).rejects.toThrow();expect(deps.compact).not.toHaveBeenCalled();expect(storage.get(key)).toBe('foreign replacement');
});
it('rejects another owner inside an encrypted cursor and retains a corrupt cursor',async()=>{
  for(const raw of ['corrupt',JSON.stringify(await encryptMemoryFields({text:JSON.stringify({v:1,uid:'bob',lastId:'foreign'})}))]){storage.set(key,raw);await expect(reviewEmbeddingStorage('alice',scope(),deps)).rejects.toThrow();expect(storage.get(key)).toBe(raw);}
  expect(deps.page).not.toHaveBeenCalled();
});
it('cursor persistence failure cannot duplicate completed mutations on a new review',async()=>{
  const plan=await reviewEmbeddingStorage('alice',scope(),deps),set=deps.storage.setItem;deps.storage.setItem=()=>{throw Error('Synthetic local quota');};await expect(applyEmbeddingStoragePlan(plan,scope(),deps)).rejects.toThrow('local quota');expect(storage.size).toBe(0);
  deps.storage.setItem=set;const resumed=await reviewEmbeddingStorage('alice',scope(),deps);expect(resumed.items).toHaveLength(0);vi.mocked(deps.compact).mockClear();await applyEmbeddingStoragePlan(resumed,scope(),deps);expect(deps.compact).not.toHaveBeenCalled();
});
it('closed admission, a pending request or an observed account ABA stops all work',async()=>{
  enabled=false;await expect(reviewEmbeddingStorage('alice',scope(),deps)).rejects.toThrow();enabled=true;pending=true;await expect(reviewEmbeddingStorage('alice',scope(),deps)).rejects.toThrow();pending=false;
  const page=deps.page;deps.page=async(...args)=>{const result=await page(...args);owner='bob';listeners.forEach(changed=>changed());owner='alice';return result;};await expect(reviewEmbeddingStorage('alice',scope(),deps)).rejects.toThrow();expect(deps.capture).not.toHaveBeenCalled();expect(deps.compact).not.toHaveBeenCalled();
});
it('abort between confirmed items preserves the cursor and stops the next write',async()=>{
  const plan=await reviewEmbeddingStorage('alice',scope(),deps),control=new AbortController(),compact=deps.compact;deps.compact=vi.fn(async input=>{const result=await compact(input);control.abort();return result;});await expect(applyEmbeddingStoragePlan(plan,{signal:control.signal,assertCurrent:()=>{}},deps)).rejects.toThrow();expect(deps.compact).toHaveBeenCalledOnce();expect(storage.size).toBe(0);
});
it('reset changes only the local read cursor and refuses an unresolved request',async()=>{
  storage.set(key,'local cursor');storage.set('unrelated','preserve');pending=true;await expect(resetEmbeddingStorageProgress('alice',scope(),deps)).rejects.toThrow();expect(storage.has(key)).toBe(true);pending=false;enabled=false;await resetEmbeddingStorageProgress('alice',scope(),deps);expect(storage.get('unrelated')).toBe('preserve');expect(storage.has(key)).toBe(false);expect(deps.page).not.toHaveBeenCalled();expect(deps.compact).not.toHaveBeenCalled();
});
