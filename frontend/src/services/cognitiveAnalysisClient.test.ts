import {expect,it,vi} from 'vitest';
import type {SessionData} from '../hooks/useSessions';
import {CognitiveAnalysisClient} from './cognitiveAnalysisClient';
import {CognitiveAnalysisWorkerMock} from '../test/cognitiveAnalysisWorkerMock';
import {IncrementalMemoryPublication} from './incrementalMemoryPublication';
import {canReadCachedMemory} from './memoryReadScope';
import {generateCognitiveInsights} from './insightEngine';
import {buildCognitivePulse} from './cognitivePulse';
const now=1_700_000_000_000,scope={uid:'synthetic-actor',teamIds:new Set(['synthetic-crew'])};
const memory=(id:string,extra:Partial<SessionData>={}):SessionData=>({id,uid:scope.uid,text:'Synthetic soberania contextual privada de conhecimento.',timestamp:now-40*86400000,updatedAt:now-40*86400000,tags:[],connections:[],embedding:[],...extra});
const signal=()=>new AbortController().signal;
function fixture(){const workers:CognitiveAnalysisWorkerMock[]=[],client=new CognitiveAnalysisClient(scope,{yieldTask:async()=>{},createWorker:()=>{const worker=new CognitiveAnalysisWorkerMock();workers.push(worker);return worker as unknown as Worker;}});return{client,workers};}
const frames=(worker:CognitiveAnalysisWorkerMock)=>worker.postMessage.mock.calls.map(([value])=>value);
it('applies ACL before reading content/vectors, sends only authorized fields and checks current references after retrieval',async()=>{
  const allowed=[memory('personal'),memory('team',{uid:'other',teamId:'synthetic-crew'}),memory('shared',{uid:'other',sharedWithIds:[scope.uid]})];
  const denied=[memory('DENIED-foreign',{uid:'other'}),memory('DENIED-team',{teamId:'revoked'}),memory('DENIED-ambiguous',{teamScopeAmbiguous:true}),memory('DENIED-locked',{encLocked:true}),memory('DENIED-deleted',{deletedAt:1})];
  for(const row of denied)for(const key of ['text','title','embedding'])Object.defineProperty(row,key,{get(){throw Error('Read content without access');}});
  const {client,workers}=fixture();let active=true;const guard=()=>{if(!active)throw Error('Synthetic scope retired');};
  try{const result=await client.select([...allowed,...denied],'pulse',signal(),guard,now);expect(result.analysis).toEqual({mode:'pulse',pulse:buildCognitivePulse(allowed,now)});expect(result.getMemory('personal')).toBe(allowed[0]);expect(result.getMemory('DENIED-team')).toBeUndefined();
    const serialized=JSON.stringify(frames(workers[0]));expect(serialized).not.toContain('DENIED-');expect(serialized).not.toContain(scope.uid);expect(serialized).not.toContain('synthetic-crew');
    const docs=frames(workers[0]).flatMap(frame=>frame.type==='patch-chunk'?frame.frame.changed??[]:[]);expect(docs.map(row=>row.id)).toEqual(allowed.map(row=>row.id));for(const row of docs)expect(Object.keys(row).sort()).toEqual(['id','text','title','timestamp','updatedAt','tags','connections','embedding','embeddingModel'].sort());
    active=false;expect(result.getMemory('personal')).toBeUndefined();expect(workers[0].terminate).toHaveBeenCalledOnce();
  }finally{client.dispose();}
});
it('projects one warm changed row without iterating the source and preserves order through an eligibility transition',async()=>{
  let reads=0;const rows=Array.from({length:1000},(_,at)=>memory('m'+at,{timestamp:at,get text(){reads++;return'Synthetic contextual privada knowledge';}}));
  const publisher=new IncrementalMemoryPublication<SessionData>('asc');publisher.apply('source',{changed:rows.map(value=>({id:value.id,value})),removed:[],order:{reset:rows.map(row=>row.id),changes:[]}});
  const {client,workers}=fixture();try{await client.select(publisher.snapshot(),'insights',signal(),undefined,now);reads=0;workers[0].postMessage.mockClear();
    const iterator=vi.spyOn(Object.getPrototypeOf(publisher.snapshot()),Symbol.iterator).mockImplementation(()=>{throw Error('Enumerated warm root');});
    try{const updated=memory('m900',{timestamp:-1,get text(){reads++;return'Synthetic new contextual privada hypothesis';}});publisher.apply('source',{changed:[{id:updated.id,value:updated}],removed:[],order:{changes:[]}});
      const result=await client.select(publisher.snapshot(),'insights',signal(),undefined,now);expect(reads).toBe(1);expect(result.getMemory('m900')).toBe(updated);
      const docs=frames(workers[0]).flatMap(frame=>frame.type==='patch-chunk'?frame.frame.changed??[]:[]);expect(docs.map(row=>row.id)).toEqual(['m900']);expect(frames(workers[0]).some(frame=>frame.type==='patch-chunk'&&frame.frame.order)).toBe(false);
      const hidden={...updated,encLocked:true};publisher.apply('source',{changed:[{id:hidden.id,value:hidden}],removed:[],order:{changes:[]}});const next=await client.select(publisher.snapshot(),'insights',signal(),undefined,now);expect(next.analysis).toMatchObject({counts:{total:999}});expect(next.getMemory('m900')).toBeUndefined();expect(result.getMemory('m1')).toBeUndefined();
    }finally{iterator.mockRestore();}
  }finally{client.dispose();publisher.clear();}
});
it('matches authorized materialized oracles across mixed deltas, source reorders and eligibility changes',async()=>{
  const publisher=new IncrementalMemoryPublication<SessionData>('asc'),{client}=fixture();let rows=Array.from({length:35},(_,at)=>memory('m'+at,{timestamp:at%3})),nextId=35,seed=73421;const operations=new Set<number>();
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>8;};
  const publish=()=>publisher.apply('source',{changed:rows.map(value=>({id:value.id,value})),removed:[],order:{reset:rows.map(row=>row.id),changes:[]}});
  try{publish();for(let step=0;step<120;step++){const op=random()%4;operations.add(op);if(op===0){const at=random()%rows.length;rows=rows.map((row,index)=>index===at?{...row,text:'Synthetic changed contextual '+step,timestamp:random()%7,encLocked:Boolean(random()%2)}:row);}else if(op===1)rows=[...rows,memory('m'+nextId++,{timestamp:random()%7,uid:random()%2?scope.uid:'other'})];else if(op===2&&rows.length>2){const at=random()%rows.length;rows=rows.filter((_,index)=>index!==at);}else rows=[...rows.slice(1),rows[0]];publish();
      const source=publisher.snapshot(),actual=await client.select(source,step%2?'pulse':'insights',signal(),undefined,now),authorized=[...source].filter(row=>!row.encLocked&&!row.deletedAt&&canReadCachedMemory(row,scope));
      if(actual.analysis.mode==='pulse')expect(actual.analysis.pulse).toEqual(buildCognitivePulse(authorized,now));else expect(actual.analysis.insights).toEqual(generateCognitiveInsights(authorized,now));
    }expect([...operations].sort()).toEqual([0,1,2,3]);
  }finally{client.dispose();publisher.clear();}
},15000);
it('never accepts a returned memory outside the current projection',async()=>{
  const {client,workers}=fixture(),rows=[memory('allowed'),memory('denied',{uid:'other'})];
  try{await client.select(rows,'insights',signal(),undefined,now);const worker=workers[0],normal=worker.postMessage.getMockImplementation()!;
    worker.postMessage.mockImplementation(message=>{if(message.type!=='query'){normal(message);return;}queueMicrotask(()=>worker.onmessage?.({data:{v:1,seq:message.seq,ok:true,mode:'insights',insights:[{id:'injected',kind:'orphan',severity:'low',title:'Synthetic',summary:'Synthetic',memoryIds:['denied'],evidence:[],score:.5}],counts:{total:1,linked:0,contradictions:0,orphans:1}}}));});
    await expect(client.select(rows,'insights',signal(),undefined,now)).rejects.toThrow('cognitive_analysis_unavailable');expect(worker.terminate).toHaveBeenCalledOnce();
  }finally{client.dispose();}
});
it('recovers an expired source journal with a controlled reset and withdraws the old lookup',async()=>{
  const publisher=new IncrementalMemoryPublication<SessionData>('asc'),rows=Array.from({length:250},(_,at)=>memory('m'+at,{timestamp:at})),{client,workers}=fixture();publisher.apply('source',{changed:rows.map(value=>({id:value.id,value})),removed:[],order:{reset:rows.map(row=>row.id),changes:[]}});
  try{const first=await client.select(publisher.snapshot(),'insights',signal(),undefined,now);for(let at=0;at<70;at++)publisher.apply('source',{changed:[{id:'m'+at,value:memory('m'+at,{timestamp:at,text:'Synthetic current '+at})}],removed:[],order:{changes:[]}});
    workers[0].postMessage.mockClear();const next=await client.select(publisher.snapshot(),'insights',signal(),undefined,now);expect(first.getMemory('m0')).toBeUndefined();expect(next.getMemory('m0')?.text).toBe('Synthetic current 0');expect(frames(workers[0]).find(message=>message.type==='patch-start')).toMatchObject({reset:true,preserve:false});expect(frames(workers[0]).flatMap(message=>message.type==='patch-chunk'?message.frame.changed??[]:[])).toHaveLength(250);
  }finally{client.dispose();publisher.clear();}
});
it('terminates a stalled transport on its deadline instead of returning a partial result',async()=>{
  vi.useFakeTimers();const worker=new CognitiveAnalysisWorkerMock();worker.postMessage.mockImplementation(()=>{});const client=new CognitiveAnalysisClient(scope,{createWorker:()=>worker as unknown as Worker,yieldTask:async()=>{}});
  try{const pending=client.select([memory('a')],'insights',signal(),undefined,now),rejected=expect(pending).rejects.toThrow('cognitive_analysis_unavailable');for(let at=0;at<12&&!worker.postMessage.mock.calls.length;at++)await Promise.resolve();expect(worker.postMessage).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(30_001);await rejected;expect(worker.terminate).toHaveBeenCalledOnce();}
  finally{client.dispose();vi.useRealTimers();}
});
