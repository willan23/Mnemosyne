import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},auth:{currentUser:{uid:'alice',email:'synthetic@example.invalid'}},db:{},storage:{}}));
vi.mock('firebase/auth',async original=>({...await original<object>(),onAuthStateChanged:vi.fn(()=>()=>{})}));
vi.mock('qrcode',()=>({default:{toDataURL:vi.fn(async()=> 'data:image/png;base64,')}}));
vi.mock('./CommsIdentityBackupPanel',()=>({CommsIdentityBackupPanel:()=>null}));
vi.mock('./PlanosModal',()=>({PlansModal:()=>null}));
vi.mock('../services/mobilePairing',async original=>({...await original<object>(),watchTrustedDevices:vi.fn((_uid,rows)=>{rows([]);return()=>{};})}));
vi.mock('../config/releaseGates',async original=>({...await original<object>(),PERSONAL_REVISION_WRITES_ENABLED:true}));
vi.mock('../services/personalIdentityReset',async original=>({...await original<object>(),removePersonalMemoriesForIdentityReset:vi.fn()}));
import {auth} from '../firebase';
import {setMemoryCryptoMnemonic} from '../services/memoryCrypto';
import {memoryEditCheckpointKey} from '../services/memoryEditRecovery';
import {removePersonalMemoriesForIdentityReset,PersonalIdentityResetError} from '../services/personalIdentityReset';
import {SettingsModal} from './SettingsModal';
import {hasProviderSecret,saveProviderSecret} from '../services/localAiConfig';
import {useUniverseStore} from '../store/universeStore';
const remove=vi.mocked(removePersonalMemoriesForIdentityReset),reset=vi.fn(),close=vi.fn();
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const props=()=>({isOpen:true,onClose:close,onResetKey:reset,mnemonic:words,initialSection:'identity'});
beforeEach(()=>{
  localStorage.clear();setMemoryCryptoMnemonic(words);reset.mockReset();close.mockReset();remove.mockReset();
  Object.defineProperty(auth,'currentUser',{configurable:true,value:{uid:'alice',email:'synthetic@example.invalid'}});
  HTMLElement.prototype.scrollTo=vi.fn();
  remove.mockImplementation(async input=>{
    const confirmed=await input.confirm(2);input.assertCurrent();
    if(!confirmed)return{status:'cancelled',removed:0};
    input.progress?.({removed:2,total:2});return{status:'completed',removed:2};
  });
});
afterEach(()=>setMemoryCryptoMnemonic(null));
it('lets a saved inactive OpenAI selection remove its encrypted legacy key without presenting a server key input',async()=>{
  useUniverseStore.setState({language:'en'});
  localStorage.setItem('mnemosyne_local_ai_config',JSON.stringify({primaryProvider:'openai'}));
  const validMnemonic='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
  await saveProviderSecret('alice','openai','synthetic-private-legacy-key',validMnemonic);
  render(<SettingsModal {...props()} initialSection="ai"/>);
  await screen.findByText('This legacy local key is not used for server generation. You can remove it from this device.');
  expect(screen.getByRole('button',{name:/OpenAI.*Not configured/})).toBeDisabled();
  expect(screen.queryByPlaceholderText('colar API key para guardar no cofre local')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Remover'}));
  await waitFor(()=>expect(hasProviderSecret('alice','openai')).toBe(false));
  expect(JSON.parse(localStorage.getItem('mnemosyne_local_ai_config')!).primaryProvider).toBe('openai');
});
it('Escape cancels local reset without opening another confirmation or resetting the key',async()=>{
  render(<SettingsModal {...props()}/>);fireEvent.click(screen.getByRole('button',{name:'Reiniciar chave local'}));
  await screen.findByRole('dialog',{name:'Reiniciar chave neste dispositivo'});fireEvent.keyDown(window,{key:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Reiniciar chave neste dispositivo'})).not.toBeInTheDocument());
  expect(reset).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
});
it('local reset preserves memories and requires an affirmative confirmation',async()=>{
  render(<SettingsModal {...props()}/>);fireEvent.click(screen.getByRole('button',{name:'Reiniciar chave local'}));
  const dialog=await screen.findByRole('dialog',{name:'Reiniciar chave neste dispositivo'});
  fireEvent.click(within(dialog).getByRole('button',{name:'Reiniciar chave'}));
  await waitFor(()=>expect(reset).toHaveBeenCalledOnce());expect(close).toHaveBeenCalledOnce();expect(remove).not.toHaveBeenCalled();
});
it('an unknown memory receipt prevents reset and preserves the pending recovery record',async()=>{
  const key=memoryEditCheckpointKey('alice');localStorage.setItem(key,'synthetic encrypted checkpoint');
  render(<SettingsModal {...props()}/>);fireEvent.click(screen.getByRole('button',{name:'Reiniciar chave local'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Reiniciar chave local'})).toBeEnabled());
  expect(screen.queryByRole('dialog',{name:'Reiniciar chave neste dispositivo'})).not.toBeInTheDocument();
  expect(reset).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe('synthetic encrypted checkpoint');
});
it('a memory edit that becomes pending while confirmation is open also prevents reset',async()=>{
  render(<SettingsModal {...props()}/>);fireEvent.click(screen.getByRole('button',{name:'Reiniciar chave local'}));
  const dialog=await screen.findByRole('dialog',{name:'Reiniciar chave neste dispositivo'}),key=memoryEditCheckpointKey('alice');
  localStorage.setItem(key,'synthetic encrypted checkpoint');fireEvent.click(within(dialog).getByRole('button',{name:'Reiniciar chave'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Reiniciar chave local'})).toBeEnabled());
  expect(reset).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe('synthetic encrypted checkpoint');
});
it('a partial removal or lost acknowledgement cannot reset the key',async()=>{
  remove.mockImplementation(async input=>{if(await input.confirm(2))throw new PersonalIdentityResetError(1);return{status:'cancelled',removed:0};});
  render(<SettingsModal {...props()}/>);fireEvent.click(screen.getByRole('button',{name:'Remover memórias pessoais e reiniciar'}));
  const dialog=await screen.findByRole('dialog',{name:'Remover memórias pessoais e reiniciar'});
  fireEvent.click(within(dialog).getByRole('button',{name:'Remover e reiniciar'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Reiniciar chave local'})).toBeEnabled());
  expect(remove).toHaveBeenCalledOnce();expect(reset).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
});
it('a completed removal resets the key once, after the service confirms completion',async()=>{
  render(<SettingsModal {...props()}/>);fireEvent.click(screen.getByRole('button',{name:'Remover memórias pessoais e reiniciar'}));
  const dialog=await screen.findByRole('dialog',{name:'Remover memórias pessoais e reiniciar'});
  expect(reset).not.toHaveBeenCalled();fireEvent.click(within(dialog).getByRole('button',{name:'Remover e reiniciar'}));
  await waitFor(()=>expect(reset).toHaveBeenCalledOnce());expect(close).toHaveBeenCalledOnce();
});
it('closing the panel settles a pending confirmation as cancellation, including after reopening',async()=>{
  const view=render(<SettingsModal {...props()}/>);fireEvent.click(screen.getByRole('button',{name:'Reiniciar chave local'}));
  await screen.findByRole('dialog',{name:'Reiniciar chave neste dispositivo'});
  await act(async()=>{view.rerender(<SettingsModal {...props()} isOpen={false}/>);});
  view.rerender(<SettingsModal {...props()}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Reiniciar chave local'})).toBeEnabled());
  expect(screen.queryByRole('dialog',{name:'Reiniciar chave neste dispositivo'})).not.toBeInTheDocument();expect(reset).not.toHaveBeenCalled();
});
