import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,pending:true,recover:vi.fn(),cancel:vi.fn(),authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/personalLearnedRevision',()=>({hasPendingPersonalRevision:(uid:string)=>uid==='alice'&&state.pending,observePersonalRevisions:()=>()=>{},
  recoverPendingPersonalRevision:(uid:string)=>state.recover(uid),cancelPendingPersonalRevision:(uid:string)=>state.cancel(uid)}));
import {PersonalRevisionRecoveryPanel} from './PersonalRevisionRecoveryPanel';
beforeEach(()=>{state.uid='alice';state.ready=true;state.pending=true;state.authListeners.clear();state.vaultListeners.clear();state.recover.mockReset();state.cancel.mockReset();
  state.recover.mockImplementation(async()=>{state.pending=false;return{status:'committed'};});state.cancel.mockImplementation(async()=>{state.pending=false;return{status:'cancelled'};});});
it('reports a committed operation only after recovery and hides pending controls',async()=>{
  render(<PersonalRevisionRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar revisão'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Revisão confirmada.');expect(state.recover).toHaveBeenCalledWith('alice');expect(screen.queryByRole('button',{name:'Recuperar revisão'})).toBeNull();
});
it('requires explicit cancellation and preserves the current draft in its result',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);render(<PersonalRevisionRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Cancelar revisão pendente'}));expect(state.cancel).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Cancelar revisão pendente'}));expect(await screen.findByRole('status')).toHaveTextContent('O rascunho atual foi conservado.');confirm.mockRestore();
});
it('locked vault disables both actions and failed recovery retains pending controls',async()=>{
  state.ready=false;render(<PersonalRevisionRecoveryPanel/>);expect(screen.getByRole('button',{name:'Recuperar revisão'})).toBeDisabled();
  act(()=>{state.ready=true;for(const callback of state.vaultListeners)callback();});state.recover.mockRejectedValue(Error('Synthetic private failure'));
  fireEvent.click(screen.getByRole('button',{name:'Recuperar revisão'}));expect(await screen.findByRole('status')).toHaveTextContent('revisão pendente foi conservada');expect(screen.getByRole('button',{name:'Recuperar revisão'})).toBeEnabled();expect(screen.queryByText('Synthetic private failure')).toBeNull();
});
it('a late response after account/vault transition or unmount cannot publish success',async()=>{
  let resolve!:(value:{status:string})=>void;state.recover.mockReturnValue(new Promise(done=>{resolve=done;}));const view=render(<PersonalRevisionRecoveryPanel/>);
  fireEvent.click(screen.getByRole('button',{name:'Recuperar revisão'}));await waitFor(()=>expect(state.recover).toHaveBeenCalledOnce());
  act(()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});for(const callback of state.vaultListeners)callback();});
  await act(async()=>resolve({status:'committed'}));expect(screen.queryByRole('status')).toBeNull();view.unmount();expect(state.authListeners.size).toBe(0);expect(state.vaultListeners.size).toBe(0);
});

