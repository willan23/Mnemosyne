import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createHash,webcrypto} from 'node:crypto';
vi.mock('../firebase',()=>({default:{},auth:{currentUser:{uid:'alice'}},db:{}}));
vi.mock('./clipCaptureService',()=>({withClipCaptureLock:async(_name:string,work:()=>Promise<unknown>)=>work()}));
import {encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic} from './memoryCrypto';
import {generatePairingKey,pairingPrivateKey} from './mobilePairingCrypto';
import {saveMobileSyncCredential,inspectMobileSyncCredential,protectLegacyMobileSyncCredential,removeMobileSyncCredential,type MobileCredentialDeps,type MobileSyncCredential} from './mobileDeviceKeyStore';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
beforeAll(()=>vi.stubGlobal('crypto',webcrypto));afterAll(()=>vi.unstubAllGlobals());beforeEach(()=>setMemoryCryptoMnemonic(words));
async function fixture(){
  const keys=await generatePairingKey(()=>{}),credential:MobileSyncCredential={ownerUid:'alice',deviceId:'M'.repeat(24),pairingId:'P'.repeat(24),deviceName:'Synthetic phone',privateKeyJwk:keys.privateKeyJwk,savedAt:1000};
  const data=new Map<string,unknown>(),listeners=new Set<()=>void>(),state={uid:'alice',ready:true,writes:[] as string[]};
  const deps:MobileCredentialDeps={get:async key=>structuredClone(data.get(key)??null),set:async(key,value)=>{data.set(key,structuredClone(value));state.writes.push(key);},remove:async key=>{data.delete(key);},keys:async()=>[...data.keys()],encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,verify:pairingPrivateKey,exclusive:async(_key,work)=>work(),mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:changed=>{listeners.add(changed);return()=>listeners.delete(changed);}},hash:async value=>createHash('sha256').update(value).digest('hex')};
  return{credential,data,state,deps,retire:()=>listeners.forEach(listener=>listener()),save:(value=credential)=>saveMobileSyncCredential(value,()=>{},deps),inspect:(uid='alice')=>inspectMobileSyncCredential(uid,()=>{},deps)};
}
it('stores a real vault cipher, reloads the exact key and avoids rewriting a confirmed identical credential',async()=>{
  const f=await fixture();await f.save();const stored=JSON.stringify(f.data.get('credential_alice'));expect(stored).not.toContain('privateKeyJwk');expect(stored).not.toContain('Synthetic phone');const current=await f.inspect();expect(current?.legacy).toBe(false);expect(current?.credential).toEqual(f.credential);const writes=f.state.writes.length;await f.save();expect(f.state.writes).toHaveLength(writes);
});
it('reads a legacy claim without mutation and upgrades only the explicitly reviewed source with an encrypted exact archive',async()=>{
  const f=await fixture();f.data.set('credential_alice',structuredClone(f.credential));const reviewed=await f.inspect();expect(reviewed?.legacy).toBe(true);expect(f.state.writes).toHaveLength(0);await protectLegacyMobileSyncCredential('alice',reviewed!.sourceDigest,()=>{},f.deps);expect((await f.inspect())?.legacy).toBe(false);const archive=[...f.data.entries()].find(([key])=>key.startsWith('archive_v2:alice:'))!;expect(archive).toBeTruthy();const secret=await decryptMemoryEnvelope((archive[1] as {enc:Parameters<typeof decryptMemoryEnvelope>[0]}).enc);expect(JSON.parse(secret.text)).toEqual({v:2,uid:'alice',previous:f.credential});expect(f.state.writes.indexOf(archive[0])).toBeLessThan(f.state.writes.indexOf('credential_alice'));
});
it('a stale legacy confirmation never overwrites the newer credential',async()=>{
  const f=await fixture();f.data.set('credential_alice',f.credential);const reviewed=await f.inspect(),newer={...f.credential,deviceId:'N'.repeat(24)};f.data.set('credential_alice',newer);await expect(protectLegacyMobileSyncCredential('alice',reviewed!.sourceDigest,()=>{},f.deps)).rejects.toThrow();expect(f.data.get('credential_alice')).toEqual(newer);expect(f.state.writes).toHaveLength(0);
});
it('foreign-UID legacy records and copied vault ciphers are never adopted or overwritten',async()=>{
  const f=await fixture();f.data.set('credential_alice',{...f.credential,ownerUid:'bob'});await expect(f.save()).rejects.toThrow();expect(f.state.writes).toHaveLength(0);f.data.delete('credential_alice');await f.save();f.data.set('credential_bob',structuredClone(f.data.get('credential_alice')));f.state.uid='bob';await expect(f.inspect('bob')).rejects.toThrow();
});
it('a private scalar that does not match its public point is refused before persistence',async()=>{
  const f=await fixture(),other=await generatePairingKey(()=>{});await expect(f.save({...f.credential,privateKeyJwk:{...f.credential.privateKeyJwk,d:other.privateKeyJwk.d}})).rejects.toThrow();expect(f.state.writes).toHaveLength(0);
});
it('archive failure preserves the old primary credential and does not write the replacement',async()=>{
  const f=await fixture();f.data.set('credential_alice',f.credential);f.deps.set=async()=>{throw Error('Synthetic persistence failure');};await expect(f.save({...f.credential,deviceId:'N'.repeat(24)})).rejects.toThrow();expect(f.data.get('credential_alice')).toEqual(f.credential);
});
it('lost primary acknowledgement recovers via readback without overwriting again or losing the old archive',async()=>{
  const f=await fixture();f.data.set('credential_alice',f.credential);const next={...f.credential,deviceId:'N'.repeat(24)},set=f.deps.set;let lose=true;f.deps.set=async(key,value)=>{await set(key,value);if(key==='credential_alice'&&lose){lose=false;throw Error('Synthetic lost ACK');}};await expect(f.save(next)).rejects.toThrow();const writes=f.state.writes.length;expect((await f.inspect())?.credential).toEqual(next);await f.save(next);expect(f.state.writes).toHaveLength(writes);expect([...f.data.keys()].filter(key=>key.startsWith('archive_v2:alice:'))).toHaveLength(1);
});
it('account/vault retirement during encryption prevents the primary write and retains its baseline',async()=>{
  const f=await fixture(),encrypt=f.deps.encrypt;f.deps.encrypt=async value=>{const sealed=await encrypt(value);f.retire();return sealed;};await expect(f.save()).rejects.toThrow();expect(f.data.has('credential_alice')).toBe(false);
});
it('concurrent primary replacement fails CAS and preserves the newer value',async()=>{
  const f=await fixture(),encrypt=f.deps.encrypt,newer={...f.credential,deviceId:'N'.repeat(24)};f.deps.encrypt=async value=>{const sealed=await encrypt(value);f.data.set('credential_alice',newer);return sealed;};await expect(f.save()).rejects.toThrow();expect(f.data.get('credential_alice')).toEqual(newer);expect(f.state.writes).toHaveLength(0);
});
it('authorized post-deletion cleanup works after Auth/vault retirement and respects exact UID archive boundaries',async()=>{
  const f=await fixture();f.state.uid='';f.state.ready=false;for(const key of['credential_alice','archive_v2:alice:old','credential_alice_other','archive_v2:alice_other:old','credential_bob'])f.data.set(key,{synthetic:true});await removeMobileSyncCredential('alice',()=>{},f.deps);expect([...f.data.keys()].sort()).toEqual(['archive_v2:alice_other:old','credential_alice_other','credential_bob']);
});
