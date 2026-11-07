import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {ShareView} from './ShareView';
const state=vi.hoisted(()=>({uid:'alice' as string|null,ready:true,shareId:'synthetic-share',read:vi.fn(),opening:vi.fn(),import:vi.fn(),success:vi.fn(),error:vi.fn(),navigate:vi.fn(),authListeners:new Set<(user:{uid:string}|null)=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({db:{},auth:{get currentUser(){return state.uid?{uid:state.uid}:null;}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string}|null)=>void)=>{state.authListeners.add(callback);callback(state.uid?{uid:state.uid}:null);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/publicCapsuleService',()=>({publicCapsuleService:{read:(...args:unknown[])=>state.read(...args),opening:(...args:unknown[])=>state.opening(...args)}}));
vi.mock('react-router-dom',()=>({useParams:()=>({shareId:state.shareId}),useNavigate:()=>state.navigate}));
vi.mock('../utils/encryptedShare',()=>({isEncryptedShare:()=>true,decryptSharePayload:vi.fn(async()=> 'Synthetic capsule plaintext')}));
vi.mock('../utils/deepLinks',()=>({readPassphraseFromHash:()=> 'synthetic-key-local-only'}));
vi.mock('../services/learningService',()=>({importCapsuleAsMemory:(...args:unknown[])=>state.import(...args)}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(listener:()=>void)=>{state.vaultListeners.add(listener);return()=>state.vaultListeners.delete(listener);}}));
vi.mock('../components/ObsidianImportRecoveryPanel',()=>({ObsidianImportRecoveryPanel:()=> <div>Recuperação de importação disponível</div>}));
vi.mock('react-hot-toast',()=>({default:{success:(...args:unknown[])=>state.success(...args),error:(...args:unknown[])=>state.error(...args)}}));
beforeEach(()=>{state.uid='alice';state.ready=true;state.shareId='synthetic-share';state.authListeners.clear();state.vaultListeners.clear();[state.read,state.opening,state.import,state.success,state.error,state.navigate].forEach(mock=>mock.mockReset());state.read.mockImplementation(async(shareId:string)=>({v:1,shareId,generation:'a'.repeat(64),ciphertext:{v:1,alg:'AES-GCM-PBKDF2',salt:'A'.repeat(22)+'==',iv:'A'.repeat(16),data:'A'.repeat(43)+'='},sourceDigest:'b'.repeat(64),createdAt:1,expiresAt:null,views:0,viewDeadline:Date.now()+600000}));state.opening.mockResolvedValue(1);state.import.mockResolvedValue({id:'new-memory',importedCount:2,memoryIds:['new-memory','second']});});
async function start(){fireEvent.click(await screen.findByRole('button',{name:'Assimilar cápsula'},{timeout:3000}));await waitFor(()=>expect(state.import).toHaveBeenCalledOnce());}
it('passes the captured actor and live guard through the import and publishes only confirmed success',async()=>{
  render(<ShareView/>);await start();await screen.findByRole('button',{name:'Ver no grafo'});expect(state.import).toHaveBeenCalledWith('alice',expect.objectContaining({shareId:'synthetic-share',text:'Synthetic capsule plaintext'}),[],expect.any(Function));expect(state.success).toHaveBeenCalledOnce();expect(screen.getByText('Recuperação de importação disponível')).toBeInTheDocument();
});
it('failed imports retain capsule text and recovery without marking success or exposing diagnostics',async()=>{
  state.import.mockRejectedValueOnce(Error('SYNTHETIC_PRIVATE_ERROR'));render(<ShareView/>);await start();await waitFor(()=>expect(state.error).toHaveBeenCalledWith('Não foi possível concluir. Recupera ou cancela a importação pendente.'));expect(screen.getByText('Synthetic capsule plaintext')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Ver no grafo'})).toBeNull();expect(state.success).not.toHaveBeenCalled();
});
it.each(['account','vault','route','unmount'])('a %s change invalidates a pending import and suppresses late success',async mode=>{
  let finish!:(value:unknown)=>void;state.import.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const view=render(<ShareView/>);await start();const guard=state.import.mock.calls[0][3];
  await act(async()=>{if(mode==='account'){state.uid='bob';state.authListeners.forEach(cb=>cb({uid:'bob'}));state.uid='alice';state.authListeners.forEach(cb=>cb({uid:'alice'}));}if(mode==='vault'){state.ready=false;state.vaultListeners.forEach(cb=>cb());state.ready=true;state.vaultListeners.forEach(cb=>cb());}if(mode==='route'){state.shareId='other-share';view.rerender(<ShareView/>);}if(mode==='unmount')view.unmount();});expect(guard).toThrow();
  await act(async()=>{finish({id:'old-memory',importedCount:1,memoryIds:['old-memory']});});expect(state.success).not.toHaveBeenCalled();expect(state.error).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Ver no grafo'})).toBeNull();
});
it('a removed capsule still exposes cancellation/recovery for a previously captured plan',async()=>{
  state.read.mockRejectedValueOnce(Error('Unavailable'));render(<ShareView/>);await screen.findByText('Erro ao carregar a cápsula.');expect(screen.getByText('Recuperação de importação disponível')).toBeInTheDocument();
});
it('a locked personal vault disables import and explains how to open it',async()=>{
  state.ready=false;render(<ShareView/>);expect(await screen.findByRole('button',{name:'Assimilar cápsula'})).toBeDisabled();expect(screen.getByRole('button',{name:'Continuar na app'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Continuar na app'}));expect(state.navigate).toHaveBeenCalledWith('/');expect(state.import).not.toHaveBeenCalled();
});
it('records a bounded opening without the link fragment or decrypted payload',async()=>{
  window.history.replaceState(null,'','/share/synthetic-share#k=SYNTHETIC_FRAGMENT_SECRET');render(<ShareView/>);
  await waitFor(()=>expect(state.opening).toHaveBeenCalledOnce());const input=state.opening.mock.calls[0][0];
  expect(Object.keys(input).sort()).toEqual(['openingId','shareId','sourceDigest','v','viewDeadline']);
  expect(JSON.stringify(input)).not.toContain('SYNTHETIC_FRAGMENT_SECRET');expect(JSON.stringify(input)).not.toContain('Synthetic capsule plaintext');
  window.history.replaceState(null,'','/');
});
it('hides a confirmed imported memory ID immediately when the account changes',async()=>{
  render(<ShareView/>);await start();await screen.findByRole('button',{name:'Ver no grafo'});
  act(()=>{state.uid='bob';state.authListeners.forEach(callback=>callback({uid:'bob'}));});
  expect(screen.queryByRole('button',{name:'Ver no grafo'})).toBeNull();
});
it('a new route does not expose the previous source while the next read is pending',async()=>{
  const view=render(<ShareView/>);await screen.findByText('Synthetic capsule plaintext');
  state.read.mockReturnValueOnce(new Promise(()=>{}));state.shareId='pending-other';view.rerender(<ShareView/>);
  expect(screen.queryByText('Synthetic capsule plaintext')).toBeNull();expect(screen.queryByRole('button',{name:'Assimilar cápsula'})).toBeNull();
});
