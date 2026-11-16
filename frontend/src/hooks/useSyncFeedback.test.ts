import {act, renderHook} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({auth:{currentUser:{uid:'alice'} as {uid:string}|null},ready:true,authListener:undefined as undefined|((user:{uid:string}|null)=>void),vaultListener:undefined as undefined|(()=>void),stopAuth:vi.fn(),stopVault:vi.fn()}));
vi.mock('../firebase',()=>({auth:f.auth}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:typeof f.authListener)=>{f.authListener=callback;return f.stopAuth;}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>f.ready,onMemoryCryptoChanged:(callback:()=>void)=>{f.vaultListener=callback;return f.stopVault;}}));
import {useSyncFeedback} from './useSyncFeedback';
beforeEach(()=>{f.auth.currentUser={uid:'alice'};f.ready=true;vi.clearAllMocks();});
it('latches an account round trip and vault lock/unlock so an old completion cannot produce UI feedback',()=>{
  const {result}=renderHook(()=>useSyncFeedback());const first=result.current.capture('alice');expect(first()).toBe(true);
  act(()=>{f.auth.currentUser={uid:'bob'};f.authListener?.(f.auth.currentUser);f.auth.currentUser={uid:'alice'};f.authListener?.(f.auth.currentUser);});
  expect(first()).toBe(false);const second=result.current.capture('alice');expect(second()).toBe(true);
  act(()=>{f.ready=false;f.vaultListener?.();f.ready=true;f.vaultListener?.();});expect(second()).toBe(false);
});
it('closed panels and unmounted views reject late feedback and dispose Auth/vault subscriptions',()=>{
  const {result,rerender,unmount}=renderHook(({active})=>useSyncFeedback(active),{initialProps:{active:true}});
  const original=result.current.capture('alice');rerender({active:false});expect(original()).toBe(false);rerender({active:true});
  expect(original()).toBe(false);
  const last=result.current.capture('alice');expect(last()).toBe(true);unmount();expect(last()).toBe(false);expect(f.stopAuth).toHaveBeenCalledOnce();expect(f.stopVault).toHaveBeenCalledOnce();
});

it('account-only security actions remain available with the vault locked and still retire on account ABA',()=>{
  f.ready=false;const {result}=renderHook(()=>useSyncFeedback()),account=result.current.captureAccount('alice');expect(account()).toBe(true);expect(result.current.capture('alice')()).toBe(false);
  act(()=>{f.auth.currentUser={uid:'bob'};f.authListener?.(f.auth.currentUser);f.auth.currentUser={uid:'alice'};f.authListener?.(f.auth.currentUser);});expect(account()).toBe(false);
});
