import {beforeAll,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',listeners:new Set<(user:{uid:string}|null)=>void>(),read:vi.fn(),identity:vi.fn(),retained:vi.fn()}));
vi.mock('../firebase',()=>({db:{},auth:{get currentUser(){return state.uid?{uid:state.uid}:null;}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,listener:(user:{uid:string}|null)=>void)=>{state.listeners.add(listener);return()=>state.listeners.delete(listener);}}));
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,...parts:string[])=>parts.join('/'),getDoc:(...args:unknown[])=>state.read(...args)}));
vi.mock('../utils/crypto',async original=>({...await original<typeof import('../utils/crypto')>(),getOrCreateIdentity:(...args:unknown[])=>state.identity(...args)}));
vi.mock('./commsIdentityRollover',()=>({loadRetainedCommsIdentities:(...args:unknown[])=>state.retained(...args)}));
import {unlockTeamKey,unlockMembershipTeamKeys} from './teamKeyAccess';
import {setMemoryCryptoMnemonic} from './memoryCrypto';
import {generateTestRsaIdentity,generateTeamKey,wrapTeamKeyForPublicPem,exportTeamKeyPlaintext,clearTeamKeyCache,getCachedTeamKey,cacheTeamKeyEpoch} from './teamVault';
import type {TeamRecord} from './teamsService';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
let old:Awaited<ReturnType<typeof generateTestRsaIdentity>>,next:typeof old,key:CryptoKey,team:TeamRecord;
beforeAll(async()=>{old=await generateTestRsaIdentity();next=await generateTestRsaIdentity();key=await generateTeamKey();team={id:'team',name:'Synthetic',ownerUid:'alice',createdAt:1,memberUids:['alice'],roles:{alice:'owner'},wrappedKeys:{alice:await wrapTeamKeyForPublicPem(key,old.pemPublic)}};});
beforeEach(()=>{vi.clearAllMocks();state.uid='alice';state.listeners.clear();clearTeamKeyCache();setMemoryCryptoMnemonic(words);state.identity.mockImplementation(async(_uid,_words,guard)=>{guard();return next;});state.retained.mockImplementation(async(_uid,_words,guard)=>{guard();return[old,next];});});
it('opens a retained old-key team wrap after identity rollover with real RSA/AES',async()=>{
  const opened=await unlockTeamKey(team,'alice',words);expect(await exportTeamKeyPlaintext(opened)).toBe(await exportTeamKeyPlaintext(key));expect(getCachedTeamKey('team')).toBe(opened);expect(state.retained).toHaveBeenCalledOnce();
});
it('uses the current private key without loading history when it opens the envelope',async()=>{
  state.identity.mockResolvedValue(old);await unlockTeamKey(team,'alice',words);expect(state.retained).not.toHaveBeenCalled();
});
it.each(['account','vault','cache','caller'] as const)('refuses late retained keys after %s changes and does not populate the cache',async mode=>{
  let live=true;state.retained.mockImplementation(async(_uid,_words,guard)=>{
    if(mode==='account'){state.uid='bob';for(const callback of state.listeners)callback({uid:'bob'});state.uid='alice';}
    if(mode==='vault'){setMemoryCryptoMnemonic(null);setMemoryCryptoMnemonic(words);}
    if(mode==='cache')clearTeamKeyCache('team');if(mode==='caller')live=false;
    guard();return[old];
  });
  await expect(unlockTeamKey(team,'alice',words,{isCurrent:()=>live})).rejects.toThrow();expect(getCachedTeamKey('team')).toBeNull();expect(state.listeners.size).toBe(0);
});
it('a closed coffer cannot return a previously cached team key',async()=>{
  cacheTeamKeyEpoch('team',1,key);setMemoryCryptoMnemonic(null);await expect(unlockTeamKey(team,'alice',words)).rejects.toThrow();expect(state.identity).not.toHaveBeenCalled();
});
it('retained keys do not grant a revoked membership or an inconsistent epoch',async()=>{
  await expect(unlockTeamKey({...team,memberUids:['bob']},'alice',words)).rejects.toThrow();
  state.read.mockResolvedValue({exists:()=>true,data:()=>({epoch:2,keyId:'different',memberUids:['alice'],wrappedKeys:team.wrappedKeys})});
  await expect(unlockTeamKey({...team,activeKeyEpoch:2,activeKeyId:'current'},'alice',words)).rejects.toThrow();expect(state.retained).not.toHaveBeenCalled();
});
it('membership background completion passes its caller guard through retained-key recovery',async()=>{
  let live=true;state.retained.mockImplementation(async()=>{live=false;return[old];});const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try{await unlockMembershipTeamKeys('alice',[team],words,()=>live);expect(getCachedTeamKey('team')).toBeNull();}finally{warning.mockRestore();}
});
