import type { InsightMemory, CognitiveInsight } from './insightEngine';
import type { CognitivePulse } from './cognitivePulse';
import type { MemorySnapshotMove } from './memorySnapshot';
import {memoryViewId,type MemoryViewPatchCounts} from './memoryViewProtocol';
export const COGNITIVE_LIMITS = Object.freeze({ documents:100_000, changes:200_000, batch:128, targetChunkUnits:65_536,
  recordTextUnits:1_048_576, vectorDimensions:8192, recordConnections:2500, recordTags:100,
  units:128_000_000, vectors:64_000_000, connections:5_000_000, tags:1_000_000 });
/** Only locally authorized data used by these heuristics; no actor, team, cipher or attachments. */
export interface CognitiveRecord extends InsightMemory {
  title:string; tags:string[]; connections:string[]; embedding:number[]; embeddingModel:string;
}
export interface CognitiveWireRecord extends Omit<CognitiveRecord,'embedding'> {embedding:Float64Array}
export interface CognitiveWeight { units:number; vectors:number; connections:number; tags:number }
export const cognitiveWeight = (row:CognitiveRecord|CognitiveWireRecord):CognitiveWeight => ({
  units:row.id.length+row.text.length+row.title.length+row.embeddingModel.length+row.tags.reduce((sum,value)=>sum+value.length,0)+row.connections.reduce((sum,value)=>sum+value.length,0),
  vectors:row.embedding.length, connections:row.connections.length, tags:row.tags.length });
function validateFields(row:CognitiveRecord|CognitiveWireRecord):void {
  if(!row||Object.keys(row).some(key=>!['id','text','title','timestamp','updatedAt','tags','connections','embedding','embeddingModel'].includes(key))||
    !memoryViewId(row.id)||typeof row.text!=='string'||typeof row.title!=='string'||row.text.length+row.title.length>COGNITIVE_LIMITS.recordTextUnits||
    !Number.isFinite(row.timestamp)||!Number.isFinite(row.updatedAt)||typeof row.embeddingModel!=='string'||row.embeddingModel.length>512||
    !Array.isArray(row.tags)||row.tags.length>COGNITIVE_LIMITS.recordTags||row.tags.some(tag=>typeof tag!=='string'||tag.length>200)||
    !Array.isArray(row.connections)||row.connections.length>COGNITIVE_LIMITS.recordConnections||!row.connections.every(memoryViewId))throw new Error('cognitive_analysis_unavailable');
}
export function validateCognitiveRecord(row:CognitiveRecord):void {
  validateFields(row);if(!Array.isArray(row.embedding)||row.embedding.length>COGNITIVE_LIMITS.vectorDimensions||row.embedding.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error('cognitive_analysis_unavailable');
}
const typedArrayPrototype=Object.getPrototypeOf(Float64Array.prototype);
const coordinateTag=Object.getOwnPropertyDescriptor(typedArrayPrototype,Symbol.toStringTag)!.get!;
const coordinateLength=Object.getOwnPropertyDescriptor(typedArrayPrototype,'length')!.get!;
const coordinateOffset=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset')!.get!;
const coordinateBuffer=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer')!.get!;
const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
export function validateCognitiveWireRecord(row:CognitiveWireRecord):void {
  validateFields(row);const value=row.embedding;if(!ArrayBuffer.isView(value)||coordinateTag.call(value)!=='Float64Array')throw new Error('cognitive_analysis_unavailable');
  const length=Number(coordinateLength.call(value)),buffer=coordinateBuffer.call(value) as ArrayBuffer;let bytes:number;try{bytes=Number(bufferLength.call(buffer));if(!length)new DataView(buffer);}catch{throw new Error('cognitive_analysis_unavailable');}
  if(coordinateOffset.call(value)!==0||bytes!==length*8||length>COGNITIVE_LIMITS.vectorDimensions)throw new Error('cognitive_analysis_unavailable');
  for(let at=0;at<length;at++)if(!Number.isFinite(value[at]))throw new Error('cognitive_analysis_unavailable');
}
/** Fresh private buffers preserve IEEE-754 doubles and never detach the session reader's arrays. */
export function cognitiveWireRecords(rows:readonly CognitiveRecord[]):CognitiveWireRecord[]{
  const shared=new WeakMap<number[],Float64Array>();return rows.map(row=>{let embedding=shared.get(row.embedding);if(!embedding){embedding=new Float64Array(row.embedding);shared.set(row.embedding,embedding);}return{...row,embedding};});
}
export type CognitiveMode = 'insights'|'pulse';
export type CognitiveAnalysis = {mode:'insights';insights:CognitiveInsight[];counts:{total:number;linked:number;contradictions:number;orphans:number}} |
  {mode:'pulse';pulse:CognitivePulse};
export interface CognitiveFrame {changed?:CognitiveWireRecord[];removed?:string[];moves?:MemorySnapshotMove[];order?:string[]}
export type CognitiveMessage = {v:1;seq:number}&(
  {type:'patch-start';reset:boolean;preserve:boolean;counts:MemoryViewPatchCounts}|
  {type:'patch-chunk';frame:CognitiveFrame}|{type:'patch-end'}|{type:'query';mode:CognitiveMode;now:number});
