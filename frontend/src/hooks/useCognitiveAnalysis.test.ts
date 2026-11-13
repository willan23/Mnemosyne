import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'synthetic-actor' as string|null,ready:true,auth:new Set<(user:{uid:string}|null)=>void>(),personal:new Set<()=>void>(),team:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return state.uid?{uid:state.uid}:null;}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string}|null)=>void)=>{state.auth.add(callback);callback(state.uid?{uid:state.uid}:null);return()=>state.auth.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.personal.add(callback);return()=>state.personal.delete(callback);}}));
vi.mock('../services/teamVault',()=>({onTeamKeyChanged:(callback:()=>void)=>{state.team.add(callback);return()=>state.team.delete(callback);}}));
import {useCognitiveAnalysis} from './useCognitiveAnalysis';
import {CognitiveAnalysisWorkerMock} from '../test/cognitiveAnalysisWorkerMock';
import {IncrementalMemoryPublication} from '../services/incrementalMemoryPublication';
import type {SessionData} from './useSessions';
const scope={uid:'synthetic-actor',teamIds:new Set(['crew'])};
const memory=(id:string):SessionData=>({id,uid:scope.uid,text:'Synthetic local contextual memory',timestamp:1,updatedAt:1,connections:[],embedding:[]});
beforeEach(()=>{state.uid=scope.uid;state.ready=true;CognitiveAnalysisWorkerMock.instances=[];vi.stubGlobal('Worker',CognitiveAnalysisWorkerMock);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('withdraws old results and callbacks immediately when the source changes',async()=>{
  const a=memory('a'),b=memory('b'),{result,rerender}=renderHook(({rows})=>useCognitiveAnalysis(rows,scope,'insights'),{initialProps:{rows:[a]}});
  await waitFor(()=>expect(result.current.ready).toBe(true));const old=result.current.getMemory;expect(old('a')).toBe(a);
  rerender({rows:[b]});expect(result.current.analysis).toBeNull();expect(old('a')).toBeUndefined();await waitFor(()=>expect(result.current.ready).toBe(true));expect(result.current.getMemory('b')).toBe(b);
});
it('does not start an inactive panel and never reuses a previous activation as a ready result',async()=>{
  const rows=[memory('a')],{result,rerender}=renderHook(({active})=>useCognitiveAnalysis(rows,scope,'pulse',active),{initialProps:{active:false}});
  expect(CognitiveAnalysisWorkerMock.instances).toHaveLength(0);rerender({active:true});await waitFor(()=>expect(result.current.ready).toBe(true));const get=result.current.getMemory;
  rerender({active:false});expect(result.current.analysis).toBeNull();expect(get('a')).toBeUndefined();expect(CognitiveAnalysisWorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
  rerender({active:true});expect(result.current.ready).toBe(false);await waitFor(()=>expect(result.current.ready).toBe(true));expect(CognitiveAnalysisWorkerMock.instances).toHaveLength(2);
});
it.each(['personal','team','account'] as const)('retires plaintext, vectors and callbacks on %s scope retirement',async kind=>{
  const rows=[memory('a')],{result,rerender}=renderHook(({source})=>useCognitiveAnalysis(source,scope,'insights'),{initialProps:{source:rows}});await waitFor(()=>expect(result.current.ready).toBe(true));const get=result.current.getMemory,worker=CognitiveAnalysisWorkerMock.instances[0];
  act(()=>{if(kind==='account'){state.uid='other';for(const callback of state.auth)callback({uid:'other'});}else for(const callback of state[kind])callback();});
  expect(worker.terminate).toHaveBeenCalledOnce();expect(get('a')).toBeUndefined();expect(result.current.analysis).toBeNull();act(()=>result.current.retry());expect(CognitiveAnalysisWorkerMock.instances).toHaveLength(1);
  act(()=>{state.uid=scope.uid;});rerender({source:[memory('fresh')]});await waitFor(()=>expect(result.current.ready).toBe(true));expect(result.current.getMemory('fresh')?.id).toBe('fresh');
});
it('coalesces new snapshots behind a held initial ACK and applies only subsequent deltas',async()=>{
  let release:(()=>void)|undefined;const workers:CognitiveAnalysisWorkerMock[]=[];
  vi.stubGlobal('Worker',class{constructor(){const worker=new CognitiveAnalysisWorkerMock(),normal=worker.postMessage.getMockImplementation()!;worker.postMessage.mockImplementation(message=>{if(!release&&message.type==='patch-start')release=()=>normal(message);else normal(message);});workers.push(worker);return worker;}});
  const publisher=new IncrementalMemoryPublication<SessionData>('asc'),rows=Array.from({length:1000},(_,at)=>({...memory('m'+at),timestamp:at}));publisher.apply('source',{changed:rows.map(value=>({id:value.id,value})),removed:[],order:{reset:rows.map(row=>row.id),changes:[]}});
  const {result,rerender}=renderHook(({source})=>useCognitiveAnalysis(source,scope,'insights'),{initialProps:{source:publisher.snapshot()}});
  await waitFor(()=>expect(release).toBeTypeOf('function'),{timeout:5000});let latest=rows[0];
  for(let at=0;at<10;at++){latest={...rows[at],text:'Synthetic changed '+at};publisher.apply('source',{changed:[{id:latest.id,value:latest}],removed:[],order:{changes:[]}});rerender({source:publisher.snapshot()});}
  expect(result.current.ready).toBe(false);expect(workers).toHaveLength(1);expect(workers[0].terminate).not.toHaveBeenCalled();act(()=>release!());await waitFor(()=>expect(result.current.ready).toBe(true),{timeout:5000});expect(result.current.getMemory(latest.id)).toBe(latest);
  const messages=workers[0].postMessage.mock.calls.map(([message])=>message),starts=messages.filter(message=>message.type==='patch-start');expect(starts.map(message=>message.reset)).toEqual([true,false]);expect(messages.flatMap(message=>message.type==='patch-chunk'?message.frame.changed??[]:[])).toHaveLength(1010);
});
it('drops a team immediately on membership scope change before publishing a new empty result',async()=>{
  const row={...memory('team'),uid:'other',teamId:'crew'},rows=[row],{result,rerender}=renderHook(({readScope})=>useCognitiveAnalysis(rows,readScope,'insights'),{initialProps:{readScope:scope}});
  await waitFor(()=>expect(result.current.ready).toBe(true));expect(result.current.getMemory('team')).toBe(row);const get=result.current.getMemory;
  rerender({readScope:{uid:scope.uid,teamIds:new Set<string>()}});expect(result.current.analysis).toBeNull();expect(get('team')).toBeUndefined();await waitFor(()=>expect(result.current.ready).toBe(true));expect(result.current.analysis).toMatchObject({counts:{total:0}});
});
it.each(['removed','permission-revoked','fence-retired'] as const)('terminates a held transport immediately when a document is %s without a key event',async change=>{
  let release:(()=>void)|undefined;const workers:CognitiveAnalysisWorkerMock[]=[];
  vi.stubGlobal('Worker',class{constructor(){const worker=new CognitiveAnalysisWorkerMock(),normal=worker.postMessage.getMockImplementation()!;worker.postMessage.mockImplementation(message=>{if(!release&&message.type==='patch-start')release=()=>normal(message);else normal(message);});workers.push(worker);return worker;}});
  const publisher=new IncrementalMemoryPublication<SessionData>('asc'),row={...memory('withdrawn'),uid:'other',sharedWithIds:[scope.uid]};publisher.apply('source',{changed:[{id:row.id,value:row}],removed:[],order:{reset:[row.id],changes:[]}});
  const {result,rerender}=renderHook(({source})=>useCognitiveAnalysis(source,scope,'insights'),{initialProps:{source:publisher.snapshot()}});await waitFor(()=>expect(release).toBeTypeOf('function'));
  if(change==='removed')publisher.apply('source',{changed:[],removed:[row.id],order:{changes:[{type:'removed',id:row.id,oldIndex:0,newIndex:-1}]}});
  else if(change==='permission-revoked')publisher.apply('source',{changed:[{id:row.id,value:{...row,sharedWithIds:[],get text(){throw Error('Read revoked plaintext');}}}],removed:[],order:{changes:[]}});
  else{publisher.clear();const fresh=memory('fresh');publisher.apply('source',{changed:[{id:fresh.id,value:fresh}],removed:[],order:{reset:[fresh.id],changes:[]}});}
  rerender({source:publisher.snapshot()});expect(workers[0].terminate).toHaveBeenCalledOnce();
  await waitFor(()=>expect(result.current.ready).toBe(true));expect(result.current.analysis).toMatchObject({counts:{total:change==='fence-retired'?1:0}});expect(result.current.getMemory(row.id)).toBeUndefined();act(()=>release!());expect(workers).toHaveLength(2);
});
it('detaches observers and terminates a pending operation on unmount',async()=>{
  const worker=new CognitiveAnalysisWorkerMock();worker.postMessage.mockImplementation(()=>{});vi.stubGlobal('Worker',class{constructor(){return worker;}});
  const rows=[memory('pending')],{unmount}=renderHook(()=>useCognitiveAnalysis(rows,scope,'insights'));await waitFor(()=>expect(worker.postMessage).toHaveBeenCalled());unmount();expect(worker.terminate).toHaveBeenCalledOnce();expect(state.auth.size+state.personal.size+state.team.size).toBe(0);
});
