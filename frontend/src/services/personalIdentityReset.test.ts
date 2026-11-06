import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {buildEncryptedMemoryFields,decryptMemoryEnvelope,isMemoryCryptoReady,setMemoryCryptoMnemonic} from './memoryCrypto';
import {memoryEditStateDigest,type MemoryEditBaseline} from './memoryEditRecovery';
import {removePersonalMemoriesForIdentityReset,PersonalIdentityResetError,type PersonalIdentityResetDeps} from './personalIdentityReset';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
let records:Map<string,Record<string,unknown>>,deps:PersonalIdentityResetDeps,uid:string,enabled:boolean,pending:boolean,visible:boolean;
let listeners:Set<()=>void>;
const confirm=vi.fn(),progress=vi.fn(),remove=vi.fn(),capture=vi.fn(),page=vi.fn(),pause=vi.fn();
const input=()=>({uid:'alice',assertCurrent:()=>{if(!visible)throw Error('retired');},confirm,progress});
const add=async(id:string)=>records.set(id,{uid:'alice',teamId:null,timestamp:1,...await buildEncryptedMemoryFields(`Synthetic private ${id}`,null)});
beforeEach(async()=>{
  setMemoryCryptoMnemonic(words);uid='alice';enabled=true;pending=false;visible=true;records=new Map();listeners=new Set();
  confirm.mockReset().mockResolvedValue(true);progress.mockReset();pause.mockReset().mockResolvedValue(undefined);
  page.mockReset().mockImplementation(async(_uid:string,after:string|null)=>[...records].sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).filter(([id])=>after===null||Buffer.compare(Buffer.from(id),Buffer.from(after))>0).slice(0,20).map(([id,data])=>({id,data:structuredClone(data)})));
  capture.mockReset().mockImplementation(async request=>{
    request.assertCurrent();const data=records.get(request.id)!;
    expect(await memoryEditStateDigest(data)).toBe(request.viewDigest);
    expect(await decryptMemoryEnvelope(data.enc as Parameters<typeof decryptMemoryEnvelope>[0])).toMatchObject({text:request.expected.text,title:request.expected.title});
    return{sessionId:request.id,teamId:null,kind:'personal',authorUid:'alice',ownerUid:'alice',stateHash:'a'.repeat(64),stateDigest:request.viewDigest,revision:1,
      teamStateHash:null,epochStateHash:null,keyEpoch:null,keyId:null,priorKeyEpoch:null,priorKeyId:null} satisfies MemoryEditBaseline;
  });
  remove.mockReset().mockImplementation(async request=>{
    request.assertCurrent();expect(request.operation).toBe('delete');expect(request.teamId).toBeNull();
    records.set(request.id,{...records.get(request.id),deletedAt:10,updatedAt:10});
    return{status:'committed',operation:'delete',sessionId:request.id,teamId:null,operationId:'test-operation',digest:'b'.repeat(64),revision:10,createdAt:10};
  });
  deps={enabled:()=>enabled,page,read:async id=>structuredClone(records.get(id)),pending:()=>pending,digest:memoryEditStateDigest,decrypt:decryptMemoryEnvelope,capture,remove,pause,
    mutation:{uid:()=>uid,ready:isMemoryCryptoReady,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}}};
  await add('a');await add('b');
});
afterEach(()=>{setMemoryCryptoMnemonic(null);expect(listeners.size).toBe(0);});
it('closed admission or an unknown pending edit refuses before a server read or confirmation',async()=>{
  enabled=false;await expect(removePersonalMemoriesForIdentityReset(input(),deps)).rejects.toBeInstanceOf(PersonalIdentityResetError);
  enabled=true;pending=true;await expect(removePersonalMemoriesForIdentityReset(input(),deps)).rejects.toThrow('chave');
  expect(page).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
});
it('an explicit cancellation keeps every source and never prepares a deletion',async()=>{
  confirm.mockResolvedValue(false);const original=structuredClone([...records]);
  expect(await removePersonalMemoriesForIdentityReset(input(),deps)).toEqual({status:'cancelled',removed:0});
  expect(confirm).toHaveBeenCalledWith(2);expect([...records]).toEqual(original);expect(capture).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
});
it('pages the reviewed set and confirms every deletion before progress, preserving ciphertext',async()=>{
  for(let n=0;n<21;n++)await add(`c${String(n).padStart(2,'0')}`);
  const ciphertext=new Map([...records].map(([id,data])=>[id,data.enc]));
  expect(await removePersonalMemoriesForIdentityReset(input(),deps)).toEqual({status:'completed',removed:23});
  expect(confirm).toHaveBeenCalledWith(23);expect(page).toHaveBeenCalledTimes(4);expect(pause).toHaveBeenCalledTimes(22);
  expect(progress.mock.calls.at(-1)).toEqual([{removed:23,total:23}]);
  for(const[id,data]of records){expect(data.deletedAt).toBe(10);expect(data.enc).toEqual(ciphertext.get(id));}
  expect(JSON.stringify(remove.mock.calls)).not.toContain('Synthetic private');expect(isMemoryCryptoReady()).toBe(true);
});
it.each(['foreign','team','ambiguous','repeated-cursor','unsupported'])('a %s source refuses the whole plan before a deletion',async variant=>{
  if(variant==='foreign')records.get('b')!.uid='bob';
  if(variant==='team')records.get('b')!.teamId='crew';
  if(variant==='ambiguous')records.get('b')!.teamScopeAmbiguous=true;
  if(variant==='unsupported')records.get('b')!.nodes=[];
  if(variant==='repeated-cursor')page.mockResolvedValue([{id:'a',data:records.get('a')!},{id:'a',data:records.get('a')!}]);
  await expect(removePersonalMemoriesForIdentityReset(input(),deps)).rejects.toThrow();expect(confirm).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
});
it('accepts Firestore UTF-8 document order for supplementary Unicode IDs',async()=>{
  await add('\uE000');await add('\u{10000}');
  expect(await removePersonalMemoriesForIdentityReset(input(),deps)).toEqual({status:'completed',removed:4});
  expect(remove.mock.calls.map(([request])=>request.id)).toEqual(['a','b','\uE000','\u{10000}']);
});
it.each(['account-ABA','vault-ABA','closed-view','closed-gate'])('a %s change during confirmation aborts without deleting or resetting the key',async variant=>{
  confirm.mockImplementation(async()=>{
    if(variant==='account-ABA'){uid='bob';listeners.forEach(changed=>changed());uid='alice';}
    if(variant==='vault-ABA'){setMemoryCryptoMnemonic(null);listeners.forEach(changed=>changed());setMemoryCryptoMnemonic(words);}
    if(variant==='closed-view')visible=false;
    if(variant==='closed-gate')enabled=false;
    return true;
  });
  await expect(removePersonalMemoriesForIdentityReset(input(),deps)).rejects.toThrow();expect(remove).not.toHaveBeenCalled();expect(isMemoryCryptoReady()).toBe(true);
});
it('a source changed after review is retained instead of silently adding it to the approved deletion',async()=>{
  confirm.mockImplementation(async()=>{records.get('a')!.tags=['remote edit'];return true;});
  await expect(removePersonalMemoriesForIdentityReset(input(),deps)).rejects.toMatchObject({removed:0});expect(capture).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
});
it('a lost acknowledgement stops at that document, keeps recovery pending and reports only confirmed removals',async()=>{
  const commit=remove.getMockImplementation()!;
  remove.mockImplementation(async request=>{if(request.id==='b'){await commit(request);pending=true;throw Error('Synthetic lost acknowledgement');}return commit(request);});
  await expect(removePersonalMemoriesForIdentityReset(input(),deps)).rejects.toMatchObject({removed:1});
  expect(pending).toBe(true);expect(remove).toHaveBeenCalledTimes(2);expect(isMemoryCryptoReady()).toBe(true);
  expect(progress.mock.calls.at(-1)).toEqual([{removed:1,total:2}]);
});
it('a newly created memory after review prevents completion and is never deleted',async()=>{
  const commit=remove.getMockImplementation()!;
  remove.mockImplementation(async request=>{const result=await commit(request);if(request.id==='b')await add('new');return result;});
  await expect(removePersonalMemoriesForIdentityReset(input(),deps)).rejects.toMatchObject({removed:2});
  expect(records.get('new')!.deletedAt).toBeUndefined();expect(remove).toHaveBeenCalledTimes(2);expect(isMemoryCryptoReady()).toBe(true);
});
it('existing tombstones are not re-deleted and a mismatched receipt prevents key reset',async()=>{
  records.get('a')!.deletedAt=9;const commit=remove.getMockImplementation()!;
  remove.mockImplementation(async request=>({...await commit(request),sessionId:'other'}));
  await expect(removePersonalMemoriesForIdentityReset(input(),deps)).rejects.toMatchObject({removed:0});
  expect(confirm).toHaveBeenCalledWith(1);expect(remove).toHaveBeenCalledTimes(1);expect(isMemoryCryptoReady()).toBe(true);
});
