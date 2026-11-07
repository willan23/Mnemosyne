import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import type {MemoryObject} from '../../types/universe';
const state=vi.hoisted(()=>({uid:'alice',prepare:vi.fn(),apply:vi.fn(),listeners:[] as Array<(value:unknown)=>void>}));
vi.mock('../../firebase',()=>({default:{},db:{},auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:()=>()=>{}}));
vi.mock('firebase/firestore',()=>({collection:(_db:unknown,...parts:string[])=>parts.join('/'),onSnapshot:(_query:unknown,callback:(value:unknown)=>void)=>{state.listeners.push(callback);return()=>{};}}));
vi.mock('../../hooks/useMemoryEditor',()=>({useMemoryEditor:()=>({editing:false,text:'',setText:()=>{},busy:false,begin:()=>{},submit:()=>{}})}));
vi.mock('../../services/semanticRelationRecovery',()=>({semanticRelationWritesEnabled:()=>true,prepareSemanticRelationReview:state.prepare,applySemanticRelationReview:state.apply}));
vi.mock('../AttachmentPreviewGrid',()=>({AttachmentPreviewGrid:()=>null}));
vi.mock('../MemoryAttachmentsPanel',()=>({MemoryAttachmentsPanel:()=>null}));
vi.mock('../TeamMemoryConnectionsPanel',()=>({TeamMemoryConnectionsPanel:()=>null}));
import {MemoryDetail} from './MemoryDetail';
import {useUniverseStore} from '../../store/universeStore';
import {setMemoryCryptoMnemonic} from '../../services/memoryCrypto';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const memory=(id:string):MemoryObject=>({id,uid:'alice',text:'Synthetic '+id,title:id==='a'?'Source':'Target',timestamp:1,updatedAt:10,persistedUpdatedAt:10,persistedStateDigest:(id==='a'?'a':'b').repeat(64),persistedTitle:null,celestialType:'planet',position:[0,0,0],embedding:[1,0],connections:[],importance:.5});
const proposal={targetId:'b',score:1,embeddingModel:'synthetic-space',algorithmVersion:'cosine-v1',evidence:'whole-memory-vector',sourceUpdatedAt:10,targetUpdatedAt:10,proposedAt:1,status:'suggested'};
const base={kind:'review',ownerUid:'alice',sourceId:'a',targetId:'b',sourceHash:'a'.repeat(64),targetHash:'b'.repeat(64),suggestionHash:'c'.repeat(64),counterpartHash:'d'.repeat(64),sourceRevision:10,targetRevision:10};
beforeEach(()=>{state.uid='alice';state.listeners=[];state.prepare.mockReset().mockResolvedValue(base);state.apply.mockReset().mockResolvedValue({status:'committed'});setMemoryCryptoMnemonic(words);useUniverseStore.setState({memories:[memory('a'),memory('b')],selectedMemoryId:'a'});});
afterEach(()=>{cleanup();setMemoryCryptoMnemonic(null);vi.restoreAllMocks();useUniverseStore.setState({memories:[],selectedMemoryId:null});});
// This verifies the consent flow, not a one-second digest SLA on a shared crypto worker.
async function show(){render(<MemoryDetail/>);await act(async()=>{state.listeners[0]({docs:[{id:'b',data:()=>proposal}]});});await waitFor(()=>expect(screen.getByRole('button',{name:'Aceitar',exact:true})).toBeEnabled(),{timeout:5000});}
it('captures displayed hashes before explicit reciprocal approval, then leaves all local graph changes to the authoritative snapshot',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);await show();fireEvent.click(screen.getByRole('button',{name:'Aceitar',exact:true}));await waitFor(()=>expect(state.apply).toHaveBeenCalledOnce());expect(state.prepare.mock.calls[0][0]).toBe('alice');expect(state.prepare.mock.calls[0][1]).toMatchObject({sourceId:'a',targetId:'b',sourceViewDigest:'a'.repeat(64),targetViewDigest:'b'.repeat(64)});expect(state.prepare.mock.calls[0][1].suggestionViewDigest).toMatch(/^[a-f0-9]{64}$/);expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Source ↔ Target'));expect(state.apply.mock.calls[0].slice(0,3)).toEqual(['alice',base,'accepted']);expect(useUniverseStore.getState().memories.map(row=>row.connections)).toEqual([[],[]]);
});
it('declined preview leaves the prepared decision unsubmitted and retains the source and target',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(false);await show();fireEvent.click(screen.getByRole('button',{name:'Aceitar',exact:true}));await waitFor(()=>expect(state.prepare).toHaveBeenCalledOnce());await act(async()=>{});expect(state.apply).not.toHaveBeenCalled();expect(useUniverseStore.getState().memories).toHaveLength(2);
});
it('a changed target while preparation waits retires the old view before confirmation or admission',async()=>{
  let finish!:(value:unknown)=>void;state.prepare.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);await show();fireEvent.click(screen.getByRole('button',{name:'Aceitar',exact:true}));await waitFor(()=>expect(state.prepare).toHaveBeenCalledOnce());act(()=>useUniverseStore.setState({memories:[memory('a'),{...memory('b'),persistedStateDigest:'e'.repeat(64)}]}));await act(async()=>finish(base));expect(confirm).not.toHaveBeenCalled();expect(state.apply).not.toHaveBeenCalled();
});
