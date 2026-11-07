vi.mock('./CommsP2PContentRecoveryPanel',()=>({CommsP2PContentRecoveryPanel:()=>null}));
vi.mock('../services/commsP2PContent',()=>({hasPendingCommsP2PContent:()=>false,observeCommsP2PContent:()=>()=>{},observeCommsP2PInbox:()=>()=>{},readCommsP2PInbox:async()=>({rows:[],next:null,scanned:0,unavailable:0}),acknowledgeStoredCommsP2P:vi.fn(),resumeCommsP2PContent:vi.fn(),createCommsP2PContentLink:vi.fn(),sendCommsP2PContent:vi.fn()}));
vi.mock('../services/commsP2PSignaling',()=>({commsP2PRequestBinding:(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='actorUid')),hasPendingCommsP2P:()=>false,hasStoredCommsP2PSession:()=>false,observeCommsP2P:()=>()=>{},mutateCommsP2PSignal:vi.fn(),watchCommsP2PSignal:()=>()=>{},commsP2PHash:vi.fn()}));
vi.mock('./CommsP2PRecoveryPanel',()=>({CommsP2PRecoveryPanel:()=>null}));
vi.mock('../services/commsLists',async()=>({...await import('../test/commsPageObserverFixture'),searchAcceptedCommsContact:(...args:unknown[])=>directory.search(...args)}));
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>(),lookup:vi.fn(),request:vi.fn(),respond:vi.fn(),success:vi.fn(),error:vi.fn(),get:vi.fn(),incoming:[] as Record<string,unknown>[],outgoing:[] as Record<string,unknown>[],snapshots:[] as{kind:string;callback:(value:unknown)=>void}[]}));
const directory=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],search:vi.fn(),remove:vi.fn(),pendingRemoval:false}));
vi.mock('../services/commsContactRemoval',()=>({removeAcceptedCommsContact:(...args:unknown[])=>directory.remove(...args),hasPendingCommsContactRemoval:()=>directory.pendingRemoval}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid,displayName:'Synthetic '+state.uid};}},db:{}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../config/releaseGates',async original=>({...await original<typeof import('../config/releaseGates')>(),COMMS_CONTACT_WRITES_ENABLED:true}));
vi.mock('firebase/firestore',()=>({collection:(_db:unknown,...parts:string[])=>({path:parts.join('/')}),where:(field:string,_operator:string,value:string)=>({field,value}),query:(ref:unknown,...filters:{field:string;value:string}[])=>({ref,filters}),doc:(_db:unknown,...parts:string[])=>({path:parts.join('/')}),getDoc:(...args:unknown[])=>state.get(...args),addDoc:vi.fn(),setDoc:vi.fn(),updateDoc:vi.fn(),
  onSnapshot:(q:{ref?:{path:string};filters?:{field:string;value:string}[]},callback:(value:unknown)=>void)=>{const kind=q.ref?.path==='acceptedContacts'?'directory':q.ref?.path==='friendRequests'?(q.filters?.[0].field==='toUid'?'incoming':'outgoing'):'other';state.snapshots.push({kind,callback});callback({docs:(kind==='incoming'?state.incoming:kind==='outgoing'?state.outgoing:kind==='directory'?directory.rows:[]).map(row=>({id:row.actualId,data:()=>row}))});return()=>{};}}));
vi.mock('../services/commsContacts',()=>({lookupCommsRecipient:(...args:unknown[])=>state.lookup(...args),requestCommsContact:(...args:unknown[])=>state.request(...args),respondCommsContact:(...args:unknown[])=>state.respond(...args),hasPendingCommsContact:()=>false}));
vi.mock('../services/commsIdentity',()=>({publishCommsIdentity:async()=>({privateKey:{},publicKey:{},pemPublic:'Synthetic public'}),resetAndPublishCommsIdentity:vi.fn()}));
vi.mock('../services/commsIdentityRollover',()=>({hasPendingCommsIdentityRollover:()=>false,observeCommsIdentityRollovers:()=>()=>{},loadRetainedCommsIdentities:async()=>[]}));
vi.mock('../services/rtcConfig',()=>({getRtcConfiguration:()=>({})}));
vi.mock('../store/universeStore',()=>({useUniverseStore:()=>({memories:[]})}));
vi.mock('../utils/translations',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('react-hot-toast',()=>({default:{success:(...args:unknown[])=>state.success(...args),error:(...args:unknown[])=>state.error(...args)}}));
vi.mock('./ObsidianImportRecoveryPanel',()=>({ObsidianImportRecoveryPanel:()=>null}));
vi.mock('./CommsImportRecoveryPanel',()=>({CommsImportRecoveryPanel:()=>null}));
vi.mock('./CommsIdentityRolloverPanel',()=>({CommsIdentityRolloverPanel:()=>null}));
vi.mock('./CommsContactRecoveryPanel',()=>({CommsContactRecoveryPanel:()=>null}));
vi.mock('./CommsDeliveryRecoveryPanel',()=>({CommsDeliveryRecoveryPanel:()=>null}));
vi.mock('../services/commsDelivery',()=>({hasPendingCommsDelivery:()=>false,observeCommsDeliveries:()=>()=>{},sendCommsDelivery:vi.fn(),acknowledgeCommsTransmission:vi.fn()}));
import {TransmissionPanel} from './TransmissionPanel';
const profile={uid:'bob',displayName:'Synthetic Bob',publicKeyPem:'Synthetic RSA public',fingerprint:'a'.repeat(64)},props={isOpen:true,onClose:vi.fn(),mnemonic:Array(12).fill('synthetic')};
beforeEach(()=>{directory.rows=[];directory.search.mockReset();directory.remove.mockReset();directory.pendingRemoval=false;state.uid='alice';state.ready=true;state.authListeners.clear();state.vaultListeners.clear();state.incoming=[];state.outgoing=[];state.snapshots=[];for(const mock of[state.lookup,state.request,state.respond,state.success,state.error,state.get])mock.mockReset();state.lookup.mockResolvedValue(profile);state.request.mockResolvedValue({status:'pending'});state.respond.mockResolvedValue({status:'accepted'});state.get.mockResolvedValue({exists:()=>false});});
async function resolve(){fireEvent.change(await screen.findByPlaceholderText('email ou uid do destinatário'),{target:{value:'bob@example.invalid'}});fireEvent.click(screen.getByTitle('Resolver destinatário'));await screen.findByText('Chave pública encontrada para Synthetic Bob');}

const acceptedRow=(uid='bob')=>({actualId:'older-'+uid,fromUid:uid,toUid:'alice',status:'accepted',createdAt:1,updatedAt:2,uid,displayName:'Accepted '+uid,publicKeyPem:'-----BEGIN PUBLIC KEY-----\nQQ==\n-----END PUBLIC KEY-----',fingerprint:'a'.repeat(64)});
const searchPage=(uid='carol')=>{const {actualId,...data}=acceptedRow(uid);return{uid:'alice',kind:'contact-search',rows:[{id:actualId,data}],next:null,unavailable:0,scanned:1};};
it('requires confirmation and captures the accepted relationship before starting its recoverable removal',async()=>{
  directory.rows=[acceptedRow()];const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);directory.remove.mockImplementation(async()=>{directory.rows=[];return{status:'complete'};});render(<TransmissionPanel {...props} initialTab="contacts"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Retirar Accepted bob'}));expect(directory.remove).not.toHaveBeenCalled();confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Retirar Accepted bob'}));await waitFor(()=>expect(directory.remove).toHaveBeenCalledOnce());expect(directory.remove.mock.calls[0].slice(0,2)).toEqual(['alice',{peerUid:'bob',anchorId:'older-bob',anchorUpdatedAt:2}]);await waitFor(()=>expect(state.success).toHaveBeenCalledWith('Contacto retirado.'));await waitFor(()=>expect(screen.queryByRole('button',{name:'Accepted bob'})).toBeNull());confirm.mockRestore();
});
it('a pending local removal disables another contact removal',async()=>{
  directory.rows=[acceptedRow()];directory.pendingRemoval=true;render(<TransmissionPanel {...props} initialTab="contacts"/>);expect(await screen.findByRole('button',{name:'Retirar Accepted bob'})).toBeDisabled();expect(directory.remove).not.toHaveBeenCalled();
});
it('a permanently unavailable recipient is reported as an ended local request',async()=>{
  state.request.mockResolvedValue({status:'revoked'});render(<TransmissionPanel {...props} initialDraft={{text:'Synthetic preserved draft'}}/>);await resolve();const draftBefore=(screen.getByPlaceholderText('Escreva a mensagem ou pensamento a encapsular...') as HTMLTextAreaElement).value;expect(draftBefore).toContain('Synthetic preserved draft');fireEvent.click(screen.getByRole('button',{name:'Pedir contacto'}));await waitFor(()=>expect(state.success).toHaveBeenCalledWith('O destinatário já não está disponível. O pedido local foi encerrado.'));expect(state.success).not.toHaveBeenCalledWith('Pedido de contacto confirmado.');expect(screen.queryByText('Chave pública encontrada para Synthetic Bob')).toBeNull();expect(screen.getByPlaceholderText('Escreva a mensagem ou pensamento a encapsular...')).toHaveValue(draftBefore);
});
it('a removal acknowledgement after account ABA cannot clear the new view or publish feedback',async()=>{
  directory.rows=[acceptedRow()];let finish!:(value:unknown)=>void;directory.remove.mockReturnValue(new Promise(done=>finish=done));const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);render(<TransmissionPanel {...props} initialTab="contacts"/>);fireEvent.click(await screen.findByRole('button',{name:'Retirar Accepted bob'}));await waitFor(()=>expect(directory.remove).toHaveBeenCalledOnce());const guard=directory.remove.mock.calls[0][2] as()=>void;
  act(()=>{state.uid='carol';for(const callback of state.authListeners)callback({uid:'carol'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});});expect(guard).toThrow();await act(async()=>finish({status:'complete'}));expect(state.success).not.toHaveBeenCalled();expect(state.error).not.toHaveBeenCalled();confirm.mockRestore();
});
it('shows accepted contacts independently of request pages and selects the projected current profile without SDK reads',async()=>{
  directory.rows=[acceptedRow(),acceptedRow(),{...acceptedRow('foreign'),toUid:'carol'}];render(<TransmissionPanel {...props} initialTab="contacts"/>);
  const contact=await screen.findByRole('button',{name:'Accepted bob'});expect(screen.getAllByRole('button',{name:'Accepted bob'})).toHaveLength(1);expect(state.get).not.toHaveBeenCalled();
  fireEvent.click(contact);await screen.findByText('Chave pública encontrada para Accepted bob');expect(state.lookup).not.toHaveBeenCalled();expect(screen.getByText('Contacto',{exact:true})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Pedir contacto'})).toBeNull();
});
it('searches an exact accepted contact outside the current page and returns to the directory',async()=>{
  directory.rows=[acceptedRow()];directory.search.mockResolvedValue(searchPage());render(<TransmissionPanel {...props} initialTab="contacts"/>);
  fireEvent.change(await screen.findByLabelText('UID ou email do contacto'),{target:{value:'carol@example.invalid'}});fireEvent.click(screen.getByRole('button',{name:'Procurar contacto aceite'}));
  await screen.findByRole('button',{name:'Accepted carol'});expect(directory.search.mock.calls[0].slice(0,3)).toEqual(['alice','carol@example.invalid',null]);expect(screen.queryByRole('button',{name:'Accepted bob'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Ver diretório'}));await screen.findByRole('button',{name:'Accepted bob'});expect(state.get).not.toHaveBeenCalled();
});
it('editing contact search retires an in-flight result and suppresses its error or selection',async()=>{
  let finish!:(value:unknown)=>void;directory.search.mockReturnValue(new Promise(done=>finish=done));render(<TransmissionPanel {...props} initialTab="contacts"/>);
  const input=await screen.findByLabelText('UID ou email do contacto');fireEvent.change(input,{target:{value:'bob'}});fireEvent.click(screen.getByRole('button',{name:'Procurar contacto aceite'}));await waitFor(()=>expect(directory.search).toHaveBeenCalledOnce());
  const guard=directory.search.mock.calls[0][3] as()=>void;fireEvent.change(input,{target:{value:'carol'}});expect(guard).toThrow();await act(async()=>finish(searchPage('bob')));
  expect(screen.queryByRole('button',{name:'Accepted bob'})).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
});
it('failed accepted-contact search is shown as an error with retry rather than stale contacts',async()=>{
  directory.rows=[acceptedRow()];directory.search.mockRejectedValue(Error('Synthetic service failure'));render(<TransmissionPanel {...props} initialTab="contacts"/>);
  fireEvent.change(await screen.findByLabelText('UID ou email do contacto'),{target:{value:'carol'}});fireEvent.click(screen.getByRole('button',{name:'Procurar contacto aceite'}));await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Accepted bob'})).toBeNull();
  directory.search.mockResolvedValue(searchPage());fireEvent.click(screen.getByRole('button',{name:'Procurar contacto aceite'}));await screen.findByRole('button',{name:'Accepted carol'});
});
it.each(['account','coffer','close'] as const)('retired %s context cannot publish a late accepted-contact search',async mode=>{
  let finish!:(value:unknown)=>void;directory.search.mockReturnValue(new Promise(done=>finish=done));const view=render(<TransmissionPanel {...props} initialTab="contacts"/>);
  fireEvent.change(await screen.findByLabelText('UID ou email do contacto'),{target:{value:'bob'}});fireEvent.click(screen.getByRole('button',{name:'Procurar contacto aceite'}));await waitFor(()=>expect(directory.search).toHaveBeenCalledOnce());const guard=directory.search.mock.calls[0][3] as()=>void;
  if(mode==='account')act(()=>{state.uid='carol';for(const listener of state.authListeners)listener({uid:'carol'});state.uid='alice';for(const listener of state.authListeners)listener({uid:'alice'});});
  if(mode==='coffer')act(()=>{state.ready=false;for(const listener of state.vaultListeners)listener();state.ready=true;for(const listener of state.vaultListeners)listener();});
  if(mode==='close'){view.rerender(<TransmissionPanel {...props} isOpen={false}/>);view.rerender(<TransmissionPanel {...props} initialTab="contacts"/>);}
  expect(guard).toThrow();await act(async()=>finish(searchPage('bob')));expect(screen.queryByRole('button',{name:'Accepted bob'})).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
});
it('uses the authenticated resolver and captures the original recipient fingerprint for a recoverable request',async()=>{
  render(<TransmissionPanel {...props}/>);await resolve();expect(state.lookup.mock.calls[0].slice(0,2)).toEqual(['alice','bob@example.invalid']);fireEvent.click(screen.getByRole('button',{name:'Pedir contacto'}));await waitFor(()=>expect(state.request).toHaveBeenCalledOnce());expect(state.request.mock.calls[0].slice(0,2)).toEqual(['alice',{uid:'bob',fingerprint:'a'.repeat(64)}]);await waitFor(()=>expect(state.success).toHaveBeenCalledWith('Pedido de contacto confirmado.'));
});
it('editing the lookup invalidates an older response before it can select another recipient',async()=>{
  let finish!:(value:typeof profile)=>void;state.lookup.mockReturnValue(new Promise(done=>{finish=done;}));render(<TransmissionPanel {...props}/>);const input=await screen.findByPlaceholderText('email ou uid do destinatário');fireEvent.change(input,{target:{value:'bob@example.invalid'}});fireEvent.click(screen.getByTitle('Resolver destinatário'));await waitFor(()=>expect(state.lookup).toHaveBeenCalledOnce());const guard=state.lookup.mock.calls[0][2] as()=>void;fireEvent.change(input,{target:{value:'carol@example.invalid'}});expect(guard).toThrow();await act(async()=>finish(profile));expect(screen.queryByText('Chave pública encontrada para Synthetic Bob')).toBeNull();expect(state.error).not.toHaveBeenCalled();
});
it.each(['account','coffer','close'] as const)('retired %s context cannot show a late lookup or contact acknowledgement',async mode=>{
  let finish!:(value:unknown)=>void;state.request.mockReturnValue(new Promise(done=>{finish=done;}));const view=render(<TransmissionPanel {...props}/>);await resolve();fireEvent.click(screen.getByRole('button',{name:'Pedir contacto'}));await waitFor(()=>expect(state.request).toHaveBeenCalledOnce());const guard=state.request.mock.calls[0][2] as()=>void;
  if(mode==='account')act(()=>{state.uid='carol';for(const listener of state.authListeners)listener({uid:'carol'});state.uid='alice';for(const listener of state.authListeners)listener({uid:'alice'});});
  if(mode==='coffer')act(()=>{state.ready=false;for(const listener of state.vaultListeners)listener();state.ready=true;for(const listener of state.vaultListeners)listener();});
  if(mode==='close'){view.rerender(<TransmissionPanel {...props} isOpen={false}/>);view.rerender(<TransmissionPanel {...props}/>);}
  expect(guard).toThrow();await act(async()=>finish({status:'pending'}));expect(state.success).not.toHaveBeenCalled();expect(state.error).not.toHaveBeenCalled();expect(screen.queryByText('Chave pública encontrada para Synthetic Bob')).toBeNull();
});
it('a snapshot cannot forge the request ID or make another recipient answer a request',async()=>{
  state.incoming=[{actualId:'own-request',id:'forged-id',fromUid:'bob',toUid:'alice',fromLabel:'Synthetic request',status:'pending',createdAt:1,updatedAt:1},{actualId:'foreign',fromUid:'bob',toUid:'carol',fromLabel:'Foreign request',status:'pending',createdAt:1,updatedAt:1}];render(<TransmissionPanel {...props} initialTab="contacts"/>);
  const button=await screen.findByTitle('Aceitar contacto');expect(screen.queryByText('Foreign request')).toBeNull();fireEvent.click(button);await waitFor(()=>expect(state.respond).toHaveBeenCalledOnce());expect(state.respond.mock.calls[0].slice(0,3)).toEqual(['alice','own-request','accepted']);
});
it('an unchanged incoming plaintext draft is not adopted after account/coffer retirement',async()=>{
  const draft={text:'Synthetic original-account draft'},view=render(<TransmissionPanel {...props} initialDraft={draft}/>);await waitFor(()=>expect((screen.getByPlaceholderText('Escreva a mensagem ou pensamento a encapsular...') as HTMLTextAreaElement).value).toContain(draft.text));
  act(()=>{state.uid='carol';for(const listener of state.authListeners)listener({uid:'carol'});});await waitFor(()=>expect(screen.getByPlaceholderText('Escreva a mensagem ou pensamento a encapsular...')).toHaveValue(''));view.unmount();
});
