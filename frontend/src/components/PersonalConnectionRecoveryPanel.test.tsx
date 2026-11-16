import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,pending:true,recover:vi.fn(),cancel:vi.fn(),authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/personalConnections',()=>({hasPendingPersonalConnection:(uid:string)=>uid==='alice'&&state.pending,observePersonalConnections:()=>()=>{},
  recoverPendingPersonalConnection:(uid:string)=>state.recover(uid),cancelPendingPersonalConnection:(uid:string)=>state.cancel(uid)}));
import {PersonalConnectionRecoveryPanel} from './PersonalConnectionRecoveryPanel';
beforeEach(()=>{state.uid='alice';state.ready=true;state.pending=true;state.authListeners.clear();state.vaultListeners.clear();state.recover.mockReset();state.cancel.mockReset();
  state.recover.mockImplementation(async()=>{state.pending=false;return{status:'committed'};});state.cancel.mockImplementation(async()=>{state.pending=false;return{status:'cancelled'};});});
it('reports a committed operation only after recovery and hides pending controls',async()=>{
  render(<PersonalConnectionRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar ligação'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Operação de ligação confirmada.');expect(state.recover).toHaveBeenCalledWith('alice');expect(screen.queryByRole('button',{name:'Recuperar ligação'})).toBeNull();
});
it('requires explicit cancellation and preserves already created notes in its result',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);render(<PersonalConnectionRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Cancelar ligação pendente'}));expect(state.cancel).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Cancelar ligação pendente'}));expect(await screen.findByRole('status')).toHaveTextContent('As notas foram conservadas.');confirm.mockRestore();
});
it('locked vault disables both actions and failed recovery retains pending controls',async()=>{
  state.ready=false;render(<PersonalConnectionRecoveryPanel/>);expect(screen.getByRole('button',{name:'Recuperar ligação'})).toBeDisabled();
  act(()=>{state.ready=true;for(const callback of state.vaultListeners)callback();});state.recover.mockRejectedValue(Error('Synthetic private failure'));
  fireEvent.click(screen.getByRole('button',{name:'Recuperar ligação'}));expect(await screen.findByRole('status')).toHaveTextContent('operação pendente foi conservada');expect(screen.getByRole('button',{name:'Recuperar ligação'})).toBeEnabled();expect(screen.queryByText('Synthetic private failure')).toBeNull();
});
it('a late response after account/vault transition or unmount cannot publish success',async()=>{
  let resolve!:(value:{status:string})=>void;state.recover.mockReturnValue(new Promise(done=>{resolve=done;}));const view=render(<PersonalConnectionRecoveryPanel/>);
  fireEvent.click(screen.getByRole('button',{name:'Recuperar ligação'}));await waitFor(()=>expect(state.recover).toHaveBeenCalledOnce());
  act(()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});for(const callback of state.vaultListeners)callback();});
  await act(async()=>resolve({status:'committed'}));expect(screen.queryByRole('status')).toBeNull();view.unmount();expect(state.authListeners.size).toBe(0);expect(state.vaultListeners.size).toBe(0);
});
