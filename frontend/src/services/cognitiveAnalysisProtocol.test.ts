import {expect,it} from 'vitest';
import {cognitiveWireRecords,validateCognitiveWireRecord,type CognitiveRecord} from './cognitiveAnalysisProtocol';
const row=(id:string,embedding:number[]):CognitiveRecord=>({id,text:'Synthetic',title:'',timestamp:1,updatedAt:1,tags:[],connections:[],embedding,embeddingModel:'synthetic-space'});
it('preserves double coordinates exactly while transferring fresh buffers without detaching reader arrays',()=>{
  const coordinates=[.1,Math.PI,1+Number.EPSILON,-0,Number.MIN_VALUE],source=row('a',coordinates),wire=cognitiveWireRecords([source]);
  expect(Array.from(wire[0].embedding)).toEqual(coordinates);const delivered=structuredClone(wire,{transfer:[wire[0].embedding.buffer]});
  expect(wire[0].embedding.byteLength).toBe(0);expect(source.embedding).toBe(coordinates);expect(source.embedding).toEqual([.1,Math.PI,1+Number.EPSILON,-0,Number.MIN_VALUE]);expect(Array.from(delivered[0].embedding)).toEqual(coordinates);expect(Object.is(delivered[0].embedding[3],-0)).toBe(true);expect(()=>validateCognitiveWireRecord(delivered[0])).not.toThrow();
});
it('deduplicates shared coordinates within one frame and transfers each private buffer once',()=>{
  const coordinates=[1,0,0],wire=cognitiveWireRecords([row('a',coordinates),row('b',coordinates)]);expect(wire[0].embedding).toBe(wire[1].embedding);
  const transfer=[...new Set(wire.map(row=>row.embedding.buffer))],delivered=structuredClone(wire,{transfer});expect(transfer).toHaveLength(1);expect(delivered[0].embedding).toBe(delivered[1].embedding);expect(coordinates).toEqual([1,0,0]);
});
it('refuses narrower coordinates and buffers with hidden unused bytes',()=>{
  const valid=cognitiveWireRecords([row('a',[1,0,0])])[0];expect(()=>validateCognitiveWireRecord({...valid,embedding:new Float32Array([1,0,0]) as unknown as Float64Array})).toThrow('cognitive_analysis_unavailable');
  expect(()=>validateCognitiveWireRecord({...valid,embedding:new Float64Array(new ArrayBuffer(64),8,3)})).toThrow('cognitive_analysis_unavailable');
  structuredClone(valid,{transfer:[valid.embedding.buffer]});expect(()=>validateCognitiveWireRecord(valid)).toThrow('cognitive_analysis_unavailable');
});
