import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,pending:true,recover:vi.fn(),cancel:vi.fn(),authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/documentImportRecovery',()=>({hasPendingDocumentImport:(uid:string)=>uid==='alice'&&state.pending,observeDocumentImports:()=>()=>{},
  recoverPendingDocumentImport:(uid:string)=>state.recover(uid),cancelPendingDocumentImport:(uid:string)=>state.cancel(uid)}));
import {DocumentImportRecoveryPanel} from './DocumentImportRecoveryPanel';
const outcome=(status='complete')=>({status:{status},importedConfirmed:13,linksConfirmed:12,result:{hubId:'original-note'}});
beforeEach(()=>{state.uid='alice';state.ready=true;state.pending=true;state.authListeners.clear();state.vaultListeners.clear();state.recover.mockReset();state.cancel.mockReset();
  state.recover.mockImplementation(async()=>{state.pending=false;return outcome();});state.cancel.mockImplementation(async()=>{state.pending=false;return outcome('cancelled');});});
it('reports confirmed counts and selects the original note only after completion',async()=>{
  const selected=vi.fn();render(<DocumentImportRecoveryPanel onMemoryCreated={selected}/>);fireEvent.click(screen.getByRole('button',{name:'Retomar importação'}));
  expect(await screen.findByRole('status')).toHaveTextContent('13 documentos e 12 ligações entre pastas e documentos');expect(selected).toHaveBeenCalledWith('original-note');expect(state.recover).toHaveBeenCalledWith('alice');expect(screen.queryByRole('button',{name:'Retomar importação'})).toBeNull();
});
it('requires cancellation confirmation, reports conserved counts and never selects a partial note',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);const selected=vi.fn();render(<DocumentImportRecoveryPanel onMemoryCreated={selected}/>);
  fireEvent.click(screen.getByRole('button',{name:'Cancelar importação pendente'}));expect(state.cancel).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Cancelar importação pendente'}));expect(await screen.findByRole('status')).toHaveTextContent('Foram conservadas');expect(selected).not.toHaveBeenCalled();confirm.mockRestore();
});
it('disables both actions while locked and keeps recovery controls after a fixed failure message',async()=>{
  state.ready=false;render(<DocumentImportRecoveryPanel/>);expect(screen.getByRole('button',{name:'Retomar importação'})).toBeDisabled();expect(screen.getByRole('button',{name:'Cancelar importação pendente'})).toBeDisabled();
  act(()=>{state.ready=true;for(const callback of state.vaultListeners)callback();});state.recover.mockRejectedValue(Error('Synthetic private failure'));
  fireEvent.click(screen.getByRole('button',{name:'Retomar importação'}));expect(await screen.findByRole('status')).toHaveTextContent('plano cifrado foi conservado');expect(screen.queryByText('Synthetic private failure')).toBeNull();expect(screen.getByRole('button',{name:'Retomar importação'})).toBeEnabled();
});
it.each(['transition','unmount'])('a late result after %s cannot publish success or select a note',async stage=>{
  let resolve!:(value:ReturnType<typeof outcome>)=>void;state.recover.mockReturnValue(new Promise(done=>{resolve=done;}));const selected=vi.fn();const view=render(<DocumentImportRecoveryPanel onMemoryCreated={selected}/>);
  fireEvent.click(screen.getByRole('button',{name:'Retomar importação'}));await waitFor(()=>expect(state.recover).toHaveBeenCalledOnce());
  if(stage==='unmount')view.unmount();else act(()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});for(const callback of state.vaultListeners)callback();});
  await act(async()=>resolve(outcome()));expect(screen.queryByRole('status')).toBeNull();expect(selected).not.toHaveBeenCalled();view.unmount();expect(state.authListeners.size).toBe(0);expect(state.vaultListeners.size).toBe(0);
});
