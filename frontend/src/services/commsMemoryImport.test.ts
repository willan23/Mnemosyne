import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {importCommsMemory,captureCommsMemory,recoverPendingCommsImport,cancelPendingCommsImport,commsImportCheckpointKey,type CommsImportDeps,type CommsMemoryInput} from './commsMemoryImport';
import {buildEncryptedMemoryFields,encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic,isMemoryCryptoReady} from './memoryCrypto';
import {canonicalAttachedMemoryJson,type AttachedMemoryInput} from '../../../functions/src/attachedMemoryContract';
import type {MemoryPermission} from './localAiConfig';
import type {SessionData} from '../hooks/useSessions';
import {CURRENT_EMBEDDING_SPACE} from './embeddingModel';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const memoryId='11111111-1111-4111-8111-111111111111',fileId='22222222-2222-4222-8222-222222222222',key=commsImportCheckpointKey('alice');
const data:CommsMemoryInput={text:'PRIVATE_COMMS_BODY_864 á漢🙂',title:'PRIVATE_COMMS_TITLE_864',attachment:{name:'PRIVATE_FILENAME_864.txt',type:'text/plain',size:4,dataUrl:'data:text/plain;base64,dGVzdA=='}};
let deps:CommsImportDeps,uid:string,policy:MemoryPermission,enabled:boolean,receipt:Record<string,unknown>|undefined,request:AttachedMemoryInput|undefined;
let storage:Map<string,string>,listeners:Set<()=>void>,policyListeners:Set<()=>void>,loseApply:boolean,failStatus:boolean,loseUpload:boolean,uploaded:boolean;
const call=vi.fn(),id=vi.fn(),process=vi.fn(),prepareUpload=vi.fn(),validateUpload=vi.fn(),resumeUpload=vi.fn(),forgetUpload=vi.fn(),cancelUpload=vi.fn();
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
beforeEach(()=>{
  setMemoryCryptoMnemonic(words);uid='alice';policy='allow-cloud';enabled=true;receipt=undefined;request=undefined;storage=new Map();listeners=new Set();policyListeners=new Set();loseApply=false;failStatus=false;loseUpload=false;uploaded=false;
  for(const mock of [call,id,process,prepareUpload,validateUpload,resumeUpload,forgetUpload,cancelUpload])mock.mockReset();id.mockReturnValueOnce(memoryId).mockReturnValue(fileId);
  process.mockResolvedValue({embedding:[.1,.2],embeddingModel:'synthetic-local',importance:.6,position:[1,2,3],celestialType:'planet'});
  prepareUpload.mockImplementation(async input=>({id:input.id,bytesDigest:'a'.repeat(64),header:{v:1,id:input.id,uid:input.uid,scope:{kind:'personal',uid:input.uid},category:'document',plainBytes:input.file.size,metadataBytes:2,cipherBytes:input.file.size+22,iv:'A'.repeat(16),wrappedKey:{iv:'A'.repeat(16),ct:'B'.repeat(64)}}}));
  validateUpload.mockImplementation(async(_uid,_upload,guard)=>{guard();});resumeUpload.mockImplementation(async(_uid,_upload,guard)=>{guard();uploaded=true;if(loseUpload){loseUpload=false;throw Error('Synthetic lost upload ACK');}return{status:'ready'};});
  forgetUpload.mockImplementation(async(_uid,_upload,guard)=>{guard();});cancelUpload.mockImplementation(async(_uid,_upload,guard)=>{guard();return{status:'cancelled'};});
  call.mockImplementation(async(mode:string,value:AttachedMemoryInput)=>{
    const digest=await hash(canonicalAttachedMemoryJson(value));const unknown={sessionId:value.sessionId,digest,status:'unknown',createdAt:null};
    if(mode==='status'){if(failStatus)throw Error('Synthetic status unavailable');return receipt??unknown;}
    if(receipt){expect(receipt.digest).toBe(digest);return receipt;}
    if(mode==='cancel'){receipt={...unknown,status:'cancelled',createdAt:1000};return receipt;}
    expect(storage.has(key)).toBe(true);expect(!value.attachmentIds.length||uploaded).toBe(true);request=structuredClone(value);receipt={...unknown,status:'committed',createdAt:1000};if(loseApply)throw Error('Synthetic lost memory ACK');return receipt;
  });
  deps={enabled:()=>enabled,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v);},removeItem:k=>{storage.delete(k);}},id,now:()=>1000,exclusive:async(_key,work)=>work(),policy:()=>policy,subscribePolicy:changed=>{policyListeners.add(changed);return()=>{policyListeners.delete(changed);};},
    encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,encryptContent:buildEncryptedMemoryFields,process,prepareUpload,validateUpload,resumeUpload,forgetUpload,cancelUpload,call,
    mutation:{uid:()=>uid,ready:isMemoryCryptoReady,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}}};
});
afterEach(()=>setMemoryCryptoMnemonic(null));
it('owns a fresh ID and journals before RPC; transmits opaque attachment IDs and real ciphertext only',async()=>{
  const result=await importCommsMemory('alice',data,[],()=>{},deps);expect(result.id).toBe(memoryId);expect(request!.attachmentIds).toEqual([fileId]);expect(request!.teamId).toBeNull();
  expect(await decryptMemoryEnvelope(request!.enc)).toMatchObject({text:data.text,title:data.title});expect(request!.metadata.learning).toMatchObject({source:'comms-import',attachmentCount:1});
  expect(prepareUpload.mock.calls[0][0].file).toMatchObject({name:data.attachment!.name,type:'text/plain',size:4});expect(prepareUpload.mock.calls[0][0].id).toBe(fileId);
  const transmitted=JSON.stringify(call.mock.calls);for(const marker of ['PRIVATE_COMMS_BODY','PRIVATE_COMMS_TITLE','PRIVATE_FILENAME','data:text'])expect(transmitted).not.toContain(marker);
  expect(call.mock.calls.map(c=>c[0])).toEqual(['status','apply','status','status']);expect(forgetUpload).toHaveBeenCalledOnce();expect(storage.size).toBe(0);
});
it.each(['lost-file','lost-memory'] as const)('recovers stable file/memory IDs and ciphers without repeating preparation: %s',async mode=>{
  if(mode==='lost-file')loseUpload=true;else loseApply=true;await expect(importCommsMemory('alice',data,[],()=>{},deps)).rejects.toThrow();const raw=storage.get(key)!;
  expect(raw).not.toContain('PRIVATE');const sealed=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);expect(sealed.request.sessionId).toBe(memoryId);expect(sealed.upload.id).toBe(fileId);
  if(mode==='lost-memory')enabled=false;await recoverPendingCommsImport('alice',deps);expect(request!.enc).toEqual(sealed.request.enc);expect(id).toHaveBeenCalledTimes(2);expect(process).toHaveBeenCalledOnce();expect(prepareUpload).toHaveBeenCalledOnce();expect(storage.size).toBe(0);
});
it('pending operations refuse a new ID, inference and local upload preparation; closed writes permit cancellation',async()=>{
  failStatus=true;await expect(importCommsMemory('alice',data,[],()=>{},deps)).rejects.toThrow();const raw=storage.get(key)!;id.mockClear();process.mockClear();prepareUpload.mockClear();
  await expect(importCommsMemory('alice',data,[],()=>{},deps)).rejects.toThrow();expect(id).not.toHaveBeenCalled();expect(process).not.toHaveBeenCalled();expect(prepareUpload).not.toHaveBeenCalled();expect(storage.get(key)).toBe(raw);
  failStatus=false;enabled=false;expect((await cancelPendingCommsImport('alice',deps)).status).toBe('cancelled');expect(cancelUpload).toHaveBeenCalledOnce();expect(call.mock.calls.some(c=>c[0]==='apply')).toBe(false);
});
it('never-cloud refuses new received attachments before inference or RPC and permits encrypted text synchronization',async()=>{
  policy='never-cloud';await expect(importCommsMemory('alice',data,[],()=>{},deps)).rejects.toThrow();expect(process).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();
  await importCommsMemory('alice',{...data,attachment:null},[],()=>{},deps);expect(request!.attachmentIds).toEqual([]);expect(prepareUpload).not.toHaveBeenCalled();expect(resumeUpload).not.toHaveBeenCalled();
});
it('closed writes refuse IDs, inference, upload preparation and RPC',async()=>{
  enabled=false;await expect(importCommsMemory('alice',data,[],()=>{},deps)).rejects.toThrow();expect(id).not.toHaveBeenCalled();expect(process).not.toHaveBeenCalled();expect(prepareUpload).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();
});
it.each(['remote','mime','size','path','extra','padding','body'] as const)('rejects invalid received data before inference: %s',async mode=>{
  const bad=structuredClone(data);if(mode==='remote')bad.attachment!.dataUrl='https://example.invalid/file';if(mode==='mime')bad.attachment!.type='image/png';if(mode==='size')bad.attachment!.size=5;
  if(mode==='path')bad.attachment!.name='../unsafe';if(mode==='extra')(bad as unknown as Record<string,unknown>).uid='bob';if(mode==='padding')bad.attachment!.dataUrl='data:text/plain;base64,dGVzdB==';if(mode==='body')bad.text='🙂'.repeat(62_501);
  await expect(importCommsMemory('alice',bad,[],()=>{},deps)).rejects.toThrow();expect(process).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();
});
it('captures received payload and only readable, live owned personal semantic candidates before awaits',async()=>{
  const input=structuredClone(data);process.mockImplementationOnce(async()=>{input.text='Changed';input.attachment!.name='changed.txt';return{embedding:[1],embeddingModel:'synthetic-local'};});
  const sessions=[{id:'good',uid:'alice',teamId:null,text:'Allowed'}, {id:'other',uid:'bob',teamId:null}, {id:'team',uid:'alice',teamId:'crew'}, {id:'locked',uid:'alice',teamId:null,encLocked:true}, {id:'deleted',uid:'alice',teamId:null,deletedAt:1}] as SessionData[];
  await importCommsMemory('alice',input,sessions,()=>{},deps);expect(process.mock.calls[0][1].map((item:SessionData)=>item.id)).toEqual(['good']);expect(prepareUpload.mock.calls[0][0].file.name).toBe(data.attachment!.name);
  expect((await decryptMemoryEnvelope(request!.enc)).text).toBe(data.text);
});
it('captures candidate vectors without copying or reading existing plaintext and forwards the durable-operation guard',async()=>{
  const source={id:'own',uid:'alice',embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE,position:[1,2,3]} as SessionData;
  for(const name of ['text','title','attachments','enc'])Object.defineProperty(source,name,{get(){throw Error('Existing content read');}});
  await importCommsMemory('alice',{...data,attachment:null},[source],()=>{},deps);const candidates=process.mock.calls[0][1];
  expect(candidates[0].embedding).toEqual([1,0]);expect(candidates[0].embedding).not.toBe(source.embedding);expect(Object.hasOwn(candidates[0],'text')).toBe(false);
  expect(process.mock.calls[0][2].assertCurrent).toEqual(expect.any(Function));expect(request!.metadata.connections).toEqual([]);
});
it.each(['account','vault','policy','outer'] as const)('latches enclosing scope loss even after returning: %s',async mode=>{
  let active=true;process.mockImplementationOnce(async()=>{if(mode==='account'){uid='bob';for(const change of listeners)change();uid='alice';}if(mode==='vault'){setMemoryCryptoMnemonic(null);for(const change of listeners)change();setMemoryCryptoMnemonic(words);}
    if(mode==='policy'){policy='never-cloud';for(const change of policyListeners)change();policy='allow-cloud';}if(mode==='outer')active=false;return{embedding:[1]};});
  await expect(importCommsMemory('alice',data,[],()=>{if(!active)throw Error('Synthetic panel changed');},deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();expect(storage.size).toBe(0);
});
it('failed terminal confirmation or cleanup conserves the exact journal and never repeats an acknowledged apply',async()=>{
  const rpc=deps.call;deps.call=async(mode,value)=>{const result=await rpc(mode,value);if(mode==='apply')failStatus=true;return result;};await expect(importCommsMemory('alice',data,[],()=>{},deps)).rejects.toThrow();const raw=storage.get(key)!;
  failStatus=false;deps.call=rpc;forgetUpload.mockRejectedValueOnce(Error('Synthetic cleanup unavailable'));await expect(recoverPendingCommsImport('alice',deps)).rejects.toThrow();expect(storage.get(key)).toBe(raw);
  await recoverPendingCommsImport('alice',deps);expect(call.mock.calls.filter(c=>c[0]==='apply')).toHaveLength(1);expect(storage.size).toBe(0);
});
it('wrong account, damaged journals and replacement bytes stop recovery and conserve the pending operation',async()=>{
  failStatus=true;await expect(importCommsMemory('alice',data,[],()=>{},deps)).rejects.toThrow();const raw=storage.get(key)!;failStatus=false;call.mockClear();
  storage.set(commsImportCheckpointKey('bob'),raw);uid='bob';await expect(recoverPendingCommsImport('bob',deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();uid='alice';
  storage.set(key,raw.replace(/"ct":"./,'"ct":"!'));await expect(recoverPendingCommsImport('alice',deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();storage.set(key,raw);
  const rpc=deps.call;deps.call=async(mode,value)=>{const result=await rpc(mode,value);storage.set(key,'replacement');return result;};await expect(recoverPendingCommsImport('alice',deps)).rejects.toThrow();expect(storage.get(key)).toBe('replacement');
});
it('strict capture preserves attachment fields by value and rejects hidden authority',()=>{
  const input=structuredClone(data),captured=captureCommsMemory(input);input.attachment!.name='Changed';expect(captured.attachment!.name).toBe(data.attachment!.name);
  expect(()=>captureCommsMemory({...data,attachment:{...data.attachment!,uid:'bob'}} as unknown as CommsMemoryInput)).toThrow();
});
