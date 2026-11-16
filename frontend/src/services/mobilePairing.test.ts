import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createHash,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
vi.mock('../firebase',()=>({default:{},auth:{currentUser:{uid:'alice'}},db:{}}));
vi.mock('./clipCaptureService',()=>({withClipCaptureLock:async(_name:string,work:()=>Promise<unknown>)=>work()}));
import {setMemoryCryptoMnemonic,encryptMemoryFields,decryptMemoryEnvelope} from './memoryCrypto';
import {generatePairingKey,pairingPrivateKey,encryptPairingHandshake,decryptPairingHandshake} from './mobilePairingCrypto';
import {createMobilePairingInvite,acceptMobilePairingInvite,trustAcceptedMobilePairing,cancelMobilePairingInvite,cancelRetainedMobilePairing,revokeTrustedDevice,mobilePairingJournalKey,parseMobilePairingUri,MobilePairingError,type MobilePairingDeps,type MobilePairingRecord} from './mobilePairing';
import type {PairingCommand} from '../../../functions/src/mobilePairingContract';
import type {MobileSyncCredential} from './mobileDeviceKeyStore';
const require=createRequire(import.meta.url),{executeMobilePairing}=require('../../../functions/lib/mobilePairing');
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
beforeAll(()=>vi.stubGlobal('crypto',webcrypto));afterAll(()=>vi.unstubAllGlobals());beforeEach(()=>{localStorage.clear();setMemoryCryptoMnemonic(words);});
function fixture(){
  const docs=new Map<string,Record<string,unknown>>([['users/alice',{}]]),vaultListeners=new Set<()=>void>(),authListeners=new Set<(uid:string|null)=>void>(),storageListeners=new Set<()=>void>();
  const state={uid:'alice',ready:true,enabled:true,now:1700000000000,locked:false,writes:0,credentials:[] as MobileSyncCredential[],calls:[] as Array<{command:PairingCommand;mode:string}>,lose:'' as string,foreign:false};let sequence=0,queue=Promise.resolve();
  const ref=(path:string)=>({path}),db={doc:ref,runTransaction:(work:(transaction:unknown)=>Promise<unknown>)=>{const result=queue.then(async()=>{const pending:Array<{path:string;value:Record<string,unknown>;merge:boolean}>=[],get=async(r:{path:string})=>{if(pending.length)throw Error('Synthetic read after write');return{exists:docs.has(r.path),data:()=>structuredClone(docs.get(r.path))};};const outcome=await work({get,getAll:(...refs:Array<{path:string}>)=>Promise.all(refs.map(get)),create:(r:{path:string},value:Record<string,unknown>)=>pending.push({path:r.path,value,merge:false}),set:(r:{path:string},value:Record<string,unknown>)=>pending.push({path:r.path,value,merge:false}),update:(r:{path:string},value:Record<string,unknown>)=>pending.push({path:r.path,value,merge:true})});for(const row of pending){docs.set(row.path,{...(row.merge?docs.get(row.path):{}),...structuredClone(row.value)});state.writes++;}return outcome;});queue=result.then(()=>{},()=>{});return result;}};
  const server={firestore:db,auth:{getUser:async(uid:string)=>({uid,disabled:false})},enabled:()=>state.enabled,now:()=>state.now};
  const deps:MobilePairingDeps={enabled:()=>state.enabled,uid:()=>state.uid,observeAuth:changed=>{authListeners.add(changed);return()=>authListeners.delete(changed);},observeStorage:(_uid,changed)=>{storageListeners.add(changed);return()=>storageListeners.delete(changed);},storage:localStorage,
    mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:changed=>{vaultListeners.add(changed);return()=>vaultListeners.delete(changed);}},exclusive:async(_name,work)=>{if(state.locked)throw Error('Synthetic occupied lock');state.locked=true;try{return await work();}finally{state.locked=false;}},id:()=>('R'+String(++sequence).padStart(23,'0')),now:()=>state.now,encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,generate:vi.fn(generatePairingKey),open:pairingPrivateKey,seal:encryptPairingHandshake,unseal:decryptPairingHandshake,
    hash:async value=>createHash('sha256').update(value).digest('hex'),qr:async()=> 'data:image/png;base64,U3ludGhldGlj',readPairing:async id=>structuredClone(docs.get('devicePairings/'+id)),readDevice:async id=>structuredClone(docs.get('trustedDevices/'+id)),saveCredential:async(value,guard)=>{guard();state.credentials.push(structuredClone(value));},
    call:async(command,mode)=>{state.calls.push({command:structuredClone(command),mode});const result=await executeMobilePairing(state.uid,command,mode,server);if(state.foreign){state.foreign=false;return{...result,actorUid:'bob'};}if(mode==='apply'&&state.lose===command.action){state.lose='';throw Error('Synthetic lost reply');}return result;}};
  const retire=()=>vaultListeners.forEach(listener=>listener()),auth=(uid:string)=>{state.uid=uid;authListeners.forEach(listener=>listener(uid));retire();};
  const create=()=>createMobilePairingInvite('alice','Synthetic desktop',()=>{},deps),accept=(uri:string)=>acceptMobilePairingInvite(uri,'Synthetic mobile',()=>{},deps);
  return{docs,state,deps,retire,auth,storageListeners,create,accept,record:(id:string)=>structuredClone(docs.get('devicePairings/'+id)) as unknown as MobilePairingRecord,dump:()=>JSON.stringify([...docs])};
}
it('real crypto/server flow commits one matched device and uses public-only actor-bound commands',async()=>{
  const f=fixture(),invite=await f.create(),accepted=await f.accept(invite.pairingUri),sync=await generatePairingKey(()=>{}),trusted=await trustAcceptedMobilePairing('alice',f.record(invite.pairingId),sync.publicKeyJwk,()=>{},f.deps);
  expect(trusted.deviceId).toBe(accepted.deviceId);expect(trusted.status).toBe('active');expect(f.state.credentials[0]).toEqual(accepted);
  for(const entry of f.state.calls){expect(entry.command.actorUid).toBe('alice');expect(JSON.stringify(entry.command)).not.toContain('"d":');expect(JSON.stringify(entry.command)).not.toContain('privateKeyJwk');}
  const raw=localStorage.getItem(mobilePairingJournalKey('alice','mobile'))!;expect(raw).not.toContain('privateKeyJwk');expect(raw).not.toContain('Synthetic mobile');
});
it('lost create reply retains the exact private key and request and resumes without another reservation',async()=>{
  const f=fixture();f.state.lose='create';await expect(f.create()).rejects.toBeInstanceOf(MobilePairingError);const raw=localStorage.getItem(mobilePairingJournalKey('alice','desktop')),writes=f.state.writes;const invite=await f.create();expect(f.state.writes).toBe(writes);expect(f.deps.generate).toHaveBeenCalledTimes(1);expect(raw).toBeTruthy();expect(parseMobilePairingUri(invite.pairingUri).creation.pairingId).toBe(invite.pairingId);
});
it('lost acceptance reply resumes without scanning and stores the same device private key',async()=>{
  const f=fixture(),invite=await f.create();f.state.lose='accept';await expect(f.accept(invite.pairingUri)).rejects.toThrow();const source=f.record(invite.pairingId),writes=f.state.writes;const recovered=await f.accept('');expect(recovered.deviceId).toBe(source.mobileDeviceId);expect(f.state.writes).toBe(writes);expect(f.deps.generate).toHaveBeenCalledTimes(2);expect(f.state.credentials[0].deviceId).toBe(source.mobileDeviceId);
});
it('a failed credential store retains acceptance and recovers without changing the device',async()=>{
  const f=fixture(),invite=await f.create(),save=f.deps.saveCredential;f.deps.saveCredential=async()=>{throw Error('Synthetic key store refusal');};await expect(f.accept(invite.pairingUri)).rejects.toThrow();const id=f.record(invite.pairingId).mobileDeviceId,writes=f.state.writes;f.deps.saveCredential=save;expect((await f.accept('')).deviceId).toBe(id);expect(f.state.writes).toBe(writes);
});
it('lost trust acknowledgement recovers the exact receipt and a revocation is never undone',async()=>{
  const f=fixture(),invite=await f.create();await f.accept(invite.pairingUri);const record=f.record(invite.pairingId),sync=await generatePairingKey(()=>{});f.state.lose='trust';await expect(trustAcceptedMobilePairing('alice',record,sync.publicKeyJwk,()=>{},f.deps)).rejects.toThrow();const writes=f.state.writes;const trusted=await trustAcceptedMobilePairing('alice',record,sync.publicKeyJwk,()=>{},f.deps);expect(f.state.writes).toBe(writes);f.state.enabled=false;await revokeTrustedDevice(trusted.deviceId,()=>{},f.deps);const revoked=f.dump();await expect(trustAcceptedMobilePairing('alice',record,sync.publicKeyJwk,()=>{},f.deps)).rejects.toThrow();expect(f.dump()).toBe(revoked);
});
it('a pending mobile private key cannot be replaced by another QR',async()=>{
  const f=fixture(),first=await f.create();f.state.lose='accept';await expect(f.accept(first.pairingUri)).rejects.toThrow();const other=structuredClone(parseMobilePairingUri(first.pairingUri));other.creation.pairingId='Q'.repeat(24);const {pairingCommandBytes}=await import('../../../functions/src/mobilePairingContract');other.creationDigest=await f.deps.hash(pairingCommandBytes(other.creation));const {pairingBase64}=await import('./mobilePairingCrypto'),uri='mnemosyne://pair?payload='+pairingBase64(new TextEncoder().encode(JSON.stringify(other))),raw=localStorage.getItem(mobilePairingJournalKey('alice','mobile'));await expect(f.accept(uri)).rejects.toThrow();expect(localStorage.getItem(mobilePairingJournalKey('alice','mobile'))).toBe(raw);expect(f.deps.generate).toHaveBeenCalledTimes(2);
});
it('cancellation before creation acknowledgement preserves the journal and a delayed replay remains terminal',async()=>{
  const f=fixture(),transport=f.deps.call;f.deps.call=async(command,mode)=>{if(command.action==='create'&&mode==='apply')throw Error('Synthetic request never sent');return transport(command,mode);};await expect(f.create()).rejects.toThrow();const raw=localStorage.getItem(mobilePairingJournalKey('alice','desktop'))!;expect(raw).toBeTruthy();await cancelRetainedMobilePairing('alice','desktop',()=>{},f.deps);expect([...f.docs.values()].some(row=>row.status==='cancelled')).toBe(true);expect(localStorage.getItem(mobilePairingJournalKey('alice','desktop'))).not.toBeNull();
});
it('cancel failure retains the intention and does not claim success or discard keys',async()=>{
  const f=fixture(),invite=await f.create(),transport=f.deps.call;f.deps.call=async(command,mode)=>{if(command.action==='cancel')throw Error('Synthetic unavailable');return transport(command,mode);};await expect(cancelMobilePairingInvite(invite.pairingId,()=>{},f.deps)).rejects.toThrow();const raw=localStorage.getItem(mobilePairingJournalKey('alice','desktop'))!;expect(raw).toBeTruthy();const plain=await decryptMemoryEnvelope(JSON.parse(raw));expect(JSON.parse(plain.text).cancelRequested).toBe(true);expect(f.record(invite.pairingId).status).toBe('pending');
});
it.each(['actor','vault','storage'] as const)('%s ABA during key generation prevents journal publication and RPC',async kind=>{
  const f=fixture(),generate=f.deps.generate;f.deps.generate=async guard=>{const keys=await generate(guard);if(kind==='actor'){f.auth('bob');f.auth('alice');}else if(kind==='vault')f.retire();else f.storageListeners.forEach(listener=>listener());return keys;};await expect(f.create()).rejects.toThrow();expect(f.state.calls).toHaveLength(0);expect(localStorage.getItem(mobilePairingJournalKey('alice','desktop'))).toBeNull();
});
it('a retired view or occupied protocol lock prevents all preparation',async()=>{
  const f=fixture();await expect(createMobilePairingInvite('alice','Synthetic',()=>{throw Error('Synthetic closed');},f.deps)).rejects.toThrow();expect(f.deps.generate).not.toHaveBeenCalled();f.state.locked=true;await expect(f.create()).rejects.toThrow();expect(f.state.calls).toHaveLength(0);
});
it('a foreign confirmation or account swap at transport cannot return an identity or credential',async()=>{
  const f=fixture();f.state.foreign=true;await expect(f.create()).rejects.toThrow();expect(localStorage.getItem(mobilePairingJournalKey('alice','desktop'))).toBeTruthy();const g=fixture(),transport=g.deps.call;g.deps.call=async(command,mode)=>{g.auth('bob');return transport(command,mode);};await expect(g.create()).rejects.toThrow();expect(g.docs.has('devicePairings/'+('R'+String(1).padStart(23,'0')))).toBe(false);
});
it('locked vault still permits account-bound revocation but account ABA retires the reply',async()=>{
  const f=fixture();f.state.ready=false;f.docs.set('trustedDevices/legacy',{deviceId:'legacy',ownerUid:'alice',status:'active'});await revokeTrustedDevice('legacy',()=>{},f.deps);expect(f.docs.get('trustedDevices/legacy')?.status).toBe('revoked');const transport=f.deps.call;f.deps.call=async(command,mode)=>{const response=await transport(command,mode);f.auth('bob');f.auth('alice');return response;};await expect(revokeTrustedDevice('legacy',()=>{},f.deps)).rejects.toThrow();
});
it('wrong-vault or foreign-UID checkpoints are retained without RPC or new keys',async()=>{
  const f=fixture(),invite=await f.create(),raw=localStorage.getItem(mobilePairingJournalKey('alice','desktop'))!,calls=f.state.calls.length;f.deps.decrypt=async()=>{throw Error('Synthetic wrong vault');};await expect(f.create()).rejects.toThrow();expect(f.state.calls).toHaveLength(calls);expect(localStorage.getItem(mobilePairingJournalKey('alice','desktop'))).toBe(raw);const g=fixture();localStorage.setItem(mobilePairingJournalKey('bob','desktop'),raw);g.state.uid='bob';await expect(createMobilePairingInvite('bob','Synthetic',()=>{},g.deps)).rejects.toThrow();expect(g.state.calls).toHaveLength(0);expect(invite.pairingId).toBeTruthy();
});
it('closed enrollment avoids fresh keys but still reconciles an already published invitation',async()=>{
  const f=fixture();f.state.enabled=false;await expect(f.create()).rejects.toThrow();expect(f.deps.generate).not.toHaveBeenCalled();f.state.enabled=true;const invite=await f.create(),writes=f.state.writes;f.state.enabled=false;expect((await f.create()).pairingId).toBe(invite.pairingId);expect(f.state.writes).toBe(writes);
});
it('a confirmed cancellation permits a fresh QR without silently discarding the unsaved previous key',async()=>{
  const f=fixture(),invite=await f.create(),save=f.deps.saveCredential;f.deps.saveCredential=async()=>{throw Error('Synthetic key store offline');};await expect(f.accept(invite.pairingUri)).rejects.toThrow();await cancelRetainedMobilePairing('alice','mobile',()=>{},f.deps);const next=await f.create();f.deps.saveCredential=save;const accepted=await f.accept(next.pairingUri);expect(accepted.pairingId).toBe(next.pairingId);expect(next.pairingId).not.toBe(invite.pairingId);expect(Object.keys(localStorage).some(key=>key.startsWith('mnemosyne:mobile-pairing-archive:v2:alice:mobile:'))).toBe(true);
});
it('an explicit resume after trust beat cancellation recovers the existing active key without a new grant',async()=>{
  const f=fixture(),invite=await f.create(),save=f.deps.saveCredential;f.deps.saveCredential=async()=>{throw Error('Synthetic key store offline');};await expect(f.accept(invite.pairingUri)).rejects.toThrow();const sync=await generatePairingKey(()=>{}),trusted=await trustAcceptedMobilePairing('alice',f.record(invite.pairingId),sync.publicKeyJwk,()=>{},f.deps);await expect(cancelRetainedMobilePairing('alice','mobile',()=>{},f.deps)).rejects.toThrow();const writes=f.state.writes;f.deps.saveCredential=save;const recovered=await f.accept('');expect(recovered.deviceId).toBe(trusted.deviceId);expect(f.state.writes).toBe(writes);
});
it('renewing an expired invitation first commits cancellation so an in-flight old trust cannot activate later',async()=>{
  const f=fixture(),invite=await f.create();f.state.now=parseMobilePairingUri(invite.pairingUri).expiresAt;const next=await f.create();expect(next.pairingId).not.toBe(invite.pairingId);expect(f.record(invite.pairingId).status).toBe('cancelled');expect(f.state.calls.some(row=>row.command.action==='cancel'&&row.mode==='apply')).toBe(true);
});
it('a failed cancellation followed by permanent device revocation allows a new desktop invite without losing the old journal',async()=>{
  const f=fixture(),invite=await f.create();await f.accept(invite.pairingUri);const sync=await generatePairingKey(()=>{}),device=await trustAcceptedMobilePairing('alice',f.record(invite.pairingId),sync.publicKeyJwk,()=>{},f.deps);await expect(cancelMobilePairingInvite(invite.pairingId,()=>{},f.deps)).rejects.toThrow();await expect(f.create()).rejects.toThrow();await revokeTrustedDevice(device.deviceId,()=>{},f.deps);const next=await f.create();expect(next.pairingId).not.toBe(invite.pairingId);expect(Object.keys(localStorage).some(key=>key.startsWith('mnemosyne:mobile-pairing-archive:v2:alice:desktop:'))).toBe(true);
});

