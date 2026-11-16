import { act, cleanup, fireEvent, render, screen,waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CognitiveSidebar } from './CognitiveSidebar';
import { useUniverseStore } from '../store/universeStore';
import type { MemoryObject, MemorySaveCallback } from '../types/universe';
const records=vi.hoisted(()=>new Map<string,unknown>());
const observed=vi.hoisted(()=>({insights:null as unknown,web:null as unknown,enabled:undefined as boolean|undefined}));
vi.mock('../firebase',()=>({default:{},db:{},storage:{},auth:{currentUser:{uid:'alice'}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:()=>()=>{}}));
vi.mock('../config/releaseGates',async original=>({...await original<typeof import('../config/releaseGates')>(),TEAM_WRITES_ENABLED:true,PERSONAL_REVISION_WRITES_ENABLED:true}));
vi.mock('firebase/firestore',async original=>({...await original<typeof import('firebase/firestore')>(),doc:()=>({}),getDocFromServer:async()=>({data:()=>({name:'Synthetic team',ownerUid:'alice',memberUids:['alice'],wrappedKeys:{alice:{v:1,alg:'RSA-OAEP',ct:'AQ=='}},activeKeyEpoch:1,activeKeyId:'11111111-1111-4111-8111-111111111111',keyRotationStatus:'active'})})}));
vi.mock('../services/clipCaptureService',()=>({withClipCaptureLock:async(_key:string,work:()=>Promise<unknown>)=>work()}));
vi.mock('../services/memoryEditRecovery',async original=>({...await original<typeof import('../services/memoryEditRecovery')>(),hasPendingMemoryEdit:()=>false,captureMemoryEditBaseline:async(input:{id:string;assertCurrent:()=>void})=>{input.assertCurrent();return{kind:'team',sessionId:input.id,teamId:'crew',authorUid:'alice',ownerUid:'alice',stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:10,teamStateHash:'c'.repeat(64),epochStateHash:'d'.repeat(64),keyEpoch:1,keyId:'11111111-1111-4111-8111-111111111111',priorKeyEpoch:1,priorKeyId:'11111111-1111-4111-8111-111111111111'};}}));
vi.mock('../services/memoryEditorDraftStore',()=>({memoryEditorDraftStore:{get:async(uid:string,id:string)=>structuredClone(records.get(uid+'/'+id)),compareExchange:async(uid:string,id:string,expected:string|null,next:unknown,guard:()=>void)=>{guard();const key=uid+'/'+id,old=records.get(key);if((old?JSON.stringify(old):null)!==expected)throw Error('Synthetic conflict');if(next===null)records.delete(key);else records.set(key,structuredClone(next));}}}));
import {setMemoryCryptoMnemonic} from '../services/memoryCrypto';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
vi.mock('./AttachmentPreviewGrid', () => ({ AttachmentPreviewGrid: () => null }));
vi.mock('./InsightsPanel', () => ({ InsightsPanel: ({sessions,enabled}:{sessions:unknown;enabled?:boolean}) => { observed.insights=sessions; observed.enabled=enabled; return null; } }));
vi.mock('./WebResearchPanel', () => ({ WebResearchPanel: ({sessions}:{sessions:unknown}) => { observed.web=sessions; return null; } }));
vi.mock('./TeamMemoryConnectionsPanel', () => ({ TeamMemoryConnectionsPanel: () => null }));
vi.mock('../utils/export', () => ({ downloadMemory: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
import toast from 'react-hot-toast';
import { IncrementalMemoryPublication } from '../services/incrementalMemoryPublication';
import { memoryById, type MemorySnapshot } from '../services/memorySnapshot';
import { MemoryViewWorkerMock } from '../test/memoryViewWorkerMock';
const memory: MemoryObject = { id: 'sidebar-synthetic', uid: 'alice', teamId: 'crew', text: 'Synthetic original',
  celestialType: 'planet', position: [0, 0, 0], embedding: [], connections: [], importance: 0.5,
  timestamp: 1, updatedAt: 10, persistedUpdatedAt: 10,persistedTitle:null,persistedStateDigest:'b'.repeat(64) };
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { vi.clearAllMocks();vi.stubGlobal('Worker',MemoryViewWorkerMock);observed.insights=null;observed.web=null;records.clear();setMemoryCryptoMnemonic(words);useUniverseStore.setState({ memories: [{ ...memory }], selectedMemoryId: memory.id, deletingMemoryId: null, language: 'pt-pt' }); });
afterEach(() => { cleanup();setMemoryCryptoMnemonic(null);vi.restoreAllMocks();vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); useUniverseStore.setState({ memories: [], selectedMemoryId: null }); });
it('suspends only the insight analysis when its overlay is inactive and retains the current sidebar selection',()=>{
  const close=vi.fn(),view=render(<CognitiveSidebar isOpen activeTab="insights" onClose={close}/>);
  expect(observed.enabled).toBe(true);const source=observed.insights;
  view.rerender(<CognitiveSidebar isOpen activeTab="insights" analysisActive={false} onClose={close}/>);
  expect(observed.enabled).toBe(false);expect(observed.insights).toBe(source);expect(useUniverseStore.getState().selectedMemoryId).toBe(memory.id);expect(close).not.toHaveBeenCalled();
  view.rerender(<CognitiveSidebar isOpen activeTab="insights" analysisActive onClose={close}/>);expect(observed.enabled).toBe(true);
});
it('shows ten related rows in published order and releases the Worker outside the memory tab',async()=>{
  const targets=Array.from({length:15},(_,index)=>({...memory,id:'related-'+index,title:'Related '+index})),source={...memory,connections:targets.map(row=>row.id).reverse()},rows=[source,...targets];
  const publisher=new IncrementalMemoryPublication<MemoryObject>('asc');publisher.apply('source',{changed:rows.map(value=>({id:value.id,value})),removed:[],order:{reset:rows.map(row=>row.id),changes:[]}});
  const snapshot=publisher.snapshot();vi.spyOn(Object.getPrototypeOf(snapshot),'filter').mockImplementation(()=>{throw Error('UI enumerated related vault');});useUniverseStore.setState({memories:snapshot,selectedMemoryId:memory.id});
  const view=render(<CognitiveSidebar isOpen activeTab="memory" onClose={()=>{}}/>);await screen.findByText('Related 0');expect(screen.getByText('Related 9')).toBeInTheDocument();expect(screen.queryByText('Related 10')).toBeNull();
  expect(screen.getByText('Related 0').compareDocumentPosition(screen.getByText('Related 9'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const worker=MemoryViewWorkerMock.instances.at(-1)!;view.rerender(<CognitiveSidebar isOpen activeTab="insights" onClose={()=>{}}/>);expect(worker.terminate).toHaveBeenCalledOnce();
});
it('reuses the scoped fallback collection and retains team, sharing, lock and deletion fields', () => {
  const publisher = new IncrementalMemoryPublication<MemoryObject>('asc');
  const protectedRow = {...memory,teamScopeAmbiguous:true,encLocked:true,sharedWithIds:['bob'],deletedAt:42};
  publisher.apply('source',{changed:[{id:memory.id,value:protectedRow}],removed:[],order:{reset:[memory.id],changes:[]}});
  const snapshot = publisher.snapshot();useUniverseStore.setState({memories:snapshot,selectedMemoryId:null});
  const view=render(<CognitiveSidebar isOpen activeTab="insights" onClose={()=>{}}/>);
  expect(observed.insights).toBe(snapshot);
  expect(memoryById(observed.insights as MemorySnapshot<MemoryObject>,memory.id)).toBe(protectedRow);
  view.rerender(<CognitiveSidebar isOpen activeTab="web" onClose={()=>{}}/>);
  expect(observed.web).toBe(snapshot);
  const explicit=[{...memory,id:'authoritative'}];
  view.rerender(<CognitiveSidebar isOpen activeTab="insights" allSessions={explicit} onClose={()=>{}}/>);
  expect(observed.insights).toBe(explicit);
  publisher.clear();
  expect(()=>memoryById(observed.web as MemorySnapshot<MemoryObject>,memory.id)).toThrow('memory_snapshot_unavailable');
});
it('renders an empty selection and counters without enumerating a large published collection', () => {
  const publisher = new IncrementalMemoryPublication<MemoryObject>('asc');
  const rows = Array.from({length:10000},(_,index)=>({...memory,id:'synthetic-'+index,timestamp:index,connections:['outside','outside']}));
  publisher.apply('source',{changed:rows.map(value=>({id:value.id,value})),removed:[],order:{reset:rows.map(row=>row.id),changes:[]}});
  const snapshot=publisher.snapshot(),prototype=Object.getPrototypeOf(snapshot);
  for(const method of ['find','filter','map','at',Symbol.iterator] as const)vi.spyOn(prototype,method).mockImplementation(()=>{throw Error('Full collection traversal during sidebar render');});
  useUniverseStore.setState({memories:snapshot,selectedMemoryId:null});
  const view=render(<CognitiveSidebar isOpen={false} onClose={()=>{}}/>);
  view.rerender(<CognitiveSidebar isOpen onClose={()=>{}}/>);
  expect(screen.getByText('10000 corpos celestes · 10000 ligações')).toBeInTheDocument();
  view.rerender(<CognitiveSidebar isOpen activeTab="insights" onClose={()=>{}}/>);
  expect(observed.insights).toBe(snapshot);
});
it('a refused project metadata change is reported and keeps the displayed tags and status',async()=>{
  useUniverseStore.setState({memories:[{...memory,projectStatus:'active',tags:['projeto','status:active']}]});const save=vi.fn<MemorySaveCallback>(async()=>{throw Error('Synthetic conflict');});render(<CognitiveSidebar isOpen onClose={()=>{}} onSaveMemory={save}/>);fireEvent.click(screen.getByRole('button',{name:'Concluído',exact:true}));await waitFor(()=>expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('estado do projeto')));expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][1]).toMatchObject({kind:'edit',refreshSemantic:false,metadata:{projectStatus:'done',tags:['projeto','status:done']}});expect(useUniverseStore.getState().memories[0]).toMatchObject({projectStatus:'active',tags:['projeto','status:active']});
});
it('preserves a refused draft and emits success only after the sidebar persistence callback resolves', async () => {
  const first = deferred(); const second = deferred(); const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<CognitiveSidebar isOpen onClose={() => undefined} onSaveMemory={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editar Memória' }));
  await waitFor(()=>expect(screen.getAllByRole('textbox').find(item=>item.tagName==='TEXTAREA')).toBeEnabled());
  fireEvent.change(screen.getAllByRole('textbox').find(item => item.tagName === 'TEXTAREA')!, { target: { value: 'Synthetic draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gravar Alterações' }));
  expect(useUniverseStore.getState().memories[0].text === memory.text).toBe(true);
  expect(toast.success).not.toHaveBeenCalled();
  await waitFor(()=>expect(save).toHaveBeenCalledOnce());
  await act(async () => first.reject(new Error('Synthetic refusal')));
  expect((screen.getAllByRole('textbox').find(item => item.tagName === 'TEXTAREA') as HTMLTextAreaElement).value === 'Synthetic draft').toBe(true);
  expect(toast.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Gravar Alterações' }));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
  await act(async () => second.resolve());
  await waitFor(()=>expect(toast.success).toHaveBeenCalledTimes(1));
  expect(useUniverseStore.getState().memories[0].text === memory.text).toBe(true);
  expect(save.mock.calls[1][1]).toMatchObject({kind:'edit',baseline:{sessionId:memory.id,stateDigest:'b'.repeat(64)},title:null});
});
it('starts deletion and success feedback only after acknowledgement and preserves a newer selection', async () => {
  vi.useFakeTimers(); vi.spyOn(window, 'confirm').mockReturnValue(true);
  const first = deferred(); const second = deferred(); const remove = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<CognitiveSidebar isOpen onClose={() => undefined} onDeleteMemory={remove} />);
  fireEvent.click(screen.getByTitle('Apagar Memória (Supernova)'));
  expect(useUniverseStore.getState().deletingMemoryId).toBeNull();
  await act(async () => first.reject(new Error('Synthetic refusal')));
  expect(useUniverseStore.getState().memories).toHaveLength(1); expect(toast.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('Apagar Memória (Supernova)'));
  await act(async () => second.resolve());
  expect(useUniverseStore.getState().deletingMemoryId).toBe(memory.id); expect(toast.success).toHaveBeenCalledTimes(1);
  act(() => { useUniverseStore.setState({ selectedMemoryId: 'new-selection' }); vi.advanceTimersByTime(801); });
  expect(useUniverseStore.getState().selectedMemoryId).toBe('new-selection');
});
