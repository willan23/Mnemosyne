import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import type {User} from 'firebase/auth';
import type {SessionData} from './useSessions';
const state=vi.hoisted(()=>({uid:'alice',epoch:0,ready:true,alive:true,run:vi.fn(),key:vi.fn()}));
vi.mock('./useSyncFeedback',()=>({useSyncFeedback:()=>({epoch:state.epoch,capture:(uid:string)=>{const epoch=state.epoch;return()=>state.alive&&state.ready&&state.uid===uid&&state.epoch===epoch;}})}));
vi.mock('../services/semanticClusterRecovery',()=>({observeSemanticClusterRequests:()=>()=>{}}));
vi.mock('../services/semanticClusterMaintenance',()=>({runSemanticClusterMaintenance:state.run,semanticClusterMaintenanceKey:state.key}));
import {useSemanticClusterBackfill} from './useSemanticClusterBackfill';
const memories=[{id:'a',uid:'alice',text:'Synthetic',timestamp:1,updatedAt:1}] as SessionData[];
beforeEach(()=>{state.uid='alice';state.epoch=0;state.ready=true;state.alive=true;state.run.mockReset().mockResolvedValue(undefined);state.key.mockReset().mockImplementation((uid,sessions)=>JSON.stringify([uid,sessions.map(row=>row.id)]));});
it('passes all supplied memories once and does not duplicate a run on unrelated renders',async()=>{
  const {rerender}=renderHook(()=>useSemanticClusterBackfill({uid:'alice'} as User,memories,true));await waitFor(()=>expect(state.run).toHaveBeenCalledOnce());expect(state.run.mock.calls[0][1]).toBe(memories);rerender();await act(async()=>{});expect(state.run).toHaveBeenCalledOnce();
});
it('own snapshots do not retire an active batch; account generation changes retire its guard and start new scope after it finishes',async()=>{
  let finish!:()=>void;state.run.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));const {rerender}=renderHook(({uid,sessions})=>useSemanticClusterBackfill({uid} as User,sessions,true),{initialProps:{uid:'alice',sessions:memories}});await waitFor(()=>expect(state.run).toHaveBeenCalledOnce());const guard=state.run.mock.calls[0][2];rerender({uid:'alice',sessions:[...memories,{...memories[0],id:'b'}]});expect(()=>guard()).not.toThrow();expect(state.run).toHaveBeenCalledOnce();state.uid='bob';state.epoch++;rerender({uid:'bob',sessions:[{...memories[0],uid:'bob'}]});expect(()=>guard()).toThrow();await act(async()=>finish());await waitFor(()=>expect(state.run).toHaveBeenCalledTimes(2));expect(state.run.mock.calls[1][0]).toBe('bob');
});
it('closed or locked context does not start and an unmounted scope refuses late continuations',async()=>{
  state.ready=false;const {rerender,unmount}=renderHook(({enabled})=>useSemanticClusterBackfill({uid:'alice'} as User,memories,enabled),{initialProps:{enabled:false}});rerender({enabled:true});expect(state.run).not.toHaveBeenCalled();state.ready=true;state.epoch++;rerender({enabled:true});await waitFor(()=>expect(state.run).toHaveBeenCalledOnce());const guard=state.run.mock.calls[0][2];state.alive=false;unmount();expect(()=>guard()).toThrow();
});
