import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {buildEncryptedMemoryFields,encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic,isMemoryCryptoReady} from './memoryCrypto';
import {revisePersonalLearnedMemory,capturePersonalRevisionBaseline,recoverPendingPersonalRevision,cancelPendingPersonalRevision,personalRevisionCheckpointKey,
  type PersonalRevisionDeps,type PersonalRevisionBaseline,type PersonalRevisionContent} from './personalLearnedRevision';
import {canonicalSyncState} from '../../../functions/src/mobileSyncImportContract';
import {personalRevisionRequestBytes,type PersonalRevisionRequest} from '../../../functions/src/personalRevisionContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const content:PersonalRevisionContent={text:'Synthetic revised note',title:'Synthetic revised title',embedding:[0.1,0.2],embeddingModel:'synthetic-local',semanticClusterId:null,position:[1,2,3],importance:0.6,processingMethod:'learned:revision+local-embedding'};
let uid:string,enabled:boolean,current:Record<string,unknown>|undefined,stamp:number,baseline:PersonalRevisionBaseline,deps:PersonalRevisionDeps;
let receipt:Record<string,unknown>|undefined,archive:Record<string,unknown>|undefined,storage:Map<string,string>,listeners:Set<()=>void>;
let loseApply:boolean,failStatus:boolean,failRemoval:boolean,modeChanged:(mode:string)=>void;
const prepare=vi.fn(async()=>structuredClone(content));const call=vi.fn();const id=vi.fn();const key=personalRevisionCheckpointKey('alice');
const input=()=>({uid:'alice',id:'note',baseline,prepare});
async function fresh(){return{sessionId:'note',stateHash:await hash(canonicalSyncState([current,stamp])),stateDigest:await hash(canonicalSyncState(current)),revision:Number(current?.updatedAt??current?.timestamp)};}
beforeEach(async()=>{
  setMemoryCryptoMnemonic(words);uid='alice';enabled=true;stamp=1;receipt=undefined;archive=undefined;storage=new Map();listeners=new Set();loseApply=false;failStatus=false;failRemoval=false;modeChanged=()=>{};
  current={uid:'alice',teamId:null,timestamp:1,updatedAt:10,...await buildEncryptedMemoryFields('Synthetic previous note','Synthetic previous title'),learning:{source:'text-generation'},attachments:[{synthetic:true}],connections:['peer']};
  id.mockReset();id.mockReturnValue('11111111-1111-4111-8111-111111111111');prepare.mockReset();prepare.mockResolvedValue(structuredClone(content));call.mockReset();
  call.mockImplementation(async(mode:string,value:{sessionId:string}|PersonalRevisionRequest)=>{
    modeChanged(mode);if(mode==='prepare')return fresh();const request=value as PersonalRevisionRequest;const digest=await hash(personalRevisionRequestBytes(request));
    const unknown={operationId:request.operationId,sessionId:'note',digest,status:'unknown',revision:null,createdAt:null};
    if(mode==='status'){if(failStatus)throw Error('Synthetic status failure');return receipt??unknown;}
    if(receipt){if(receipt.digest!==digest)throw Error('Synthetic receipt mismatch');return receipt;}
    if(mode==='cancel'){receipt={...unknown,status:'cancelled',createdAt:1000};return receipt;}
    expect(storage.has(key)).toBe(true);if(canonicalSyncState(await fresh())!==canonicalSyncState(request.baseline))throw Error('Synthetic conflict');
    archive={text:'',title:null,enc:structuredClone(request.priorEnc)};current={...current,text:'',title:null,enc:structuredClone(request.enc),...request.metadata,updatedAt:1000};stamp++;
    receipt={...unknown,status:'committed',revision:1000,createdAt:1000};if(loseApply)throw Error('Synthetic lost acknowledgement');return receipt;
  });
  deps={enabled:()=>enabled,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v);},removeItem:k=>{if(failRemoval)throw Error('Synthetic removal failure');storage.delete(k);}},id,exclusive:async(_name,work)=>work(),
    read:async()=>structuredClone(current),encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,encryptContent:buildEncryptedMemoryFields,call,
    mutation:{uid:()=>uid,ready:isMemoryCryptoReady,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}}};
  baseline=await capturePersonalRevisionBaseline({uid:'alice',id:'note',expected:{text:'Synthetic previous note',title:'Synthetic previous title'}},deps);call.mockClear();
});
afterEach(()=>setMemoryCryptoMnemonic(null));
it('seals before RPC and independently confirms archived and new ciphertext before cleanup',async()=>{
  const before=structuredClone(current);await revisePersonalLearnedMemory(input(),deps);
  expect(await decryptMemoryEnvelope(current!.enc as Parameters<typeof decryptMemoryEnvelope>[0])).toMatchObject({text:content.text,title:content.title});
  expect(await decryptMemoryEnvelope(archive!.enc as Parameters<typeof decryptMemoryEnvelope>[0])).toMatchObject({text:'Synthetic previous note',title:'Synthetic previous title'});
  expect(current!.attachments).toEqual(before!.attachments);expect(storage.has(key)).toBe(false);expect(call.mock.calls.map(c=>c[0])).toEqual(['prepare','status','apply','status']);
  const transmitted=JSON.stringify(call.mock.calls.filter(c=>c[0]!=='prepare'));expect(transmitted).not.toContain('Synthetic revised');expect(transmitted).not.toContain('Synthetic previous');
});
it.each(['missing','owner','team','ambiguous','legacy-scope','shared','deleted','revision','locked','malformed-cipher','learning'] as const)('refuses unsafe initial state before inference: %s',async mode=>{
  if(mode==='missing')current=undefined;else{const d=current!;if(mode==='owner')d.uid='bob';if(mode==='team')d.teamId='crew';if(mode==='ambiguous')d.teamScopeAmbiguous=true;
    if(mode==='legacy-scope')delete d.teamId;if(mode==='shared')d.sharedWithIds=['bob'];if(mode==='deleted')d.deletedAt=11;if(mode==='revision')d.updatedAt=1.5;
    if(mode==='locked')d.enc={v:1,iv:'invalid',ct:'invalid'};if(mode==='malformed-cipher')d.enc={v:2};if(mode==='learning')d.learning='bad';}
  await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow();expect(prepare).not.toHaveBeenCalled();expect(receipt).toBeUndefined();expect(storage.size).toBe(0);
});
it.each(['metadata','revision','noop-version'] as const)('refuses a newer baseline before inference: %s',async mode=>{
  if(mode==='metadata')current!.attachments=[];if(mode==='revision')current!.updatedAt=11;if(mode==='noop-version')stamp++;
  await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow('rascunho');expect(prepare).not.toHaveBeenCalled();expect(receipt).toBeUndefined();
});
it('captures the supplied baseline by value before the first await',async()=>{
  const original=structuredClone(baseline);const oldRead=deps.read;deps.read=async id=>{baseline.revision=999;return oldRead(id);};
  await revisePersonalLearnedMemory(input(),deps);expect((call.mock.calls.find(c=>c[0]==='apply')![1] as PersonalRevisionRequest).baseline).toEqual(original);
});
it('refuses a displayed result that no longer matches stored plaintext',async()=>{
  await expect(capturePersonalRevisionBaseline({uid:'alice',id:'note',expected:{text:'Stale display',title:null}},deps)).rejects.toThrow('rascunho');
});
it('recovers a lost acknowledgement with the same ID and ciphertext after parent deletion, even with writes closed',async()=>{
  loseApply=true;await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow('lost acknowledgement');expect(storage.get(key)).not.toContain('Synthetic');
  current=undefined;enabled=false;const saved=receipt;call.mockClear();prepare.mockClear();
  expect(await recoverPendingPersonalRevision('alice',deps)).toEqual(saved);expect(call.mock.calls.map(c=>c[0])).toEqual(['status','status']);expect(prepare).not.toHaveBeenCalled();expect(id).toHaveBeenCalledOnce();expect(storage.size).toBe(0);
});
it('failed terminal status or removal preserves the exact sealed operation',async()=>{
  modeChanged=mode=>{if(mode==='apply')failStatus=true;};await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow();const raw=storage.get(key)!;
  failStatus=false;modeChanged=()=>{};failRemoval=true;await expect(recoverPendingPersonalRevision('alice',deps)).rejects.toThrow();expect(storage.get(key)).toBe(raw);
  failRemoval=false;await recoverPendingPersonalRevision('alice',deps);expect(storage.size).toBe(0);
});
it('pending revisions refuse new inference and permit cancellation when writes are closed',async()=>{
  failStatus=true;await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow();const raw=storage.get(key)!;prepare.mockClear();id.mockClear();
  await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow();expect(prepare).not.toHaveBeenCalled();expect(id).not.toHaveBeenCalled();expect(storage.get(key)).toBe(raw);
  enabled=false;failStatus=false;await expect(recoverPendingPersonalRevision('alice',deps)).rejects.toThrow();expect(storage.get(key)).toBe(raw);
  expect((await cancelPendingPersonalRevision('alice',deps)).status).toBe('cancelled');expect(storage.size).toBe(0);expect(archive).toBeUndefined();
});
it('closed writes refuse preparation, ID generation and RPC',async()=>{
  enabled=false;await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow('validação');expect(prepare).not.toHaveBeenCalled();expect(id).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();
});
it('encrypts legacy plaintext locally before sending its archive',async()=>{
  current={...current,enc:null,text:'Synthetic legacy text',title:'Synthetic legacy title'};baseline=await capturePersonalRevisionBaseline({uid:'alice',id:'note'},deps);call.mockClear();
  await revisePersonalLearnedMemory(input(),deps);expect(await decryptMemoryEnvelope(archive!.enc as Parameters<typeof decryptMemoryEnvelope>[0])).toMatchObject({text:'Synthetic legacy text'});
  expect(JSON.stringify(call.mock.calls)).not.toContain('Synthetic legacy');
});
it.each(['account','vault','outer'] as const)('refuses observed scope changes during preparation: %s',async mode=>{
  let active=true;prepare.mockImplementationOnce(async()=>{if(mode==='account'){uid='bob';for(const change of listeners)change();uid='alice';}
    if(mode==='vault'){setMemoryCryptoMnemonic(null);for(const change of listeners)change();setMemoryCryptoMnemonic(words);}if(mode==='outer')active=false;return content;});
  await expect(revisePersonalLearnedMemory({...input(),assertCurrent:()=>{if(!active)throw Error('Synthetic outer scope changed');}},deps)).rejects.toThrow();expect(receipt).toBeUndefined();expect(storage.size).toBe(0);
});
it('late acknowledgement after account change conserves the sealed receipt and refuses success',async()=>{
  const rpc=deps.call;deps.call=async(mode,value)=>{const result=await rpc(mode,value);if(mode==='apply'){uid='bob';for(const change of listeners)change();}return result;};
  await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow();expect(receipt?.status).toBe('committed');expect(storage.has(key)).toBe(true);
});
it('tampered ciphertext and replacement journals are preserved without acknowledgement',async()=>{
  failStatus=true;await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow();const raw=storage.get(key)!;
  storage.set(key,raw.replace(/"ct":"./,'"ct":"!'));failStatus=false;call.mockClear();await expect(recoverPendingPersonalRevision('alice',deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();
  storage.set(key,raw);modeChanged=mode=>{if(mode==='status')storage.set(key,'replacement');};await expect(recoverPendingPersonalRevision('alice',deps)).rejects.toThrow();expect(storage.get(key)).toBe('replacement');
});
it('invalid receipt bindings or unknown fields retain the pending operation',async()=>{
  const rpc=deps.call;deps.call=async(mode,value)=>{const result=await rpc(mode,value);return mode==='status'?{...(result as object),plaintext:'Synthetic leak'}:result;};
  await expect(revisePersonalLearnedMemory(input(),deps)).rejects.toThrow();expect(storage.has(key)).toBe(true);expect(receipt).toBeUndefined();
});
