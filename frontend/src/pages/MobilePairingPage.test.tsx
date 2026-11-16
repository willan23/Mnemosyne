import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,pending:false,authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>(),accept:vi.fn(),inspect:vi.fn(),protect:vi.fn(),cancel:vi.fn()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}},db:{},default:{}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(changed:()=>void)=>{state.vaultListeners.add(changed);return()=>state.vaultListeners.delete(changed);}}));
vi.mock('../services/mobilePairing',()=>({acceptMobilePairingInvite:(...args:unknown[])=>state.accept(...args),hasPendingMobilePairing:()=>state.pending,cancelRetainedMobilePairing:(...args:unknown[])=>state.cancel(...args)}));
vi.mock('../services/mobileDeviceKeyStore',()=>({isNativeSecureStorage:()=>false,inspectMobileSyncCredential:(...args:unknown[])=>state.inspect(...args),protectLegacyMobileSyncCredential:(...args:unknown[])=>state.protect(...args)}));
vi.mock('../services/mobileSync',()=>({importQueuedMobileSyncEnvelopes:vi.fn(),queueMobileMemoryDelta:vi.fn()}));
vi.mock('../hooks/useSessions',()=>({useSessions:()=>({allSessions:[]})}));
vi.mock('../components/SyncRecoveryActions',()=>({SyncRecoveryActions:()=>null}));
vi.mock('./LoginPage',()=>({LoginPage:()=>null}));
vi.mock('../services/mobileQrScanner',()=>({scanMobilePairingQr:vi.fn()}));
import {MobilePairingPage} from './MobilePairingPage';
const credential={ownerUid:'alice',deviceId:'M'.repeat(24),pairingId:'P'.repeat(24),deviceName:'Synthetic legacy phone',privateKeyJwk:{},savedAt:1};
beforeEach(()=>{state.uid='alice';state.ready=true;state.pending=false;state.authListeners.clear();state.vaultListeners.clear();vi.clearAllMocks();state.inspect.mockResolvedValue(null);state.protect.mockResolvedValue(undefined);state.cancel.mockResolvedValue(undefined);});
it('retires a late acceptance after account change without showing the old credential or success',async()=>{
  let resolve!:(value:typeof credential)=>void;state.accept.mockReturnValue(new Promise(done=>{resolve=done;}));render(<MobilePairingPage/>);fireEvent.change(screen.getByPlaceholderText('Colar convite copiado do desktop'),{target:{value:'mnemosyne://pair?payload=Synthetic'}});fireEvent.click(screen.getByRole('button',{name:'Aceitar convite',exact:true}));await waitFor(()=>expect(state.accept).toHaveBeenCalledOnce());
  act(()=>{state.uid='bob';state.authListeners.forEach(changed=>changed({uid:'bob'}));});await act(async()=>{resolve(credential);});expect(screen.queryByText(/Resposta confirmada e chave guardada/)).not.toBeInTheDocument();expect(screen.queryByText(/Synthetic legacy phone/)).not.toBeInTheDocument();
});
it('resumes a retained request without requiring another scan and keeps provider diagnostics out of feedback',async()=>{
  state.pending=true;state.accept.mockRejectedValue(Error('Synthetic internal provider diagnostic'));render(<MobilePairingPage/>);fireEvent.click(await screen.findByRole('button',{name:'Retomar último pedido cifrado'}));await screen.findByText(/O emparelhamento ainda não foi confirmado/);expect(state.accept).toHaveBeenCalledWith('',expect.any(String),expect.any(Function));expect(screen.queryByText(/internal provider diagnostic/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Retomar último pedido cifrado'})).toBeEnabled();
});
it('legacy protection is an explicit confirmation of the displayed account/device and captured source digest',async()=>{
  const digest='a'.repeat(64);state.inspect.mockResolvedValue({credential,legacy:true,sourceDigest:digest});render(<MobilePairingPage/>);expect(await screen.findByText(/Synthetic legacy phone/)).toBeVisible();expect(state.protect).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirmar conta e proteger credencial antiga'}));await screen.findByText(/Credencial protegida pelo cofre/);expect(state.protect).toHaveBeenCalledWith('alice',digest,expect.any(Function));
});
