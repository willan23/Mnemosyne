import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('../firebase',()=>({db:{},auth:{},default:{}}));
import {reviewEmbeddingPublication,publishEmbeddingPlan,loadEmbeddingIndexHistory,EMBEDDING_PUBLICATION_BATCH_LIMIT,type EmbeddingPublicationDeps,type EmbeddingIndexHistoryDeps} from './embeddingIndexManagement';
import {buildEncryptedMemoryFields,setMemoryCryptoMnemonic,isMemoryCryptoReady} from './memoryCrypto';
import {embeddingIndexViewDigest} from './embeddingIndexRecovery';
import type {SessionData} from '../hooks/useSessions';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const nonce='11111111-1111-4111-8111-111111111111';
const memory=(id:string):SessionData=>({id,uid:'alice',text:'Synthetic source',timestamp:1,updatedAt:10,encrypted:true,syncConflictDigest:'a'.repeat(64)});
let records:SessionData[],byId:Map<string,SessionData>,deps:EmbeddingPublicationDeps,controller:AbortController,listeners:Set<()=>void>,uid:string;
const prepared=vi.fn(),capture=vi.fn(),publish=vi.fn(),mutation=()=>({uid:()=>uid,ready:isMemoryCryptoReady,subscribe:(changed:()=>void)=>{listeners.add(changed);return()=>{listeners.delete(changed);};}});
const current=(id:string)=>byId.get(id),options=()=>({signal:controller.signal,assertCurrent:()=>{},onProgress:vi.fn()});
beforeEach(()=>{setMemoryCryptoMnemonic(words);uid='alice';listeners=new Set();controller=new AbortController();records=[memory('a'),memory('b')];byId=new Map(records.map(row=>[row.id,row]));prepared.mockReset().mockResolvedValue({vector:[1,0]});capture.mockReset().mockImplementation(async input=>({sessionId:input.id,ownerUid:'alice',revision:10,stateDigest:'a'.repeat(64),stateHash:'b'.repeat(64),contentDigest:'c'.repeat(64)}));publish.mockReset().mockResolvedValue({status:'committed'});deps={enabled:()=>true,pending:()=>false,exclusive:async(_name,work)=>work(),prepared,capture,publish,mutation:mutation()};});
afterEach(()=>{setMemoryCryptoMnemonic(null);expect(listeners.size).toBe(0);});
it('reviews authorized personal candidates before sequential publication and excludes later arrivals from the captured plan',async()=>{
  records.push({...memory('foreign'),uid:'bob'},{...memory('team'),teamId:'crew'},{...memory('shared'),sharedWithIds:['bob']},{...memory('locked'),encLocked:true},{...memory('deleted'),deletedAt:2},{...memory('plaintext'),encrypted:false});
  const plan=await reviewEmbeddingPublication('alice',records,current,options(),deps);expect(plan.items.map(row=>row.id)).toEqual(['a','b']);expect(publish).not.toHaveBeenCalled();byId.set('later',memory('later'));
  const progress=vi.fn();expect(await publishEmbeddingPlan(plan,current,{...options(),onProgress:progress},deps)).toMatchObject({completed:2,total:2});expect(publish.mock.calls.map(row=>row[0].id)).toEqual(['a','b']);expect(progress.mock.calls).toEqual([[1,2],[2,2]]);
});
it('missing preparation or a changed source refuses the whole captured batch before the first write',async()=>{
  prepared.mockResolvedValueOnce({vector:[1]}).mockResolvedValueOnce(null);await expect(reviewEmbeddingPublication('alice',records,current,options(),deps)).rejects.toThrow();expect(capture).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled();
  prepared.mockResolvedValue({vector:[1]});const plan=await reviewEmbeddingPublication('alice',records,current,options(),deps);byId.set('b',{...memory('b'),syncConflictDigest:'d'.repeat(64)});await expect(publishEmbeddingPlan(plan,current,options(),deps)).rejects.toThrow();expect(publish).not.toHaveBeenCalled();
});
it('stopping after a confirmed memory never starts the next write; lost acknowledgement leaves the nonce to the recovery service',async()=>{
  const plan=await reviewEmbeddingPublication('alice',records,current,options(),deps);publish.mockImplementationOnce(async()=>{controller.abort();return{status:'committed'};});await expect(publishEmbeddingPlan(plan,current,options(),deps)).rejects.toThrow();expect(publish).toHaveBeenCalledOnce();
  controller=new AbortController();publish.mockClear().mockRejectedValueOnce(new Error('Synthetic pending ACK'));await expect(publishEmbeddingPlan(plan,current,options(),deps)).rejects.toThrow('pending ACK');expect(publish).toHaveBeenCalledOnce();
});
it('closed admission, an existing journal, duplicate IDs and observed account ABA refuse before publication',async()=>{
  await expect(reviewEmbeddingPublication('alice',records,current,options(),{...deps,enabled:()=>false})).rejects.toThrow();await expect(reviewEmbeddingPublication('alice',records,current,options(),{...deps,pending:()=>true})).rejects.toThrow();
  await expect(reviewEmbeddingPublication('alice',[records[0],records[0]],current,options(),deps)).rejects.toThrow();prepared.mockImplementationOnce(async()=>{uid='bob';listeners.forEach(changed=>changed());uid='alice';return{vector:[1]};});await expect(reviewEmbeddingPublication('alice',records,current,options(),deps)).rejects.toThrow();expect(publish).not.toHaveBeenCalled();
});
it('a bounded review reports the remaining corpus instead of claiming a complete large migration',async()=>{
  records=Array.from({length:EMBEDDING_PUBLICATION_BATCH_LIMIT+1},(_,index)=>memory('m'+index));byId=new Map(records.map(row=>[row.id,row]));const plan=await reviewEmbeddingPublication('alice',records,current,options(),deps);expect(plan.items.length).toBe(2000);expect(plan.remaining).toBe(1);expect(publish).not.toHaveBeenCalled();
});
async function historyFixture(){
  const row={uid:'alice',teamId:null,text:'',title:null,timestamp:1,updatedAt:10,...await buildEncryptedMemoryFields('Synthetic history source',null)},viewDigest=await embeddingIndexViewDigest(row),contentDigest=await embeddingIndexViewDigest({uid:'alice',teamId:null,enc:row.enc,keyEpoch:null,keyId:null});
  const archive={...row,createdAt:20,previousUpdatedAt:10,embedding:[1,0],embeddingIndex:{v:1,operationId:nonce,kind:'publish',contentDigest}},read=vi.fn().mockImplementation(async()=>structuredClone(row)),page=vi.fn().mockResolvedValue({rows:[{id:'embedding-index-'+nonce,data:archive}],tail:null});
  return{row,archive,read,page,viewDigest,historyDeps:{read,page,mutation:mutation()} satisfies EmbeddingIndexHistoryDeps,input:{uid:'alice',id:'note',viewDigest,assertCurrent:()=>{}}};
}
it('projects only model/version metadata from cipher archives and keeps pagination even across ordinary content versions',async()=>{
  const f=await historyFixture();f.page.mockResolvedValueOnce({rows:[{id:'content-revision',data:f.row}],tail:'page-two'});const first=await loadEmbeddingIndexHistory(f.input,f.historyDeps);expect(first.entries).toEqual([]);expect(first.next).not.toBeNull();
  const second=await loadEmbeddingIndexHistory({...f.input,cursor:first.next},f.historyDeps);expect(f.page.mock.calls[1][1]).toBe('page-two');expect(second.entries).toEqual([{versionId:'embedding-index-'+nonce,createdAt:20,previousRevision:10,space:'Xenova/all-MiniLM-L6-v2@legacy-main',dimensions:2,rollbackAllowed:true}]);expect(JSON.stringify(second.entries)).not.toContain('ct');expect(JSON.stringify(second.entries)).not.toContain('embedding":');
});
it('a valid older cipher is shown without rollback permission; malformed or foreign archives never become selectable',async()=>{
  const f=await historyFixture(),other=await buildEncryptedMemoryFields('Synthetic different history',null),otherDigest=await embeddingIndexViewDigest({uid:'alice',teamId:null,enc:other.enc,keyEpoch:null,keyId:null});
  f.page.mockResolvedValue({rows:[{id:'embedding-index-'+nonce,data:{...f.archive,enc:other.enc,embeddingIndex:{...f.archive.embeddingIndex,contentDigest:otherDigest}}},{id:'embedding-index-22222222-2222-4222-8222-222222222222',data:{...f.archive,uid:'bob'}}],tail:null});const result=await loadEmbeddingIndexHistory(f.input,f.historyDeps);expect(result.entries).toHaveLength(1);expect(result.entries[0].rollbackAllowed).toBe(false);expect(result.invalid).toBe(1);
});
it('late sharing, stale displayed digests, cursor scope mismatch and wrong vault keys never expose history',async()=>{
  const f=await historyFixture();await expect(loadEmbeddingIndexHistory({...f.input,viewDigest:'b'.repeat(64)},f.historyDeps)).rejects.toThrow();f.read.mockClear();await expect(loadEmbeddingIndexHistory({...f.input,cursor:{uid:'bob',sessionId:'note',viewDigest:f.viewDigest,tail:'foreign'}},f.historyDeps)).rejects.toThrow();expect(f.read).not.toHaveBeenCalled();
  f.page.mockImplementationOnce(async()=>{Object.assign(f.row,{sharedWithIds:['bob']});return{rows:[],tail:null};});await expect(loadEmbeddingIndexHistory(f.input,f.historyDeps)).rejects.toThrow();delete (f.row as Record<string,unknown>).sharedWithIds;
  setMemoryCryptoMnemonic([...words].reverse());await expect(loadEmbeddingIndexHistory(f.input,f.historyDeps)).rejects.toThrow();
});
