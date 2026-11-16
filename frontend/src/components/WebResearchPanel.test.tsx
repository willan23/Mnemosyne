import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {WebResearchPanel} from './WebResearchPanel';
import type {SessionData} from '../hooks/useSessions';
const state=vi.hoisted(()=>({uid:'alice' as string|null,ready:true,policy:'allow-cloud',research:vi.fn(),save:vi.fn(),success:vi.fn(),error:vi.fn(),
  authListeners:new Set<(user:{uid:string}|null)=>void>(),vaultListeners:new Set<()=>void>()}));
vi.mock('../firebase',()=>({db:{},auth:{get currentUser(){return state.uid?{uid:state.uid}:null;}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string}|null)=>void)=>{state.authListeners.add(callback);callback(state.uid?{uid:state.uid}:null);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vaultListeners.add(callback);return()=>state.vaultListeners.delete(callback);}}));
vi.mock('../services/teamVault',()=>({getTeamKeyCacheGeneration:()=>0,onTeamKeyChanged:()=>()=>{}}));
vi.mock('../services/localAiConfig',()=>({getLocalAiConfig:()=>({memoryPermission:state.policy})}));
vi.mock('../services/webResearchService',()=>({runWebResearch:(...args:unknown[])=>state.research(...args)}));
vi.mock('../services/webResearchMemory',()=>({saveWebResearchMemory:(...args:unknown[])=>state.save(...args),buildPersonalResearchContext:(memories:SessionData[],_uid:string,selected:string[])=>memories.filter(memory=>selected.includes(memory.id)).map(memory=>`${memory.title??''}\n${memory.text}`)}));
vi.mock('./AttachedMemoryRecoveryPanel',()=>({AttachedMemoryRecoveryPanel:()=> <div>Recuperação disponível</div>}));
vi.mock('react-hot-toast',()=>({default:{success:(...args:unknown[])=>state.success(...args),error:(...args:unknown[])=>state.error(...args)}}));
const answer={query:'Synthetic query',mode:'public',summary:'Synthetic public answer',main_ideas:['Synthetic idea'],key_concepts:['synthetic'],suggested_memories:[],local_comparisons:[],sources:[]};
const memories=[{id:'own',uid:'alice',teamId:null,title:'Synthetic own',text:'Synthetic private own'},
  {id:'foreign',uid:'bob',teamId:null,title:'Synthetic foreign',text:'Synthetic private foreign'},
  {id:'team',uid:'alice',teamId:'crew',title:'Synthetic team',text:'Synthetic private team'},
  {id:'shared',uid:'alice',sharedWithIds:['bob'],title:'Synthetic shared',text:'Synthetic private shared'},
  {id:'locked',uid:'alice',encLocked:true,title:'Synthetic locked'}, {id:'deleted',uid:'alice',deletedAt:1,title:'Synthetic deleted'}] as SessionData[];
beforeEach(()=>{state.uid='alice';state.ready=true;state.policy='allow-cloud';state.authListeners.clear();state.vaultListeners.clear();
  [state.research,state.save,state.success,state.error].forEach(mock=>mock.mockReset());state.research.mockResolvedValue(answer);state.save.mockResolvedValue({id:'synthetic-memory'});});
const props={isOpen:true,onClose:vi.fn(),sessions:memories,initialQuery:'Synthetic query'};
async function research(){fireEvent.click(screen.getByRole('button',{name:'Pesquisar'}));await screen.findByText('Synthetic public answer');}
function changeAccount(uid:string){state.uid=uid;state.authListeners.forEach(callback=>callback({uid}));}
it('contextual selection exposes only live personal memories and sends only explicit selected context',async()=>{
  render(<WebResearchPanel {...props}/>);fireEvent.click(screen.getByRole('button',{name:/^Contextual/}));
  expect(screen.getByRole('button',{name:'Synthetic own'})).toBeInTheDocument();
  for(const title of ['Synthetic foreign','Synthetic team','Synthetic shared','Synthetic locked','Synthetic deleted'])expect(screen.queryByRole('button',{name:title})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Synthetic own'}));await research();
  expect(state.research).toHaveBeenCalledWith({query:'Synthetic query',mode:'contextual',context:['Synthetic own\nSynthetic private own'],max_sources:8},expect.objectContaining({context:expect.objectContaining({uid:'alice',scope:{kind:'personal'}}),assertCurrent:expect.any(Function)}));
});
it('private-local research sends no memory and comparison stays in the captured personal result mode',async()=>{
  state.research.mockResolvedValueOnce({...answer,mode:'private-local'});render(<WebResearchPanel {...props}/>);fireEvent.click(screen.getByRole('button',{name:/^Privada local/}));
  fireEvent.click(screen.getByRole('button',{name:'Synthetic own'}));await research();expect(state.research.mock.calls[0][0].context).toEqual([]);
});
it('confirmed save uses the captured result/owner and disables a second save of that same result',async()=>{
  const created=vi.fn();render(<WebResearchPanel {...props} onMemoryCreated={created}/>);await research();
  fireEvent.click(screen.getByRole('button',{name:'Guardar como constelação'}));await waitFor(()=>expect(created).toHaveBeenCalledWith('synthetic-memory'));
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',result:answer,sessions:[memories[0]],assertCurrent:expect.any(Function)}));
  expect(screen.getByRole('button',{name:'Constelação guardada'})).toBeDisabled();expect(state.success).toHaveBeenCalledWith('Constelação de pesquisa guardada.');
});
it('a failed durable save keeps the research result and recovery available without success',async()=>{
  state.save.mockRejectedValueOnce(Error('Synthetic pending creation'));render(<WebResearchPanel {...props}/>);await research();
  fireEvent.click(screen.getByRole('button',{name:'Guardar como constelação'}));await waitFor(()=>expect(state.error).toHaveBeenCalledWith('Synthetic pending creation'));
  expect(screen.getByText('Synthetic public answer')).toBeInTheDocument();expect(screen.getByText('Recuperação disponível')).toBeInTheDocument();expect(state.success).not.toHaveBeenCalled();
});
it('account changes away and back during research suppress the old answer and clear context selection',async()=>{
  let finish!:(value:unknown)=>void;state.research.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));render(<WebResearchPanel {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Pesquisar'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
  await act(async()=>{changeAccount('bob');changeAccount('alice');finish(answer);});expect(screen.queryByText('Synthetic public answer')).toBeNull();expect(state.error).not.toHaveBeenCalled();expect(state.save).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toHaveValue('');
});
it('locking the vault removes an existing result and refuses later save',async()=>{
  render(<WebResearchPanel {...props}/>);await research();act(()=>{state.ready=false;state.vaultListeners.forEach(callback=>callback());});
  expect(screen.queryByRole('button',{name:'Guardar como constelação'})).toBeNull();expect(screen.queryByText('Synthetic public answer')).toBeNull();expect(screen.getByRole('button',{name:'Pesquisar'})).toBeDisabled();
});
it('a closed and reopened panel cannot publish a response or completion from its previous operation',async()=>{
  let finish!:(value:unknown)=>void;state.research.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const view=render(<WebResearchPanel {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Pesquisar'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
  view.rerender(<WebResearchPanel {...props} isOpen={false}/>);view.rerender(<WebResearchPanel {...props}/>);
  await act(async()=>finish(answer));expect(screen.queryByText('Synthetic public answer')).toBeNull();expect(state.error).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Pesquisar'})).not.toBeDisabled();
});
it('late save after account switch or panel close cannot emit callbacks or success',async()=>{
  for(const mode of ['account','close']){
    let finish!:(value:unknown)=>void;state.save.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const created=vi.fn();const view=render(<WebResearchPanel {...props} onMemoryCreated={created}/>);await research();
    fireEvent.click(screen.getByRole('button',{name:'Guardar como constelação'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    await act(async()=>{if(mode==='account')changeAccount('bob');else fireEvent.click(screen.getByRole('button',{name:'Fechar pesquisa web'}));finish({id:'created'});});
    expect(created).not.toHaveBeenCalled();expect(state.success).not.toHaveBeenCalled();expect(state.error).not.toHaveBeenCalled();view.unmount();state.uid='alice';
  }
});
