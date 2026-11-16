import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,pending:true,recover:vi.fn(),cancel:vi.fn(),authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/commsContacts',()=>({hasPendingCommsContact:(uid:string)=>uid==='alice'&&state.pending,observeCommsContacts:()=>()=>{},recoverCommsContact:(...args:unknown[])=>state.recover(...args),cancelCommsContact:(...args:unknown[])=>state.cancel(...args)}));
vi.mock('./CommsContactRemovalRecoveryPanel',()=>({CommsContactRemovalRecoveryPanel:()=>null}));
import {CommsContactRecoveryPanel} from './CommsContactRecoveryPanel';
beforeEach(()=>{state.uid='alice';state.ready=true;state.pending=true;state.authListeners.clear();state.vaultListeners.clear();state.recover.mockReset();state.cancel.mockReset();state.recover.mockImplementation(async()=>{state.pending=false;return{status:'revoked'};});state.cancel.mockImplementation(async()=>{state.pending=false;return{status:'revoked'};});});
it('reports an unavailable recipient as a terminal local request and refreshes the current selection',async()=>{
  const changed=vi.fn();render(<CommsContactRecoveryPanel onChanged={changed}/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar pedido de contacto'}));expect(await screen.findByRole('status')).toHaveTextContent('O destinatário já não está disponível. O pedido local foi encerrado.');expect(changed).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'Recuperar pedido de contacto'})).toBeNull();
});
it('cancel confirmation can also settle a permanently revoked request without a success claim for creation',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);render(<CommsContactRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Cancelar pedido de contacto'}));expect(await screen.findByRole('status')).toHaveTextContent('destinatário já não está disponível');expect(state.cancel).toHaveBeenCalledOnce();confirm.mockRestore();
});
it('a locked coffer or transient service failure retains recovery and hides private error details',async()=>{
  state.ready=false;render(<CommsContactRecoveryPanel/>);expect(screen.getByRole('button',{name:'Recuperar pedido de contacto'})).toBeDisabled();act(()=>{state.ready=true;for(const callback of state.vaultListeners)callback();});state.recover.mockRejectedValue(Error('Synthetic private outage'));
  fireEvent.click(screen.getByRole('button',{name:'Recuperar pedido de contacto'}));expect(await screen.findByRole('status')).toHaveTextContent('cópia cifrada local foi conservada');expect(screen.getByRole('button',{name:'Recuperar pedido de contacto'})).toBeEnabled();expect(screen.queryByText('Synthetic private outage')).toBeNull();
});
it.each(['account','coffer','close'] as const)('revoked result after %s retirement cannot clear or refresh another context',async mode=>{
  let finish!:(value:unknown)=>void;state.recover.mockReturnValue(new Promise(done=>finish=done));const changed=vi.fn(),view=render(<CommsContactRecoveryPanel onChanged={changed}/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar pedido de contacto'}));await waitFor(()=>expect(state.recover).toHaveBeenCalledOnce());const guard=state.recover.mock.calls[0][1] as()=>void;
  if(mode==='account')act(()=>{state.uid='carol';for(const callback of state.authListeners)callback({uid:'carol'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});});
  if(mode==='coffer')act(()=>{state.ready=false;for(const callback of state.vaultListeners)callback();state.ready=true;for(const callback of state.vaultListeners)callback();});
  if(mode==='close'){view.rerender(<CommsContactRecoveryPanel active={false} onChanged={changed}/>);view.rerender(<CommsContactRecoveryPanel onChanged={changed}/>);}
  expect(guard).toThrow();await act(async()=>finish({status:'revoked'}));expect(changed).not.toHaveBeenCalled();expect(screen.queryByRole('status')).toBeNull();view.unmount();expect(state.authListeners.size).toBe(0);expect(state.vaultListeners.size).toBe(0);
});
