import {expect,it,vi} from 'vitest';
import {CognitiveAnalysisIndex} from './cognitiveAnalysisIndex';
import {COGNITIVE_LIMITS as limits,cognitiveWireRecords,type CognitiveRecord,type CognitiveMessage} from './cognitiveAnalysisProtocol';
import {generateCognitiveInsights} from './insightEngine';
import {buildCognitivePulse} from './cognitivePulse';
import {CURRENT_EMBEDDING_SPACE} from './embeddingModel';
type Message=CognitiveMessage extends infer M?M extends{seq:number}?Omit<M,'v'|'seq'>:never:never;
const now=1_700_000_000_000,day=86400000;
const record=(id:string,extra:Partial<CognitiveRecord>={}):CognitiveRecord=>({id,text:'Synthetic memory with soberania contextual and privada research',title:'',timestamp:now-40*day,updatedAt:now-40*day,tags:[],connections:[],embedding:[1,0,0],embeddingModel:CURRENT_EMBEDDING_SPACE,...extra});
function fixture(){const index=new CognitiveAnalysisIndex();let seq=0;const send=(message:Message)=>{const payload=message.type==='patch-chunk'&&message.frame.changed?{...message,frame:{changed:cognitiveWireRecords(message.frame.changed as unknown as CognitiveRecord[])}}:message;return index.handle(structuredClone({...payload,v:1,seq:++seq}) as CognitiveMessage);};
 const initialize=(rows:CognitiveRecord[])=>{send({type:'patch-start',reset:true,preserve:false,counts:{size:rows.length,changed:rows.length,removed:0,moves:0,order:rows.length}});for(let at=0;at<rows.length;at+=128)send({type:'patch-chunk',frame:{order:rows.slice(at,at+128).map(row=>row.id)}});for(let at=0;at<rows.length;at+=128)send({type:'patch-chunk',frame:{changed:rows.slice(at,at+128)}});send({type:'patch-end'});};return{index,send,initialize};}
it('matches the original pure heuristics and pulse, including source order, empty text, model spaces and duplicate tags',()=>{
  const rows=Array.from({length:180},(_,at)=>record('m'+at,{text:at%3?'Sempre vou estudar soberania contextual privada no produto.':'Nunca devo estudar soberania contextual privada no produto.',
    updatedAt:now-(at%2?1:45)*day,tags:at%7?['produto','Produto']:[],connections:at%4?['outside']:[],embeddingModel:at%2?CURRENT_EMBEDDING_SPACE:'synthetic-other-space',embedding:at%2?[1,0,0]:[.9,.1,0]}));
  rows.push(record('title-only',{text:'',title:'Only a title'}));const f=fixture();f.initialize(rows);
  const insights=generateCognitiveInsights(rows,now);expect(f.send({type:'query',mode:'insights',now})).toEqual({mode:'insights',insights,counts:{total:rows.length,linked:rows.filter(row=>row.connections.length).length,contradictions:insights.filter(row=>row.kind==='contradiction').length,orphans:insights.filter(row=>row.kind==='orphan').length}});
  expect(f.send({type:'query',mode:'pulse',now})).toEqual({mode:'pulse',pulse:buildCognitivePulse(rows,now)});
});
it('prepares only changed text while applying precise order moves and removals',()=>{
  const f=fixture(),rows=[record('a'),record('b'),record('c')],normalize=vi.spyOn(String.prototype,'normalize');
  try{f.initialize(rows);f.send({type:'query',mode:'insights',now});normalize.mockClear();f.send({type:'query',mode:'insights',now});expect(normalize).not.toHaveBeenCalled();
    const updated=record('c',{text:'Sempre vou estudar uma nova hipótese contextual privada.'});
    f.send({type:'patch-start',reset:false,preserve:true,counts:{size:2,changed:1,removed:1,moves:3,order:0}});f.send({type:'patch-chunk',frame:{moves:[{id:'c',type:'removed',oldIndex:2,newIndex:-1},{id:'c',type:'added',oldIndex:-1,newIndex:0},{id:'b',type:'removed',oldIndex:2,newIndex:-1}]}});f.send({type:'patch-chunk',frame:{removed:['b']}});f.send({type:'patch-chunk',frame:{changed:[updated]}});f.send({type:'patch-end'});
    const actual=f.send({type:'query',mode:'insights',now});expect(normalize).toHaveBeenCalledTimes(2);expect(actual).toMatchObject({insights:generateCognitiveInsights([updated,rows[0]],now)});
  }finally{normalize.mockRestore();}
});
it.each([
  {name:'nonfinite vector',extra:{embedding:[NaN]}}, {name:'long tag',extra:{tags:['x'.repeat(201)]}}, {name:'invalid connection',extra:{connections:['a/b']}}, {name:'actor metadata',extra:{uid:'unwanted-actor'}},
  {name:'dimension limit',extra:{embedding:Array(8193).fill(0)}}, {name:'text limit',extra:{text:'x'.repeat(limits.recordTextUnits+1)}},
])('rejects $name and discards a partial replica',({extra})=>{
  const f=fixture();expect(()=>f.initialize([record('a',extra)])).toThrow('cognitive_analysis_unavailable');expect(()=>f.send({type:'query',mode:'pulse',now})).toThrow();f.initialize([]);expect(f.send({type:'query',mode:'insights',now})).toMatchObject({counts:{total:0}});
});
it('rejects incomplete, repeated and out-of-phase frames',()=>{
  const f=fixture();f.initialize([record('a')]);f.send({type:'patch-start',reset:false,preserve:true,counts:{size:1,changed:1,removed:0,moves:0,order:0}});
  expect(()=>f.send({type:'query',mode:'insights',now})).toThrow();f.initialize([]);
  expect(()=>f.index.handle({v:1,seq:1,type:'query',mode:'pulse',now})).toThrow();
  expect(()=>fixture().send({type:'patch-start',reset:true,preserve:false,counts:{size:100001,changed:0,removed:0,moves:0,order:100001}})).toThrow();
});
it('bounds aggregate vector coordinates even when rows share an array within each transfer frame',()=>{
  const vector=Array(8192).fill(0),rows=Array.from({length:Math.floor(limits.vectors/vector.length)+1},(_,at)=>record('m'+at,{embedding:vector})),f=fixture();
  expect(()=>f.initialize(rows)).toThrow('cognitive_analysis_unavailable');expect(()=>f.send({type:'query',mode:'pulse',now})).toThrow();
},15000);
