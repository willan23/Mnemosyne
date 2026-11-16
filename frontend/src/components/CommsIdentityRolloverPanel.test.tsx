import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,pending:true,enabled:true,recover:vi.fn(),cancel:vi.fn(),inspect:vi.fn(),republish:vi.fn(),authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../config/releaseGates',()=>({get COMMS_IDENTITY_ROLLOVERS_ENABLED(){return state.enabled;}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/commsIdentityRollover',()=>({hasPendingCommsIdentityRollover:(uid:string)=>uid==='alice'&&state.pending,observeCommsIdentityRollovers:()=>()=>{},
  recoverCommsIdentityRollover:(...args:unknown[])=>state.recover(...args),cancelCommsIdentityRollover:(...args:unknown[])=>state.cancel(...args),inspectCommsIdentityConflict:(...args:unknown[])=>state.inspect(...args),republishCommsIdentityConflict:(...args:unknown[])=>state.republish(...args),CommsIdentitySupersededError:class extends Error{}}));
import {CommsIdentitySupersededError} from '../services/commsIdentityRollover';
import {CommsIdentityRolloverPanel} from './CommsIdentityRolloverPanel';
const words=Array.from({length:12},()=> 'synthetic');
const preview={uid:'alice',operationId:'11111111-1111-4111-8111-111111111111',journalDigest:'d'.repeat(64),candidateFingerprint:'b'.repeat(64),baseline:{priorFingerprint:'c'.repeat(64),userStateHash:'e'.repeat(64),profileStateHash:'f'.repeat(64)}};
beforeEach(()=>{state.uid='alice';state.ready=true;state.pending=true;state.enabled=true;state.authListeners.clear();state.vaultListeners.clear();for(const mock of [state.recover,state.cancel,state.inspect,state.republish])mock.mockReset();
  state.recover.mockRejectedValue(new CommsIdentitySupersededError());state.inspect.mockResolvedValue(preview);state.republish.mockImplementation(async()=>{state.pending=false;return{result:{status:'committed'}};});
});
async function inspect(){fireEvent.click(screen.getByRole('button',{name:'Recuperar identidade Comms'}));fireEvent.click(await screen.findByRole('button',{name:'Verificar conflito de identidade'}));return screen.findByRole('button',{name:'Confirmar publicação da identidade conservada'});}
it('conflict inspection shows both fingerprints and requires explicit confirmation before republish',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);render(<CommsIdentityRolloverPanel mnemonic={words}/>);const button=await inspect();expect(screen.getByText(preview.baseline.priorFingerprint)).toBeVisible();expect(screen.getByText(preview.candidateFingerprint)).toBeVisible();expect(state.republish).not.toHaveBeenCalled();
  fireEvent.click(button);expect(state.republish).not.toHaveBeenCalled();confirm.mockReturnValue(true);fireEvent.click(button);await waitFor(()=>expect(state.republish).toHaveBeenCalledOnce());expect(state.republish.mock.calls[0].slice(0,3)).toEqual(['alice',words,preview]);expect(await screen.findByRole('status')).toHaveTextContent('confirmada');confirm.mockRestore();
});
it('closed admission still allows inspection while keeping publication disabled',async()=>{
  state.enabled=false;render(<CommsIdentityRolloverPanel mnemonic={words}/>);expect(await inspect()).toBeDisabled();expect(state.republish).not.toHaveBeenCalled();expect(screen.getByText('A publicação de outra identidade ainda não está disponível nesta versão.')).toBeVisible();
});
it('a stale reviewed baseline clears the preview and keeps the recovery controls',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);state.republish.mockRejectedValue(Error('Synthetic private stale baseline'));render(<CommsIdentityRolloverPanel mnemonic={words}/>);fireEvent.click(await inspect());expect(await screen.findByRole('status')).toHaveTextContent('verifica novamente');expect(screen.queryByText(preview.candidateFingerprint)).toBeNull();expect(screen.queryByText('Synthetic private stale baseline')).toBeNull();expect(screen.getByRole('button',{name:'Verificar conflito de identidade'})).toBeEnabled();confirm.mockRestore();
});
it.each(['account','coffer','close'] as const)('a preview returned after %s retirement cannot be shown or published',async kind=>{
  let finish!:(value:unknown)=>void;state.inspect.mockReturnValue(new Promise(done=>finish=done));const view=render(<CommsIdentityRolloverPanel mnemonic={words}/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar identidade Comms'}));fireEvent.click(await screen.findByRole('button',{name:'Verificar conflito de identidade'}));await waitFor(()=>expect(state.inspect).toHaveBeenCalledOnce());const guard=state.inspect.mock.calls[0][2] as ()=>void;
  if(kind==='account')act(()=>{state.uid='bob';for(const notify of state.authListeners)notify({uid:'bob'});state.uid='alice';for(const notify of state.authListeners)notify({uid:'alice'});});
  if(kind==='coffer')act(()=>{state.ready=false;for(const notify of state.vaultListeners)notify();state.ready=true;for(const notify of state.vaultListeners)notify();});
  if(kind==='close'){view.rerender(<CommsIdentityRolloverPanel mnemonic={words} active={false}/>);view.rerender(<CommsIdentityRolloverPanel mnemonic={words}/>);}
  expect(guard).toThrow();await act(async()=>finish(preview));expect(screen.queryByText(preview.candidateFingerprint)).toBeNull();expect(state.republish).not.toHaveBeenCalled();view.unmount();expect(state.authListeners.size).toBe(0);expect(state.vaultListeners.size).toBe(0);
});
