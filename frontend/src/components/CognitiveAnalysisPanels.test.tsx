import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'synthetic-actor',auth:new Set<(user:{uid:string}|null)=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string}|null)=>void)=>{state.auth.add(callback);callback({uid:state.uid});return()=>state.auth.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>true,onMemoryCryptoChanged:()=>()=>{}}));
vi.mock('../services/teamVault',()=>({onTeamKeyChanged:()=>()=>{}}));
import {InsightsPanel} from './InsightsPanel';
import {CognitivePulsePanel} from './CognitivePulsePanel';
import {CognitiveAnalysisWorkerMock} from '../test/cognitiveAnalysisWorkerMock';
import {IncrementalMemoryPublication} from '../services/incrementalMemoryPublication';
import type {SessionData} from '../hooks/useSessions';
import {useUniverseStore} from '../store/universeStore';
const scope={uid:'synthetic-actor',teamIds:new Set<string>()};
const rows:SessionData[]=Array.from({length:3},(_,at)=>({id:'m'+at,uid:scope.uid,text:'Synthetic local contextual memory',title:'Synthetic title '+at,timestamp:1,updatedAt:1,tags:['synthetic'],connections:[]}));
beforeEach(()=>{state.uid=scope.uid;useUniverseStore.setState({language:'pt-pt'});CognitiveAnalysisWorkerMock.instances=[];vi.stubGlobal('Worker',CognitiveAnalysisWorkerMock);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('renders worker insights and counts without a UI collection filter, and resolves a click against the current scope',async()=>{
  const publisher=new IncrementalMemoryPublication<SessionData>('asc');publisher.apply('source',{changed:rows.map(value=>({id:value.id,value})),removed:[],order:{reset:rows.map(row=>row.id),changes:[]}});const source=publisher.snapshot();vi.spyOn(Object.getPrototypeOf(source),'filter').mockImplementation(()=>{throw Error('UI filtered the cofre');});
  const open=vi.fn();render(<InsightsPanel sessions={source} readScope={scope} onMemoryClick={open}/>);expect(screen.getByRole('status')).toHaveTextContent('A preparar');await screen.findAllByRole('button',{name:'Synthetic title 0'});expect(screen.getByText('Memórias').nextSibling).toHaveTextContent('3');fireEvent.click(screen.getAllByRole('button',{name:'Synthetic title 0'})[0]);expect(open).toHaveBeenCalledWith(rows[0]);
  act(()=>{state.uid='other';for(const callback of state.auth)callback({uid:'other'});});expect(screen.queryByRole('button',{name:'Synthetic title 0'})).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('Não foi possível');
});
it('keeps a closed pulse idle, then displays a prepared pulse and navigates only to a current memory',async()=>{
  const open=vi.fn(),close=vi.fn(),view=render(<CognitivePulsePanel isOpen={false} sessions={rows} uid={scope.uid} readScope={scope} onClose={close} onOpenMemory={open} onOpenInsights={()=>{}}/>);expect(CognitiveAnalysisWorkerMock.instances).toHaveLength(0);
  view.rerender(<CognitivePulsePanel isOpen sessions={rows} uid={scope.uid} readScope={scope} onClose={close} onOpenMemory={open} onOpenInsights={()=>{}}/>);
  await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());const card=screen.getByRole('button',{name:/3 memorias sem ligacoes/});fireEvent.click(card);expect(open).toHaveBeenCalledWith('m0');expect(close).toHaveBeenCalledOnce();
});
it('releases the covered insights projection before pulse starts and rebuilds it when pulse closes',async()=>{
  let peak=0;vi.stubGlobal('Worker',class extends CognitiveAnalysisWorkerMock{constructor(){super();peak=Math.max(peak,CognitiveAnalysisWorkerMock.instances.filter(worker=>!worker.terminate.mock.calls.length).length);}});
  const content=(pulse:boolean)=><><InsightsPanel sessions={rows} readScope={scope} enabled={!pulse} onMemoryClick={()=>{}}/><CognitivePulsePanel isOpen={pulse} sessions={rows} uid={scope.uid} readScope={scope} onClose={()=>{}} onOpenMemory={()=>{}} onOpenInsights={()=>{}}/></>;
  const view=render(content(false));await screen.findAllByRole('button',{name:'Synthetic title 0'});const initial=CognitiveAnalysisWorkerMock.instances[0];
  view.rerender(content(true));await screen.findByRole('button',{name:/3 memorias sem ligacoes/});expect(initial.terminate).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'Synthetic title 0'})).toBeNull();
  const pulse=CognitiveAnalysisWorkerMock.instances[1];view.rerender(content(false));await screen.findAllByRole('button',{name:'Synthetic title 0'});expect(pulse.terminate).toHaveBeenCalledOnce();expect(CognitiveAnalysisWorkerMock.instances).toHaveLength(3);expect(peak).toBe(1);
  view.unmount();expect(CognitiveAnalysisWorkerMock.instances.every(worker=>worker.terminate.mock.calls.length===1)).toBe(true);
});
