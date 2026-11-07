import {beforeAll,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{currentUser:null}}));
import {regenerateCommsIdentity,recoverCommsIdentityRollover,cancelCommsIdentityRollover,loadRetainedCommsIdentities,inspectCommsIdentityConflict,republishCommsIdentityConflict,CommsIdentitySupersededError,commsIdentityBackupRecoveryKey,commsIdentityRolloverKey,commsIdentityHistoryPrefix,type CommsIdentityRolloverDeps} from './commsIdentityRollover';
import {createEncryptedIdentityCandidate,openEncryptedIdentity} from '../utils/crypto';
import {encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic} from './memoryCrypto';
import {commsIdentityRequestBytes,type CommsIdentityRolloverRequest,type CommsIdentityRolloverOutcome,type CommsIdentityBaseline,type CommsIdentityCommand} from '../../../functions/src/commsIdentityContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const id='11111111-1111-4111-8111-111111111111',root='mnemosyne_identity_vault_alice',key=commsIdentityRolloverKey('alice');
let old:Awaited<ReturnType<typeof createEncryptedIdentityCandidate>>,candidate:typeof old,remote:typeof old;
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
beforeAll(async()=>{old=await createEncryptedIdentityCandidate('alice',words);candidate=await createEncryptedIdentityCandidate('alice',words);remote=await createEncryptedIdentityCandidate('alice',words);});
beforeEach(()=>setMemoryCryptoMnemonic(words));
function fixture(){
  const records=new Map<string,string>([[root,old.vaultRaw]]),listeners=new Set<()=>void>();
  const receipts=new Map<string,CommsIdentityRolloverOutcome>();
  const state={uid:'alice',ready:true,enabled:true,receipt:null as CommsIdentityRolloverOutcome|null,baseline:null as CommsIdentityBaseline|null,remotePem:old.identity.pemPublic,current:true,loseAck:false,failApply:false,failPrimaryRead:false,failStage:false,applyCount:0,storageChanged:()=>{},duringStatus:undefined as undefined|(()=>void)};
  const storage:Storage={get length(){return records.size;},key:index=>[...records.keys()][index]??null,clear:()=>records.clear(),removeItem:k=>records.delete(k),getItem:k=>{if(k===root&&state.failPrimaryRead){state.failPrimaryRead=false;throw Error('Synthetic readback failed');}return records.get(k)??null;},setItem:(k,value)=>{if(state.failStage&&k===key)throw Error('Synthetic stage denied');records.set(k,value);}};
  const call=vi.fn(async(mode:string,value:unknown)=>{
    const command=value as CommsIdentityCommand;expect(command.actorUid).toBe('alice');expect(Object.keys(command).sort()).toEqual(['actorUid','request']);
    if(mode==='prepare')return state.baseline??{userStateHash:'a'.repeat(64),profileStateHash:'b'.repeat(64),priorFingerprint:await hash(old.identity.pemPublic)};
    const request=command.request as CommsIdentityRolloverRequest,result:CommsIdentityRolloverOutcome={operationId:request.operationId,digest:await hash(commsIdentityRequestBytes(request)),fingerprint:await hash(request.publicKeyPem),status:'unknown',current:false,createdAt:null},receipt=receipts.get(request.operationId);
    if(mode==='status'){state.duringStatus?.();return receipt?{...receipt,current:receipt.status==='committed'&&state.current&&request.publicKeyPem===state.remotePem}:result;}
    if(receipt)return{...receipt,current:receipt.status==='committed'&&state.current&&request.publicKeyPem===state.remotePem};
    if(mode==='cancel'){state.receipt={...result,status:'cancelled',createdAt:1000};receipts.set(request.operationId,state.receipt);return state.receipt;}
    state.applyCount++;if(state.failApply)throw Error('Synthetic apply unavailable');expect([old.vaultRaw,candidate.vaultRaw]).toContain(records.get(root));expect(records.get(key)).toBeTruthy();
    state.receipt={...result,status:'committed',current:true,createdAt:1000};receipts.set(request.operationId,state.receipt);state.current=true;state.remotePem=request.publicKeyPem;if(state.loseAck)throw Error('Synthetic ACK lost');return state.receipt;
  });
  const deps:CommsIdentityRolloverDeps={enabled:()=>state.enabled,storage,id:()=>id,exclusive:async(_name,work)=>work(),mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}},
    prepare:vi.fn(async()=>candidate),open:openEncryptedIdentity,retire:vi.fn(),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,call,
    observeStorage:(_uid,changed)=>{state.storageChanged=changed;return()=>{state.storageChanged=()=>{};};}};
  return{records,listeners,state,deps,call};
}
it('closed admission performs no generation, profile call or local replacement',async()=>{
  const f=fixture();f.state.enabled=false;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.deps.prepare).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();expect(f.records.get(root)).toBe(old.vaultRaw);expect(f.records.has(key)).toBe(false);
});
it('stages ciphertext old/new keys and a stable request before submission, then promotes only after current receipt confirmation',async()=>{
  const f=fixture();await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).resolves.toMatchObject({pemPublic:candidate.identity.pemPublic});
  expect(f.state.applyCount).toBe(1);expect(f.records.get(root)).toBe(candidate.vaultRaw);expect(f.records.has(key)).toBe(false);expect(f.deps.retire).toHaveBeenCalledOnce();
  const archived=f.records.get(commsIdentityHistoryPrefix('alice')+id)!;expect(Object.keys(JSON.parse(archived)).sort()).toEqual(['ct','iv','v']);expect(archived).not.toContain('publicKeyPem');expect(archived).not.toContain(old.vaultRaw);
  const history=await loadRetainedCommsIdentities('alice',words,()=>{},f.deps);expect(history.map(item=>item.pemPublic).sort()).toEqual([old.identity.pemPublic,candidate.identity.pemPublic].sort());
});
it('lost commit ACK preserves the old primary and resumes the same ID/ciphertext without another generation or apply, with the gate closed',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;expect(f.records.get(root)).toBe(old.vaultRaw);f.state.enabled=false;
  const result=await recoverCommsIdentityRollover('alice',words,()=>{},f.deps);expect(result.result.status).toBe('committed');expect(f.state.applyCount).toBe(1);expect(f.deps.prepare).toHaveBeenCalledOnce();expect(f.records.get(root)).toBe(candidate.vaultRaw);expect(f.records.get(commsIdentityHistoryPrefix('alice')+id)).toBe(raw);
});
it('cancel before commit retains the old primary and both encrypted key versions, and a committed cancel confirms the new primary',async()=>{
  const f=fixture();f.state.failApply=true;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();f.state.enabled=false;
  expect((await cancelCommsIdentityRollover('alice',words,()=>{},f.deps)).status).toBe('cancelled');expect(f.records.get(root)).toBe(old.vaultRaw);expect(f.records.has(key)).toBe(false);expect(f.records.has(commsIdentityHistoryPrefix('alice')+id)).toBe(true);
  const g=fixture();g.state.loseAck=true;await expect(regenerateCommsIdentity('alice',words,()=>{},g.deps)).rejects.toThrow();g.state.enabled=false;expect((await cancelCommsIdentityRollover('alice',words,()=>{},g.deps)).status).toBe('committed');expect(g.records.get(root)).toBe(candidate.vaultRaw);expect(g.state.applyCount).toBe(1);
});
it('a committed historical identity superseded remotely is not promoted or removed from recovery',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();f.state.current=false;const raw=f.records.get(key);
  await expect(recoverCommsIdentityRollover('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(root)).toBe(old.vaultRaw);expect(f.records.get(key)).toBe(raw);
});
it.each(['actor','vault','outer','storage'] as const)('context %s ABA prevents late promotion and preserves recovery ciphertext',async mode=>{
  const f=fixture();f.state.loseAck=true;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();let live=true;f.state.duringStatus=()=>{
    if(mode==='actor'){f.state.uid='bob';for(const changed of f.listeners)changed();f.state.uid='alice';}if(mode==='vault'){f.state.ready=false;for(const changed of f.listeners)changed();f.state.ready=true;}if(mode==='outer')live=false;if(mode==='storage')f.state.storageChanged();};
  await expect(recoverCommsIdentityRollover('alice',words,()=>{if(!live)throw Error();},f.deps)).rejects.toThrow();expect(f.records.get(root)).toBe(old.vaultRaw);expect(f.records.has(key)).toBe(true);expect(f.listeners.size).toBe(0);
});
it('a failed local promotion readback retains the journal and archive and retries without new keys or profile writes',async()=>{
  const f=fixture();const put=f.deps.storage.setItem;f.deps.storage.setItem=(k,value)=>{put(k,value);if(k===root&&value===candidate.vaultRaw)f.state.failPrimaryRead=true;};
  await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(root)).toBe(candidate.vaultRaw);expect(f.records.has(key)).toBe(true);expect(f.records.has(commsIdentityHistoryPrefix('alice')+id)).toBe(true);
  f.deps.storage.setItem=put;expect((await recoverCommsIdentityRollover('alice',words,()=>{},f.deps)).result.status).toBe('committed');expect(f.state.applyCount).toBe(1);expect(f.deps.prepare).toHaveBeenCalledOnce();
});
it('wrong vault, transplanted owner and tampered journal preserve the own and other records',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;
  setMemoryCryptoMnemonic([...words].reverse());await expect(recoverCommsIdentityRollover('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);setMemoryCryptoMnemonic(words);
  f.records.set(commsIdentityRolloverKey('bob'),raw);f.state.uid='bob';await expect(recoverCommsIdentityRollover('bob',words,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(commsIdentityRolloverKey('bob'))).toBe(raw);f.state.uid='alice';
  const changed=JSON.parse(raw);changed.ct=(changed.ct[0]==='A'?'B':'A')+changed.ct.slice(1);f.records.set(key,JSON.stringify(changed));await expect(recoverCommsIdentityRollover('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(root)).toBe(old.vaultRaw);
});
it('a primary changed by another writer is never replaced during recovery',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();f.state.duringStatus=()=>f.records.set(root,'Synthetic other primary');
  await expect(recoverCommsIdentityRollover('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(root)).toBe('Synthetic other primary');expect(f.records.has(key)).toBe(true);
});
it('a failed durable stage never submits apply or deletes the old primary',async()=>{
  const f=fixture();f.state.failStage=true;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.state.applyCount).toBe(0);expect(f.records.get(root)).toBe(old.vaultRaw);expect(f.records.has(key)).toBe(false);
});
it('an existing pending request refuses another generation and leaves its ciphertext unchanged',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key);await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);expect(f.deps.prepare).toHaveBeenCalledOnce();
});
it('retained ciphertext keys must match the bound old fingerprint and new public key',async()=>{
  const f=fixture();await regenerateCommsIdentity('alice',words,()=>{},f.deps);const archive=commsIdentityHistoryPrefix('alice')+id,raw=f.records.get(archive)!;
  const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);journal.request.baseline.priorFingerprint='f'.repeat(64);
  const changed=JSON.stringify(await encryptMemoryFields({text:JSON.stringify(journal)}));f.records.set(archive,changed);
  await expect(loadRetainedCommsIdentities('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(archive)).toBe(changed);expect(f.records.get(root)).toBe(candidate.vaultRaw);
});

it('identity observation ignores other actors and unrelated journals while retaining current-identity invalidation',async()=>{
  const {observeCommsIdentityRollovers,commsIdentityHistoryPrefix}=await import('./commsIdentityRollover');let uid:string|null='alice';const callback=vi.fn(),stop=observeCommsIdentityRollovers(callback,()=>uid);
  for(const key of ['mnemosyne:comms-p2p:v1:bob','mnemosyne:comms-p2p-session:v1:bob','mnemosyne:comms-p2p:v1:alice','mnemosyne_identity_vault_bob','mnemosyne:comms-identity-history:v1:alice-other:old'])window.dispatchEvent(new StorageEvent('storage',{key}));expect(callback).not.toHaveBeenCalled();
  for(const key of ['mnemosyne_identity_vault_alice','mnemosyne:comms-identity-rollover:v1:alice',commsIdentityHistoryPrefix('alice')+'old',null])window.dispatchEvent(new StorageEvent('storage',{key}));expect(callback).toHaveBeenCalledTimes(4);uid='bob';window.dispatchEvent(new StorageEvent('storage',{key:'mnemosyne_identity_vault_alice'}));expect(callback).toHaveBeenCalledTimes(4);window.dispatchEvent(new StorageEvent('storage',{key:'mnemosyne_identity_vault_bob'}));expect(callback).toHaveBeenCalledTimes(5);stop();window.dispatchEvent(new StorageEvent('storage',{key:null}));expect(callback).toHaveBeenCalledTimes(5);
});
const nextId='22222222-2222-4222-8222-222222222222';
async function supersededFixture(){
  const f=fixture();f.state.loseAck=true;await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();f.state.loseAck=false;f.state.current=false;f.state.remotePem=remote.identity.pemPublic;
  f.state.baseline={userStateHash:'c'.repeat(64),profileStateHash:'d'.repeat(64),priorFingerprint:await hash(remote.identity.pemPublic)};f.deps.id=()=>nextId;return f;
}
it('a superseded receipt has a read-only conflict preview with the gate closed and no private material',async()=>{
  const f=await supersededFixture(),before=[...f.records];f.state.enabled=false;
  await expect(recoverCommsIdentityRollover('alice',words,()=>{},f.deps)).rejects.toBeInstanceOf(CommsIdentitySupersededError);
  const preview=await inspectCommsIdentityConflict('alice',words,()=>{},f.deps);expect(preview).toMatchObject({uid:'alice',operationId:id,baseline:f.state.baseline,candidateFingerprint:await hash(candidate.identity.pemPublic)});
  expect([...f.records]).toEqual(before);expect(f.state.applyCount).toBe(1);expect(JSON.stringify(preview)).not.toContain('vaultRaw');expect(JSON.stringify(preview)).not.toContain('publicKeyPem');
  await expect(republishCommsIdentityConflict('alice',words,preview,()=>{},f.deps)).rejects.toThrow();expect([...f.records]).toEqual(before);
});
it('explicit republish reuses the retained candidate, archives the original journal and preserves both decryptable keys',async()=>{
  const f=await supersededFixture(),raw=f.records.get(key)!,preview=await inspectCommsIdentityConflict('alice',words,()=>{},f.deps);
  const result=await republishCommsIdentityConflict('alice',words,preview,()=>{},f.deps);expect(result.result).toMatchObject({operationId:nextId,status:'committed',current:true});expect(f.state.applyCount).toBe(2);expect(f.deps.prepare).toHaveBeenCalledOnce();
  expect(f.records.get(commsIdentityHistoryPrefix('alice')+id)).toBe(raw);expect(f.records.get(root)).toBe(candidate.vaultRaw);expect(f.records.has(key)).toBe(false);
  const next=JSON.parse((await decryptMemoryEnvelope(JSON.parse(f.records.get(commsIdentityHistoryPrefix('alice')+nextId)!))).text);
  expect(next).toMatchObject({v:2,localPriorFingerprint:await hash(old.identity.pemPublic),cancelVaultRaw:old.vaultRaw,request:{baseline:preview.baseline,publicKeyPem:candidate.identity.pemPublic}});
  const retained=await loadRetainedCommsIdentities('alice',words,()=>{},f.deps);expect(retained.map(identity=>identity.pemPublic).sort()).toEqual([old.identity.pemPublic,candidate.identity.pemPublic].sort());expect(retained.some(identity=>identity.pemPublic===remote.identity.pemPublic)).toBe(false);
});
it('lost republish ACK reloads the same v2 ciphertext and nonce with admission closed',async()=>{
  const f=await supersededFixture(),preview=await inspectCommsIdentityConflict('alice',words,()=>{},f.deps);f.state.loseAck=true;
  await expect(republishCommsIdentityConflict('alice',words,preview,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;expect(f.records.has(commsIdentityHistoryPrefix('alice')+id)).toBe(true);expect(f.records.get(root)).toBe(old.vaultRaw);
  f.state.enabled=false;expect((await recoverCommsIdentityRollover('alice',words,()=>{},f.deps)).result.operationId).toBe(nextId);expect(f.state.applyCount).toBe(2);expect(f.records.get(commsIdentityHistoryPrefix('alice')+nextId)).toBe(raw);
});
it.each(['baseline','journal','nonce','capacity'] as const)('a changed %s refuses republish before replacing the pending cipher or submitting another apply',async kind=>{
  const f=await supersededFixture(),preview=await inspectCommsIdentityConflict('alice',words,()=>{},f.deps);
  if(kind==='baseline')f.state.baseline!.profileStateHash='e'.repeat(64);
  if(kind==='journal')preview.journalDigest='f'.repeat(64);
  if(kind==='nonce')f.deps.id=()=>id;
  if(kind==='capacity')for(let index=0;index<19;index++)f.records.set(commsIdentityHistoryPrefix('alice')+`${index.toString().padStart(8,'0')}-1111-4111-8111-111111111111`,'Synthetic retained cipher');
  const before=[...f.records];await expect(republishCommsIdentityConflict('alice',words,preview,()=>{},f.deps)).rejects.toThrow();expect([...f.records]).toEqual(before);expect(f.state.applyCount).toBe(1);
});
it('a failed republish stage keeps the original pending journal and its durable archive without another apply',async()=>{
  const f=await supersededFixture(),preview=await inspectCommsIdentityConflict('alice',words,()=>{},f.deps),raw=f.records.get(key);f.state.failStage=true;
  await expect(republishCommsIdentityConflict('alice',words,preview,()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);expect(f.records.get(commsIdentityHistoryPrefix('alice')+id)).toBe(raw);expect(f.state.applyCount).toBe(1);
});
it('cancelling an unadmitted republish preserves both keys and the captured local primary, including a previously promoted candidate',async()=>{
  for(const local of [old.vaultRaw,candidate.vaultRaw]){const f=await supersededFixture();f.records.set(root,local);const preview=await inspectCommsIdentityConflict('alice',words,()=>{},f.deps);f.state.failApply=true;
    await expect(republishCommsIdentityConflict('alice',words,preview,()=>{},f.deps)).rejects.toThrow();f.state.enabled=false;
    expect((await cancelCommsIdentityRollover('alice',words,()=>{},f.deps)).status).toBe('cancelled');expect(f.records.get(root)).toBe(local);expect(f.records.has(key)).toBe(false);expect((await loadRetainedCommsIdentities('alice',words,()=>{},f.deps)).length).toBe(2);
  }
});
it.each(['actor','vault','storage'] as const)('a %s transition during conflict inspection returns no preview and preserves ciphertext',async kind=>{
  const f=await supersededFixture(),before=[...f.records];f.state.duringStatus=()=>{if(kind==='storage')f.state.storageChanged();else{if(kind==='actor')f.state.uid='bob';else f.state.ready=false;for(const notify of f.listeners)notify();f.state.uid='alice';f.state.ready=true;}};
  await expect(inspectCommsIdentityConflict('alice',words,()=>{},f.deps)).rejects.toThrow();expect([...f.records]).toEqual(before);expect(f.listeners.size).toBe(0);
});
it('backup recovery blocks another rollover and retained handle loading until its local mutation is settled',async()=>{
  const f=fixture();f.records.set(commsIdentityBackupRecoveryKey('alice'),'Synthetic pending local recovery');const before=[...f.records];await expect(regenerateCommsIdentity('alice',words,()=>{},f.deps)).rejects.toThrow();await expect(loadRetainedCommsIdentities('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();expect(f.deps.prepare).not.toHaveBeenCalled();expect([...f.records]).toEqual(before);
});
it('the initial storage read failing retires rollover and conflict observers without submitting another operation',async()=>{
  for(const work of [recoverCommsIdentityRollover,inspectCommsIdentityConflict]){const f=fixture(),stop=vi.fn();f.deps.observeStorage=()=>stop;const get=f.deps.storage.getItem;f.deps.storage.getItem=k=>{if(k===key)throw Error('Synthetic pending read failure');return get(k);};await expect(work('alice',words,()=>{},f.deps)).rejects.toThrow();expect(stop).toHaveBeenCalledOnce();expect(f.call).not.toHaveBeenCalled();expect(f.listeners.size).toBe(0);}
});
