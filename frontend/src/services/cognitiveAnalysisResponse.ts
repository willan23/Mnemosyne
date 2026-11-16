import type {SessionData} from '../hooks/useSessions';
import type {CognitiveInsight,InsightKind} from './insightEngine';
import type {CognitivePulse,CognitivePulseHighlight} from './cognitivePulse';
import type {CognitiveAnalysis,CognitiveMode} from './cognitiveAnalysisProtocol';
import {memoryViewId} from './memoryViewProtocol';
const fail=()=>new Error('cognitive_analysis_unavailable');
const kinds:InsightKind[]=['contradiction','orphan','resurface','pattern'];
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw fail();return value as Record<string,unknown>;};
const string=(value:unknown,max=2048):value is string=>typeof value==='string'&&value.length<=max;
const count=(value:unknown,max:number):value is number=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=max;
function highlight(value:unknown,get:(id:string)=>SessionData|undefined,insight:boolean):CognitiveInsight|CognitivePulseHighlight{
  const row=object(value);
  if(!string(row.id)||!kinds.includes(row.kind as InsightKind)||!string(row.title)||!string(row.summary)||
    !Array.isArray(row.memoryIds)||row.memoryIds.length<1||row.memoryIds.length>8||!row.memoryIds.every(id=>memoryViewId(id)&&get(id))||
    !Array.isArray(row.evidence)||row.evidence.length>3||!row.evidence.every(value=>string(value,512))||
    typeof row.score!=='number'||!Number.isFinite(row.score)||row.score<0||row.score>1.000001||insight&&!['high','medium','low'].includes(String(row.severity)))throw fail();
  const result={id:row.id,kind:row.kind as InsightKind,title:row.title,summary:row.summary,memoryIds:row.memoryIds as string[],evidence:row.evidence as string[],score:row.score};
  return insight?{...result,severity:row.severity as CognitiveInsight['severity']}:result;
}
/** Validate shape and resolve every exposed memory against the current authorized snapshot after retrieval. */
export function validateCognitiveAnalysis(value:unknown,mode:CognitiveMode,get:(id:string)=>SessionData|undefined,total:number,linked:number,references:number):CognitiveAnalysis{
  const row=object(value);if(row.mode!==mode)throw fail();
  if(mode==='insights'){
    if(!Array.isArray(row.insights)||row.insights.length>13)throw fail();const insights=row.insights.map(value=>highlight(value,get,true) as CognitiveInsight),counts=object(row.counts);
    if(new Set(insights.map(value=>value.id)).size!==insights.length||insights.filter(value=>value.kind==='contradiction').length>6||insights.filter(value=>value.kind==='resurface').length>5||insights.filter(value=>value.kind==='orphan').length>1||insights.filter(value=>value.kind==='pattern').length>1)throw fail();
    if(counts.total!==total||counts.linked!==linked||counts.contradictions!==insights.filter(value=>value.kind==='contradiction').length||counts.orphans!==insights.filter(value=>value.kind==='orphan').length)throw fail();
    return{mode,insights,counts:{total,linked,contradictions:Number(counts.contradictions),orphans:Number(counts.orphans)}};
  }
  const pulse=object(row.pulse),stats=object(pulse.stats);
  if(!string(pulse.dateKey,10)||!/^\d{4}-\d{2}-\d{2}$/.test(pulse.dateKey)||!string(pulse.title)||!string(pulse.subtitle)||!string(pulse.constellationLabel,128)||
    !Array.isArray(pulse.highlights)||pulse.highlights.length>5||!count(stats.memories,total)||!count(stats.connections,references)||!count(stats.orphans,stats.memories)||!count(stats.resurfacing,5)||!count(stats.contradictions,6))throw fail();
  const result:CognitivePulse={dateKey:pulse.dateKey,title:pulse.title,subtitle:pulse.subtitle,constellationLabel:pulse.constellationLabel,highlights:pulse.highlights.map(value=>highlight(value,get,false)),
    stats:{memories:stats.memories,connections:stats.connections,orphans:stats.orphans,resurfacing:stats.resurfacing,contradictions:stats.contradictions}};
  return{mode:'pulse',pulse:result};
}
