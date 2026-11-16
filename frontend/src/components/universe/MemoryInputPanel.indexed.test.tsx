import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({embedding:vi.fn(),unlocked:true,personal:new Set<()=>void>(),team:new Set<()=>void>()}));
vi.mock('../../firebase',()=>({auth:{currentUser:{uid:'alice'}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:()=>()=>{}}));
vi.mock('../../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.unlocked,onMemoryCryptoChanged:(callback:()=>void)=>{state.personal.add(callback);return()=>state.personal.delete(callback);}}));
vi.mock('../../services/teamVault',()=>({onTeamKeyChanged:(callback:()=>void)=>{state.team.add(callback);return()=>state.team.delete(callback);}}));
vi.mock('../../services/embeddingService',()=>({embeddingService:{getEmbedding:(text:string)=>state.embedding(text)}}));
vi.mock('../../services/personalMemoryMutation',()=>({withPersonalMemoryMutation:async(_uid:string,work:(context:{assertCurrent:()=>void})=>Promise<unknown>)=>work({assertCurrent:()=>{}})}));
vi.mock('../../services/attachedMemoryRecovery',()=>({assertPersonalMemoryCreationEnabled:()=>{},hasPendingAttachedMemoryCreation:()=>false}));
import { MemoryInputPanel } from './MemoryInputPanel';
import { useUniverseStore } from '../../store/universeStore';
import { IndexedSemanticWriteCorpus } from '../../services/indexedSemanticWriteCorpus';
import { IndexedSemanticWriteIndex } from '../../services/indexedSemanticWriteIndex';
import { CURRENT_EMBEDDING_SPACE } from '../../services/embeddingModel';
import type { IndexedSemanticWriteMessage } from '../../services/indexedSemanticWriteProtocol';
import type { MemoryObject, MemorySaveCallback } from '../../types/universe';
class TestWorker extends EventTarget {
  index=new IndexedSemanticWriteIndex();terminate=vi.fn(()=>this.index.clear());
  postMessage=vi.fn((message:IndexedSemanticWriteMessage)=>{const data={v:1,seq:message.seq,ok:true,...this.index.handle(structuredClone(message))};queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data})));});
}
let corpus:IndexedSemanticWriteCorpus<MemoryObject>|undefined;
beforeEach(()=>{state.unlocked=true;state.embedding.mockReset().mockResolvedValue([1,0]);useUniverseStore.setState({memories:[],embeddingReady:true,selectedMemoryId:null});});
afterEach(()=>{cleanup();corpus?.clear();corpus=undefined;vi.unstubAllGlobals();expect(state.personal.size).toBe(0);expect(state.team.size).toBe(0);});
function publish(){
  const worker=new TestWorker();vi.stubGlobal('Worker',vi.fn(function(){return worker;}));
  const values:MemoryObject[]=[{id:'existing',uid:'alice',text:'Synthetic existing',timestamp:1,updatedAt:1,embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE,celestialType:'planet',connections:[],position:[1,2,3],importance:.5}];
  corpus=new IndexedSemanticWriteCorpus({uid:'alice',teamIds:new Set()},id=>values.find(value=>value.id===id));
  corpus.apply('personal',{changed:values.map(value=>({id:value.id,value})),removed:[],order:{reset:values.map(value=>value.id),changes:[]}});corpus.associate(values);
  useUniverseStore.getState().loadMemories(values);expect(useUniverseStore.getState().memories).toBe(values);return worker;
}
async function open(){fireEvent.click(screen.getByRole('button',{name:/Nova memória/}));const input=await screen.findByRole('textbox');fireEvent.change(input,{target:{value:'Synthetic new thought'}});return input;}
it('the real input, engine and Zustand publication use the indexed Worker before confirmed creation',async()=>{
  const worker=publish(),save=vi.fn<MemorySaveCallback>(async()=>({id:'confirmed-memory'}));render(<MemoryInputPanel onSave={save}/>);await open();fireEvent.click(screen.getByRole('button',{name:'Lançar'}));
  await waitFor(()=>expect(useUniverseStore.getState().selectedMemoryId).toBe('confirmed-memory'));
  expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).toMatchObject({uid:'alice',embeddingModel:CURRENT_EMBEDDING_SPACE,connections:[]});
  expect(worker.postMessage.mock.calls.some(([message])=>message.type==='query')).toBe(true);expect(worker.terminate).not.toHaveBeenCalled();
});
it('a vault retirement during local inference preserves the input and prevents creation',async()=>{
  publish();let finish!:(vector:number[])=>void;state.embedding.mockImplementationOnce(()=>new Promise<number[]>(resolve=>{finish=resolve;}));
  const save=vi.fn(async()=>({id:'unexpected'}));render(<MemoryInputPanel onSave={save}/>);const input=await open();fireEvent.click(screen.getByRole('button',{name:'Lançar'}));await waitFor(()=>expect(state.embedding).toHaveBeenCalledOnce());
  await act(async()=>{state.unlocked=false;for(const callback of state.personal)callback();finish([1,0]);});expect(save).not.toHaveBeenCalled();expect(input).toHaveValue('Synthetic new thought');
});
