import type {SessionData} from '../hooks/useSessions';
import {canReadCachedMemory,type MemoryReadScope} from './memoryReadScope';
import {IncrementalMemoryPublication} from './incrementalMemoryPublication';
import {memoryById,memorySnapshotDelta,memorySnapshotScopeActive,type MemorySnapshot} from './memorySnapshot';
import {memoryViewId} from './memoryViewProtocol';
import {embeddingSpaceOf} from './embeddingModel';
import {COGNITIVE_LIMITS as limits,cognitiveWeight,cognitiveWireRecords,validateCognitiveRecord,type CognitiveRecord,type CognitiveFrame,type CognitiveMessage,type CognitiveMode,type CognitiveAnalysis} from './cognitiveAnalysisProtocol';
import {validateCognitiveAnalysis} from './cognitiveAnalysisResponse';
import {createCognitiveAnalysisYield} from './cognitiveAnalysisYield';
const fail=()=>new Error('cognitive_analysis_unavailable');
type Projected={id:string;timestamp:number;source?:SessionData;record?:CognitiveRecord;connections:string[]};
type Message=CognitiveMessage extends infer M?M extends {seq:number}?Omit<M,'v'|'seq'>:never:never;
export interface CognitiveSelection {analysis:CognitiveAnalysis;getMemory:(id:string)=>SessionData|undefined}
/** Scoped projection and acknowledged transport. Source-order filtering happens incrementally before the Worker. */
export class CognitiveAnalysisClient {
  private scope:MemoryReadScope;private createWorker:()=>Worker;private yieldTask:()=>Promise<void>;private cancelYield:()=>void;
  private projected=new IncrementalMemoryPublication<Projected>('asc',{views:{eligible:row=>Boolean(row.record),linked:row=>Boolean(row.record?.connections.length)}});
  private source:readonly SessionData[]|null=null;private transferred:MemorySnapshot<Projected>|null=null;
  private worker:Worker|null=null;private generation=0;private lookupEpoch=0;private seq=0;private busy=false;
  private pending:{seq:number;resolve:(value:unknown)=>void;reject:()=>void}|null=null;
  constructor(scope:MemoryReadScope,options:{createWorker?:()=>Worker;yieldTask?:()=>Promise<void>}={}){
    this.scope={uid:scope.uid,teamIds:new Set(scope.teamIds)};this.createWorker=options.createWorker??(()=>new Worker(new URL('./cognitiveAnalysisWorker.ts',import.meta.url),{type:'module'}));const controlled=createCognitiveAnalysisYield();this.yieldTask=options.yieldTask??controlled.yieldTask;this.cancelYield=controlled.cancel;
  }
  dispose():void{this.generation++;this.busy=false;this.cancelYield();const pending=this.pending;this.pending=null;this.worker?.terminate();this.worker=null;this.source=null;this.transferred=null;this.projected.clear();pending?.reject();}
  private eligible(row:SessionData):boolean{return !row.encLocked&&!row.deletedAt&&canReadCachedMemory(row,this.scope);}
  private project(row:SessionData):Projected{
    if(!memoryViewId(row.id))throw fail();
    if(!this.eligible(row))return{id:row.id,timestamp:0,source:row,connections:[]};
    const record:CognitiveRecord={id:row.id,text:row.text,title:row.title??'',timestamp:row.timestamp,updatedAt:row.updatedAt,tags:row.tags??[],connections:row.connections??[],embedding:row.embedding??[],embeddingModel:embeddingSpaceOf(row.embeddingModel)};
    validateCognitiveRecord(record);return{id:row.id,timestamp:0,source:row,record,connections:record.connections};
  }
  private async prepare(source:readonly SessionData[],guard:()=>void):Promise<void>{
    if(source===this.source)return;const delta=memorySnapshotDelta(this.source,source);
    if(!delta){
      this.projected.clear();let changed:Array<{id:string;value:Projected}>=[],units=0,offset=0;
      const commit=async()=>{if(!changed.length)return;this.projected.apply('source',{changed,removed:[],order:{changes:changed.map(({id},at)=>({type:'added' as const,id,oldIndex:-1,newIndex:offset+at}))}});offset+=changed.length;changed=[];units=0;await this.yieldTask();guard();};
      for(const row of source){guard();const value=this.project(row);changed.push({id:row.id,value});units+=value.record?cognitiveWeight(value.record).units+value.record.embedding.length*4:row.id.length;if(changed.length===limits.batch||units>=limits.targetChunkUnits)await commit();}
      await commit();
    }else{
      const prepared=new Map<string,Projected>();
      const value=(id:string):Projected=>{let row=prepared.get(id);if(row)return row;const current=memoryById(source,id),old=this.projected.get(id);row=current?(old?.source===current?old:this.project(current)):{id,timestamp:0,connections:[]};prepared.set(id,row);return row;};
      for(let at=0;at<delta.order.length;at+=limits.batch){
        const moves=delta.order.slice(at,at+limits.batch),last=new Map<string,'added'|'removed'>();for(const move of moves)last.set(move.id,move.type);
        for(const move of moves)if(!prepared.has(move.id)){const old=this.projected.get(move.id);if(old&&old.source===memoryById(source,move.id))prepared.set(move.id,old);}
        const changed=Array.from(last).flatMap(([id,type])=>type==='added'?[{id,value:value(id)}]:[]);
        this.projected.apply('source',{changed,removed:[],order:{changes:moves}});await this.yieldTask();guard();
      }
      let changed:Array<{id:string;value:Projected}>=[],units=0;
      const commit=async()=>{if(!changed.length)return;this.projected.apply('source',{changed,removed:[],order:{changes:[]}});changed=[];units=0;await this.yieldTask();guard();};
      for(const row of delta.changed){guard();if(!this.projected.get(row.id))throw fail();const next=value(row.id);if(this.projected.get(row.id)!==next){changed.push({id:row.id,value:next});units+=next.record?cognitiveWeight(next.record).units+next.record.embedding.length*4:row.id.length;}if(changed.length===limits.batch||units>=limits.targetChunkUnits)await commit();}
      await commit();for(const id of delta.removed)if(this.projected.get(id))throw fail();
    }
    if(this.projected.count!==source.length)throw fail();
  }
  private request(message:Message):Promise<unknown>{
    if(!this.worker){const worker=this.createWorker();this.worker=worker;worker.onmessage=event=>{if(this.worker!==worker)return;const pending=this.pending;if(!pending||event.data?.seq!==pending.seq){this.dispose();return;}this.pending=null;pending.resolve(event.data);};worker.onerror=worker.onmessageerror=()=>{if(this.worker===worker)this.dispose();};}
    const seq=++this.seq,worker=this.worker;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(this.worker===worker&&this.pending?.seq===seq)this.dispose();},30_000);this.pending={seq,resolve:value=>{clearTimeout(timer);resolve(value);},reject:()=>{clearTimeout(timer);reject(fail());}};try{const transfer=message.type==='patch-chunk'?[...new Set((message.frame.changed??[]).map(row=>row.embedding.buffer as ArrayBuffer))]:[];worker.postMessage({...message,v:1,seq} satisfies CognitiveMessage,transfer);}catch{this.dispose();}});
  }
  private async exchange(message:Message,guard:()=>void,ack:boolean):Promise<Record<string,unknown>>{
    guard();const response=await this.request(message);guard();if(!response||typeof response!=='object')throw fail();const row=response as Record<string,unknown>;
    if(row.v!==1||row.seq!==this.seq||row.ok!==true||(ack?row.ack!==true||row.mode!==undefined:row.ack!==undefined))throw fail();return row;
  }
  private async frame(frame:CognitiveFrame,guard:()=>void):Promise<void>{await this.exchange({type:'patch-chunk',frame},guard,true);await this.yieldTask();guard();}
  private async records(rows:Iterable<Projected>,guard:()=>void):Promise<void>{
    let changed:CognitiveRecord[]=[],units=0;
    for(const row of rows){guard();if(!row.record)throw fail();const size=cognitiveWeight(row.record).units+row.record.embedding.length*4;if(changed.length&&(changed.length===limits.batch||units+size>limits.targetChunkUnits)){await this.frame({changed:cognitiveWireRecords(changed)},guard);changed=[];units=0;}changed.push(row.record);units+=size;}
    if(changed.length)await this.frame({changed:cognitiveWireRecords(changed)},guard);
  }
  async select(source:readonly SessionData[],mode:CognitiveMode,signal:AbortSignal,assertCurrent:()=>void=()=>{},now=Date.now()):Promise<CognitiveSelection>{
    if(this.busy||this.source&&!memorySnapshotScopeActive(this.source))this.dispose();const generation=this.generation,lookupEpoch=++this.lookupEpoch;
    const guard=()=>{if(signal.aborted||generation!==this.generation||!memorySnapshotScopeActive(source)||!this.scope.uid)throw fail();assertCurrent();};
    const abort=()=>{if(generation===this.generation)this.dispose();};this.busy=true;signal.addEventListener('abort',abort,{once:true});
    try{
      guard();if(source.length>limits.documents||!['insights','pulse'].includes(mode)||!Number.isFinite(now))throw fail();await this.prepare(source,guard);guard();
      const next=this.projected.snapshot().view('eligible'),delta=memorySnapshotDelta(this.transferred,next);
      if(next!==this.transferred){
        await this.exchange({type:'patch-start',reset:!delta,preserve:Boolean(delta),counts:{size:next.length,changed:delta?.changed.length??next.length,removed:delta?.removed.length??0,moves:delta?.order.length??0,order:delta?0:next.length}},guard,true);
        if(delta){for(let at=0;at<delta.order.length;at+=limits.batch)await this.frame({moves:delta.order.slice(at,at+limits.batch)},guard);for(let at=0;at<delta.removed.length;at+=limits.batch)await this.frame({removed:delta.removed.slice(at,at+limits.batch)},guard);await this.records(delta.changed,guard);}
        else{let order:string[]=[];for(const row of next){guard();order.push(row.id);if(order.length===limits.batch){await this.frame({order},guard);order=[];}}if(order.length)await this.frame({order},guard);await this.records(next,guard);}
        await this.exchange({type:'patch-end'},guard,true);
      }
      const result=await this.exchange({type:'query',mode,now},guard,false);
      const getMemory=(id:string):SessionData|undefined=>{try{guard();if(lookupEpoch!==this.lookupEpoch)return;const projected=next.get(id),row=projected?.source;return projected?.record&&row&&this.eligible(row)?row:undefined;}catch{if(generation===this.generation)this.dispose();return undefined;}};
      const analysis=validateCognitiveAnalysis(result,mode,getMemory,next.length,this.projected.snapshot().view('linked').length,next.connectionReferences);
      this.source=source;this.transferred=next;return{analysis,getMemory};
    }catch{if(generation===this.generation)this.dispose();throw fail();}finally{signal.removeEventListener('abort',abort);if(generation===this.generation)this.busy=false;}
  }
}
