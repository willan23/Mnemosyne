import {beforeEach,expect,it,vi} from 'vitest';
import type {User} from 'firebase/auth';
const state=vi.hoisted(()=>({uid:'alice',ready:true,enabled:true,authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>(),
  identity:vi.fn(),hash:vi.fn(),clear:vi.fn(),clearMemory:vi.fn(),call:vi.fn(),calls:[] as unknown[],regions:[] as string[],names:[] as string[],
  lockGate:undefined as undefined|(()=>Promise<void>)}));
vi.mock('../firebase',()=>({default:{},db:{},auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('../config/releaseGates',()=>({get COMMS_IDENTITY_PUBLICATION_ENABLED(){return state.enabled;},COMMS_IDENTITY_ROLLOVERS_ENABLED:false}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('firebase/functions',()=>({getFunctions:(_app:unknown,region:string)=>{state.regions.push(region);return{};},httpsCallable:(_functions:unknown,name:string)=>async(value:unknown)=>{state.names.push(name);state.calls.push(structuredClone(value));return{data:await state.call(value)};}}));
vi.mock('./memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../utils/crypto',()=>({getOrCreateIdentity:(...args:unknown[])=>state.identity(...args),sha256ExactHex:(...args:unknown[])=>state.hash(...args),
  clearIdentityVault:(...args:unknown[])=>state.clear(...args),clearVolatileIdentities:()=>state.clearMemory()}));
vi.mock('./clipCaptureService',()=>({withClipCaptureLock:async(_name:string,work:()=>Promise<unknown>)=>{if(state.lockGate)await state.lockGate();return work();}}));
import {publishCommsIdentity,resetAndPublishCommsIdentity,CommsIdentityPublicationConflictError} from './commsIdentity';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'],fingerprint='a'.repeat(64);
const user=()=>({uid:'alice',displayName:'Synthetic Alice',email:'synthetic@example.invalid'}) as User;
const identity={publicKey:{} as CryptoKey,privateKey:{} as CryptoKey,pemPublic:'Synthetic public key'};
const outcome=()=>({v:1,uid:'alice',fingerprint,status:'current',changed:state.enabled});
beforeEach(()=>{state.uid='alice';state.ready=true;state.enabled=true;state.authListeners.clear();state.calls=[];state.regions=[];state.names=[];state.lockGate=undefined;
  state.identity.mockReset().mockImplementation(async(_uid:string,_words:string[],guard:()=>void)=>{guard();return identity;});state.hash.mockReset().mockResolvedValue(fingerprint);
  state.call.mockReset().mockImplementation(async()=>outcome());state.clear.mockReset();state.clearMemory.mockReset();
});
function actorAba(){state.uid='bob';for(const changed of state.authListeners)changed({uid:'bob'});state.uid='alice';for(const changed of state.authListeners)changed({uid:'alice'});}
function vaultAba(){state.ready=false;for(const changed of state.vaultListeners)changed();state.ready=true;for(const changed of state.vaultListeners)changed();}
it('sends only the captured actor and public key to the EU callable and validates confirmation before returning a private handle',async()=>{
  await expect(publishCommsIdentity(user(),words)).resolves.toEqual(identity);
  expect(state.calls).toEqual([{v:1,actorUid:'alice',publicKeyPem:identity.pemPublic,mode:'publish'}]);expect(state.regions).toEqual(['europe-west1']);expect(state.names).toEqual(['publishCommsIdentityKey']);
  expect(state.hash).toHaveBeenCalledWith(identity.pemPublic);const serialized=JSON.stringify(state.calls);
  for(const forbidden of ['privateKey','synthetic@example.invalid','Synthetic Alice','abandon'])expect(serialized).not.toContain(forbidden);expect(state.authListeners.size).toBe(0);
});
it('a callable denial keeps the local identity and does not return its private handle',async()=>{
  state.call.mockRejectedValue(Error('Synthetic denial'));await expect(publishCommsIdentity(user(),words)).rejects.toThrow();expect(state.calls).toHaveLength(1);expect(state.clear).not.toHaveBeenCalled();
});
it.each(['actor','vault'] as const)('a %s transition during key preparation prevents submission even after returning',async phase=>{
  state.identity.mockImplementation(async()=>{if(phase==='actor')actorAba();else vaultAba();return identity;});
  await expect(publishCommsIdentity(user(),words)).rejects.toThrow();expect(state.calls).toEqual([]);
});
it.each(['actor','vault'] as const)('a %s transition during public-key hashing prevents submission',async phase=>{
  state.hash.mockImplementation(async()=>{if(phase==='actor')actorAba();else vaultAba();return fingerprint;});
  await expect(publishCommsIdentity(user(),words)).rejects.toThrow();expect(state.calls).toEqual([]);
});
it('the caller context reaches key preparation and refuses submission after panel closure',async()=>{
  let live=true;state.identity.mockImplementation(async(_uid:string,_words:string[],guard:()=>void)=>{live=false;expect(guard).toThrow();return identity;});
  await expect(publishCommsIdentity(user(),words,()=>{if(!live)throw Error('Synthetic closed');})).rejects.toThrow();expect(state.calls).toEqual([]);
});
it('mutable User and mnemonic inputs cannot change the captured actor or introduce label/email authority',async()=>{
  const caller=user(),phrase=[...words];state.identity.mockImplementation(async(uid:string,captured:string[])=>{caller.uid='bob';caller.displayName='Other';caller.email='other@example.invalid';phrase[0]='changed';expect(uid).toBe('alice');expect(captured).toEqual(words);return identity;});
  await publishCommsIdentity(caller,phrase);expect(state.calls).toEqual([{v:1,actorUid:'alice',publicKeyPem:identity.pemPublic,mode:'publish'}]);
});
it('a context change while waiting for the local lock prevents identity preparation and submission',async()=>{
  let release!:()=>void;state.lockGate=()=>new Promise<void>(resolve=>{release=resolve;});const result=publishCommsIdentity(user(),words),rejected=expect(result).rejects.toThrow();
  actorAba();release();await rejected;expect(state.identity).not.toHaveBeenCalled();expect(state.calls).toEqual([]);expect(state.clear).not.toHaveBeenCalled();
});
it.each(['actor','vault'] as const)('a %s change after dispatch suppresses the returned handle without claiming to undo the server commit',async phase=>{
  state.call.mockImplementation(async()=>{if(phase==='actor')actorAba();else vaultAba();return outcome();});
  await expect(publishCommsIdentity(user(),words)).rejects.toThrow();expect(state.calls).toHaveLength(1);expect(state.clear).not.toHaveBeenCalled();
});
it('locking or switching the vault retires volatile private identity caches',()=>{vaultAba();expect(state.clearMemory).toHaveBeenCalledTimes(2);});
it('invalid mnemonic input is refused before reset or key preparation',async()=>{
  await expect(resetAndPublishCommsIdentity(user(),null)).rejects.toThrow();expect(state.clear).not.toHaveBeenCalled();expect(state.identity).not.toHaveBeenCalled();expect(state.calls).toEqual([]);
});
it.each(['mnemosyne:comms-identity-rollover:v1:alice','mnemosyne:comms-identity-backup:v1:alice'])('pending encrypted recovery %s prevents publication',async key=>{
  localStorage.setItem(key,'Synthetic pending cipher');try{await expect(publishCommsIdentity(user(),words)).rejects.toThrow();expect(state.identity).not.toHaveBeenCalled();expect(state.calls).toEqual([]);}finally{localStorage.removeItem(key);}
});
it.each([
  {uid:'bob'},{fingerprint:'b'.repeat(64)},{v:2},{status:'unknown'},{privateKey:'Synthetic forbidden'},{status:'unpublished',changed:false},
])('a response with foreign identity or incompatible fields is refused: %j',async patch=>{
  state.call.mockResolvedValue({...outcome(),...patch});await expect(publishCommsIdentity(user(),words)).rejects.toThrow();expect(state.clear).not.toHaveBeenCalled();
});
it('a remote key conflict has a recoverable domain error and never clears the local key',async()=>{
  state.call.mockRejectedValue(Object.assign(Error('Synthetic conflict'),{code:'functions/already-exists'}));
  await expect(publishCommsIdentity(user(),words)).rejects.toBeInstanceOf(CommsIdentityPublicationConflictError);expect(state.clear).not.toHaveBeenCalled();
});
it('closed local admission sends only check and can confirm an already published identity',async()=>{
  state.enabled=false;await expect(publishCommsIdentity(user(),words)).resolves.toEqual(identity);expect(state.calls).toEqual([{v:1,actorUid:'alice',publicKeyPem:identity.pemPublic,mode:'check'}]);
});
it('closed admission never falls back to publication when a pair is missing',async()=>{
  state.enabled=false;state.call.mockResolvedValue({...outcome(),status:'unpublished'});await expect(publishCommsIdentity(user(),words)).rejects.toThrow();
  expect(state.calls).toHaveLength(1);expect(state.calls[0]).toMatchObject({mode:'check'});expect(state.clear).not.toHaveBeenCalled();
});
it('a check response claiming a mutation is not accepted as a read-only confirmation',async()=>{
  state.enabled=false;state.call.mockResolvedValue({...outcome(),changed:true});await expect(publishCommsIdentity(user(),words)).rejects.toThrow();expect(state.clear).not.toHaveBeenCalled();
});
it('a lost reply can be retried with the same retained identity and no local reset',async()=>{
  state.call.mockRejectedValueOnce(Error('Synthetic lost reply')).mockResolvedValue(outcome());
  await expect(publishCommsIdentity(user(),words)).rejects.toThrow();await expect(publishCommsIdentity(user(),words)).resolves.toEqual(identity);
  expect(state.calls).toHaveLength(2);expect(state.calls[0]).toEqual(state.calls[1]);expect(state.clear).not.toHaveBeenCalled();
});
it('prepared public and private key handles are captured before asynchronous hashing',async()=>{
  const mutable={...identity},privateKey=mutable.privateKey;state.identity.mockResolvedValue(mutable);
  state.hash.mockImplementation(async pem=>{expect(pem).toBe(identity.pemPublic);mutable.pemPublic='Synthetic changed public key';mutable.privateKey={synthetic:'foreign'} as unknown as CryptoKey;return fingerprint;});
  const result=await publishCommsIdentity(user(),words);expect(result.pemPublic).toBe(identity.pemPublic);expect(result.privateKey).toBe(privateKey);expect(Object.isFrozen(result)).toBe(true);
  expect(state.calls[0]).toMatchObject({publicKeyPem:identity.pemPublic});
});
it('reset cannot clear a local identity after losing context while waiting for the lock',async()=>{
  let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});state.lockGate=()=>waiting;
  const result=resetAndPublishCommsIdentity(user(),words),rejected=expect(result).rejects.toThrow();actorAba();release();await rejected;
  expect(state.clear).not.toHaveBeenCalled();expect(state.identity).not.toHaveBeenCalled();expect(state.calls).toEqual([]);
});
