import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CapsuleManagerPage} from './CapsuleManagerPage';
const state=vi.hoisted(()=>({uid:'alice' as string|null,read:vi.fn(),withdraw:vi.fn(),auth:new Set<(value:{uid:string}|null)=>void>(),vault:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return state.uid?{uid:state.uid}:null;}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(value:{uid:string}|null)=>void)=>{state.auth.add(callback);callback(state.uid?{uid:state.uid}:null);return()=>state.auth.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>false,onMemoryCryptoChanged:(callback:()=>void)=>{state.vault.add(callback);return()=>state.vault.delete(callback);}}));
vi.mock('../services/capsuleOwnerService',()=>({capsuleOwnerService:{read:(...args:unknown[])=>state.read(...args)}}));
vi.mock('../services/publicCapsuleService',()=>({revokePublicCapsule:(...args:unknown[])=>state.withdraw(...args)}));
const row=(id='capsule-a')=>({shareId:id,sourceToken:'a'.repeat(64),createdAt:1,expiresAt:null,views:null,importCount:0,itemCount:1,revoked:false,revokedAt:null});
beforeEach(()=>{state.uid='alice';state.auth.clear();state.vault.clear();state.read.mockReset().mockResolvedValue({rows:[row()],nextAfter:null});state.withdraw.mockReset().mockResolvedValue(undefined);});
afterEach(cleanup);
it('lists owner metadata and withdraws with the captured creation token even while the vault is locked',async()=>{
  render(<MemoryRouter><CapsuleManagerPage/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Retirar cápsula'}));
  await waitFor(()=>expect(state.withdraw).toHaveBeenCalledOnce());expect(state.withdraw.mock.calls[0][0]).toEqual(row());
  await screen.findByText('Retirada',{selector:'dd'});expect(screen.getByRole('button',{name:'Retirar cápsula'})).toBeDisabled();
});
it('a rejected withdrawal leaves the link unretired and asks for a refreshed snapshot',async()=>{
  state.withdraw.mockRejectedValueOnce(Error('Synthetic stale source'));render(<MemoryRouter><CapsuleManagerPage/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Retirar cápsula'}));
  await screen.findByText('Não foi possível retirar a cápsula. Atualiza a lista antes de tentar novamente.');expect(screen.getByText('Não retirada',{selector:'dd'})).toBeInTheDocument();
});
it('late owner metadata cannot appear after switching to another account',async()=>{
  let finish!:(value:unknown)=>void;state.read.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValue({rows:[],nextAfter:null});render(<MemoryRouter><CapsuleManagerPage/></MemoryRouter>);
  await waitFor(()=>expect(state.read).toHaveBeenCalledOnce());await act(async()=>{state.uid='bob';state.auth.forEach(callback=>callback({uid:'bob'}));});
  await act(async()=>{finish({rows:[row('old-private-id')],nextAfter:null});});expect(screen.queryByText(/old-priv/)).toBeNull();expect(screen.queryByRole('button',{name:'Retirar cápsula'})).toBeNull();
});
it('reads a selected publication from the fragment without including a key or silently listing other pages',async()=>{
  render(<MemoryRouter initialEntries={['/capsules#share=capsule-a']}><CapsuleManagerPage/></MemoryRouter>);await screen.findByRole('button',{name:'Retirar cápsula'});expect(state.read.mock.calls[0][0]).toEqual({shareId:'capsule-a'});
});
it('anonymous visitors receive a login action and no metadata request',async()=>{
  state.uid=null;render(<MemoryRouter><CapsuleManagerPage/></MemoryRouter>);expect(screen.getByRole('button',{name:'Entrar'})).toBeInTheDocument();expect(state.read).not.toHaveBeenCalled();
});
