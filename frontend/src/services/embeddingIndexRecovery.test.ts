import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {buildEncryptedMemoryFields,encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic,isMemoryCryptoReady} from './memoryCrypto';
import {captureEmbeddingIndexBaseline,publishPreparedEmbedding,rollbackPublishedEmbedding,recoverPendingEmbeddingIndex,cancelPendingEmbeddingIndex,
  embeddingIndexCheckpointKey,embeddingIndexViewDigest,inspectPendingEmbeddingIndex,exportPendingEmbeddingIndex,importPendingEmbeddingIndex,hasPendingEmbeddingIndex,
  type EmbeddingIndexBaseline,type EmbeddingIndexRecoveryDeps} from './embeddingIndexRecovery';
import {canonicalSyncState} from '../../../functions/src/mobileSyncImportContract';
import {EMBEDDING_INDEX_TARGET_SPACE,embeddingIndexRequestBytes,type EmbeddingIndexRequest} from '../../../functions/src/embeddingIndexContract';
import type {SessionData} from '../hooks/useSessions';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'],nonce='11111111-1111-4111-8111-111111111111';
const checkpoint=embeddingIndexCheckpointKey('alice'),vector=[1,...Array(383).fill(0)];
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
let uid:string,enabled:boolean,row:Record<string,unknown>|undefined,view:SessionData|undefined,baseline:EmbeddingIndexBaseline,stamp:number,receipt:Record<string,unknown>|undefined;
let storage:Map<string,string>,listeners:Set<()=>void>,storageListeners:Set<()=>void>,deps:EmbeddingIndexRecoveryDeps;
let loseApply:boolean,failStatus:boolean,failRemove:boolean,revoked:boolean;
const call=vi.fn(),prepared=vi.fn(),id=vi.fn();
async function fresh():Promise<EmbeddingIndexBaseline>{return{sessionId:'note',ownerUid:'alice',stateHash:await hash(canonicalSyncState([row,stamp])),stateDigest:await embeddingIndexViewDigest(row!),
  contentDigest:await hash(canonicalSyncState({uid:row!.uid,teamId:row!.teamId,enc:row!.enc,keyEpoch:row!.keyEpoch??null,keyId:row!.keyId??null})),revision:Number(row!.updatedAt??row!.timestamp)};}
const input=()=>({uid:'alice',id:'note',baseline,profile:'multilingualCandidate' as const,readCurrent:()=>view});
beforeEach(async()=>{
  setMemoryCryptoMnemonic(words);uid='alice';enabled=true;stamp=1;receipt=undefined;storage=new Map();listeners=new Set();storageListeners=new Set();loseApply=false;failStatus=false;failRemove=false;revoked=false;
  row={uid:'alice',teamId:null,timestamp:1,updatedAt:10,...await buildEncryptedMemoryFields('Synthetic index source',null),connections:['peer'],attachments:[{retained:true}],learning:{revisedAt:4},embedding:[1,0]};
  id.mockReset();id.mockReturnValue(nonce);prepared.mockReset();prepared.mockResolvedValue({version:1,uid:'alice',memoryId:'note',space:EMBEDDING_INDEX_TARGET_SPACE,sourceDigest:'synthetic-validated-checkpoint',vector});call.mockReset();
  call.mockImplementation(async(mode,command:{actorUid:string;request:unknown})=>{
    expect(command.actorUid).toBe('alice');if(mode==='prepare')return fresh();const request=command.request as EmbeddingIndexRequest,digest=await hash(embeddingIndexRequestBytes(request)),unknown={operationId:request.operationId,sessionId:'note',digest,status:revoked?'revoked':'unknown',revision:null,versionId:null,createdAt:null};
    if(mode==='status'){if(failStatus)throw Error('Synthetic status failure');return receipt??unknown;}if(receipt)return receipt;
    if(mode==='cancel'){receipt={...unknown,status:'cancelled',createdAt:1000};return receipt;}
    expect(storage.has(checkpoint)).toBe(true);expect(canonicalSyncState(await fresh())).toBe(canonicalSyncState(request.baseline));
    if(request.change.kind==='publish')row={...row,embedding:[...request.change.vector],embeddingModel:request.change.space,updatedAt:1000};stamp++;
    receipt={...unknown,status:'committed',revision:1000,versionId:'embedding-index-'+request.operationId,createdAt:1000};if(loseApply)throw Error('Synthetic lost acknowledgement');return receipt;
  });
  deps={enabled:()=>enabled,id,prepared,storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);},removeItem:key=>{if(failRemove)throw Error('Synthetic removal failure');storage.delete(key);}},
    exclusive:async(_key,work)=>work(),read:async()=>structuredClone(row),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,call,
    observe:(_key,changed)=>{storageListeners.add(changed);return()=>{storageListeners.delete(changed);};},mutation:{uid:()=>uid,ready:isMemoryCryptoReady,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}}};
  baseline=await captureEmbeddingIndexBaseline({uid:'alice',id:'note',viewDigest:await embeddingIndexViewDigest(row)},deps);call.mockClear();
  view={id:'note',uid:'alice',teamId:undefined,text:'Synthetic index source',timestamp:1,updatedAt:10,syncConflictDigest:baseline.stateDigest};
});
afterEach(()=>{setMemoryCryptoMnemonic(null);expect(listeners.size).toBe(0);expect(storageListeners.size).toBe(0);});
it('publishes only the validated checkpoint after sealing a real encrypted journal, then confirms and removes it',async()=>{
  const before=structuredClone(row);let encrypted:string|undefined;const set=deps.storage.setItem;deps.storage.setItem=(key,value)=>{encrypted=value;set(key,value);};
  const result=await publishPreparedEmbedding(input(),deps);expect(result.status).toBe('committed');expect(row!.enc).toEqual(before!.enc);expect(row!.attachments).toEqual(before!.attachments);expect(row!.connections).toEqual(before!.connections);expect(row!.learning).toEqual(before!.learning);expect(row!.embedding).toEqual(vector);expect(storage.size).toBe(0);
  const envelope=JSON.parse(encrypted!);expect(Object.keys(envelope).sort()).toEqual(['ct','iv','v']);const journal=JSON.parse((await decryptMemoryEnvelope(envelope)).text);expect(journal).toMatchObject({kind:'embedding-index',uid:'alice',request:{change:{vector}}});expect(encrypted).not.toContain('Synthetic');expect(JSON.stringify(call.mock.calls)).not.toContain('Synthetic index source');
});
it('lost acknowledgement survives closed admission and missing source without another vector read or nonce',async()=>{
  loseApply=true;await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow('lost acknowledgement');const committed=receipt;expect(storage.has(checkpoint)).toBe(true);enabled=false;row=undefined;view=undefined;prepared.mockClear();call.mockClear();
  expect(await recoverPendingEmbeddingIndex('alice',()=>{},deps)).toEqual(committed);expect(call.mock.calls.map(r=>r[0])).toEqual(['status','status']);expect(prepared).not.toHaveBeenCalled();expect(id).toHaveBeenCalledOnce();expect(storage.size).toBe(0);
});
it('an unresolved journal blocks another start and requires explicit cancellation when admission is closed',async()=>{
  failStatus=true;await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();const raw=storage.get(checkpoint);prepared.mockClear();await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();expect(prepared).not.toHaveBeenCalled();failStatus=false;enabled=false;
  await expect(recoverPendingEmbeddingIndex('alice',()=>{},deps)).rejects.toThrow();expect(storage.get(checkpoint)).toBe(raw);expect((await cancelPendingEmbeddingIndex('alice',()=>{},deps)).status).toBe('cancelled');expect(row!.embedding).toEqual([1,0]);
});
it('revocation without a receipt is durably cancelled before clearing the encrypted pending request',async()=>{
  failStatus=true;await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();failStatus=false;enabled=false;revoked=true;call.mockClear();expect((await recoverPendingEmbeddingIndex('alice',()=>{},deps)).status).toBe('cancelled');expect(call.mock.calls.map(r=>r[0])).toEqual(['status','cancel','status']);expect(storage.size).toBe(0);
});
it('rollback sends only a captured archive reference without reading any prepared vector',async()=>{
  await rollbackPublishedEmbedding({uid:'alice',id:'note',baseline,versionId:'embedding-index-22222222-2222-4222-8222-222222222222'},deps);expect(prepared).not.toHaveBeenCalled();expect((call.mock.calls.find(r=>r[0]==='apply')![1].request as EmbeddingIndexRequest).change).toEqual({kind:'rollback',versionId:'embedding-index-22222222-2222-4222-8222-222222222222'});
});
it.each(['version','digest','text','locked','shared'] as const)('a changed %s source is refused before journaling or applying',async change=>{
  if(change==='version')stamp++;if(change==='digest')view={...view!,syncConflictDigest:'a'.repeat(64)};if(change==='text')view={...view!,text:'Stale source'};if(change==='locked')view={...view!,encLocked:true};if(change==='shared')row!.sharedWithIds=['bob'];
  await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();expect(storage.size).toBe(0);expect(call.mock.calls.some(r=>r[0]==='apply')).toBe(false);expect(id).not.toHaveBeenCalled();
});
it('a stale displayed view, foreign profile or checkpoint is refused without overwriting a journal',async()=>{
  await expect(captureEmbeddingIndexBaseline({uid:'alice',id:'note',viewDigest:'a'.repeat(64)},deps)).rejects.toThrow();
  await expect(publishPreparedEmbedding({...input(),profile:'englishPinned'},deps)).rejects.toThrow();expect(prepared).not.toHaveBeenCalled();
  prepared.mockResolvedValueOnce({version:1,uid:'bob',memoryId:'note',space:EMBEDDING_INDEX_TARGET_SPACE,vector});await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();expect(storage.size).toBe(0);
});
it.each(['account','vault','storage','view'] as const)('the observed %s transition stays invalid even if its original value returns',async change=>{
  prepared.mockImplementationOnce(async()=>{if(change==='account'){uid='bob';listeners.forEach(callback=>callback());uid='alice';}if(change==='vault'){setMemoryCryptoMnemonic(null);listeners.forEach(callback=>callback());setMemoryCryptoMnemonic(words);}if(change==='storage')storageListeners.forEach(callback=>callback());if(change==='view')view={...view!};return{version:1,uid:'alice',memoryId:'note',space:EMBEDDING_INDEX_TARGET_SPACE,vector};});
  await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();expect(storage.size).toBe(0);expect(id).not.toHaveBeenCalled();expect(receipt).toBeUndefined();
});
it('damaged or wrong-owner encrypted journals never reach RPC and preserve every other account',async()=>{
  failStatus=true;await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();const raw=storage.get(checkpoint)!,enc=JSON.parse(raw);enc.ct=(enc.ct[0]==='A'?'B':'A')+enc.ct.slice(1);storage.set(checkpoint,JSON.stringify(enc));call.mockClear();failStatus=false;
  await expect(recoverPendingEmbeddingIndex('alice',()=>{},deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();storage.set(checkpoint,raw);storage.set(embeddingIndexCheckpointKey('bob'),raw);uid='bob';await expect(recoverPendingEmbeddingIndex('bob',()=>{},deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();expect(storage.get(checkpoint)).toBe(raw);
});
it('mismatched confirmations and local removal failure preserve the exact original pending bytes',async()=>{
  loseApply=true;await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();const raw=storage.get(checkpoint),rpc=deps.call;
  deps.call=async(mode,command)=>({...await rpc(mode,command) as object,versionId:'embedding-index-22222222-2222-4222-8222-222222222222'});await expect(recoverPendingEmbeddingIndex('alice',()=>{},deps)).rejects.toThrow();expect(storage.get(checkpoint)).toBe(raw);
  deps.call=rpc;failRemove=true;await expect(recoverPendingEmbeddingIndex('alice',()=>{},deps)).rejects.toThrow();expect(storage.get(checkpoint)).toBe(raw);failRemove=false;await recoverPendingEmbeddingIndex('alice',()=>{},deps);expect(storage.size).toBe(0);
});
it('closed admission and failed durable storage never send an apply request',async()=>{
  enabled=false;await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow('validação');expect(call).not.toHaveBeenCalled();enabled=true;deps.storage.setItem=()=>{throw Error('Synthetic durable store unavailable');};await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();expect(call.mock.calls.some(r=>r[0]==='apply')).toBe(false);expect(receipt).toBeUndefined();
});
it('exports and restores exact encrypted custody without RPC, then recovers the original nonce with admission closed',async()=>{
  loseApply=true;await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();const raw=storage.get(checkpoint)!;enabled=false;call.mockClear();id.mockClear();prepared.mockClear();
  expect(await inspectPendingEmbeddingIndex('alice',()=>{},deps)).toMatchObject({sessionId:'note',kind:'publish',operationId:nonce});const backup=await exportPendingEmbeddingIndex('alice',()=>{},deps);
  expect(backup).not.toContain('Synthetic index source');expect(backup).not.toContain('vector');expect(JSON.parse(backup)).toMatchObject({format:'mnemosyne.embedding-index-request',uid:'alice'});expect(call).not.toHaveBeenCalled();
  storage.delete(checkpoint);await importPendingEmbeddingIndex('alice',backup,()=>{},deps);expect(storage.get(checkpoint)).toBe(raw);expect(call).not.toHaveBeenCalled();expect(id).not.toHaveBeenCalled();expect(prepared).not.toHaveBeenCalled();
  expect((await recoverPendingEmbeddingIndex('alice',()=>{},deps)).status).toBe('committed');expect(hasPendingEmbeddingIndex('alice',deps.storage)).toBe(false);
});
it('backup restoration never overwrites another pending request or accepts another account inside an edited wrapper',async()=>{
  failStatus=true;await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();const backup=await exportPendingEmbeddingIndex('alice',()=>{},deps),raw=storage.get(checkpoint)!;call.mockClear();
  await expect(importPendingEmbeddingIndex('alice',backup,()=>{},deps)).rejects.toThrow();expect(storage.get(checkpoint)).toBe(raw);
  uid='bob';const foreign=JSON.parse(backup);foreign.uid='bob';await expect(importPendingEmbeddingIndex('bob',JSON.stringify(foreign),()=>{},deps)).rejects.toThrow();expect(storage.has(embeddingIndexCheckpointKey('bob'))).toBe(false);expect(storage.get(checkpoint)).toBe(raw);expect(call).not.toHaveBeenCalled();
});
it('invalid backups and a vault transition during decryption preserve empty storage and never call the server',async()=>{
  failStatus=true;await expect(publishPreparedEmbedding(input(),deps)).rejects.toThrow();const backup=await exportPendingEmbeddingIndex('alice',()=>{},deps);storage.delete(checkpoint);call.mockClear();
  for(const value of ['{}',backup+'x','x'.repeat(300001),JSON.stringify({...JSON.parse(backup),extra:true})])await expect(importPendingEmbeddingIndex('alice',value,()=>{},deps)).rejects.toThrow();expect(storage.size).toBe(0);
  const decrypt=deps.decrypt;deps.decrypt=async value=>{const result=await decrypt(value);listeners.forEach(changed=>changed());return result;};await expect(importPendingEmbeddingIndex('alice',backup,()=>{},deps)).rejects.toThrow();expect(storage.size).toBe(0);expect(call).not.toHaveBeenCalled();
});
