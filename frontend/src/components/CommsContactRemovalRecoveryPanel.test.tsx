import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,pending:true,recover:vi.fn(),cancel:vi.fn(),authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/commsContactRemoval',()=>({hasPendingCommsContactRemoval:(uid:string)=>uid==='alice'&&state.pending,observeCommsContactRemoval:()=>()=>{},continueCommsContactRemoval:(...args:unknown[])=>state.recover(...args),cancelCommsContactRemoval:(...args:unknown[])=>state.cancel(...args)}));
import {CommsContactRemovalRecoveryPanel} from './CommsContactRemovalRecoveryPanel';
beforeEach(()=>{state.uid='alice';state.ready=true;state.pending=true;state.authListeners.clear();state.vaultListeners.clear();state.recover.mockReset();state.cancel.mockReset();state.recover.mockImplementation(async()=>{state.pending=false;return{status:'complete',removedCount:61};});state.cancel.mockImplementation(async()=>{state.pending=false;return{status:'cancelled',removedCount:0};});});
it('continues the admitted operation, reports completion and refreshes only the current view',async()=>{
  const changed=vi.fn();render(<CommsContactRemovalRecoveryPanel onChanged={changed}/>);fireEvent.click(screen.getByRole('button',{name:'Continuar remoção de contacto'}));expect(await screen.findByRole('status')).toHaveTextContent('Contacto retirado.');expect(changed).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'Continuar remoção de contacto'})).toBeNull();
});
it('another bounded pending batch retains recovery and shows its cumulative progress',async()=>{
  state.recover.mockResolvedValue({status:'pending',removedCount:50});render(<CommsContactRemovalRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Continuar remoção de contacto'}));expect(await screen.findByRole('status')).toHaveTextContent('50 pedido(s) retirado(s)');expect(screen.getByRole('button',{name:'Continuar remoção de contacto'})).toBeEnabled();
});
it('requires confirmation before cancelling an unknown intent, and keeps admitted progress pending',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);render(<CommsContactRemovalRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Cancelar intenção não admitida'}));expect(state.cancel).not.toHaveBeenCalled();confirm.mockReturnValue(true);state.cancel.mockResolvedValue({status:'pending',removedCount:25});
  fireEvent.click(screen.getByRole('button',{name:'Cancelar intenção não admitida'}));expect(await screen.findByRole('status')).toHaveTextContent('25 pedido(s) retirado(s)');expect(screen.getByRole('button',{name:'Continuar remoção de contacto'})).toBeEnabled();state.cancel.mockImplementation(async()=>{state.pending=false;return{status:'cancelled',removedCount:0};});fireEvent.click(screen.getByRole('button',{name:'Cancelar intenção não admitida'}));expect(await screen.findByRole('status')).toHaveTextContent('Nenhum contacto foi retirado por esta operação');confirm.mockRestore();
});
it('locked vault disables recovery; a service failure keeps the operation without exposing raw details',async()=>{
  state.ready=false;render(<CommsContactRemovalRecoveryPanel/>);expect(screen.getByRole('button',{name:'Continuar remoção de contacto'})).toBeDisabled();act(()=>{state.ready=true;for(const callback of state.vaultListeners)callback();});state.recover.mockRejectedValue(Error('Synthetic private error'));
  fireEvent.click(screen.getByRole('button',{name:'Continuar remoção de contacto'}));expect(await screen.findByRole('status')).toHaveTextContent('cópia cifrada local foi conservada');expect(screen.getByRole('button',{name:'Continuar remoção de contacto'})).toBeEnabled();expect(screen.queryByText('Synthetic private error')).toBeNull();
});
it.each(['account','coffer','close'] as const)('retired %s context suppresses late completion and parent refresh',async mode=>{
  let finish!:(value:unknown)=>void;state.recover.mockReturnValue(new Promise(done=>finish=done));const changed=vi.fn(),view=render(<CommsContactRemovalRecoveryPanel onChanged={changed}/>);fireEvent.click(screen.getByRole('button',{name:'Continuar remoção de contacto'}));await waitFor(()=>expect(state.recover).toHaveBeenCalledOnce());const guard=state.recover.mock.calls[0][1] as()=>void;
  if(mode==='account')act(()=>{state.uid='carol';for(const callback of state.authListeners)callback({uid:'carol'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});});
  if(mode==='coffer')act(()=>{state.ready=false;for(const callback of state.vaultListeners)callback();state.ready=true;for(const callback of state.vaultListeners)callback();});
  if(mode==='close'){view.rerender(<CommsContactRemovalRecoveryPanel active={false} onChanged={changed}/>);view.rerender(<CommsContactRemovalRecoveryPanel onChanged={changed}/>);}
  expect(guard).toThrow();await act(async()=>finish({status:'complete',removedCount:61}));expect(changed).not.toHaveBeenCalled();expect(screen.queryByRole('status')).toBeNull();view.unmount();expect(state.authListeners.size).toBe(0);expect(state.vaultListeners.size).toBe(0);
});
