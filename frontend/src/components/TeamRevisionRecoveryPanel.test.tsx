import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,pending:true,recover:vi.fn(),cancel:vi.fn(),authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/teamRevisionRecovery',()=>({hasPendingTeamRevision:(uid:string)=>uid==='alice'&&state.pending,observeTeamRevisions:()=>()=>{},recoverPendingTeamRevision:(uid:string,guard:()=>void)=>state.recover(uid,guard),cancelPendingTeamRevision:(uid:string,guard:()=>void)=>state.cancel(uid,guard)}));
import {TeamRevisionRecoveryPanel} from './TeamRevisionRecoveryPanel';
beforeEach(()=>{state.uid='alice';state.ready=true;state.pending=true;state.authListeners.clear();state.vaultListeners.clear();state.recover.mockReset();state.cancel.mockReset();state.recover.mockImplementation(async()=>{state.pending=false;return{status:'committed'};});state.cancel.mockImplementation(async()=>{state.pending=false;return{status:'cancelled'};});});
it('reports a confirmed team revision while explicitly conserving the draft',async()=>{
  render(<TeamRevisionRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar revisão de equipa'}));expect(await screen.findByRole('status')).toHaveTextContent('O rascunho foi conservado');expect(state.recover).toHaveBeenCalledWith('alice',expect.any(Function));expect(screen.queryByRole('button',{name:'Recuperar revisão de equipa'})).toBeNull();
});
it('requires explicit cancellation and reports revocation without claiming a save',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);render(<TeamRevisionRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Cancelar revisão de equipa'}));expect(state.cancel).not.toHaveBeenCalled();confirm.mockReturnValue(true);state.cancel.mockImplementation(async()=>{state.pending=false;return{status:'revoked'};});fireEvent.click(screen.getByRole('button',{name:'Cancelar revisão de equipa'}));expect(await screen.findByRole('status')).toHaveTextContent('O acesso à equipa');expect(screen.getByRole('status')).toHaveTextContent('rascunho foi conservado');confirm.mockRestore();
});
it('locked vault disables actions and failures preserve the pending operation without exposing errors',async()=>{
  state.ready=false;render(<TeamRevisionRecoveryPanel/>);expect(screen.getByRole('button',{name:'Recuperar revisão de equipa'})).toBeDisabled();act(()=>{state.ready=true;for(const callback of state.vaultListeners)callback();});state.recover.mockRejectedValue(Error('Synthetic private diagnostic'));fireEvent.click(screen.getByRole('button',{name:'Recuperar revisão de equipa'}));expect(await screen.findByRole('status')).toHaveTextContent('pedido e o rascunho foram conservados');expect(screen.getByRole('button',{name:'Recuperar revisão de equipa'})).toBeEnabled();expect(screen.queryByText('Synthetic private diagnostic')).toBeNull();
});
it('late recovery retires its guard and feedback on account/vault changes and unmount',async()=>{
  let resolve!:(value:{status:string})=>void;state.recover.mockReturnValue(new Promise(done=>{resolve=done;}));const view=render(<TeamRevisionRecoveryPanel/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar revisão de equipa'}));await waitFor(()=>expect(state.recover).toHaveBeenCalledOnce());const guard=state.recover.mock.calls[0][1];
  act(()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});for(const callback of state.vaultListeners)callback();});expect(guard).toThrow();await act(async()=>resolve({status:'committed'}));expect(screen.queryByRole('status')).toBeNull();view.unmount();expect(state.authListeners.size).toBe(0);expect(state.vaultListeners.size).toBe(0);
});
