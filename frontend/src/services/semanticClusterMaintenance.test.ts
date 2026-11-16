import {expect,it,vi} from 'vitest';
vi.mock('./semanticClusterRecovery',()=>({applySemanticClusterBatch:vi.fn(),hasPendingSemanticClusters:vi.fn(),prepareSemanticClusterComponent:vi.fn(),semanticClusterWritesEnabled:()=>false}));
import type {SessionData} from '../hooks/useSessions';
import {runSemanticClusterMaintenance,semanticClusterMaintenancePlan} from './semanticClusterMaintenance';
const memory=(id:string,extra:Partial<SessionData>={}):SessionData=>({id,uid:'alice',text:'Synthetic',timestamp:1,updatedAt:1,semanticGraphHash:'a'.repeat(64),connections:[],...extra});
it('groups full components by personal or team scope and excludes foreign shared ambiguous locked and unverified memories',()=>{
  const plan=semanticClusterMaintenancePlan('alice',[memory('a',{connections:['b','team']}),memory('b',{semanticClusterId:'kept'}),memory('team',{teamId:'crew',uid:'bob',connections:['a']}),memory('other',{teamId:'other',uid:'owner'}),memory('foreign',{uid:'bob'}),memory('shared',{sharedWithIds:['bob']}),memory('bad',{teamScopeAmbiguous:true}),memory('unknown',{semanticGraphHash:undefined}),memory('locked',{encLocked:true})]);
  expect(plan.map(component=>[component.teamId,component.graphs.map(row=>row.id)])).toEqual([[null,['a','b']],['crew',['team']],['other',['other']]]);
});
it('prepares once before calculation and carries only own confirmed versions through 100-item batches',async()=>{
  const memories=Array.from({length:205},(_,index)=>memory('n'+String(index).padStart(3,'0'),{connections:index?['n'+String(index-1).padStart(3,'0')]:[]}));
  const prepared={authority:{teamId:null,ownerUid:'alice',teamStateHash:null,epochStateHash:null,keyEpoch:null,keyId:null},dependencies:memories.map(row=>({sessionId:row.id,authorUid:'alice',stateHash:'a'.repeat(64)}))};
  const prepare=vi.fn(async()=>({prepared,patches:memories.map(row=>({sessionId:row.id,semanticClusterId:'same'}))})),apply=vi.fn(async(_uid,base,patches)=>{if(apply.mock.calls.length>1){expect(base.dependencies[0].stateHash).toBe('b'.repeat(64));expect(base.dependencies[204].stateHash).toBe('a'.repeat(64));}return{status:'committed',dependencyUpdates:patches.map(row=>({sessionId:row.sessionId,stateHash:'b'.repeat(64)}))};});
  await runSemanticClusterMaintenance('alice',memories,()=>{},{enabled:()=>true,pending:async()=>false,prepare,apply} as never);expect(prepare).toHaveBeenCalledOnce();expect(apply.mock.calls.map(call=>call[2].length)).toEqual([100,100,5]);expect(prepared.dependencies[0].stateHash).toBe('a'.repeat(64));
});
it('a pending journal or context change prevents further preparation and batches',async()=>{
  const prepare=vi.fn(),apply=vi.fn();await expect(runSemanticClusterMaintenance('alice',[memory('a')],()=>{},{enabled:()=>true,pending:async()=>true,prepare,apply} as never)).rejects.toThrow('confirmação');expect(prepare).not.toHaveBeenCalled();
  await expect(runSemanticClusterMaintenance('alice',[memory('a')],()=>{throw Error('Retired');},{enabled:()=>true,pending:async()=>false,prepare,apply} as never)).rejects.toThrow('Retired');expect(apply).not.toHaveBeenCalled();
});
