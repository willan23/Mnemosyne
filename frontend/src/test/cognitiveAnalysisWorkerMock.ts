import {vi} from 'vitest';
import {CognitiveAnalysisIndex} from '../services/cognitiveAnalysisIndex';
import type {CognitiveMessage} from '../services/cognitiveAnalysisProtocol';
/** Real protocol/index behind structured-clone frames; scheduling is covered by the Chromium probe. */
export class CognitiveAnalysisWorkerMock {
  static instances:CognitiveAnalysisWorkerMock[]=[];
  onmessage:((event:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
  index=new CognitiveAnalysisIndex();terminate=vi.fn(()=>this.index.clear());
  postMessage=vi.fn((message:CognitiveMessage,transfer:Transferable[]=[])=>{let data:unknown;try{data={v:1,seq:message.seq,ok:true,...this.index.handle(structuredClone(message,{transfer}))};}catch{data={v:1,seq:message.seq,ok:false};}queueMicrotask(()=>{if(!this.terminate.mock.calls.length)this.onmessage?.({data:structuredClone(data)});});});
  constructor(){CognitiveAnalysisWorkerMock.instances.push(this);}
}
