import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,pending:true,recover:vi.fn(),cancel:vi.fn(),authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/commsMemoryImport',()=>({hasPendingCommsImport:(uid:string)=>uid==='alice'&&state.pending,observeCommsImports:()=>()=>{},
  recoverPendingCommsImport:(uid:string)=>state.recover(uid),cancelPendingCommsImport:(uid:string)=>state.cancel(uid)}));
import {CommsImportRecoveryPanel} from './CommsImportRecoveryPanel';
beforeEach(()=>{state.uid='alice';state.ready=true;state.pending=true;state.authListeners.clear();state.vaultListeners.clear();state.recover.mockReset();state.cancel.mockReset();
  state.recover.mockImplementation(async()=>{state.pending=false;return{status:'committed'};});state.cancel.mockImplementation(async()=>{state.pending=false;return{status:'cancelled'};});});
it('reports a committed operation only after receipt recovery',async()=>{
  render(<CommsImportRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar importação do Comms'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Importação do Comms confirmada.');expect(state.recover).toHaveBeenCalledWith('alice');expect(screen.queryByRole('button',{name:'Recuperar importação do Comms'})).toBeNull();
});
it('requires explicit cancellation and explains retained prepared files',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);render(<CommsImportRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Cancelar importação do Comms'}));expect(state.cancel).not.toHaveBeenCalled();
  expect(confirm.mock.calls[0][0]).toContain('ficheiro já preparado');confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Cancelar importação do Comms'}));expect(await screen.findByRole('status')).toHaveTextContent('cancelada.');confirm.mockRestore();
});
it('locked vault disables actions; recovery failures conserve pending controls and hide raw errors',async()=>{
  state.ready=false;render(<CommsImportRecoveryPanel/>);expect(screen.getByRole('button',{name:'Recuperar importação do Comms'})).toBeDisabled();
  act(()=>{state.ready=true;for(const callback of state.vaultListeners)callback();});state.recover.mockRejectedValue(Error('Synthetic private failure'));
  fireEvent.click(screen.getByRole('button',{name:'Recuperar importação do Comms'}));expect(await screen.findByRole('status')).toHaveTextContent('importação pendente foi conservada');expect(screen.getByRole('button',{name:'Recuperar importação do Comms'})).toBeEnabled();expect(screen.queryByText('Synthetic private failure')).toBeNull();
});
it('late account/vault response cannot publish success after switching back',async()=>{
  let resolve!:(value:{status:string})=>void;state.recover.mockReturnValue(new Promise(done=>{resolve=done;}));const view=render(<CommsImportRecoveryPanel/>);
  fireEvent.click(screen.getByRole('button',{name:'Recuperar importação do Comms'}));await waitFor(()=>expect(state.recover).toHaveBeenCalledOnce());
  act(()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});for(const callback of state.vaultListeners)callback();});
  await act(async()=>resolve({status:'committed'}));expect(screen.queryByRole('status')).toBeNull();view.unmount();expect(state.authListeners.size).toBe(0);expect(state.vaultListeners.size).toBe(0);
});
