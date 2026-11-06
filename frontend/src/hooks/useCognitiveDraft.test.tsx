import {act,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',generation:0,records:new Map<string,unknown>(),authListeners:new Set<(user:{uid:string}|null)=>void>(),teamListeners:new Set<()=>void>(),
  fail:false,gate:undefined as undefined|(()=>Promise<void>),casGate:undefined as undefined|(()=>Promise<void>),failAfterWrite:false,failedReads:0,teams:[] as unknown[],enforceLock:false,locks:new Set<string>(),lockCalls:0,lockCollisions:0}));
vi.mock('../firebase',()=>({default:{},db:{},auth:{get currentUser(){return state.uid?{uid:state.uid}:null;}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string}|null)=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('firebase/firestore',async original=>({...await original<typeof import('firebase/firestore')>(),doc:vi.fn(),getDocFromServer:async()=>({data:()=>state.teams[0]})}));
vi.mock('../services/teamVault',()=>({getTeamKeyCacheGeneration:()=>state.generation,onTeamKeyChanged:(callback:()=>void)=>{state.teamListeners.add(callback);return()=>state.teamListeners.delete(callback);}}));
vi.mock('../services/teamsService',()=>({parseTeam:(_id:string,value:unknown)=>value}));
vi.mock('../services/clipCaptureService',()=>({withClipCaptureLock:async(key:string,work:()=>Promise<unknown>)=>{
  if(!state.enforceLock)return work();state.lockCalls++;if(state.locks.has(key)){state.lockCollisions++;throw Error('Synthetic competing lock');}
  state.locks.add(key);try{return await work();}finally{state.locks.delete(key);}
}}));
vi.mock('../services/cognitiveDraftStore',()=>({cognitiveDraftStore:{get:async(uid:string)=>{if(state.gate)await state.gate();if(state.failedReads>0){state.failedReads--;throw Error('Synthetic readback failed');}if(state.fail)throw Error('Synthetic store failed');return structuredClone(state.records.get(uid));},
  compareExchange:async(uid:string,expected:string|null,next:unknown,guard:()=>void)=>{guard();if(state.fail)throw Error('Synthetic write failed');const old=state.records.get(uid);if((old?JSON.stringify(old):null)!==expected)throw Error('Synthetic concurrent draft');if(next===null)state.records.delete(uid);else state.records.set(uid,structuredClone(next));if(state.failAfterWrite){state.failAfterWrite=false;state.failedReads++;}if(state.casGate)await state.casGate();}}}));
import {useCognitiveDraft} from './useCognitiveDraft';
import {setMemoryCryptoMnemonic} from '../services/memoryCrypto';
import {loadCognitiveDraft,saveCognitiveDraft} from '../services/cognitiveDraft';
import type {TeamRecord} from '../services/teamsService';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const id='11111111-1111-4111-8111-111111111111';const baseline={sessionId:id,stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:9};
function Editor(){const draft=useCognitiveDraft(state.teams as TeamRecord[]);return <>
  <input aria-label="Draft" disabled={!draft.ready} value={draft.text} onChange={event=>draft.setText(event.target.value)}/>
  <button onClick={()=>void draft.flush()}>Flush</button><button onClick={()=>void draft.discard()}>Discard</button>
  <button onClick={()=>{draft.setLearnedGeneration({id,uid:'alice',personalRevisionBaseline:baseline});draft.setText('Synthetic generated body');}}>Generate</button>
  {draft.learnedGeneration&&<p data-testid="generation">{JSON.stringify(draft.learnedGeneration)}</p>}
  {draft.message&&<p role="status">{draft.message}</p>}
  <p data-testid="ready">{String(draft.ready)}</p><p data-testid="dirty">{String(draft.dirty)}</p>
  </>;}
beforeEach(()=>{state.uid='alice';state.generation=0;state.records.clear();state.authListeners.clear();state.teamListeners.clear();state.teams=[];state.fail=false;state.gate=undefined;state.casGate=undefined;state.failAfterWrite=false;state.failedReads=0;state.enforceLock=false;state.locks.clear();state.lockCalls=0;state.lockCollisions=0;setMemoryCryptoMnemonic(words);sessionStorage.clear();});
afterEach(()=>{setMemoryCryptoMnemonic(null);vi.restoreAllMocks();});
async function ready(){await waitFor(()=>expect(screen.getByLabelText('Draft')).toBeEnabled());}
it('a replacement scope waits for its retired local read to release the draft lock',async()=>{
  state.enforceLock=true;let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});state.gate=()=>held;
  const {result}=renderHook(()=>useCognitiveDraft([]));await waitFor(()=>expect(state.lockCalls).toBe(1));
  act(()=>{state.generation++;for(const callback of state.teamListeners)callback();});
  await act(async()=>{await Promise.resolve();});expect(result.current.ready).toBe(false);expect(state.lockCollisions).toBe(0);
  state.gate=undefined;await act(async()=>release());await waitFor(()=>expect(result.current.ready).toBe(true));
  expect(state.lockCalls).toBe(2);expect(result.current.message).toBeNull();expect(state.records.size).toBe(0);
});
it('several retired scopes skip their reads and only the latest view acquires the lock',async()=>{
  state.enforceLock=true;let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});state.gate=()=>held;
  const {result}=renderHook(()=>useCognitiveDraft([]));await waitFor(()=>expect(state.lockCalls).toBe(1));
  for(let i=0;i<3;i++)await act(async()=>{state.generation++;for(const callback of state.teamListeners)callback();});
  expect(state.lockCollisions).toBe(0);state.gate=undefined;await act(async()=>release());await waitFor(()=>expect(result.current.ready).toBe(true));
  expect(state.lockCalls).toBe(2);expect(result.current.message).toBeNull();
});
it('a team key becoming available during reload does not leave capture disabled',async()=>{
  state.enforceLock=true;
  state.teams=[{id:'crew',memberUids:['alice'],roles:{alice:'owner'},wrappedKeys:{alice:{}},activeKeyEpoch:1,activeKeyId:'22222222-2222-4222-8222-222222222222',keyRotationStatus:'active'}];
  const {result,rerender}=renderHook(()=>useCognitiveDraft(state.teams as TeamRecord[]));
  await waitFor(()=>expect(result.current.ready).toBe(true));
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});state.gate=()=>held;
  state.teams=[{...state.teams[0] as object,activeKeyEpoch:2,activeKeyId:'33333333-3333-4333-8333-333333333333'}];rerender();
  await waitFor(()=>expect(state.lockCalls).toBe(2));
  act(()=>{for(const callback of state.teamListeners)callback();});
  state.gate=undefined;await act(async()=>release());
  await waitFor(()=>expect(result.current.ready).toBe(true));
  expect(result.current.message).toBeNull();expect(state.lockCollisions).toBe(0);
});
it('a lock owned by a different view still fails closed without overwriting the stored draft',async()=>{
  state.enforceLock=true;state.locks.add('mnemosyne:cognitive-draft:v1:alice');state.records.set('alice',{synthetic:'preserved unreadable draft'});
  const {result}=renderHook(()=>useCognitiveDraft([]));await waitFor(()=>expect(result.current.message).not.toBeNull());
  expect(result.current.ready).toBe(false);expect(state.lockCollisions).toBe(1);expect(state.records.get('alice')).toEqual({synthetic:'preserved unreadable draft'});
});
it('a new scope waits for its own in-flight save and reopens the committed encrypted draft',async()=>{
  state.enforceLock=true;const {result}=renderHook(()=>useCognitiveDraft([]));await waitFor(()=>expect(result.current.ready).toBe(true));
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});state.casGate=()=>held;
  act(()=>result.current.setText('Synthetic durable draft'));let saving!:Promise<void>;act(()=>{saving=result.current.flush();});
  await waitFor(()=>expect(state.records.has('alice')).toBe(true));
  act(()=>{state.generation++;for(const callback of state.teamListeners)callback();});
  await act(async()=>{await Promise.resolve();});expect(state.lockCollisions).toBe(0);expect(result.current.ready).toBe(false);
  state.casGate=undefined;await act(async()=>{release();await saving;});await waitFor(()=>expect(result.current.ready).toBe(true));
  expect(result.current.text).toBe('Synthetic durable draft');expect(result.current.message).toBeNull();expect(state.lockCollisions).toBe(0);
  expect(JSON.stringify(state.records.get('alice'))).not.toContain('Synthetic durable draft');
});
it('a generated baseline and changed draft reopen together after a durable encrypted save',async()=>{
  const view=render(<Editor/>);await ready();fireEvent.click(screen.getByText('Generate'));fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'Synthetic revised body'}});fireEvent.click(screen.getByText('Flush'));
  await waitFor(()=>expect(screen.getByTestId('dirty')).toHaveTextContent('false'));expect(JSON.stringify(state.records.get('alice'))).not.toContain('Synthetic');view.unmount();render(<Editor/>);await ready();
  expect(screen.getByLabelText('Draft')).toHaveValue('Synthetic revised body');expect(screen.getByTestId('generation')).toHaveTextContent(JSON.stringify(baseline));
});
it('a global legacy draft is never assigned to the current account',async()=>{
  sessionStorage.setItem('mnemosyne.flow.draft','LEGACY_UNOWNED_PRIVATE_791');render(<Editor/>);await ready();expect(screen.getByLabelText('Draft')).toHaveValue('');expect(sessionStorage.getItem('mnemosyne.flow.draft')).toBe('LEGACY_UNOWNED_PRIVATE_791');
});
it('switching account hides plaintext immediately and restoring a saved own draft requires its own vault',async()=>{
  render(<Editor/>);await ready();fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'ALICE_PRIVATE_791'}});fireEvent.click(screen.getByText('Flush'));await waitFor(()=>expect(state.records.has('alice')).toBe(true));
  act(()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});});expect(screen.getByLabelText('Draft')).toHaveValue('');expect(screen.queryByText('ALICE_PRIVATE_791')).toBeNull();await ready();
  act(()=>{state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});setMemoryCryptoMnemonic([...words].reverse());});
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Não foi possível abrir'));expect(screen.getByLabelText('Draft')).toHaveValue('');expect(state.records.has('alice')).toBe(true);
  act(()=>setMemoryCryptoMnemonic(words));await ready();expect(screen.getByLabelText('Draft')).toHaveValue('ALICE_PRIVATE_791');
});
it('lock/unlock hides plaintext while preserving the encrypted record',async()=>{
  render(<Editor/>);await ready();fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'VAULT_PRIVATE_791'}});fireEvent.click(screen.getByText('Flush'));await waitFor(()=>{expect(state.records.has('alice')).toBe(true);expect(screen.getByTestId('dirty')).toHaveTextContent('false');},{timeout:10000});
  act(()=>setMemoryCryptoMnemonic(null));expect(screen.getByLabelText('Draft')).toHaveValue('');expect(screen.getByLabelText('Draft')).toBeDisabled();act(()=>setMemoryCryptoMnemonic(words));await ready();expect(screen.getByLabelText('Draft')).toHaveValue('VAULT_PRIVATE_791');
});
it('failed writes keep the current edit and support an explicit retry without exposing raw errors',async()=>{
  render(<Editor/>);await ready();state.fail=true;fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'UNSAVED_PRIVATE_791'}});fireEvent.click(screen.getByText('Flush'));
  expect(await screen.findByRole('status')).toHaveTextContent('Mantém esta vista aberta');expect(screen.getByLabelText('Draft')).toHaveValue('UNSAVED_PRIVATE_791');expect(state.records.size).toBe(0);
  state.fail=false;fireEvent.click(screen.getByText('Flush'));await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());expect(state.records.has('alice')).toBe(true);
});
it('a slow old load cannot publish after switching away and back',async()=>{
  await saveCognitiveDraft('alice',{v:1,uid:'alice',scope:{kind:'personal'},text:'OLD_PRIVATE_791',generation:null,image:null,imagePrompt:''},null);
  let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});state.gate=()=>waiting;const view=render(<Editor/>);
  act(()=>{state.uid='bob';for(const callback of state.authListeners)callback({uid:'bob'});state.uid='alice';for(const callback of state.authListeners)callback({uid:'alice'});});
  view.unmount();state.gate=undefined;await act(async()=>release());expect(screen.queryByText('OLD_PRIVATE_791')).toBeNull();expect(state.authListeners.size).toBe(0);
});
it('a saved draft changed by another tab is not overwritten by retrying an older view',async()=>{
  render(<Editor/>);await ready();fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'Local unsaved body'}});
  await saveCognitiveDraft('alice',{v:1,uid:'alice',scope:{kind:'personal'},text:'Other tab body',generation:null,image:null,imagePrompt:''},null);
  const other=structuredClone(state.records.get('alice'));fireEvent.click(screen.getByText('Flush'));await screen.findByRole('status');expect(state.records.get('alice')).toEqual(other);expect(screen.getByLabelText('Draft')).toHaveValue('Local unsaved body');
});
it('explicit discard requires confirmation, removes only the own record and resets the visible edit',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);render(<Editor/>);await ready();fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'Own body'}});fireEvent.click(screen.getByText('Flush'));await waitFor(()=>expect(state.records.has('alice')).toBe(true));state.records.set('bob',{synthetic:true});
  fireEvent.click(screen.getByText('Discard'));expect(state.records.has('alice')).toBe(true);confirm.mockReturnValue(true);fireEvent.click(screen.getByText('Discard'));await waitFor(()=>expect(state.records.has('alice')).toBe(false));expect(state.records.has('bob')).toBe(true);expect(screen.getByLabelText('Draft')).toHaveValue('');
});
it('an edit queued during a confirmed write is saved against that revision before both flushes return',async()=>{
  const {result}=renderHook(()=>useCognitiveDraft([]));await waitFor(()=>expect(result.current.ready).toBe(true));
  let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});state.casGate=()=>waiting;
  let first!:Promise<void>,second!:Promise<void>;
  act(()=>{result.current.setText('First durable body');});act(()=>{first=result.current.flush();});
  await waitFor(()=>expect(state.records.has('alice')).toBe(true));
  act(()=>{result.current.setText('Latest queued body');});act(()=>{second=result.current.flush();});
  state.casGate=undefined;await act(async()=>{release();await Promise.all([first,second]);});
  expect((await loadCognitiveDraft('alice')).draft?.text).toBe('Latest queued body');expect(result.current.dirty).toBe(false);
});
it('a failed readback retries the known committed revision without overwriting a foreign copy',async()=>{
  const {result}=renderHook(()=>useCognitiveDraft([]));await waitFor(()=>expect(result.current.ready).toBe(true));
  state.failAfterWrite=true;act(()=>{result.current.setText('Durable but unconfirmed body');});await act(async()=>{await result.current.flush();});
  expect(result.current.message).toContain('Mantém esta vista aberta');expect(result.current.dirty).toBe(true);expect(state.records.has('alice')).toBe(true);
  const committed=JSON.stringify(state.records.get('alice'));await act(async()=>{await result.current.flush();});
  expect(result.current.message).toBeNull();expect(result.current.dirty).toBe(false);expect(JSON.stringify(state.records.get('alice'))).not.toBe(committed);
  expect((await loadCognitiveDraft('alice')).draft?.text).toBe('Durable but unconfirmed body');
});
it('a generated result snapshots its image and exact baseline before caller mutation',async()=>{
  const {result}=renderHook(()=>useCognitiveDraft([]));await waitFor(()=>expect(result.current.ready).toBe(true));
  const generated={text:'Generated body',scope:{kind:'personal' as const},image:{mediaType:'image/png',provider:'synthetic',dataUrl:'data:image/png;base64,c3ludGhldGlj'},imagePrompt:'Image prompt',generation:{id,uid:'alice',personalRevisionBaseline:{...baseline}}};
  act(()=>{result.current.setGenerationResult(generated);});generated.generation.personalRevisionBaseline.revision=99;generated.image.dataUrl='changed';
  await act(async()=>{await result.current.flush();});const saved=(await loadCognitiveDraft('alice')).draft!;
  expect(saved.generation?.personalRevisionBaseline).toEqual(baseline);expect(saved.image?.dataUrl).toBe('data:image/png;base64,c3ludGhldGlj');expect(saved.text).toBe('Generated body');
});
it('a captured callback stays invalid after the team view changes and returns',async()=>{
  const {result,rerender}=renderHook(()=>useCognitiveDraft(state.teams as TeamRecord[]));await waitFor(()=>expect(result.current.ready).toBe(true));const captured=result.current.capture();expect(captured()).toBe(true);
  state.teams=[{id:'crew',memberUids:['alice'],wrappedKeys:{alice:{}},activeKeyEpoch:1,activeKeyId:'22222222-2222-4222-8222-222222222222',keyRotationStatus:'active'}];rerender();expect(captured()).toBe(false);
  await waitFor(()=>expect(result.current.ready).toBe(true));state.teams=[];rerender();await waitFor(()=>expect(result.current.ready).toBe(true));expect(captured()).toBe(false);
});
it('an edit callback stays invalid when text changes and returns to the submitted value',async()=>{
  const {result}=renderHook(()=>useCognitiveDraft([]));await waitFor(()=>expect(result.current.ready).toBe(true));act(()=>result.current.setText('Submitted body'));const captured=result.current.captureEdit();expect(captured()).toBe(true);act(()=>result.current.setText('New edit'));act(()=>result.current.setText('Submitted body'));expect(captured()).toBe(false);
});
it('a captured callback retires on role change even when membership and epoch are unchanged',async()=>{
  state.teams=[{id:'crew',memberUids:['alice'],roles:{alice:'admin'},wrappedKeys:{alice:{}},activeKeyEpoch:1,activeKeyId:'22222222-2222-4222-8222-222222222222',keyRotationStatus:'active'}];const {result,rerender}=renderHook(()=>useCognitiveDraft(state.teams as TeamRecord[]));await waitFor(()=>expect(result.current.ready).toBe(true));const captured=result.current.captureEdit();state.teams=[{...state.teams[0] as object,roles:{alice:'member'}}];rerender();expect(captured()).toBe(false);await waitFor(()=>expect(result.current.ready).toBe(true));
});
