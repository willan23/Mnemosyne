import {beforeAll,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{currentUser:null}}));
import {downloadCommsIdentityBackup,inspectCommsIdentityBackup,restoreCommsIdentityBackup,purgeCommsIdentityHistory,recoverCommsIdentityBackup,cancelCommsIdentityBackup,COMMS_IDENTITY_BACKUP_FORMAT,type CommsIdentityBackupDeps} from './commsIdentityBackup';
import {commsIdentityBackupRecoveryKey,commsIdentityRolloverKey,commsIdentityHistoryPrefix,loadRetainedCommsIdentities,recoverCommsIdentityRollover,type CommsIdentityRolloverDeps} from './commsIdentityRollover';
import {createEncryptedIdentityCandidate,openEncryptedIdentity,getOrCreateIdentity,clearVolatileIdentities,rsaEncrypt,rsaDecrypt} from '../utils/crypto';
import {encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic} from './memoryCrypto';
import {generateTeamKey,wrapTeamKeyForIdentity,unwrapTeamKeyWithPrivateKey,exportTeamKeyPlaintext} from './teamVault';
import {commsIdentityRequestBytes,type CommsIdentityRolloverRequest} from '../../../functions/src/commsIdentityContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const root='mnemosyne_identity_vault_alice',stage=commsIdentityBackupRecoveryKey('alice'),pending=commsIdentityRolloverKey('alice'),prefix=commsIdentityHistoryPrefix('alice'),id='11111111-1111-4111-8111-111111111111';
let old:Awaited<ReturnType<typeof createEncryptedIdentityCandidate>>,active:typeof old,other:typeof old;
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
beforeAll(async()=>{old=await createEncryptedIdentityCandidate('alice',words);active=await createEncryptedIdentityCandidate('alice',words);other=await createEncryptedIdentityCandidate('alice',words);});
beforeEach(()=>{localStorage.clear();clearVolatileIdentities();setMemoryCryptoMnemonic(words);});
const source=(raw:string)=>({size:new TextEncoder().encode(raw).length,text:async()=>raw});
async function journal(v:1|2=1,operationId=id){const request:CommsIdentityRolloverRequest={operationId,baseline:{userStateHash:'a'.repeat(64),profileStateHash:'b'.repeat(64),priorFingerprint:await hash((v===1?old:other).identity.pemPublic)},publicKeyPem:active.identity.pemPublic};
  return JSON.stringify(await encryptMemoryFields({text:JSON.stringify({v,uid:'alice',request,oldVaultRaw:old.vaultRaw,newVaultRaw:active.vaultRaw,...(v===2?{localPriorFingerprint:await hash(old.identity.pemPublic),cancelVaultRaw:old.vaultRaw}:{})})}));}
async function retained(identity:typeof old,operationId:string){return JSON.stringify(await encryptMemoryFields({text:JSON.stringify({v:3,uid:'alice',operationId,vaultRaw:identity.vaultRaw,fingerprint:await hash(identity.identity.pemPublic)})}));}
async function fixture(primaryRaw:string|null=active.vaultRaw){
  const records=new Map<string,string>();if(primaryRaw!==null)records.set(root,primaryRaw);let sequence=100;
  const listeners=new Set<()=>void>();const state={uid:'alice',ready:true,baseline:{userStateHash:'c'.repeat(64),profileStateHash:'d'.repeat(64),priorFingerprint:await hash(active.identity.pemPublic)},receiptStatus:'unknown' as 'unknown'|'committed'|'cancelled',receiptCurrent:false,failSet:null as string|null,failGet:null as string|null,failNextReadback:null as string|null,failRemove:null as string|null,storageChanged:()=>{},stops:0};
  const storage:Storage={get length(){return records.size;},key:index=>[...records.keys()][index]??null,clear:()=>records.clear(),getItem:key=>{if(state.failGet===key){state.failGet=null;throw Error('Synthetic read denied');}return records.get(key)??null;},setItem:(key,value)=>{if(state.failSet===key)throw Error('Synthetic quota');records.set(key,value);if(state.failNextReadback===key){state.failGet=key;state.failNextReadback=null;}},removeItem:key=>{if(state.failRemove===key)throw Error('Synthetic delete failure');records.delete(key);}};
  const remote=vi.fn(async(uid:string,request?:CommsIdentityRolloverRequest)=>{expect(uid).toBe('alice');if(!request)return{...state.baseline};return{operationId:request.operationId,digest:await hash(commsIdentityRequestBytes(request)),fingerprint:await hash(request.publicKeyPem),status:state.receiptStatus,current:state.receiptCurrent,createdAt:state.receiptStatus==='unknown'?null:1000};});
  const download=vi.fn((_text:string,_name:string,guard:()=>void)=>guard());
  const deps:CommsIdentityBackupDeps={storage,mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}},exclusive:async(_name,work)=>work(),id:vi.fn(()=>`${(sequence++).toString(16).padStart(8,'0')}-2222-4222-8222-222222222222`),now:()=>1000,open:openEncryptedIdentity,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,retire:vi.fn(),remote,download,observeStorage:(_uid,changed)=>{state.storageChanged=changed;return()=>{state.stops++;state.storageChanged=()=>{};};}};
  return{records,state,storage,listeners,deps,remote,download};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const rolloverDeps=(f:Fixture):CommsIdentityRolloverDeps=>({...f.deps,enabled:()=>false,prepare:async()=>{throw Error('Unexpected key generation');},call:async(mode,value)=>{expect(['prepare','status']).toContain(mode);const command=value as {actorUid:string;request:CommsIdentityRolloverRequest};return f.remote(command.actorUid,mode==='prepare'?undefined:command.request);}});
async function exported(v:1|2=1,pendingRequest=false){const f=await fixture(pendingRequest?old.vaultRaw:active.vaultRaw),raw=await journal(v);if(pendingRequest)f.records.set(pending,raw);else f.records.set(prefix+id,raw);await downloadCommsIdentityBackup('alice',words,()=>{},f.deps);return{f,raw,text:f.download.mock.calls[0][0]};}

it('exports only encrypted metadata and restores historic RSA messages and team wraps in an empty installation',async()=>{
  const message=await rsaEncrypt('Synthetic historic message',old.identity.publicKey),team=await generateTeamKey(),wrap=await wrapTeamKeyForIdentity(team,old.identity);const {f,text}=await exported();
  expect(Object.keys(JSON.parse(text)).sort()).toEqual(['enc','format','v']);expect(JSON.parse(text).format).toBe(COMMS_IDENTITY_BACKUP_FORMAT);for(const secret of ['privateJwk','abandon',old.vaultRaw,'alice'])expect(text).not.toContain(secret);expect(f.remote).not.toHaveBeenCalled();
  const target=await fixture(null),file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps);expect(preview).toMatchObject({identityCount:2,canRestore:true,pending:false});const before=[...target.records];expect(before).toEqual([]);
  expect((await restoreCommsIdentityBackup('alice',words,file,preview,'restore',()=>{},target.deps)).status).toBe('complete');expect(target.records.get(root)).toBe(active.vaultRaw);expect(target.records.has(stage)).toBe(false);
  const identities=await loadRetainedCommsIdentities('alice',words,()=>{},rolloverDeps(target)),historic=identities.find(item=>item.pemPublic===old.identity.pemPublic)!;
  expect(await rsaDecrypt(message,historic.privateKey)).toBe('Synthetic historic message');expect(await exportTeamKeyPlaintext(await unwrapTeamKeyWithPrivateKey(wrap,historic.privateKey))).toBe(await exportTeamKeyPlaintext(team));
});
it('the same phrase without an identity vault generates a different RSA key and cannot open the historic message',async()=>{
  const message=await rsaEncrypt('Synthetic phrase-only loss',old.identity.publicKey),fresh=await getOrCreateIdentity('alice',words);expect(fresh.pemPublic).not.toBe(old.identity.pemPublic);await expect(rsaDecrypt(message,fresh.privateKey)).rejects.toThrow();
});
it('retained-only import works without remote access and keeps the primary and unresolved local journal unchanged',async()=>{
  const {text}=await exported(),target=await fixture(other.vaultRaw);target.records.set(pending,await journal(2,'22222222-2222-4222-8222-222222222222'));target.remote.mockRejectedValue(Error('Synthetic offline'));const file=source(text),prior=target.records.get(pending),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps);
  expect(preview).toMatchObject({canRestore:false,canRetain:true,publishedFingerprint:null});await restoreCommsIdentityBackup('alice',words,file,preview,'retain',()=>{},target.deps);expect(target.records.get(root)).toBe(other.vaultRaw);expect(target.records.get(pending)).toBe(prior);expect((await loadRetainedCommsIdentities('alice',words,()=>{},rolloverDeps(target))).map(row=>row.pemPublic)).toContain(old.identity.pemPublic);
});
it('replacing a local primary preserves its private key in encrypted v3 history and never writes a profile',async()=>{
  const {text}=await exported(),target=await fixture(other.vaultRaw),message=await rsaEncrypt('Synthetic previous installation key',other.identity.publicKey),file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps);
  await restoreCommsIdentityBackup('alice',words,file,preview,'restore',()=>{},target.deps);expect(target.records.get(root)).toBe(active.vaultRaw);const identities=await loadRetainedCommsIdentities('alice',words,()=>{},rolloverDeps(target));expect(identities).toHaveLength(3);expect(await rsaDecrypt(message,identities.find(row=>row.pemPublic===other.identity.pemPublic)!.privateKey)).toBe('Synthetic previous installation key');
  const archives=[...target.records].filter(([key])=>key.startsWith(prefix));expect(archives).toHaveLength(2);const v3=JSON.parse((await decryptMemoryEnvelope(JSON.parse(archives.find(([key])=>key!==prefix+id)![1]))).text);expect(v3).toMatchObject({v:3,uid:'alice',vaultRaw:other.vaultRaw});expect(target.remote.mock.calls.every(([uid])=>uid==='alice')).toBe(true);
});
it.each([1,2] as const)('a v%s pending lost-ACK journal is restored intact and resumes its same nonce with admission closed',async v=>{
  const {text,raw}=await exported(v,true),target=await fixture(null);target.state.receiptStatus='committed';target.state.receiptCurrent=true;const file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps);
  await restoreCommsIdentityBackup('alice',words,file,preview,'restore',()=>{},target.deps);expect(target.records.get(pending)).toBe(raw);expect(target.records.get(prefix+id)).toBe(raw);expect(target.records.get(root)).toBe(active.vaultRaw);
  expect((await recoverCommsIdentityRollover('alice',words,()=>{},rolloverDeps(target))).result.status).toBe('committed');expect(target.records.has(pending)).toBe(false);expect(target.records.get(prefix+id)).toBe(raw);
});
it('a remotely superseded v2 operation remains recoverable as a conflict without claiming the third private key',async()=>{
  const {text,raw}=await exported(2,true),target=await fixture(null);target.state.baseline.priorFingerprint=await hash(other.identity.pemPublic);target.state.receiptStatus='committed';const file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps);
  await restoreCommsIdentityBackup('alice',words,file,preview,'restore',()=>{},target.deps);expect(target.records.get(pending)).toBe(raw);expect(target.records.get(root)).toBe(old.vaultRaw);await expect(recoverCommsIdentityRollover('alice',words,()=>{},rolloverDeps(target))).rejects.toThrow();expect(target.records.get(pending)).toBe(raw);const identities=await loadRetainedCommsIdentities('alice',words,()=>{},rolloverDeps(target));expect(identities.some(row=>row.pemPublic===other.identity.pemPublic)).toBe(false);
});
it('a primary distinct from a restored pending journal is retained rather than omitted from the imported keys',async()=>{
  const producer=await fixture(other.vaultRaw);producer.records.set(pending,await journal(2));await downloadCommsIdentityBackup('alice',words,()=>{},producer.deps);const file=source(producer.download.mock.calls[0][0]),target=await fixture(null);target.state.baseline.priorFingerprint=await hash(other.identity.pemPublic);target.state.receiptStatus='committed';
  const preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps);await restoreCommsIdentityBackup('alice',words,file,preview,'restore',()=>{},target.deps);expect(target.records.get(root)).toBe(old.vaultRaw);expect(target.records.has(pending)).toBe(true);expect((await loadRetainedCommsIdentities('alice',words,()=>{},rolloverDeps(target))).map(row=>row.pemPublic).sort()).toEqual([old.identity.pemPublic,active.identity.pemPublic,other.identity.pemPublic].sort());
});
it.each(['owner','coffer','cipher','schema','size'] as const)('a wrong %s backup preserves every local and foreign record',async kind=>{
  const {text}=await exported(),target=await fixture(other.vaultRaw);target.records.set('mnemosyne_identity_vault_bob','Synthetic foreign cipher');let raw=text;
  if(kind==='owner'){const enc=JSON.parse(text).enc,payload=JSON.parse((await decryptMemoryEnvelope(enc)).text);payload.uid='bob';raw=JSON.stringify({format:COMMS_IDENTITY_BACKUP_FORMAT,v:1,enc:await encryptMemoryFields({text:JSON.stringify(payload)})});}
  if(kind==='coffer')setMemoryCryptoMnemonic([...words].reverse());
  if(kind==='cipher'){const packet=JSON.parse(text);packet.enc.ct=(packet.enc.ct[0]==='A'?'B':'A')+packet.enc.ct.slice(1);raw=JSON.stringify(packet);}
  if(kind==='schema')raw=JSON.stringify({...JSON.parse(text),privateKey:'Synthetic forbidden field'});
  const file=kind==='size'?{size:4*1024*1024+1,text:async()=>raw}:source(raw),before=[...target.records];await expect(inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps)).rejects.toThrow();expect([...target.records]).toEqual(before);expect(target.records.has(stage)).toBe(false);
});
it('public/private keys with matching declared metadata must also pass a real RSA round trip before export',async()=>{
  const f=await fixture(old.vaultRaw);f.deps.open=vi.fn(async()=>({...old.identity,privateKey:other.identity.privateKey}));await expect(downloadCommsIdentityBackup('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.download).not.toHaveBeenCalled();expect(f.records.get(root)).toBe(old.vaultRaw);
});
it.each(['file','local','remote'] as const)('a changed %s rejects the reviewed restoration before staging any mutation',async kind=>{
  const {text}=await exported(),target=await fixture(other.vaultRaw);let raw=text;const preview=await inspectCommsIdentityBackup('alice',words,source(raw),()=>{},target.deps);
  if(kind==='file'){const packet=JSON.parse(raw),payload=JSON.parse((await decryptMemoryEnvelope(packet.enc)).text);payload.createdAt=1001;packet.enc=await encryptMemoryFields({text:JSON.stringify(payload)});raw=JSON.stringify(packet);}
  if(kind==='local')target.records.set(prefix+'33333333-3333-4333-8333-333333333333',await retained(old,'33333333-3333-4333-8333-333333333333'));
  if(kind==='remote')target.state.baseline.profileStateHash='e'.repeat(64);
  const before=[...target.records];await expect(restoreCommsIdentityBackup('alice',words,source(raw),preview,'restore',()=>{},target.deps)).rejects.toThrow();expect([...target.records]).toEqual(before);
});
it('quota denial before a durable stage changes no identity or pending request',async()=>{
  const {text}=await exported(),target=await fixture(other.vaultRaw),file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps);target.state.failSet=stage;const before=[...target.records];await expect(restoreCommsIdentityBackup('alice',words,file,preview,'restore',()=>{},target.deps)).rejects.toThrow();expect([...target.records]).toEqual(before);
});
it.each(['recover','cancel'] as const)('partial local restore with failed readback can %s without replacing another account',async action=>{
  const {text}=await exported(),target=await fixture(other.vaultRaw),file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps);target.records.set('mnemosyne_identity_vault_bob','Synthetic foreign cipher');target.state.failNextReadback=prefix+id;
  await expect(restoreCommsIdentityBackup('alice',words,file,preview,'restore',()=>{},target.deps)).rejects.toThrow();const raw=target.records.get(stage)!;expect(raw).toBeTruthy();expect(raw).not.toContain(other.vaultRaw);expect(target.records.get(root)).toBe(other.vaultRaw);const idCalls=vi.mocked(target.deps.id).mock.calls.length;
  if(action==='recover'){expect((await recoverCommsIdentityBackup('alice',words,()=>{},target.deps)).status).toBe('complete');expect(target.records.get(root)).toBe(active.vaultRaw);expect((await loadRetainedCommsIdentities('alice',words,()=>{},rolloverDeps(target))).map(row=>row.pemPublic)).toContain(other.identity.pemPublic);}
  else{expect((await cancelCommsIdentityBackup('alice',words,()=>{},target.deps)).status).toBe('cancelled');expect(target.records.get(root)).toBe(other.vaultRaw);expect([...target.records.keys()].some(key=>key.startsWith(prefix))).toBe(false);}
  expect(vi.mocked(target.deps.id).mock.calls.length).toBe(idCalls);expect(target.records.has(stage)).toBe(false);expect(target.records.get('mnemosyne_identity_vault_bob')).toBe('Synthetic foreign cipher');
});
it('remote change after stage admission preserves recovery and cancellation restores the exact prior local state',async()=>{
  const {text}=await exported(),target=await fixture(other.vaultRaw),file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps),put=target.storage.setItem;target.storage.setItem=(key,value)=>{put(key,value);if(key===stage)target.state.baseline.userStateHash='e'.repeat(64);};
  await expect(restoreCommsIdentityBackup('alice',words,file,preview,'restore',()=>{},target.deps)).rejects.toThrow();expect(target.records.has(stage)).toBe(true);expect(target.records.get(root)).toBe(other.vaultRaw);await expect(recoverCommsIdentityBackup('alice',words,()=>{},target.deps)).rejects.toThrow();await cancelCommsIdentityBackup('alice',words,()=>{},target.deps);expect([...target.records]).toEqual([[root,other.vaultRaw]]);
});
it('purge requires an actually re-read matching backup and preserves the primary, pending request and foreign accounts',async()=>{
  const {f,text,raw}=await exported();f.records.set('mnemosyne:comms-identity-history:v1:bob:'+id,'Synthetic foreign cipher');const file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},f.deps);expect(preview.purgeableIds).toEqual([id]);const read=vi.fn(file.text);file.text=read;
  await purgeCommsIdentityHistory('alice',words,file,preview,[id],()=>{},f.deps);expect(read).toHaveBeenCalledOnce();expect(f.records.get(root)).toBe(active.vaultRaw);expect(f.records.has(prefix+id)).toBe(false);expect(f.records.get('mnemosyne:comms-identity-history:v1:bob:'+id)).toBe('Synthetic foreign cipher');expect(f.records.has(stage)).toBe(false);
  // Restoring the already verified file recovers the exact archive ciphertext.
  const fresh=await inspectCommsIdentityBackup('alice',words,file,()=>{},f.deps);await restoreCommsIdentityBackup('alice',words,file,fresh,'retain',()=>{},f.deps);expect(f.records.get(prefix+id)).toBe(raw);
});
it('a pending rollover archive is excluded from purge and bytes missing from a selected backup cannot be removed',async()=>{
  const {f,text,raw}=await exported();f.records.set(pending,raw);const file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},f.deps);expect(preview.purgeableIds).toEqual([]);const before=[...f.records];await expect(purgeCommsIdentityHistory('alice',words,file,preview,[id],()=>{},f.deps)).rejects.toThrow();expect([...f.records]).toEqual(before);
});
it('changing a reviewed archive fingerprint refuses purge even if its ID and file digest match',async()=>{
  const {f,text}=await exported(),file=source(text),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},f.deps),before=[...f.records];preview.purgeableKeys[0].fingerprints=['f'.repeat(64)];await expect(purgeCommsIdentityHistory('alice',words,file,preview,[id],()=>{},f.deps)).rejects.toThrow();expect([...f.records]).toEqual(before);
});
it('a purge interrupted at deletion retains ciphertext recovery and can restore the removed archive',async()=>{
  const {f,text,raw}=await exported(),second='22222222-2222-4222-8222-222222222222';f.records.set(prefix+second,await retained(other,second));await downloadCommsIdentityBackup('alice',words,()=>{},f.deps);const current=f.download.mock.calls[1][0],file=source(current),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},f.deps);f.state.failRemove=prefix+second;
  await expect(purgeCommsIdentityHistory('alice',words,file,preview,[id,second],()=>{},f.deps)).rejects.toThrow();expect(f.records.get(prefix+id)).toBeUndefined();expect(f.records.has(stage)).toBe(true);f.state.failRemove=null;await cancelCommsIdentityBackup('alice',words,()=>{},f.deps);expect(f.records.get(prefix+id)).toBe(raw);expect(f.records.get(root)).toBe(active.vaultRaw);expect(f.records.has(stage)).toBe(false);expect(text).toBeTruthy();
});
it('history capacity prevents restoration while a verified archived copy can be purged to free space',async()=>{
  const {text}=await exported(),target=await fixture(other.vaultRaw);for(let index=1;index<=20;index++){const operationId=`${index.toString(16).padStart(8,'0')}-3333-4333-8333-333333333333`;target.records.set(prefix+operationId,await retained(other,operationId));}
  const preview=await inspectCommsIdentityBackup('alice',words,source(text),()=>{},target.deps);expect(preview.canRestore).toBe(false);const before=[...target.records];await expect(restoreCommsIdentityBackup('alice',words,source(text),preview,'restore',()=>{},target.deps)).rejects.toThrow();expect([...target.records]).toEqual(before);
  await downloadCommsIdentityBackup('alice',words,()=>{},target.deps);const file=source(target.download.mock.calls[0][0]),saved=await inspectCommsIdentityBackup('alice',words,file,()=>{},target.deps);await purgeCommsIdentityHistory('alice',words,file,saved,saved.purgeableIds.slice(0,2),()=>{},target.deps);expect([...target.records.keys()].filter(key=>key.startsWith(prefix))).toHaveLength(18);
  const fresh=await inspectCommsIdentityBackup('alice',words,source(text),()=>{},target.deps);expect(fresh.canRestore).toBe(true);await restoreCommsIdentityBackup('alice',words,source(text),fresh,'restore',()=>{},target.deps);expect(target.records.get(root)).toBe(active.vaultRaw);
});
it.each(['actor','vault','view','storage'] as const)('a %s retirement during file reading produces no preview or local mutation',async kind=>{
  const {text}=await exported(),target=await fixture(null);let live=true;const file={size:text.length,text:async()=>{if(kind==='actor'){target.state.uid='bob';for(const changed of target.listeners)changed();target.state.uid='alice';}if(kind==='vault'){target.state.ready=false;for(const changed of target.listeners)changed();target.state.ready=true;}if(kind==='view')live=false;if(kind==='storage')target.state.storageChanged();return text;}};
  await expect(inspectCommsIdentityBackup('alice',words,file,()=>{if(!live)throw Error('Synthetic closed');},target.deps)).rejects.toThrow();expect([...target.records]).toEqual([]);expect(target.listeners.size).toBe(0);
});
it('initial storage failure always retires its observer and a malformed recovery cannot mutate identities',async()=>{
  const f=await fixture();f.state.failGet=stage;await expect(downloadCommsIdentityBackup('alice',words,()=>{},f.deps)).rejects.toThrow();expect(f.state.stops).toBe(1);expect(f.listeners.size).toBe(0);f.records.set(stage,'Synthetic damaged checkpoint');const before=[...f.records];await expect(recoverCommsIdentityBackup('alice',words,()=>{},f.deps)).rejects.toThrow();await expect(cancelCommsIdentityBackup('alice',words,()=>{},f.deps)).rejects.toThrow();expect([...f.records]).toEqual(before);
});
it('recovery still reads the initial v1 local checkpoint layout',async()=>{
  const {text,raw}=await exported(),target=await fixture(other.vaultRaw),before={primaryRaw:other.vaultRaw,pendingRaw:null,history:[]},after={...before,history:[{operationId:id,raw}]};
  target.records.set(stage,JSON.stringify(await encryptMemoryFields({text:JSON.stringify({v:1,uid:'alice',operationId:'33333333-3333-4333-8333-333333333333',backupId:'44444444-4444-4444-8444-444444444444',backupDigest:await hash(text),createdAt:1000,mode:'retain',before,after,baseline:null})})));
  await recoverCommsIdentityBackup('alice',words,()=>{},target.deps);expect(target.records.get(root)).toBe(other.vaultRaw);expect(target.records.get(prefix+id)).toBe(raw);expect(target.records.has(stage)).toBe(false);
});
it('one maximum-size archive can be purged from a twenty-entry history using a deduplicated recovery checkpoint',async()=>{
  const f=await fixture(other.vaultRaw);for(let index=1;index<=20;index++){const operationId=`${index.toString(16).padStart(8,'0')}-3333-4333-8333-333333333333`,raw=await retained(other,operationId);f.records.set(prefix+operationId,raw+' '.repeat(100_000-raw.length));}
  await downloadCommsIdentityBackup('alice',words,()=>{},f.deps);const file=source(f.download.mock.calls[0][0]),preview=await inspectCommsIdentityBackup('alice',words,file,()=>{},f.deps),removed=preview.purgeableIds[0],put=f.storage.setItem;let checkpoint:string|null=null;f.storage.setItem=(key,value)=>{put(key,value);if(key===stage)checkpoint=value;};
  await purgeCommsIdentityHistory('alice',words,file,preview,[removed],()=>{},f.deps);expect([...f.records.keys()].filter(key=>key.startsWith(prefix))).toHaveLength(19);const operation=JSON.parse((await decryptMemoryEnvelope(JSON.parse(checkpoint!))).text);expect(operation.v).toBe(2);expect(operation.ciphers).toHaveLength(21);expect(checkpoint!.length).toBeLessThan(4*1024*1024);expect(f.records.get(root)).toBe(other.vaultRaw);
},10_000);
