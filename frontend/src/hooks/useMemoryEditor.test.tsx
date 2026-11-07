import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',generation:0,records:new Map<string,unknown>(),authListeners:new Set<(user:{uid:string}|null)=>void>(),teamListeners:new Set<()=>void>(),capture:vi.fn(),fail:false,readbackFail:false,failedReads:0,writeGate:undefined as undefined|(()=>Promise<void>)}));
vi.mock('../firebase',()=>({default:{},db:{},auth:{get currentUser(){return state.uid?{uid:state.uid}:null;}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string}|null)=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('../services/teamVault',()=>({getTeamKeyCacheGeneration:()=>state.generation,onTeamKeyChanged:(callback:()=>void)=>{state.teamListeners.add(callback);return()=>state.teamListeners.delete(callback);}}));
vi.mock('../services/memoryEditRecovery',()=>({hasPendingMemoryEdit:()=>false,captureMemoryEditBaseline:(...args:unknown[])=>state.capture(...args)}));
const gates=vi.hoisted(()=>({enabled:true}));
vi.mock('../config/releaseGates',()=>({get TEAM_WRITES_ENABLED(){return gates.enabled;},get PERSONAL_REVISION_WRITES_ENABLED(){return gates.enabled;}}));
vi.mock('../services/clipCaptureService',()=>({withClipCaptureLock:async(_key:string,work:()=>Promise<unknown>)=>work()}));
vi.mock('../services/memoryEditorDraftStore',()=>({memoryEditorDraftStore:{get:async(uid:string,id:string)=>{if(state.failedReads){state.failedReads--;throw Error('Synthetic failed readback');}return structuredClone(state.records.get(uid+'/'+id));},compareExchange:async(uid:string,id:string,expected:string|null,next:unknown,guard:()=>void)=>{guard();if(state.fail)throw Error('Synthetic storage full');const key=uid+'/'+id,old=state.records.get(key);if((old?JSON.stringify(old):null)!==expected)throw Error('Synthetic another tab');if(next===null)state.records.delete(key);else state.records.set(key,structuredClone(next));if(state.readbackFail){state.readbackFail=false;state.failedReads++;}if(state.writeGate)await state.writeGate();}}}));
import {useMemoryEditor} from './useMemoryEditor';
import {setMemoryCryptoMnemonic} from '../services/memoryCrypto';
import {loadMemoryEditorDraft,saveMemoryEditorDraft} from '../services/memoryEditorDraft';
import type {MemoryObject,MemorySaveSubmission,MemorySaveCallback} from '../types/universe';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const memory=(id='note'):MemoryObject=>({id,uid:'alice',text:'Original formatted text\n',title:'Presentation fallback',persistedTitle:null,persistedStateDigest:'b'.repeat(64),persistedUpdatedAt:10,timestamp:1,updatedAt:10,embedding:[],position:[0,0,0],connections:[],importance:.5,celestialType:'planet'});
const baseline=(id='note')=>({kind:'personal' as const,sessionId:id,teamId:null,authorUid:'alice',ownerUid:'alice',stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:10,teamStateHash:null,epochStateHash:null,keyEpoch:null,keyId:null,priorKeyEpoch:null,priorKeyId:null});
beforeEach(()=>{state.uid='alice';state.generation=0;state.records.clear();state.authListeners.clear();state.teamListeners.clear();state.capture.mockReset().mockImplementation(async input=>{input.assertCurrent();return baseline(input.id);});state.fail=false;state.writeGate=undefined;state.readbackFail=false;state.failedReads=0;setMemoryCryptoMnemonic(words);});
afterEach(()=>{setMemoryCryptoMnemonic(null);vi.restoreAllMocks();});
beforeEach(()=>{gates.enabled=true;});
async function open(result:{current:ReturnType<typeof useMemoryEditor>}){await act(async()=>{await result.current.begin();});await waitFor(()=>expect(result.current.ready).toBe(true));}
it('retries a refused initial baseline against the current view without discarding another draft',async()=>{
  let selected=memory();state.capture.mockRejectedValueOnce(Error('Synthetic concurrent cluster update'));
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),{result,rerender}=renderHook(()=>useMemoryEditor(selected,vi.fn()));
  await act(async()=>{await result.current.begin();});expect(result.current.ready).toBe(false);expect(result.current.message).toContain('Não foi possível abrir');
  selected={...selected,updatedAt:11,persistedStateDigest:'c'.repeat(64)};rerender();
  state.capture.mockImplementation(async input=>{input.assertCurrent();return{...baseline(),revision:11,stateDigest:'c'.repeat(64)};});
  state.records.set('bob/note',{synthetic:true});
  await act(async()=>{await result.current.discardAndReopen();});
  expect(state.capture).toHaveBeenCalledTimes(2);expect(result.current.ready).toBe(true);
  expect(state.capture.mock.calls[1][0].viewDigest).toBe('c'.repeat(64));
  expect(confirm).not.toHaveBeenCalled();expect(state.records.get('bob/note')).toEqual({synthetic:true});
  expect((await loadMemoryEditorDraft('alice','note')).draft?.baseline.revision).toBe(11);
});
it('an initial opening refusal cannot be retried into a different account',async()=>{
  state.capture.mockRejectedValueOnce(Error('Synthetic concurrent cluster update'));
  const {result,rerender}=renderHook(()=>useMemoryEditor(memory(),vi.fn()));
  await act(async()=>{await result.current.begin();});
  act(()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});});rerender();
  await act(async()=>{await result.current.discardAndReopen();});
  expect(state.capture).toHaveBeenCalledOnce();expect(state.records.size).toBe(0);expect(result.current.text).toBe('');
});
it('captures before editing and saves exact code formatting with the stored title untouched',async()=>{
  const save=vi.fn(async(_memory:MemoryObject,submission?:MemorySaveSubmission)=>{submission?.assertCurrent();}),{result}=renderHook(()=>useMemoryEditor(memory(),save));await open(result);expect(state.capture).toHaveBeenCalledWith(expect.objectContaining({viewDigest:'b'.repeat(64),expected:{text:'Original formatted text\n',title:null,authorUid:'alice'}}));
  const text='    indented code\n\ná漢🙂\n';act(()=>result.current.setText(text));await waitFor(()=>expect(result.current.dirty).toBe(false));expect(JSON.stringify([...state.records])).not.toContain('indented');await act(async()=>{await result.current.submit();});expect(save).toHaveBeenCalledWith(expect.objectContaining({text,title:undefined}),expect.objectContaining({kind:'edit',baseline:baseline(),title:null,refreshSemantic:true,assertCurrent:expect.any(Function)}));expect(state.records.size).toBe(0);expect(result.current.editing).toBe(false);
});
it('typing a title explicitly replaces the presentation fallback while unchanged titles remain null',async()=>{
  const save=vi.fn(async()=>{}),{result}=renderHook(()=>useMemoryEditor(memory(),save));await open(result);act(()=>result.current.setTitle('Chosen title'));await act(async()=>{await result.current.submit();});expect(save.mock.calls[0][1]).toMatchObject({title:'Chosen title'});
});
it('remote updates preserve the original draft and refuse submission until an explicit new review',async()=>{
  let selected=memory();const save=vi.fn(async()=>{}),{result,rerender}=renderHook(()=>useMemoryEditor(selected,save));await open(result);act(()=>result.current.setText('Unsaved local body'));await waitFor(()=>expect(result.current.dirty).toBe(false));selected={...selected,text:'Remote body',persistedStateDigest:'c'.repeat(64),updatedAt:11};rerender();expect(result.current.text).toBe('Unsaved local body');expect(result.current.message).toContain('recebeu alterações');expect(result.current.canSubmit).toBe(false);expect(state.capture).toHaveBeenCalledOnce();
  await act(async()=>{await result.current.submit();});expect(save).not.toHaveBeenCalled();expect((await loadMemoryEditorDraft('alice','note')).draft?.text).toBe('Unsaved local body');
});
it('closed admission refuses direct submission and metadata callbacks while retaining the durable editor',async()=>{
  const save=vi.fn(),{result,rerender}=renderHook(()=>useMemoryEditor(memory(),save));await open(result);act(()=>result.current.setText('Synthetic retained draft'));await waitFor(()=>expect(result.current.dirty).toBe(false));gates.enabled=false;rerender();await act(async()=>{await result.current.submit();expect(await result.current.saveMetadata({projectStatus:'done'})).toBe(false);});expect(save).not.toHaveBeenCalled();expect(result.current.canSubmit).toBe(false);expect(result.current.writesEnabled).toBe(false);expect((await loadMemoryEditorDraft('alice','note')).draft?.text).toBe('Synthetic retained draft');
});
it('metadata capture failure is reported without invoking save or replacing the existing draft',async()=>{
  const save=vi.fn(),{result}=renderHook(()=>useMemoryEditor(memory(),save));await open(result);state.capture.mockRejectedValueOnce(Error('Synthetic stale snapshot'));await act(async()=>{expect(await result.current.saveMetadata({projectStatus:'done'})).toBe(false);});expect(save).not.toHaveBeenCalled();expect((await loadMemoryEditorDraft('alice','note')).draft?.text).toBe('Original formatted text\n');
});
it('a durable draft reopens after unmount with the same baseline and no recapture',async()=>{
  const first=renderHook(()=>useMemoryEditor(memory(),vi.fn()));await open(first.result);act(()=>first.result.current.setText('Durable edit'));await waitFor(()=>expect(first.result.current.dirty).toBe(false));first.unmount();state.capture.mockClear();const second=renderHook(()=>useMemoryEditor(memory(),vi.fn()));await open(second.result);expect(second.result.current.text).toBe('Durable edit');expect(state.capture).not.toHaveBeenCalled();
});
it('selection change cannot clear or overwrite the previous memory draft while its write finishes',async()=>{
  let selected=memory();const {result,rerender}=renderHook(()=>useMemoryEditor(selected,vi.fn()));await open(result);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});state.writeGate=()=>gate;act(()=>result.current.setText('Old memory latest edit'));await waitFor(()=>expect(state.records.has('alice/note')).toBe(true));selected=memory('other');rerender();expect(result.current.text).toBe('');state.writeGate=undefined;await act(async()=>release());expect((await loadMemoryEditorDraft('alice','note')).draft?.text).toBe('Old memory latest edit');await open(result);expect(result.current.text).toBe('Original formatted text\n');
});
it('a late rejected mutation preserves the durable draft and its exact captured baseline',async()=>{
  const save=vi.fn(async()=>{throw Error('Synthetic stale server version');}),{result}=renderHook(()=>useMemoryEditor(memory(),save));await open(result);act(()=>result.current.setText('Retry draft'));await act(async()=>{await result.current.submit();});expect(result.current.text).toBe('Retry draft');expect(result.current.message).toContain('não foi confirmada');expect((await loadMemoryEditorDraft('alice','note')).draft?.baseline).toEqual(baseline());
});
it('an edit made during a late response retires the submission guard and survives confirmation',async()=>{
  let finish!:()=>void;const save=vi.fn<MemorySaveCallback>(()=>new Promise<void>(resolve=>{finish=resolve;})),{result}=renderHook(()=>useMemoryEditor(memory(),save));await open(result);act(()=>result.current.setText('Submitted text'));let submission!:Promise<unknown>;act(()=>{submission=result.current.submit();});await waitFor(()=>expect(save).toHaveBeenCalledOnce());const guard=save.mock.calls[0][1]!.assertCurrent;
  // A different local writer can update the hook even while the form's button is busy.
  await act(async()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});finish();await submission;});expect(guard).toThrow();expect(state.records.has('alice/note')).toBe(true);expect(result.current.text).toBe('');
});
it('readback failure can retry its known committed revision without replacing another tab',async()=>{
  const {result}=renderHook(()=>useMemoryEditor(memory(),vi.fn()));await open(result);state.readbackFail=true;act(()=>result.current.setText('Stored but unconfirmed edit'));await waitFor(()=>expect(result.current.message).toContain('Não foi possível guardar'));expect(state.records.has('alice/note')).toBe(true);const saved=await loadMemoryEditorDraft('alice','note');await saveMemoryEditorDraft('alice','note',{...saved.draft!,text:'Other tab latest'},saved.raw);await act(async()=>{await result.current.submit();});expect((await loadMemoryEditorDraft('alice','note')).draft?.text).toBe('Other tab latest');expect(result.current.text).toBe('Stored but unconfirmed edit');
});
it('discard requires explicit confirmation and deletes only the reviewed own memory draft',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),{result}=renderHook(()=>useMemoryEditor(memory(),vi.fn()));await open(result);act(()=>result.current.setText('Local draft'));await waitFor(()=>expect(result.current.dirty).toBe(false));state.records.set('bob/note',{synthetic:true});await act(async()=>{await result.current.discardAndReopen();});expect(result.current.text).toBe('Local draft');confirm.mockReturnValue(true);await act(async()=>{await result.current.discardAndReopen();});expect(result.current.text).toBe('Original formatted text\n');expect(state.records.has('bob/note')).toBe(true);
});
