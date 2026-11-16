import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
const state=vi.hoisted(()=>({uid:'alice',listeners:new Set<(user:{uid:string})=>void>()}));
vi.mock('../firebase',()=>({default:{},auth:{get currentUser(){return{uid:state.uid};}},db:{}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.listeners.add(callback);return()=>state.listeners.delete(callback);}}));
vi.mock('./clipCaptureService',()=>({withClipCaptureLock:async(_key:string,work:()=>Promise<unknown>)=>work()}));
import {getOrCreateDesktopSyncIdentity} from './desktopSyncIdentity';
import {setMemoryCryptoMnemonic} from './memoryCrypto';
import {deriveAesKeyFromMnemonic,decryptTextAesGcm,encryptTextAesGcm} from '../utils/crypto';
import {generatePairingKey} from './mobilePairingCrypto';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
beforeAll(()=>vi.stubGlobal('crypto',webcrypto));afterAll(()=>vi.unstubAllGlobals());beforeEach(()=>{localStorage.clear();state.uid='alice';state.listeners.clear();setMemoryCryptoMnemonic(words);});
it('reloads the same encrypted desktop identity without a mnemonic/private-handle cache',async()=>{
  const first=await getOrCreateDesktopSyncIdentity('alice',words),raw=localStorage.getItem('mnemosyne_desktop_sync_identity_alice')!,second=await getOrCreateDesktopSyncIdentity('alice',words);expect(second.publicKeyJwk).toEqual(first.publicKeyJwk);expect(second.privateKey).not.toBe(first.privateKey);expect(localStorage.getItem('mnemosyne_desktop_sync_identity_alice')).toBe(raw);expect(raw).not.toContain('privateKeyJwk');expect(Object.isFrozen(second)).toBe(true);
});
it('refuses caller retirement and account mismatch without writing a desktop identity',async()=>{
  await expect(getOrCreateDesktopSyncIdentity('alice',words,()=>{throw Error('Synthetic closed');})).rejects.toThrow();expect(localStorage.length).toBe(0);state.uid='bob';await expect(getOrCreateDesktopSyncIdentity('alice',words)).rejects.toThrow();expect(localStorage.length).toBe(0);
});
it('corrupted legacy scalar/public pairs fail without replacing their encrypted original',async()=>{
  await getOrCreateDesktopSyncIdentity('alice',words);const key=await deriveAesKeyFromMnemonic(words,'mnemosyne:desktop-sync:alice'),raw=localStorage.getItem('mnemosyne_desktop_sync_identity_alice')!,body=JSON.parse(await decryptTextAesGcm(JSON.parse(raw),key)),other=await generatePairingKey(()=>{});body.privateKeyJwk.d=other.privateKeyJwk.d;const corrupt=JSON.stringify(await encryptTextAesGcm(JSON.stringify(body),key));localStorage.setItem('mnemosyne_desktop_sync_identity_alice',corrupt);await expect(getOrCreateDesktopSyncIdentity('alice',words)).rejects.toThrow();expect(localStorage.getItem('mnemosyne_desktop_sync_identity_alice')).toBe(corrupt);
});
