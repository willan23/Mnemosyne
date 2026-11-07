import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice' as string|null,ready:true,outgoing:true,incoming:true,
  vaultListeners:new Set<()=>void>(),authListener:(user:{uid:string}|null)=>{void user;},recover:vi.fn(),cancel:vi.fn(),confirm:vi.fn()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return state.uid?{uid:state.uid}:null;}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:typeof state.authListener)=>{state.authListener=callback;callback(state.uid?{uid:state.uid}:null);return vi.fn();}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/mobileSyncCheckpoints',()=>({observeSyncCheckpoints:()=>vi.fn()}));
vi.mock('../services/mobileSyncOutbox',()=>({hasPendingSyncOutbox:()=>state.outgoing,recoverPendingSyncOutbox:(...args:unknown[])=>state.recover(...args),cancelPendingSyncOutbox:(...args:unknown[])=>state.cancel(...args)}));
vi.mock('../services/mobileSyncImport',()=>({hasPendingSyncImport:()=>state.incoming,confirmPendingMobileSyncImport:(...args:unknown[])=>state.confirm(...args)}));
import {SyncRecoveryActions} from './SyncRecoveryActions';
const view=()=>render(<SyncRecoveryActions uid="alice" deviceId="phone" outgoing="desktop-to-mobile"/>);
beforeEach(()=>{vi.clearAllMocks();state.uid='alice';state.ready=true;state.outgoing=true;state.incoming=true;state.vaultListeners.clear();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('makes no automatic requests and disables every recovery action while the vault is locked',()=>{
  state.ready=false;view();for(const button of screen.getAllByRole('button'))expect(button).toBeDisabled();expect(state.recover).not.toHaveBeenCalled();expect(state.cancel).not.toHaveBeenCalled();expect(state.confirm).not.toHaveBeenCalled();
});
it('reports queued publication as awaiting import and cancel during partial import as conserved progress',async()=>{
  state.recover.mockResolvedValueOnce({envelopeId:'synthetic',delivery:'queued',imported:0,conflicts:0});state.cancel.mockResolvedValueOnce({envelopeId:'synthetic',delivery:'pending',imported:0,conflicts:0});view();
  fireEvent.click(screen.getByRole('button',{name:'Retomar envio'}));await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('importação'));
  expect(state.recover).toHaveBeenCalledExactlyOnceWith('alice','phone','desktop-to-mobile');expect(state.cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Cancelar envio'}));await waitFor(()=>expect(state.cancel).toHaveBeenCalledExactlyOnceWith('alice','phone','desktop-to-mobile'));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Retoma'));expect(screen.getByRole('button',{name:'Cancelar envio'})).toBeEnabled();
});
it('confirmation queries the opposite direction and shows only actual aggregate counters',async()=>{
  state.confirm.mockResolvedValueOnce({status:'complete',cursor:2,memoryCount:2,imported:1,conflicts:1});view();fireEvent.click(screen.getByRole('button',{name:'Confirmar importação'}));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('1 alteração(ões) confirmada(s); 1 conflito(s) conservado(s).'));
  expect(state.confirm).toHaveBeenCalledExactlyOnceWith('alice','phone','mobile-to-desktop');expect(state.recover).not.toHaveBeenCalled();
});
it('suppresses late account/vault feedback and keeps fixed errors without private diagnostics',async()=>{
  for(const mode of ['account','vault']){
    let finish!:(value:unknown)=>void;state.recover.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));view();fireEvent.click(screen.getByRole('button',{name:'Retomar envio'}));
    for(const button of screen.getAllByRole('button'))expect(button).toBeDisabled();
    await act(async()=>{if(mode==='account'){state.uid='bob';state.authListener({uid:'bob'});}else{state.ready=false;state.vaultListeners.forEach(listener=>listener());}finish({delivery:'complete',imported:5,conflicts:0});});
    expect(screen.queryByRole('status')).toBeNull();cleanup();state.uid='alice';state.ready=true;
  }
  state.recover.mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC'));view();fireEvent.click(screen.getByRole('button',{name:'Retomar envio'}));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('Não foi possível confirmar. Os dados de recuperação foram conservados.'));
  expect(screen.queryByText('SYNTHETIC_PRIVATE_DIAGNOSTIC')).toBeNull();
});
