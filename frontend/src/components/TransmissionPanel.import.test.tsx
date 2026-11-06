vi.mock('./CommsP2PContentRecoveryPanel',()=>({CommsP2PContentRecoveryPanel:()=>null}));
vi.mock('../services/commsP2PContent',()=>({hasPendingCommsP2PContent:()=>false,observeCommsP2PContent:()=>()=>{},observeCommsP2PInbox:()=>()=>{},readCommsP2PInbox:async()=>({rows:[],next:null,scanned:0,unavailable:0}),acknowledgeStoredCommsP2P:vi.fn(),resumeCommsP2PContent:vi.fn(),createCommsP2PContentLink:vi.fn(),sendCommsP2PContent:vi.fn()}));
vi.mock('../services/commsP2PSignaling',()=>({commsP2PRequestBinding:(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='actorUid')),hasPendingCommsP2P:()=>false,hasStoredCommsP2PSession:()=>false,observeCommsP2P:()=>()=>{},mutateCommsP2PSignal:vi.fn(),watchCommsP2PSignal:()=>()=>{},commsP2PHash:vi.fn()}));
vi.mock('./CommsP2PRecoveryPanel',()=>({CommsP2PRecoveryPanel:()=>null}));
vi.mock('../services/commsLists',async()=>import('../test/commsPageObserverFixture'));
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',ready:true,memories:[] as unknown[],body:'Memória partilhada: Synthetic title\nID: foreign-note-id\n\nSynthetic body',
  recipient:'alice',status:'received',import:vi.fn(),decrypt:vi.fn(),identity:vi.fn(),retained:vi.fn(),success:vi.fn(),error:vi.fn(),update:vi.fn(),ack:vi.fn(),
  authListeners:new Set<(user:{uid:string})=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}},db:{}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('firebase/firestore',()=>({collection:(_db:unknown,...path:string[])=>({path:path.join('/')}),where:(field:string,_operator:string,value:string)=>({field,value}),
  query:(ref:unknown,...filters:{field:string;value:string}[])=>({ref,filters}),doc:vi.fn(),setDoc:vi.fn(),getDoc:vi.fn(),getDocs:vi.fn(),limit:vi.fn(),addDoc:vi.fn(),updateDoc:(...args:unknown[])=>state.update(...args),
  onSnapshot:(q:{ref?:{path:string};filters?:{field:string;value:string}[]},callback:(snapshot:unknown)=>void)=>{
    const inbox=q.ref?.path==='transmissions'&&q.filters?.some(filter=>filter.field==='recipientId');
    const record={encryptedData:btoa('\0'.repeat(256)),senderId:'bob',recipientId:state.recipient,status:state.status,timestamp:1},snapshot={docs:inbox?[{id:'transmission-1',data:()=>({...record})}]:[]};let active=true;
    // Firestore delivers asynchronously; queued data stays immutable and an
    // unsubscribed fixture must not publish its first snapshot into a new view.
    queueMicrotask(()=>{if(active)callback(snapshot);});return()=>{active=false;};
  }}));
vi.mock('../utils/crypto',()=>({rsaDecrypt:(...args:unknown[])=>state.decrypt(...args),importPublicKey:vi.fn(),rsaEncrypt:vi.fn(),encryptBytesAesGcm:vi.fn(),sha256Hex:vi.fn()}));
vi.mock('../services/commsIdentity',()=>({publishCommsIdentity:(...args:unknown[])=>state.identity(...args),resetAndPublishCommsIdentity:vi.fn()}));
vi.mock('../services/rtcConfig',()=>({getRtcConfiguration:()=>({})}));
vi.mock('../store/universeStore',()=>({useUniverseStore:()=>({memories:state.memories})}));
vi.mock('react-hot-toast',()=>({default:{success:(...args:unknown[])=>state.success(...args),error:(...args:unknown[])=>state.error(...args)}}));
vi.mock('../utils/translations',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('../services/capsuleService',()=>({isCapsulePackText:()=>false,decodeCapsulePack:vi.fn()}));
vi.mock('../services/learningService',()=>({importCapsuleAsMemory:vi.fn()}));
vi.mock('../services/commsMemoryImport',()=>({importCommsMemory:(...args:unknown[])=>state.import(...args)}));
vi.mock('./ObsidianImportRecoveryPanel',()=>({ObsidianImportRecoveryPanel:()=>null}));
vi.mock('./CommsImportRecoveryPanel',()=>({CommsImportRecoveryPanel:()=>null}));
vi.mock('./CommsIdentityRolloverPanel',()=>({CommsIdentityRolloverPanel:()=>null}));
vi.mock('./CommsContactRecoveryPanel',()=>({CommsContactRecoveryPanel:()=>null}));
vi.mock('./CommsDeliveryRecoveryPanel',()=>({CommsDeliveryRecoveryPanel:()=>null}));
vi.mock('../services/commsDelivery',()=>({hasPendingCommsDelivery:()=>false,observeCommsDeliveries:()=>()=>{},sendCommsDelivery:vi.fn(),acknowledgeCommsTransmission:(...args:unknown[])=>state.ack(...args)}));
vi.mock('../services/commsContacts',()=>({lookupCommsRecipient:vi.fn(),requestCommsContact:vi.fn(),respondCommsContact:vi.fn(),hasPendingCommsContact:()=>false}));
vi.mock('../services/commsIdentityRollover',()=>({hasPendingCommsIdentityRollover:()=>false,observeCommsIdentityRollovers:()=>()=>{},loadRetainedCommsIdentities:(...args:unknown[])=>state.retained(...args)}));
import {TransmissionPanel} from './TransmissionPanel';
const props={isOpen:true,onClose:vi.fn(),mnemonic:null,initialTab:'inbox' as const};
beforeEach(()=>{state.uid='alice';state.ready=true;state.recipient='alice';state.status='received';state.memories=[];state.authListeners.clear();state.vaultListeners.clear();
  for(const mock of [state.import,state.decrypt,state.identity,state.retained,state.success,state.error,state.update,state.ack])mock.mockReset();
  state.retained.mockResolvedValue([]);
  state.decrypt.mockImplementation(async()=>state.body);state.identity.mockResolvedValue({publicKey:{},privateKey:{},pemPublic:'Synthetic public'});state.import.mockResolvedValue({id:'owned-new-id'});state.update.mockResolvedValue(undefined);state.ack.mockResolvedValue({updatedAt:2});
});
it('lost acknowledgement after successful decrypt does not mark the relay message failed',async()=>{
  state.status='sent';state.ack.mockRejectedValue(Error('Synthetic ACK unavailable'));render(<TransmissionPanel {...props}/>);await waitFor(()=>expect(state.ack).toHaveBeenCalledOnce());await screen.findByRole('button',{name:'Importar no Universo'});expect(state.ack.mock.calls[0].slice(0,2)).toEqual(['alice','transmission-1']);expect(state.update).not.toHaveBeenCalled();
});
it('a missing local private key does not create a terminal failed receipt for the sender',async()=>{
  state.status='sent';state.decrypt.mockRejectedValue(Error('Synthetic unavailable private key'));render(<TransmissionPanel {...props}/>);await screen.findByText('Erro a desencriptar. Chave privada inválida?');expect(state.update).not.toHaveBeenCalled();expect(state.ack).not.toHaveBeenCalled();
});
it('a lost receipt acknowledgement can be retried explicitly without another delivery or direct Firestore write',async()=>{
  state.status='sent';state.ack.mockRejectedValueOnce(Error('Synthetic ACK lost'));render(<TransmissionPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Confirmar leitura'}));await waitFor(()=>expect(state.ack).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.queryByRole('button',{name:'Confirmar leitura'})).toBeNull());expect(state.update).not.toHaveBeenCalled();expect(state.ack.mock.calls[1].slice(0,2)).toEqual(['alice','transmission-1']);
});
it('imports received text with own authority and reports success only after confirmation',async()=>{
  state.memories=[{id:'foreign-note-id',uid:'alice',teamId:null,text:'Existing different body',timestamp:1}];
  let resolve!:(value:{id:string})=>void;state.import.mockReturnValue(new Promise(done=>{resolve=done;}));render(<TransmissionPanel {...props}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Importar no Universo'}));await waitFor(()=>expect(state.import).toHaveBeenCalledOnce());
  expect(state.import.mock.calls[0].slice(0,2)).toEqual(['alice',{text:'Synthetic body',title:'Synthetic title',attachment:null}]);
  expect(state.success).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'A Importar...'})).toBeDisabled();
  await act(async()=>resolve({id:'owned-new-id'}));expect(state.success).toHaveBeenCalledWith('txImportedOk');
});
it('only readable personal text deduplicates; foreign sender IDs and other scopes are not authority',async()=>{
  state.memories=[{id:'other-note',uid:'bob',teamId:null,text:'Synthetic body',timestamp:1}];render(<TransmissionPanel {...props}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Importar no Universo'}));await waitFor(()=>expect(state.import).toHaveBeenCalledOnce());
});
it('refuses a duplicate readable personal body before the recoverable importer',async()=>{
  state.memories=[{id:'own-note',uid:'alice',teamId:null,text:'Synthetic body',timestamp:1}];render(<TransmissionPanel {...props}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Importar no Universo'}));await waitFor(()=>expect(state.error).toHaveBeenCalledWith('txAlreadyExists'));expect(state.import).not.toHaveBeenCalled();
});
it('a failed import retains the received message and suppresses the raw error',async()=>{
  state.import.mockRejectedValue(Error('Synthetic private error'));render(<TransmissionPanel {...props}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Importar no Universo'}));await waitFor(()=>expect(state.error).toHaveBeenCalledWith('txImportFail'));
  expect(screen.getByText(state.body.replace(/\s+/g,' '))).toBeInTheDocument();expect(screen.getByRole('button',{name:'Importar no Universo'})).toBeEnabled();expect(state.success).not.toHaveBeenCalled();
});
it('close/reopen permanently invalidates an in-flight import guard and feedback',async()=>{
  let resolve!:(value:{id:string})=>void;state.import.mockReturnValue(new Promise(done=>{resolve=done;}));const view=render(<TransmissionPanel {...props}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Importar no Universo'}));await waitFor(()=>expect(state.import).toHaveBeenCalledOnce());const guard=state.import.mock.calls[0][3] as ()=>void;
  expect(guard).not.toThrow();view.rerender(<TransmissionPanel {...props} isOpen={false}/>);view.rerender(<TransmissionPanel {...props}/>);
  expect(guard).toThrow();await act(async()=>resolve({id:'owned-new-id'}));expect(state.success).not.toHaveBeenCalled();
});
it('late plaintext cannot appear after a vault transition, even after unlocking again',async()=>{
  let resolve!:(value:string)=>void;state.decrypt.mockReturnValueOnce(new Promise(done=>{resolve=done;}));const view=render(<TransmissionPanel {...props}/>);
  await waitFor(()=>expect(state.decrypt).toHaveBeenCalledOnce());state.identity.mockReturnValue(new Promise(()=>{}));
  act(()=>{state.ready=false;for(const callback of state.vaultListeners)callback();state.ready=true;for(const callback of state.vaultListeners)callback();});
  await act(async()=>resolve(state.body));expect(screen.queryByText(state.body)).toBeNull();expect(screen.queryByRole('button',{name:'Importar no Universo'})).toBeNull();view.unmount();
});
it('an account transition permanently invalidates the operation even when returning to the same account',async()=>{
  let resolve!:(value:{id:string})=>void;state.import.mockReturnValue(new Promise(done=>{resolve=done;}));render(<TransmissionPanel {...props}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Importar no Universo'}));await waitFor(()=>expect(state.import).toHaveBeenCalledOnce());const guard=state.import.mock.calls[0][3] as ()=>void;
  act(()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});});
  expect(guard).toThrow();await act(async()=>resolve({id:'owned-new-id'}));expect(state.success).not.toHaveBeenCalled();expect(state.error).not.toHaveBeenCalled();
});
it('rejects a relay message for a different recipient before decrypting or importing',async()=>{
  state.recipient='bob';render(<TransmissionPanel {...props}/>);await waitFor(()=>expect(state.identity).toHaveBeenCalledOnce());
  expect(state.decrypt).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Importar no Universo'})).toBeNull();
});
it('a transmission encrypted to a retained identity still opens in the current account',async()=>{
  state.decrypt.mockRejectedValueOnce(Error('Synthetic newer private key')).mockResolvedValue(state.body);state.retained.mockResolvedValue([{publicKey:{},privateKey:{},pemPublic:'Synthetic previous public key'}]);
  render(<TransmissionPanel {...props} mnemonic={Array(12).fill('synthetic')}/>);await screen.findByRole('button',{name:'Importar no Universo'});expect(state.retained).toHaveBeenCalledOnce();expect(state.retained.mock.calls[0][0]).toBe('alice');expect(state.decrypt).toHaveBeenCalledTimes(2);
});
it('late retained keys cannot publish plaintext or a failed acknowledgement after the panel closes',async()=>{
  state.decrypt.mockRejectedValue(Error('Synthetic newer private key'));let resolve!:(value:unknown[])=>void;state.retained.mockReturnValue(new Promise(done=>{resolve=done;}));
  const view=render(<TransmissionPanel {...props} mnemonic={Array(12).fill('synthetic')}/>);await waitFor(()=>expect(state.retained).toHaveBeenCalledOnce());view.rerender(<TransmissionPanel {...props} isOpen={false}/>);
  await act(async()=>resolve([{privateKey:{},publicKey:{},pemPublic:'Synthetic previous public key'}]));expect(state.update).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Importar no Universo'})).toBeNull();
});
it('reopening the panel reloads retained private handles instead of reusing the closed view cache',async()=>{
  const current={},previous={};state.identity.mockResolvedValue({publicKey:{},privateKey:current,pemPublic:'Synthetic current'});
  state.decrypt.mockImplementation(async(_cipher,privateKey)=>{if(privateKey===current)throw Error('Synthetic current mismatch');return state.body;});
  state.retained.mockResolvedValue([{publicKey:{},privateKey:previous,pemPublic:'Synthetic previous'}]);const words=Array(12).fill('synthetic');
  const view=render(<TransmissionPanel {...props} mnemonic={words}/>);await screen.findByRole('button',{name:'Importar no Universo'});expect(state.retained).toHaveBeenCalledOnce();
  view.rerender(<TransmissionPanel {...props} mnemonic={words} isOpen={false}/>);view.rerender(<TransmissionPanel {...props} mnemonic={words}/>);
  await waitFor(()=>expect(state.retained).toHaveBeenCalledTimes(2));await screen.findByRole('button',{name:'Importar no Universo'});
});
