import type { SessionData } from '../hooks/useSessions';
import { cognitiveEngine } from '../engines/CognitiveEngine';
import { semanticCandidateEligibility } from './semanticCandidateCapture';
import { withSemanticCandidates } from './semanticCandidateOperations';
import { personalSemanticCandidates } from './personalSemanticScope';
import { withAiGenerationContext, type AiGenerationContextDeps } from './aiGenerationContext';
import { assertPersonalMemoryCreationEnabled, createPersonalMemory, hasPendingAttachedMemoryCreation } from './attachedMemoryRecovery';
import { parseWebResearchResult, type WebResearchResult } from './webResearchService';

export interface WebResearchMemoryDeps {
  context?:AiGenerationContextDeps;
  enabled:()=>void;pending:(uid:string)=>boolean;
  semantic:typeof cognitiveEngine.processMemory;
  create:typeof createPersonalMemory;
  now:()=>number;
}
const defaults=():WebResearchMemoryDeps=>({enabled:assertPersonalMemoryCreationEnabled,pending:hasPendingAttachedMemoryCreation,
  semantic:(...args)=>cognitiveEngine.processMemory(...args),create:createPersonalMemory,now:Date.now});
export function formatResearchAsMemory(result:WebResearchResult):string {
  return [`[Pesquisa web] ${result.query}`,'','Resumo',result.summary,'','Ideias principais',
    ...result.main_ideas.map((idea,index)=>`${index+1}. ${idea}`),'','Conceitos-chave',result.key_concepts.map(concept=>`#${concept}`).join(' '),'','Fontes',
    ...result.sources.map((source,index)=>`${index+1}. ${source.title} - ${source.url}`)].join('\n');
}
export function buildPersonalResearchContext(sessions:readonly SessionData[],uid:string,selectedIds:readonly string[]):string[] {
  let remaining=12000;const result:string[]=[];
  for(const memory of personalSemanticCandidates(sessions,uid).filter(memory=>selectedIds.includes(memory.id)).slice(0,8)){
    const budget=Math.min(2000,remaining);let text='';let bytes=0;
    for(const char of `${memory.title??''}\n${memory.text??''}`){const size=new TextEncoder().encode(char).length;if(bytes+size>budget)break;text+=char;bytes+=size;}
    if(text.trim()){result.push(text);remaining-=bytes;}if(!remaining)break;
  }
  return result;
}
/** Capture the result and owner before inference; keep the guard through durable creation and its receipts. */
export async function saveWebResearchMemory(input:{uid:string;result:WebResearchResult;sessions:readonly SessionData[];assertCurrent?:()=>void},deps=defaults()) {
  const result=parseWebResearchResult(input.result);deps.enabled();
  if(deps.pending(input.uid))throw new Error('Recupera ou cancela a criação pendente antes de guardar outra pesquisa.');
  return withAiGenerationContext({uid:input.uid},async context=>{
    const guard=()=>{input.assertCurrent?.();context.assertCurrent();};guard();
    const text=formatResearchAsMemory(result);let cognitive:Awaited<ReturnType<typeof cognitiveEngine.processMemory>>|null=null;
    try{cognitive=await withSemanticCandidates(input.sessions,{assertCurrent:guard,eligible:semanticCandidateEligibility(input.uid)},(candidates,current)=>deps.semantic(text,candidates,{assertCurrent:current}));guard();}
    catch{guard();console.warn('Web research memory saved without local semantic enrichment.');}
    guard();const savedAt=deps.now();const saved=await deps.create({uid:input.uid,text,title:`Pesquisa web: ${result.query}`.slice(0,90),metadata:{
      tags:['web-research','fonte-externa',...result.key_concepts.slice(0,6).map(concept=>Array.from(concept.slice(0,128)).filter(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127).join(''))],category:'Pesquisa web',
      nodes:null,links:null,embedding:cognitive?.embedding??null,embeddingModel:cognitive?.embeddingModel??null,connections:[],
      semanticClusterId:cognitive?.semanticClusterId??null,position:cognitive?.position??null,importance:cognitive?.importance??0.7,celestialType:cognitive?.celestialType??'nebula',
      processingMethod:cognitive?'web-research+local-embedding':'web-research',webResearch:{mode:result.mode,savedAt},
    }},undefined,guard);guard();return saved;
  },deps.context);
}
