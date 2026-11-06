import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

it('waits for account admission before attaching workspace snapshots', () => {
  const { rerender } = renderHook(({ ready }) => useUniverseMemories(ready), { initialProps: { ready: false } });
  act(() => state.auth?.({ uid: 'alice' }));
  expect(state.listeners).toHaveLength(0);
  rerender({ ready: true });
  act(() => state.auth?.({ uid: 'alice' }));
  expect(state.listeners.length).toBeGreaterThan(0);
});

type SnapshotDoc = { id: string; data: () => Record<string, unknown> };
type SnapshotChange = { type: 'added' | 'modified' | 'removed'; doc: SnapshotDoc; oldIndex: number; newIndex: number };
type Snapshot = { readonly docs: SnapshotDoc[]; docChanges?: () => SnapshotChange[] };
type Secret = { text: string; locked: boolean };
const state = vi.hoisted(() => ({
  auth: null as null | ((user: { uid: string } | null) => void),
  crypto: null as null | (() => void),
  teams: [] as Array<(teams: Array<{ id: string }>) => void>,
  listeners: [] as Array<{ next: (snapshot: Snapshot) => void; error: () => void }>,
  resolve: vi.fn(), load: vi.fn(), loading: vi.fn(),
  apply:vi.fn(),capture:vi.fn(),create:vi.fn(),semantic:vi.fn(),
  legacy: vi.fn(), unlock: vi.fn(), notifyKeys: vi.fn(),
  mnemonic: null as string[] | null, cachedEpochs: new Set<string>(),
  keyChanged: null as null | (() => void),
}));
vi.mock('../firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: typeof state.auth) => {
  state.auth = callback; return () => undefined;
} }));
vi.mock('firebase/firestore', () => ({
  arrayUnion: vi.fn(), collection: vi.fn(), doc: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn(),
  query: vi.fn(), orderBy: vi.fn(), updateDoc: vi.fn(), where: vi.fn(), Timestamp: class {},
  onSnapshot: (_query: unknown, next: (snapshot: Snapshot) => void, error: () => void) => {
    let previous: SnapshotDoc[] = [];
    state.listeners.push({ next: incoming => {
      // Older tests provide a full view. Translate it into Firestore-style changes
      // with indices; explicit delta tests never read incoming.docs here.
      if (incoming.docChanges) { next(incoming); return; }
      const docs = incoming.docs, working = [...previous], changes: SnapshotChange[] = [];
      for (const old of previous) {
        if (docs.some(doc => doc.id === old.id)) continue;
        const oldIndex = working.findIndex(doc => doc.id === old.id);
        working.splice(oldIndex, 1);
        changes.push({ type: 'removed', doc: old, oldIndex, newIndex: -1 });
      }
      docs.forEach((doc, newIndex) => {
        const oldIndex = working.findIndex(old => old.id === doc.id);
        if (oldIndex === -1) {
          working.splice(newIndex, 0, doc);
          changes.push({ type: 'added', doc, oldIndex, newIndex });
        } else if (oldIndex !== newIndex || JSON.stringify(working[oldIndex].data()) !== JSON.stringify(doc.data())) {
          working.splice(oldIndex, 1);
          working.splice(newIndex, 0, doc);
          changes.push({ type: 'modified', doc, oldIndex, newIndex });
        }
      });
      previous = docs;
      next({ docs, docChanges: () => changes });
    }, error }); return () => undefined;
  },
}));
vi.mock('../store/universeStore', () => ({ useUniverseStore: () => ({ loadMemories: state.load, setIsLoading: state.loading }) }));
vi.mock('../services/memoryCrypto', () => ({
  MemoryCryptoLockedError: class extends Error {},
  isLegacyNestedMemoryCandidate: (...args: unknown[]) => state.legacy(...args),
  onMemoryCryptoChanged: (callback: () => void) => { state.crypto = callback; return () => undefined; },
}));
vi.mock('../services/sessionMemoryFields', () => ({
  buildSessionWriteFields: vi.fn(), parseSessionTeamId: (data: Record<string, unknown>) => data.teamId ?? null,
  resolveSessionSecretFields: (data: Record<string, unknown>) => state.resolve(data),
}));
vi.mock('../services/memoryEditRecovery',()=>({applyMemoryEdit:(...args:unknown[])=>state.apply(...args),captureMemoryEditBaseline:(...args:unknown[])=>state.capture(...args),memoryEditStateDigest:async()=> 'b'.repeat(64),MemoryEditError:class extends Error{constructor(){super('Synthetic baseline required');}}}));
vi.mock('../services/personalMemoryMutation',()=>({withPersonalMemoryMutation:async(_uid:string,work:(context:{assertCurrent:()=>void})=>Promise<unknown>)=>work({assertCurrent:()=>{}})}));
vi.mock('../services/attachedMemoryRecovery',()=>({createPersonalMemory:(...args:unknown[])=>state.create(...args)}));
vi.mock('../engines/CognitiveEngine',()=>({cognitiveEngine:{processMemory:(...args:unknown[])=>state.semantic(...args)}}));
vi.mock('../services/teamsService', () => ({ watchMyTeams: (_uid: string, callback: typeof state.teams[number]) => {
  state.teams.push(callback); return () => undefined;
} }));
vi.mock('../services/teamKeyAccess', () => ({ unlockMembershipTeamKeys: vi.fn(), unlockTeamKey: (...args: unknown[]) => state.unlock(...args) }));
vi.mock('../services/teamVault', () => ({ clearTeamKeyCache: vi.fn(),
  getCachedTeamKey: (teamId: string, epoch: number) => state.cachedEpochs.has(`${teamId}:${epoch}`) ? {} : null,
  notifyTeamKeysUpdated: () => state.notifyKeys(),
  onTeamKeyChanged: (callback: () => void) => { state.keyChanged = callback; return () => undefined; } }));
vi.mock('../utils/sessionMnemonic', () => ({ readSessionMnemonic: () => state.mnemonic }));

import { useUniverseMemories } from './useUniverseMemories';
import { IncrementalSessionSnapshot } from '../services/incrementalSessionSnapshot';
import { IndexedSemanticWriteIndex } from '../services/indexedSemanticWriteIndex';
import { selectSemanticWriteNeighbors } from '../services/semanticWriteClient';
import type { IndexedSemanticWriteMessage } from '../services/indexedSemanticWriteProtocol';
import { CURRENT_EMBEDDING_SPACE } from '../services/embeddingModel';
class HookIndexWorker extends EventTarget {
  index = new IndexedSemanticWriteIndex();
  terminate = vi.fn(() => this.index.clear());
  postMessage = vi.fn((message: IndexedSemanticWriteMessage) => { const data = { v: 1, seq: message.seq, ok: true, ...this.index.handle(structuredClone(message)) }; queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data }))); });
}
const snapshot = (id: string, teamId: string | null = null): Snapshot => ({
  docs: [{ id, data: () => ({ uid: 'alice', text: id, timestamp: 1, teamId }) }],
});
const document = (id: string, extra: Record<string, unknown> = {}): SnapshotDoc => ({
  id, data: () => ({ uid: 'alice', text: id, timestamp: 1, teamId: null, ...extra }),
});
const delta = (...changes: SnapshotChange[]): Snapshot => ({
  get docs(): SnapshotDoc[] { throw new Error('A delta must not scan snapshot.docs'); },
  docChanges: () => changes,
});
const lastMemories = () => state.load.mock.lastCall?.[0] as Array<{ id: string; text: string }>;
const lastIds = () => state.load.mock.lastCall?.[0].map((memory: { id: string }) => memory.id);
function pendingSecret() {
  let finish!: (secret: Secret) => void;
  state.resolve.mockImplementationOnce(() => new Promise<Secret>(resolve => { finish = resolve; }));
  return () => finish({ text: 'stale private text', locked: false });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.listeners = []; state.teams = [];
  state.mnemonic = null; state.cachedEpochs = new Set(); state.keyChanged = null;
  state.legacy.mockReset().mockImplementation(data => data.legacy === true);
  state.unlock.mockReset().mockImplementation(async (team, _uid, _mnemonic, options) => {
    if (options.isCurrent?.() === false) throw new Error('Synthetic membership revoked');
    state.cachedEpochs.add(`${team.id}:${options.epoch}`);
    return {};
  });
  state.resolve.mockReset().mockImplementation(async data => ({ text: data.text, locked: false }));
  state.apply.mockReset().mockImplementation(async input=>{input.assertCurrent();if(input.prepare)await input.prepare(input.assertCurrent);input.assertCurrent();return{status:'committed'};});state.capture.mockReset().mockImplementation(async input=>{input.assertCurrent();return base(input.id,input.teamId,input.expected.authorUid);});state.create.mockReset().mockResolvedValue({id:'actual-created-id'});state.semantic.mockReset().mockResolvedValue({embedding:[1],embeddingModel:'synthetic-local',semanticClusterId:'synthetic-cluster',position:[0,0,0],importance:.5,celestialType:'planet'});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const base=(id:string,teamId:string|null,authorUid='bob')=>({kind:teamId?'team' as const:'personal' as const,sessionId:id,teamId,authorUid,ownerUid:teamId?'owner':authorUid,stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:10,teamStateHash:teamId?'c'.repeat(64):null,epochStateHash:teamId?'d'.repeat(64):null,keyEpoch:teamId?1:null,keyId:teamId?'11111111-1111-4111-8111-111111111111':null,priorKeyEpoch:teamId?1:null,priorKeyId:teamId?'11111111-1111-4111-8111-111111111111':null});
it('routes team saves through the captured recoverable operation without direct SDK persistence or a new baseline', async () => {
  const view = renderHook(() => useUniverseMemories()); act(() => state.auth?.({ uid: 'alice' }));
  const memory = { id: 'team-memory', teamId: 'crew', uid: 'bob', text: 'synthetic', connections: [], persistedUpdatedAt: 10,persistedStateDigest:'b'.repeat(64) },baseline=base(memory.id,memory.teamId);
  await act(async () => view.result.current.saveMemory(memory as Parameters<typeof view.result.current.saveMemory>[0],{kind:'edit',baseline,title:null,metadata:{tags:['chosen']},refreshSemantic:false,assertCurrent:vi.fn()}));
  expect(state.apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ uid: 'alice', id: 'team-memory', teamId: 'crew',baseline,operation:'edit', prepare: expect.any(Function) }));expect(state.capture).not.toHaveBeenCalled();expect(state.semantic).not.toHaveBeenCalled();
});
it('refuses to re-encrypt locked team placeholders and propagates a fixed persistence failure', async () => {
  const view = renderHook(() => useUniverseMemories()); act(() => state.auth?.({ uid: 'alice' }));
  const memory = { id: 'team-memory', teamId: 'crew', uid: 'alice', text: 'synthetic', connections: [], encLocked: true };
  await expect(view.result.current.saveMemory(memory as Parameters<typeof view.result.current.saveMemory>[0])).rejects.toThrow('Não foi possível guardar a memória de equipa.');

});
it('routes deletion through the reviewed source and recoverable tombstone instead of re-reading a newer view', async () => {
  const view = renderHook(() => useUniverseMemories()); act(() => state.auth?.({ uid: 'alice' }));
  act(() => state.teams[0]([{ id: 'crew' }]));
  await act(async () => state.listeners.at(-1)!.next({ docs: [{ id: 'team-memory', data: () => ({
    uid: 'alice', teamId: 'crew', text: 'Synthetic', timestamp: 1, updatedAt: 10 }) }] }));
  const source={id:'team-memory',uid:'alice',teamId:'crew',text:'Synthetic',persistedTitle:null,persistedStateDigest:'b'.repeat(64)};
  state.apply.mockRejectedValueOnce(new Error('Synthetic permission failure'));
  await expect(view.result.current.deleteMemory('team-memory',source as Parameters<typeof view.result.current.deleteMemory>[1])).rejects.toThrow('Não foi possível apagar a memória.');
  expect(state.capture).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',id:source.id,viewDigest:source.persistedStateDigest,expected:{text:'Synthetic',title:null,authorUid:'alice'}}));expect(state.apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ uid: 'alice', id: 'team-memory', teamId: 'crew',operation:'delete' }));
});
it('an absent or incompatible baseline refuses inference and admission for an existing memory',async()=>{const view=renderHook(()=>useUniverseMemories());act(()=>state.auth?.({uid:'alice'}));const memory={id:'team-memory',uid:'alice',teamId:'crew',text:'Synthetic',connections:[],persistedStateDigest:'b'.repeat(64)};await expect(view.result.current.saveMemory(memory as Parameters<typeof view.result.current.saveMemory>[0])).rejects.toThrow();expect(state.apply).not.toHaveBeenCalled();expect(state.semantic).not.toHaveBeenCalled();});
it('local semantic refresh uses the indexed source, excludes other scopes and does not write inferred reciprocal edges',async()=>{
  const worker=new HookIndexWorker();vi.stubGlobal('Worker',vi.fn(function(){return worker;}));
  const view=renderHook(()=>useUniverseMemories());act(()=>state.auth?.({uid:'alice'}));
  await act(async()=>state.listeners[0].next({docs:[document('allowed',{embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE}),document('foreign',{uid:'bob',embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE})]}));
  let ids:string[]|undefined;state.semantic.mockImplementation(async(_text,source,options)=>{const result=await selectSemanticWriteNeighbors([1,0],source,options);ids=result.neighbors.map(row=>row.candidate.id);return{embedding:[1],embeddingModel:'synthetic-local'};});
  const memory={id:'edited',uid:'alice',text:'New text',connections:[],persistedStateDigest:'b'.repeat(64)};
  await view.result.current.saveMemory(memory as Parameters<typeof view.result.current.saveMemory>[0],{kind:'edit',baseline:base('edited',null,'alice'),title:null,metadata:{},refreshSemantic:true,assertCurrent:()=>{}});
  expect(ids).toEqual(['allowed']);const content=await state.apply.mock.calls[0][0].prepare(()=>{});expect(content.metadata).toMatchObject({embedding:[1],processingMethod:'universe:manual-edit+local-embedding'});expect(content.metadata.connections).toBeUndefined();
  expect(worker.postMessage.mock.calls.filter(([message])=>message.type==='init')).toHaveLength(1);view.unmount();expect(worker.terminate).toHaveBeenCalledOnce();
});
it('published capture uses the ascending winning view, while personal and team edits keep their own listener variants',async()=>{
  const worker=new HookIndexWorker();vi.stubGlobal('Worker',vi.fn(function(){return worker;}));
  const view=renderHook(()=>useUniverseMemories());act(()=>state.auth?.({uid:'alice'}));
  const vector={embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE};
  await act(async()=>state.listeners[0].next({docs:[document('same',{...vector,text:'Personal variant',timestamp:3}),document('personal',{...vector,timestamp:2})]}));
  await act(async()=>state.listeners[1].next({docs:[document('same',{...vector,text:'Legacy variant',timestamp:3}),document('legacy',{...vector,timestamp:1})]}));
  act(()=>state.teams[0]([{id:'crew'}]));await act(async()=>state.listeners[2].next({docs:[document('same',{...vector,uid:'bob',teamId:'crew',text:'Team variant',timestamp:3})]}));
  const source=state.load.mock.lastCall![0];const capture=await selectSemanticWriteNeighbors([1,0],source,{eligible:(await import('../services/semanticWriteScope')).semanticCandidateEligibility('alice')});
  expect(capture.neighbors.map(row=>row.candidate.id)).toEqual(['legacy','personal']);
  const observed:Array<{ids:string[];text:unknown}>=[];state.semantic.mockImplementation(async(_text,candidates,options)=>{const result=await selectSemanticWriteNeighbors([1,0],candidates,options);observed.push({ids:result.neighbors.map(row=>row.candidate.id),text:(result.neighbors[0]?.candidate as {text?:string})?.text});return{embedding:[1,0],embeddingModel:CURRENT_EMBEDDING_SPACE};});
  for(const teamId of [undefined,'crew']){const memory={id:'edited',uid:teamId?'bob':'alice',teamId,text:'Synthetic edit',connections:[],persistedStateDigest:'b'.repeat(64)};
    await view.result.current.saveMemory(memory as Parameters<typeof view.result.current.saveMemory>[0],{kind:'edit',baseline:base(memory.id,teamId??null,memory.uid),title:null,metadata:{},refreshSemantic:true,assertCurrent:()=>{}});}
  expect(observed).toEqual([{ids:['same','personal'],text:'Personal variant'},{ids:['same'],text:'Team variant'}]);expect(worker.postMessage.mock.calls.filter(([message])=>message.type==='init')).toHaveLength(1);
  const before=worker.postMessage.mock.calls.length;await act(async()=>state.listeners[0].next(delta({type:'modified',doc:document('personal',{...vector,timestamp:2,text:'Changed'}),oldIndex:1,newIndex:1})));
  await selectSemanticWriteNeighbors([1,0],state.load.mock.lastCall![0],{eligible:(await import('../services/semanticWriteScope')).semanticCandidateEligibility('alice')});
  expect(worker.postMessage.mock.calls.slice(before).flatMap(([message])=>message.type==='patch-chunk'?message.changed.map(row=>row.id):[])).toEqual(['personal']);
  act(()=>state.crypto?.());expect(worker.terminate).toHaveBeenCalledOnce();view.unmount();
});
it('refuses a semantic edit when a newer snapshot changes its candidate cohort during inference',async()=>{
  const view=renderHook(()=>useUniverseMemories());act(()=>state.auth?.({uid:'alice'}));
  await act(async()=>state.listeners[0].next(snapshot('allowed')));
  let finish!:(value:unknown)=>void;state.semantic.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const committed=vi.fn();state.apply.mockImplementation(async input=>{input.assertCurrent();await input.prepare(input.assertCurrent);committed();return{status:'committed'};});
  const memory={id:'edited',uid:'alice',text:'New text',connections:[],persistedStateDigest:'b'.repeat(64)};
  const pending=view.result.current.saveMemory(memory as Parameters<typeof view.result.current.saveMemory>[0],{kind:'edit',baseline:base('edited',null,'alice'),title:null,metadata:{},refreshSemantic:true,assertCurrent:()=>{}});
  const rejected=expect(pending).rejects.toThrow('Não foi possível guardar a memória.');
  await waitFor(()=>expect(finish).toBeDefined());
  await act(async()=>state.listeners[0].next(snapshot('replacement')));
  finish({embedding:[1],embeddingModel:'synthetic-local'});await rejected;
  expect(committed).not.toHaveBeenCalled();
});
it('explicit creation uses the confirmed generated ID and fails when its account changes during acknowledgement',async()=>{const view=renderHook(()=>useUniverseMemories());act(()=>state.auth?.({uid:'alice'}));const memory={id:'local-placeholder',uid:'alice',text:'Synthetic new capture',connections:[],embedding:[],position:[0,0,0],importance:.5,celestialType:'planet'};expect(await view.result.current.saveMemory(memory as Parameters<typeof view.result.current.saveMemory>[0],{kind:'create',assertCurrent:()=>{}})).toEqual({id:'actual-created-id'});state.create.mockImplementationOnce(async()=>{state.auth?.({uid:'bob'});return{id:'wrong-account-completion'};});await expect(view.result.current.saveMemory(memory as Parameters<typeof view.result.current.saveMemory>[0],{kind:'create',assertCurrent:()=>{}})).rejects.toThrow();});
it('a personal tombstone prevents a nested legacy shadow from resurrecting the same ID and is UID scoped',async()=>{renderHook(()=>useUniverseMemories());act(()=>state.auth?.({uid:'alice'}));await act(async()=>state.listeners[1].next(snapshot('same-id')));expect(lastIds()).toEqual(['same-id']);await act(async()=>state.listeners[0].next({docs:[{id:'same-id',data:()=>({uid:'alice',teamId:null,timestamp:1,deletedAt:20})}]}));expect(lastIds()).toEqual([]);await act(async()=>state.listeners[1].next(snapshot('same-id')));expect(lastIds()).toEqual([]);act(()=>state.auth?.({uid:'bob'}));await act(async()=>state.listeners[3].next(snapshot('same-id')));expect(lastIds()).toEqual(['same-id']);});
it('refuses saves and deletions after logout instead of acknowledging an operation that was never sent', async () => {
  const view = renderHook(() => useUniverseMemories()); act(() => state.auth?.(null));
  await expect(view.result.current.saveMemory({ id: 'memory' } as Parameters<typeof view.result.current.saveMemory>[0])).rejects.toThrow('Conta indisponível');
  await expect(view.result.current.deleteMemory('memory')).rejects.toThrow('Conta indisponível');

});

it.each([0, 1])('never republishes personal/legacy decryption after account change (listener %s)', async index => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[index].next(snapshot('loaded')));
  expect(lastIds()).toEqual(['loaded']);
  const finish = pendingSecret();
  act(() => state.listeners[index].next(snapshot('pending')));
  act(() => state.auth?.({ uid: 'bob' }));
  expect(lastIds()).toEqual([]);
  await act(async () => finish());
  expect(lastIds()).toEqual([]);
});

it.each([0, 1])('clears denied subscriptions and rejects late completions (listener %s)', async index => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[index].next(snapshot('loaded')));
  const finish = pendingSecret();
  act(() => state.listeners[index].next(snapshot('pending')));
  act(() => state.listeners[index].error());
  expect(lastIds()).toEqual([]);
  await act(async () => finish());
  expect(lastIds()).toEqual([]);
});

it('invalidates prior generations on vault refresh, logout and unmount', async () => {
  const view = renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  const finish = pendingSecret();
  act(() => state.listeners[0].next(snapshot('pending')));
  act(() => state.crypto?.());
  await act(async () => finish());
  expect(lastIds()).toEqual([]);
  await act(async () => state.listeners[2].next(snapshot('current')));
  expect(lastIds()).toEqual(['current']);
  act(() => state.auth?.(null));
  expect(lastIds()).toEqual([]);
  view.unmount();
  const count = state.load.mock.calls.length;
  await act(async () => state.listeners[2].next(snapshot('after-unmount')));
  expect(state.load).toHaveBeenCalledTimes(count);
});

it('prevents an old team listener from republishing after membership replacement', async () => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  act(() => state.teams[0]([{ id: 'crew' }]));
  await act(async () => state.listeners[2].next(snapshot('loaded', 'crew')));
  const finish = pendingSecret();
  act(() => state.listeners[2].next(snapshot('pending', 'crew')));
  act(() => state.teams[0]([]));
  expect(lastIds()).toEqual([]);
  act(() => state.teams[0]([{ id: 'crew' }]));
  await act(async () => state.listeners[3].next(snapshot('new-membership', 'crew')));
  await act(async () => finish());
  expect(lastIds()).toEqual(['new-membership']);
  act(() => state.listeners[3].error());
  expect(lastIds()).toEqual([]);
});

it('maps only changed personal documents and keeps unchanged objects across delta snapshots', async () => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[0].next({ docs: [document('a'), document('b')] }));
  const original = lastMemories();
  expect(state.resolve).toHaveBeenCalledTimes(2);

  await act(async () => state.listeners[0].next(delta({
    type: 'modified', doc: document('b', { text: 'Changed b', timestamp: 2 }), oldIndex: 1, newIndex: 0,
  })));
  expect(state.resolve).toHaveBeenCalledTimes(3);
  expect(lastIds()).toEqual(['a', 'b']);
  expect(lastMemories()[0]).toBe(original[0]);
  expect(lastMemories()[1]).not.toBe(original[1]);
  expect(lastMemories()[1].text).toBe('Changed b');
});

it('preserves snapshot order for timestamp ties after a moved document', async () => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[0].next({ docs: [document('a'), document('b'), document('c')] }));
  const original = lastMemories();
  await act(async () => state.listeners[0].next(delta({
    type: 'modified', doc: document('c', { text: 'Moved c' }), oldIndex: 2, newIndex: 0,
  })));

  expect(lastIds()).toEqual(['c', 'a', 'b']);
  expect(lastMemories()[1]).toBe(original[0]);
  expect(lastMemories()[2]).toBe(original[1]);
  expect(state.resolve).toHaveBeenCalledTimes(4);
});

it('keeps legacy/personal/team precedence and the first-origin tie position through deltas', async () => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[1].next({ docs: [
    document('shared', { text: 'Legacy shared' }), document('legacy-only'),
  ] }));
  await act(async () => state.listeners[0].next({ docs: [
    document('personal-only'), document('shared', { text: 'Personal shared' }),
  ] }));
  act(() => state.teams[0]([{ id: 'crew' }]));
  await act(async () => state.listeners[2].next({ docs: [
    document('shared', { text: 'Team shared', teamId: 'crew' }), document('team-only', { teamId: 'crew' }),
  ] }));
  expect(lastIds()).toEqual(['shared', 'legacy-only', 'personal-only', 'team-only']);
  expect(lastMemories()[0].text).toBe('Team shared');

  await act(async () => state.listeners[2].next(delta({
    type: 'removed', doc: document('shared', { teamId: 'crew' }), oldIndex: 0, newIndex: -1,
  })));
  expect(lastIds()).toEqual(['shared', 'legacy-only', 'personal-only', 'team-only']);
  expect(lastMemories()[0].text).toBe('Personal shared');
  await act(async () => state.listeners[0].next(delta({
    type: 'modified', doc: document('shared', { text: 'New personal shared' }), oldIndex: 1, newIndex: 0,
  })));
  expect(lastIds()).toEqual(['shared', 'legacy-only', 'personal-only', 'team-only']);
  expect(lastMemories()[0].text).toBe('New personal shared');
});

it('preserves tombstones through failure/refresh and reconciles confirmed reset, undelete and removal deltas', async () => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[1].next(snapshot('same-id')));
  await act(async () => state.listeners[0].next({ docs: [document('same-id', { deletedAt: 20 })] }));
  expect(lastIds()).toEqual([]);
  act(() => state.listeners[0].error());
  await act(async () => state.listeners[1].next(delta({
    type: 'modified', doc: document('same-id', { text: 'Legacy shadow changed' }), oldIndex: 0, newIndex: 0,
  })));
  expect(lastIds()).toEqual([]);

  act(() => state.crypto?.());
  await act(async () => state.listeners[3].next(snapshot('same-id')));
  expect(lastIds()).toEqual([]);
  await act(async () => state.listeners[2].next({ docs: [] }));
  expect(lastIds()).toEqual(['same-id']);
  await act(async () => state.listeners[2].next(delta({
    type: 'added', doc: document('same-id', { deletedAt: 30 }), oldIndex: -1, newIndex: 0,
  })));
  expect(lastIds()).toEqual([]);
  await act(async () => state.listeners[2].next(delta({
    type: 'modified', doc: document('same-id', { deletedAt: null, text: 'Undeleted root' }), oldIndex: 0, newIndex: 0,
  })));
  expect(lastMemories()[0].text).toBe('Undeleted root');
  await act(async () => state.listeners[2].next(delta({
    type: 'modified', doc: document('same-id', { deletedAt: 40 }), oldIndex: 0, newIndex: 0,
  })));
  expect(lastIds()).toEqual([]);
  const mapped = state.resolve.mock.calls.length;
  await act(async () => state.listeners[2].next(delta({
    type: 'removed', doc: document('same-id', { deletedAt: 40 }), oldIndex: 0, newIndex: -1,
  })));
  expect(state.resolve).toHaveBeenCalledTimes(mapped);
  expect(lastIds()).toEqual(['same-id']);
  act(() => state.auth?.({ uid: 'bob' }));
  await act(async () => state.listeners[5].next(snapshot('same-id')));
  expect(lastIds()).toEqual(['same-id']);
});

it('keeps the original deletedAt zero visibility while excluding its legacy shadow', async () => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[1].next({ docs: [document('same-id', { text: 'Legacy shadow' })] }));
  await act(async () => state.listeners[0].next({ docs: [document('same-id', { deletedAt: 0, text: 'Root zero marker' })] }));
  expect(lastIds()).toEqual(['same-id']);
  expect(lastMemories()[0].text).toBe('Root zero marker');
  act(() => state.listeners[0].error());
  expect(lastIds()).toEqual([]);
});

it('maintains the legacy plaintext count from changed and removed documents only', async () => {
  const view = renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[1].next({ docs: [
    document('a', { legacy: true }), document('b', { legacy: false }),
  ] }));
  expect(view.result.current.legacyPlaintextCount).toBe(1);
  await act(async () => state.listeners[1].next(delta({
    type: 'modified', doc: document('b', { legacy: true }), oldIndex: 1, newIndex: 1,
  })));
  expect(view.result.current.legacyPlaintextCount).toBe(2);
  await act(async () => state.listeners[1].next(delta({
    type: 'removed', doc: document('a', { legacy: true }), oldIndex: 0, newIndex: -1,
  })));
  expect(view.result.current.legacyPlaintextCount).toBe(1);
  await act(async () => state.listeners[1].next(delta({
    type: 'modified', doc: document('b', { legacy: false }), oldIndex: 0, newIndex: 0,
  })));
  expect(view.result.current.legacyPlaintextCount).toBe(0);
  expect(state.legacy).toHaveBeenCalledTimes(4);
  act(() => state.listeners[1].error());
  expect(view.result.current.legacyPlaintextCount).toBe(0);
});

it('commits accumulated changes and movements when an older callback finishes late', async () => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[0].next({ docs: [document('a'), document('b')] }));
  let finish!: (secret: Secret) => void;
  state.resolve.mockImplementationOnce(() => new Promise<Secret>(resolve => { finish = resolve; }));
  act(() => state.listeners[0].next(delta({
    type: 'modified', doc: document('a', { text: 'New a' }), oldIndex: 0, newIndex: 0,
  })));
  act(() => state.listeners[0].next(delta({
    type: 'modified', doc: document('b', { text: 'New b' }), oldIndex: 1, newIndex: 0,
  })));
  await act(async () => finish({ text: 'New a', locked: false }));

  expect(lastIds()).toEqual(['b', 'a']);
  expect(lastMemories().map(memory => memory.text)).toEqual(['New b', 'New a']);
  expect(state.resolve).toHaveBeenCalledTimes(4);
});

it('does not restore a pending changed document that a newer delta removed', async () => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[0].next({ docs: [document('a'), document('b')] }));
  const finish = pendingSecret();
  act(() => state.listeners[0].next(delta({
    type: 'modified', doc: document('a', { text: 'Pending a' }), oldIndex: 0, newIndex: 0,
  })));
  await act(async () => state.listeners[0].next(delta({
    type: 'removed', doc: document('a'), oldIndex: 0, newIndex: -1,
  })));
  expect(lastIds()).toEqual(['b']);
  const published = state.load.mock.calls.length;
  await act(async () => finish());
  expect(lastIds()).toEqual(['b']);
  expect(state.load).toHaveBeenCalledTimes(published);
});

it('unlocks only mapped historical epochs and deduplicates each outstanding epoch promise', async () => {
  renderHook(() => useUniverseMemories());
  state.mnemonic = Array.from({ length: 12 }, () => 'synthetic');
  const finishes = new Map<number, () => void>();
  state.unlock.mockImplementation((team, _uid, _mnemonic, options) => new Promise<void>(resolve => {
    finishes.set(options.epoch, () => { state.cachedEpochs.add(`${team.id}:${options.epoch}`); resolve(); });
  }));
  act(() => state.auth?.({ uid: 'alice' }));
  act(() => state.teams[0]([{ id: 'crew' }]));
  act(() => state.listeners[2].next({ docs: [
    document('a', { teamId: 'crew', keyEpoch: 2 }), document('b', { teamId: 'crew', keyEpoch: 2 }),
    document('c', { teamId: 'crew', keyEpoch: 3 }), document('deleted', { teamId: 'crew', keyEpoch: 4, deletedAt: 20 }),
  ] }));
  expect(state.unlock.mock.calls.map(call => call[3].epoch)).toEqual([2, 3]);
  await act(async () => { finishes.get(2)!(); finishes.get(3)!(); });
  expect(lastIds()).toEqual(['a', 'b', 'c']);
  expect(state.resolve).toHaveBeenCalledTimes(3);
  expect(state.notifyKeys).toHaveBeenCalledOnce();

  await act(async () => state.listeners[2].next(delta({
    type: 'added', doc: document('d', { teamId: 'crew', keyEpoch: 2 }), oldIndex: -1, newIndex: 3,
  })));
  expect(state.unlock).toHaveBeenCalledTimes(2);
  expect(state.resolve).toHaveBeenCalledTimes(4);
  expect(lastIds()).toEqual(['a', 'b', 'c', 'd']);
});

it('does not map a historical epoch completion after membership removal', async () => {
  renderHook(() => useUniverseMemories());
  state.mnemonic = Array.from({ length: 12 }, () => 'synthetic');
  let finish!: () => void;
  state.unlock.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  act(() => state.auth?.({ uid: 'alice' }));
  act(() => state.teams[0]([{ id: 'crew' }]));
  act(() => state.listeners[2].next({ docs: [document('a', { teamId: 'crew', keyEpoch: 2 })] }));
  const guard = state.unlock.mock.calls[0][3].isCurrent;
  act(() => state.teams[0]([]));
  expect(guard()).toBe(false);
  await act(async () => finish());
  expect(lastIds()).toEqual([]);
  expect(state.resolve).not.toHaveBeenCalled();
});

it('rebuilds a denied team listener from a fresh cache instead of reusing decrypted objects', async () => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  act(() => state.teams[0]([{ id: 'crew' }]));
  await act(async () => state.listeners[2].next(snapshot('a', 'crew')));
  const before = lastMemories()[0];
  act(() => state.listeners[2].error());
  expect(lastIds()).toEqual([]);
  await act(async () => state.listeners[2].next(snapshot('a', 'crew')));
  expect(lastIds()).toEqual(['a']);
  expect(lastMemories()[0]).not.toBe(before);
  expect(state.resolve).toHaveBeenCalledTimes(2);
});

it.each([0, 1, 2])('resets the old listener cache before replacing a denied bucket (%s)', async index => {
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  if (index === 2) act(() => state.teams[0]([{ id: 'crew' }]));
  await act(async () => state.listeners[index].next(snapshot('loaded', index === 2 ? 'crew' : null)));
  const reset = vi.spyOn(IncrementalSessionSnapshot.prototype, 'reset');
  act(() => state.listeners[index].error());
  expect(reset).toHaveBeenCalledOnce();
});

it('resets active caches on membership replacement, key refresh, account change and unmount', () => {
  const reset = vi.spyOn(IncrementalSessionSnapshot.prototype, 'reset');
  const view = renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  act(() => state.teams[0]([{ id: 'crew' }]));
  act(() => state.teams[0]([{ id: 'crew' }]));
  expect(reset).toHaveBeenCalledTimes(1);
  act(() => state.crypto?.());
  expect(reset).toHaveBeenCalledTimes(4);
  act(() => state.auth?.({ uid: 'bob' }));
  expect(reset).toHaveBeenCalledTimes(6);
  view.unmount();
  expect(reset).toHaveBeenCalledTimes(8);
});

const largeDocuments = () => Array.from({ length: 300 }, (_, index) =>
  document(`large-${index}`, { timestamp: 300 - index }));

it.each(['key-refresh', 'account-change', 'logout', 'unmount'] as const)(
  'retires a yielding publication synchronously on %s', async reason => {
    vi.useFakeTimers();
    const view = renderHook(() => useUniverseMemories());
    act(() => state.auth?.({ uid: 'alice' }));
    await act(async () => state.listeners[0].next({ docs: largeDocuments() }));
    expect(state.resolve).toHaveBeenCalledTimes(300);
    expect(lastIds()).toEqual([]);

    act(() => {
      if (reason === 'key-refresh') state.crypto?.();
      else if (reason === 'account-change') state.auth?.({ uid: 'bob' });
      else if (reason === 'logout') state.auth?.(null);
      else view.unmount();
    });
    expect(lastIds()).toEqual([]);
    const retiredAt = state.load.mock.calls.length;
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(state.load).toHaveBeenCalledTimes(retiredAt);
    expect(lastIds()).toEqual([]);
  },
);

it.each(['membership', 'listener-error'] as const)(
  'removes revoked team rows immediately while a large replacement view yields (%s)', async reason => {
    vi.useFakeTimers();
    renderHook(() => useUniverseMemories());
    act(() => state.auth?.({ uid: 'alice' }));
    await act(async () => state.listeners[0].next({ docs: largeDocuments() }));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(lastMemories()).toHaveLength(300);
    act(() => state.teams[0]([{ id: 'crew' }]));
    await act(async () => state.listeners[2].next(snapshot('team-private', 'crew')));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(lastIds()).toContain('team-private');

    act(() => {
      if (reason === 'membership') state.teams[0]([]);
      else state.listeners[2].error();
    });
    expect(lastIds()).toEqual([]);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(lastMemories()).toHaveLength(300);
    expect(lastIds()).not.toContain('team-private');
  },
);

it('delivers only the latest delta when a prior large publication is yielding', async () => {
  vi.useFakeTimers();
  renderHook(() => useUniverseMemories());
  act(() => state.auth?.({ uid: 'alice' }));
  await act(async () => state.listeners[0].next({ docs: largeDocuments() }));
  await act(async () => state.listeners[0].next(delta({
    type: 'modified', doc: document('large-299', { timestamp: 0, text: 'Latest large row' }), oldIndex: 299, newIndex: 299,
  })));
  await act(async () => { await vi.runAllTimersAsync(); });

  const completeViews = state.load.mock.calls.filter(call => call[0].length === 300);
  expect(completeViews).toHaveLength(1);
  expect(lastMemories()[0]).toMatchObject({ id: 'large-299', text: 'Latest large row' });
  expect(state.resolve).toHaveBeenCalledTimes(301);
});
