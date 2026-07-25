import { getLocalAiConfig } from './localAiConfig';
import { FAIR_USE } from '../config/fairUse';
import { consumeRateLimit } from '../utils/clientRateLimit';

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

const productionWebResearchEndpoint =
  (typeof window !== 'undefined' && (window.location.origin.includes('mnemosyne-one.web.app') || window.location.origin.includes('mnemosyne-one.firebaseapp.com')))
    ? '/api/v1/web/research'
    : 'https://mnemosyne-one.web.app/api/v1/web/research';
const legacyCloudRunWebResearchEndpoint =
  'https://mnemosyne-web-research-tq3vyofasq-ew.a.run.app/api/v1/web/research';
const configuredWebResearchEndpoint =
  (import.meta.env.PROD ? productionWebResearchEndpoint : import.meta.env.VITE_WEB_RESEARCH_ENDPOINT as string | undefined) ||
  (import.meta.env.PROD ? productionWebResearchEndpoint : undefined);
const fallbackBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const webResearchBackendEnabled =
  import.meta.env.VITE_ENABLE_WEB_RESEARCH_BACKEND === 'true' ||
  Boolean(configuredWebResearchEndpoint);

const normalizeBase = (value: string): string => value.trim().replace(/\/+$/, '');

const endpointCandidates = (baseUrl: string): string[] => {
  const normalizedBase = normalizeBase(baseUrl);
  return Array.from(new Set([
    configuredWebResearchEndpoint,
    legacyCloudRunWebResearchEndpoint,
    `${normalizedBase}/api/v1/web/research`,
    `${normalizedBase}/v1/web/research`,
    `${normalizedBase}/web/research`,
  ].filter((url): url is string => Boolean(url?.trim()))));
};

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

export async function runWebResearch(request: WebResearchRequest): Promise<WebResearchResult> {
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

  const config = getLocalAiConfig();
  const backendConfig = config.providers.nvidia;
  const baseUrl = backendConfig.endpoint || fallbackBaseUrl;
  let lastFailure = '';

  for (const endpoint of endpointCandidates(baseUrl)) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: request.query,
          mode: request.mode,
          context: request.context || [],
          max_sources: request.max_sources || 8,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data && typeof data === 'object' && ('sources' in data || 'summary' in data)) {
          return data as WebResearchResult;
        }
        throw new Error('resposta do servidor com formato incorreto');
      }

      let message = `${response.status} ${response.statusText}`.trim();
      try {
        const payload = await response.json();
        message = payload.detail || message;
      } catch {
        // Keep statusText when the backend response is not JSON.
      }
      lastFailure = message || 'endpoint indisponível';
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'endpoint indisponível';
    }
  }

  return buildBrowserFallbackResult(request, lastFailure);
}
