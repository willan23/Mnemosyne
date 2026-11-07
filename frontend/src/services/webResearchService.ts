import { FAIR_USE } from '../config/fairUse';
import { consumeRateLimit } from '../utils/clientRateLimit';
import { AuthHttpError, getAuthJsonHeaders } from './authHttp';
import { approximateBytes, guardCloudUse } from './cloudUsePolicy';
import { withAiGenerationContext, type AiGenerationContext } from './aiGenerationContext';
import { getLocalAiConfig } from './localAiConfig';

export type WebResearchMode = 'public' | 'contextual' | 'private-local';

export interface WebResearchSource {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  status: 'read' | 'snippet-only' | 'failed';
}

export interface WebResearchResult {
  query: string;
  mode: WebResearchMode;
  summary: string;
  key_concepts: string[];
  main_ideas: string[];
  suggested_memories: string[];
  sources: WebResearchSource[];
  local_comparisons: string[];
}

export interface WebResearchRequest {
  query: string;
  mode: WebResearchMode;
  context?: string[];
  max_sources?: number;
}
export class WebResearchUnavailableError extends Error {
  constructor() { super('Pesquisa web indisponível. Verifica a sessão e repete o pedido.'); }
}
export function parseWebResearchRequest(value: WebResearchRequest): WebResearchRequest {
  if (!value || typeof value.query !== 'string' || !['public','contextual','private-local'].includes(value.mode)) throw new WebResearchUnavailableError();
  const query=value.query.trim().replace(/\s+/g,' '); const max_sources=value.max_sources ?? 8;
  if(value.mode==='contextual'&&value.context!==undefined&&!Array.isArray(value.context))throw new WebResearchUnavailableError();
  const context=value.mode==='contextual' ? [...(value.context ?? [])] : [];
  if (query.length<2 || approximateBytes(query)>2000 || !Number.isSafeInteger(max_sources) || max_sources<1 || max_sources>12 ||
      context.length>8 || context.some(item=>typeof item!=='string'||approximateBytes(item)>2000) || approximateBytes(...context)>12000) throw new WebResearchUnavailableError();
  return {query,mode:value.mode,context,max_sources};
}
export function parseWebResearchResult(value: unknown, expected?: Pick<WebResearchRequest,'query'|'mode'>): WebResearchResult {
  const object=(input:unknown):input is Record<string,unknown>=>Boolean(input&&typeof input==='object'&&!Array.isArray(input));
  const text=(input:unknown,limit:number):input is string=>typeof input==='string'&&approximateBytes(input)<=limit;
  const strings=(input:unknown,count:number,limit:number):input is string[]=>Array.isArray(input)&&input.length<=count&&input.every(item=>text(item,limit));
  if(!object(value)||!text(value.query,2000)||!['public','contextual','private-local'].includes(value.mode as string)||!text(value.summary,50000)||
    !strings(value.key_concepts,50,512)||!strings(value.main_ideas,20,10000)||!strings(value.suggested_memories,20,10000)||!strings(value.local_comparisons,20,10000)||
    !Array.isArray(value.sources)||value.sources.length>12|| (expected&&(value.query!==expected.query||value.mode!==expected.mode)) ||
    (value.mode!=='contextual'&&value.local_comparisons.length))throw new WebResearchUnavailableError();
  const sources:WebResearchSource[]=value.sources.map(source=>{
    if(!object(source)||!text(source.title,2000)||!text(source.url,4096)||!text(source.snippet,20000)||!text(source.summary,20000)||!['read','snippet-only','failed'].includes(source.status as string))throw new WebResearchUnavailableError();
    let url:URL;try{url=new URL(source.url);}catch{throw new WebResearchUnavailableError();}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new WebResearchUnavailableError();
    return {title:source.title,url:source.url,snippet:source.snippet,summary:source.summary,status:source.status as WebResearchSource['status']};
  });
  const result:WebResearchResult={query:value.query,mode:value.mode as WebResearchMode,summary:value.summary,key_concepts:[...value.key_concepts],main_ideas:[...value.main_ideas],
    suggested_memories:[...value.suggested_memories],sources,local_comparisons:[...value.local_comparisons]};
  if(approximateBytes(JSON.stringify(result))>250000)throw new WebResearchUnavailableError();return result;
}
async function readResearchResponse(response:Response,guard:()=>void):Promise<string> {
  if(!response.body)throw new WebResearchUnavailableError();
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;let complete=false;
  try{
    while(true){guard();const part=await reader.read();guard();if(part.done){complete=true;break;}
      length+=part.value.byteLength;if(length>250000)throw new WebResearchUnavailableError();chunks.push(part.value);
    }
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new WebResearchUnavailableError();}
  }finally{if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
}

const productionWebResearchEndpoint =
  (typeof window !== 'undefined' && (window.location.origin.includes('mnemosyne-one.web.app') || window.location.origin.includes('mnemosyne-one.firebaseapp.com')))
    ? '/api/v1/web/research'
    : 'https://mnemosyne-one.web.app/api/v1/web/research';
const configuredWebResearchEndpoint =
  (import.meta.env.PROD ? productionWebResearchEndpoint : import.meta.env.VITE_WEB_RESEARCH_ENDPOINT as string | undefined) ||
  (import.meta.env.PROD ? productionWebResearchEndpoint : undefined);
const webResearchBackendEnabled =
  import.meta.env.VITE_ENABLE_WEB_RESEARCH_BACKEND === 'true' ||
  Boolean(configuredWebResearchEndpoint);

const webResearchEndpoint = configuredWebResearchEndpoint || '/api/v1/web/research';

const extractConcepts = (query: string): string[] => {
  const stopwords = new Set(['como', 'para', 'pela', 'pelo', 'sobre', 'with', 'from', 'what', 'when', 'where', 'the', 'and']);
  return Array.from(new Set(
    (query.toLowerCase().match(/[a-zà-ÿ0-9]{4,}/g) || [])
      .filter((term) => !stopwords.has(term))
  )).slice(0, 8);
};

const buildBrowserFallbackResult = (request: WebResearchRequest, reason?: string): WebResearchResult => {
  const query = request.query.trim();
  const encodedQuery = encodeURIComponent(query);
  const concepts = extractConcepts(query);
  const reasonSuffix = reason ? ` O backend configurado não respondeu (${reason}).` : '';

  return {
    query,
    mode: request.mode,
    summary: `Pesquisa preparada com fontes públicas alternativas. Se o resumo automático não conseguir ler páginas protegidas, abre uma das fontes abaixo e guarda a constelação quando encontrares o melhor resultado.${reasonSuffix}`,
    key_concepts: concepts.length ? concepts : ['pesquisa-web'],
    main_ideas: [
      'A app não bloqueia a pesquisa quando um motor público falha; mostra fontes alternativas para continuares a investigar.',
      'As memórias locais continuam privadas; no modo privado-local, a comparação acontece só no cliente.',
      'Quando o backend consegue ler as páginas, o painel devolve resumo, conceitos e fontes diretamente.',
    ],
    suggested_memories: [
      `Criar uma memória de pesquisa sobre: ${query}`,
      'Registar fontes relevantes encontradas na pesquisa pública.',
    ],
    sources: ([
      {
        title: 'Google Search',
        url: `https://www.google.com/search?q=${encodedQuery}`,
        snippet: 'Pesquisa pública em nova aba.',
        summary: 'Abre esta fonte para consultar resultados públicos atualizados.',
        status: 'snippet-only',
      },
      {
        title: 'DuckDuckGo',
        url: `https://duckduckgo.com/?q=${encodedQuery}`,
        snippet: 'Pesquisa pública com foco em privacidade.',
        summary: 'Alternativa pública para consultar resultados sem enviar memórias locais.',
        status: 'snippet-only',
      },
      {
        title: 'Bing',
        url: `https://www.bing.com/search?q=${encodedQuery}`,
        snippet: 'Pesquisa pública generalista.',
        summary: 'Boa alternativa quando outro motor limita ou devolve poucos resultados.',
        status: 'snippet-only',
      },
      {
        title: 'Wikipedia',
        url: `https://www.wikipedia.org/search-redirect.php?search=${encodedQuery}`,
        snippet: 'Pesquisa enciclopédica.',
        summary: 'Útil para conceitos, pessoas, lugares e temas de conhecimento geral.',
        status: 'snippet-only',
      },
      {
        title: 'Google Scholar',
        url: `https://scholar.google.com/scholar?q=${encodedQuery}`,
        snippet: 'Pesquisa de artigos e referências técnicas.',
        summary: 'Útil quando o pedido envolve papers, estudos ou documentação técnica.',
        status: 'snippet-only',
      },
    ] satisfies WebResearchSource[]).slice(0, request.max_sources || 8),
    local_comparisons: [],
  };
};

export async function runWebResearch(input: WebResearchRequest, options: {context?:AiGenerationContext;assertCurrent?:()=>void} = {}): Promise<WebResearchResult> {
  const request=parseWebResearchRequest(input);const context=request.context ?? [];
  const authorize=()=>guardCloudUse('web-research', 'Mnemosyne web research', {
    bytes: approximateBytes(request.query, ...context),
    containsMemory: context.length > 0,
    containsAttachment: false,
    containsPrompt: true,
  });
  // Preserve a direct privacy rejection even when no account/vault is available.
  if(!['allow-cloud','confirm-cloud'].includes(getLocalAiConfig().memoryPermission))authorize();
  const work=async(captured:AiGenerationContext):Promise<WebResearchResult>=>{
  const guard=()=>{options.assertCurrent?.();captured.assertCurrent();if(captured.scope.kind!=='personal')throw new WebResearchUnavailableError();};
  guard();await captured.assertAccess();guard();
  authorize();guard();
  const rate = consumeRateLimit('web-research', FAIR_USE.webResearchPerHour, 60 * 60 * 1000);
  if (!rate.allowed) {
    const mins = Math.max(1, Math.ceil(rate.retryAfterMs / 60_000));
    return buildBrowserFallbackResult(
      request,
      `limite fair-use atingido (~${FAIR_USE.webResearchPerHour}/hora). Tenta de novo em ~${mins} min`
    );
  }

  if (!webResearchBackendEnabled) {
    return buildBrowserFallbackResult(request, 'backend web desativado');
  }

  let lastFailure = '';

  for (const endpoint of [webResearchEndpoint]) {
    try {
      const headers=await getAuthJsonHeaders(captured.uid);guard();await captured.assertAccess();guard();
      if(typeof headers.Authorization!=='string'||!/^Bearer \S+$/.test(headers.Authorization))throw new WebResearchUnavailableError();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,signal:captured.signal,
        body: JSON.stringify({
          query: request.query,
          mode: request.mode,
          context,
          max_sources: request.max_sources || 8,
        }),
      });
      guard();

      if (response.ok) {
        const raw=await readResearchResponse(response,guard);guard();
        let data:unknown;try{data=JSON.parse(raw);}catch{throw new WebResearchUnavailableError();}
        const result=parseWebResearchResult(data,request);await captured.assertAccess();guard();return result;
      }
      if(response.status>=400&&response.status<500)throw new WebResearchUnavailableError();
      lastFailure='endpoint indisponível';
    } catch (error) {
      guard();if(error instanceof WebResearchUnavailableError || error instanceof AuthHttpError || captured.signal.aborted)throw new WebResearchUnavailableError();
      lastFailure='endpoint indisponível';
    }
  }

  await captured.assertAccess();guard();return buildBrowserFallbackResult(request, lastFailure);
  };
  if(options.context)return work(options.context);
  return withAiGenerationContext({},work);
}
