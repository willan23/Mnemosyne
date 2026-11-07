import * as functions from 'firebase-functions/v1';
import * as cheerio from 'cheerio';
import { verifyBearerIdToken } from './httpAuth';
import { clientKeyFromRequest, consumeServerRateLimit, RATE_LIMITS } from './rateLimit';
import { resolveTextModel, resolveImageModel, validImageOptions, validTextTokenRequest } from './modelPolicy';
import { reserveAiGenerationBudget, isAiGenerationAdmissionLive, AiGenerationAccessError } from './aiBudget';
import { parseAiGenerationScope, AI_INPUT_OVERHEAD_RESERVATION } from './aiCostPolicy';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { isLiveAccount, withLiveAccount, AccountUnavailableError } from './accountAccess';
import { beginProviderAttempt, finishProviderAttempt, releaseProviderAttempt } from './providerCircuit';
import { ProviderHttpError, shouldTripProviderCircuit } from './providerErrorPolicy';
import { fetchProviderResponse } from './providerTransport';
import { isGenerationProviderEnabled } from './generationProviderPolicy';
import { GENERATION_HTTP_POLICY } from './generationHttpPolicy';
import { reportedTextModel, decodeProviderImage } from './providerResponsePolicy';
import { generateGeminiText, generateGeminiImage } from './geminiGeneration';
import { generateOpenRouterFreeText } from './openrouterFreeGeneration';
import { safeFetchExternalUrl } from './safeExternalFetch';
import { observeAiHandler, type AiOperation } from './aiOperationalEvents';

import { readEnv, readSecret, openaiApiKey, nvidiaApiKey, huggingfaceApiKey, geminiApiKey, openrouterApiKey } from './params';

type ResearchMode = 'public' | 'contextual' | 'private-local';
type SourceStatus = 'read' | 'snippet-only' | 'failed';

export function parseResearchModeAndContext(
    rawMode: unknown,
    rawContext: unknown,
): { mode: ResearchMode; context: string[] } | null {
    const mode = rawMode === undefined || rawMode === null ? 'public' : rawMode;
    if (mode !== 'public' && mode !== 'contextual' && mode !== 'private-local') return null;
    // The private-local contract is enforced again on the server. A modified
    // client cannot make the server process local memory in this mode.
    if (mode !== 'contextual') return { mode, context: [] };
    if (rawContext === undefined || rawContext === null) return { mode, context: [] };
    if (!Array.isArray(rawContext) || rawContext.length > 8 ||
        rawContext.some((item) => typeof item !== 'string' || Buffer.byteLength(item, 'utf8') > 2000)) {
        return null;
    }
    const context = rawContext.map((item: string) => item.trim());
    if (Buffer.byteLength(context.join(''), 'utf8') > 12_000) return null;
    return { mode, context };
}

interface WebResearchSource {
    title: string;
    url: string;
    snippet: string;
    summary: string;
    status: SourceStatus;
}

interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
}

interface GenerationResponsePayload {
    text: string;
    model: string | null;
    provider: string;
    warning?: string;
}

interface ImageGenerationResponsePayload {
    image_base64?: string | null;
    image_url?: string | null;
    media_type: string;
    model: string;
    provider: string;
    revised_prompt?: string | null;
    warning?: string | null;
}

const STOPWORDS = new Set([
    'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could',
    'every', 'first', 'from', 'have', 'into', 'more', 'most', 'other', 'over', 'same',
    'such', 'than', 'that', 'their', 'there', 'these', 'they', 'this', 'through', 'under',
    'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
    'ainda', 'algo', 'anos', 'antes', 'aqui', 'cada', 'como', 'contra', 'depois', 'desde',
    'deste', 'desta', 'entre', 'esta', 'este', 'foram', 'mais', 'mas', 'mesmo', 'muito',
    'para', 'pela', 'pelo', 'pode', 'pois', 'porque', 'quando', 'sobre', 'tambem', 'todos',
    'uma', 'usar', 'isso', 'esse', 'essa', 'eles', 'elas', 'com', 'dos', 'das', 'que',
]);

const blockedHosts = new Set(['duckduckgo.com', 'www.duckduckgo.com', 'bing.com', 'www.bing.com', 'google.com', 'www.google.com']);

const normalizeText = (value: string): string => (value || '').replace(/\s+/g, ' ').trim();

const envValue = (...names: string[]): string | undefined => {
    for (const name of names) {
        if (name === 'OPENAI_API_KEY') {
            const v = readSecret(openaiApiKey, name);
            if (v) return v;
            continue;
        }
        if (name === 'NVIDIA_API_KEY') {
            const v = readSecret(nvidiaApiKey, 'NVIDIA_API_KEY');
            if (v) return v;
            continue;
        }
        if (name === 'HUGGINGFACE_API_KEY') {
            const v = readSecret(huggingfaceApiKey, 'HUGGINGFACE_API_KEY');
            if (v) return v;
            continue;
        }
        const value = readEnv(name);
        if (value) return value;
    }
    return undefined;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

const getString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;

const clampNumber = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

const imageSizeToDimensions = (size: unknown): { width: number; height: number } => {
    const match = /^(\d{3,4})x(\d{3,4})$/.exec(String(size || '1024x1024'));
    if (!match) return { width: 1024, height: 1024 };
    return {
        width: clampNumber(Number(match[1]), 256, 1024),
        height: clampNumber(Number(match[2]), 256, 1024),
    };
};

const words = (value: string): string[] => (
    normalizeText(value).toLowerCase().match(/[a-zà-ÿ0-9]{4,}/g) || []
).filter((token) => !STOPWORDS.has(token));

const splitSentences = (value: string): string[] => normalizeText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40);

const rankSummary = (text: string, query: string, limit = 4): string => {
    const sentences = splitSentences(text);
    if (!sentences.length) return normalizeText(text).slice(0, 700);

    const queryTerms = new Set(words(query));
    return sentences
        .slice(0, 80)
        .map((sentence, index) => {
            const sentenceTerms = new Set(words(sentence));
            const overlap = [...queryTerms].filter((term) => sentenceTerms.has(term)).length;
            return { sentence, score: overlap * 3 + Math.min(Math.floor(sentence.length / 120), 3), index };
        })
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit)
        .map((item) => item.sentence)
        .join(' ')
        .slice(0, 1200);
};

const extractConcepts = (text: string, limit = 12): string[] => {
    const counts = new Map<string, number>();
    words(text).forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([token]) => token);
};

const isUsableUrl = (url: string): boolean => {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        if (blockedHosts.has(parsed.hostname.toLowerCase())) return false;
        if (parsed.pathname.startsWith('/y.js') || parsed.pathname.includes('/aclick')) return false;
        if (parsed.search.includes('ad_domain=') || parsed.search.includes('ad_provider=')) return false;
        return true;
    } catch {
        return false;
    }
};

const resolveDuckDuckGoUrl = (href: string): string => {
    const absoluteHref = href.startsWith('//') ? `https:${href}` : href;
    try {
        const parsed = new URL(absoluteHref, 'https://duckduckgo.com');
        if (parsed.hostname.includes('duckduckgo.com') && parsed.pathname.startsWith('/l/')) {
            return decodeURIComponent(parsed.searchParams.get('uddg') || '');
        }
        return parsed.toString();
    } catch {
        return absoluteHref;
    }
};

const fetchText = async (url: string): Promise<string> => {
    const response = await safeFetchExternalUrl(url);
    if (response.status < 200 || response.status >= 300) throw new Error(`Pesquisa externa: ${response.status}`);
    return response.body;
};

const searchDuckDuckGo = async (query: string, maxSources: number): Promise<WebSearchResult[]> => {
    const html = await fetchText(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
    const $ = cheerio.load(html);
    const results: WebSearchResult[] = [];
    const seen = new Set<string>();

    $('.result').each((_, result) => {
        if (results.length >= maxSources) return false;
        const $result = $(result);
        if ($result.hasClass('result--ad') || $result.hasClass('result--ads')) return undefined;
        const link = $result.find('a.result__a, .result__title a').first();
        const rawHref = link.attr('href');
        if (!rawHref) return undefined;
        const url = resolveDuckDuckGoUrl(rawHref);
        if (!isUsableUrl(url) || seen.has(url)) return undefined;
        seen.add(url);
        results.push({
            title: normalizeText(link.text()) || url,
            url,
            snippet: normalizeText($result.find('.result__snippet').first().text()),
        });
        return undefined;
    });

    return results;
};

const searchWikipedia = async (query: string, maxSources: number): Promise<WebSearchResult[]> => {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'opensearch');
    url.searchParams.set('search', query);
    url.searchParams.set('limit', String(maxSources));
    url.searchParams.set('namespace', '0');
    url.searchParams.set('format', 'json');
    const response = await safeFetchExternalUrl(url.toString());
    if (response.status < 200 || response.status >= 300) throw new Error(`Pesquisa externa: ${response.status}`);
    const payload = JSON.parse(response.body) as [string, string[], string[], string[]];
    const titles = Array.isArray(payload[1]) ? payload[1] : [];
    const snippets = Array.isArray(payload[2]) ? payload[2] : [];
    const urls = Array.isArray(payload[3]) ? payload[3] : [];
    return titles
        .map((title, index) => ({ title, snippet: snippets[index] || '', url: urls[index] || '' }))
        .filter((result) => isUsableUrl(result.url))
        .slice(0, maxSources);
};

type WebSearcher = (query: string, maxSources: number) => Promise<WebSearchResult[]>;
type SearchProvider = { id: 'duckduckgo' | 'wikipedia'; search: WebSearcher };

const defaultSearchProviders: SearchProvider[] = [
    { id: 'duckduckgo', search: searchDuckDuckGo },
    { id: 'wikipedia', search: searchWikipedia },
];

export const searchPublicWeb = async (
    query: string,
    maxSources: number,
    providers: readonly SearchProvider[] = defaultSearchProviders,
): Promise<WebSearchResult[]> => {
    const collected: WebSearchResult[] = [];
    const seen = new Set<string>();
    for (const { id, search } of providers) {
        if (collected.length >= maxSources) break;
        try {
            const results = await search(query, maxSources);
            for (const result of results) {
                if (seen.has(result.url) || !isUsableUrl(result.url)) continue;
                seen.add(result.url);
                collected.push(result);
                if (collected.length >= maxSources) break;
            }
        } catch {
            // Provider errors can contain full query URLs or request bodies.
            console.warn('Search provider failed', { provider: id });
        }
    }
    return collected;
};

const extractPageText = (html: string): { title: string; text: string } => {
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, nav, footer, header, form').remove();
    const title = normalizeText($('title').first().text());
    const pieces: string[] = [];
    const description = $('meta[name="description"]').attr('content');
    if (description) pieces.push(description);

    $('h1, h2, p, li').each((_, element) => {
        if (pieces.join(' ').length > 18000) return false;
        const text = normalizeText($(element).text());
        if (text.length >= 60) pieces.push(text);
        return undefined;
    });

    return { title, text: normalizeText(pieces.join(' ')) };
};

const fetchResearchSource = async (result: WebSearchResult, query: string): Promise<WebResearchSource> => {
    try {
        const response = await safeFetchExternalUrl(result.url);
        if (response.status < 200 || response.status >= 300 || !response.contentType.includes('text/html')) {
            return {
                title: result.title,
                url: result.url,
                snippet: result.snippet,
                summary: rankSummary(result.snippet || result.title, query, 1),
                status: 'snippet-only',
            };
        }
        const { title, text } = extractPageText(response.body);
        if (text.length < 160) {
            return {
                title: title || result.title,
                url: response.url,
                snippet: result.snippet,
                summary: rankSummary([result.snippet, text, result.title].join(' '), query, 1),
                status: 'snippet-only',
            };
        }
        return {
            title: title || result.title,
            url: response.url,
            snippet: result.snippet,
            summary: rankSummary(text, query, 3),
            status: 'read',
        };
    } catch {
        return {
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            summary: rankSummary(result.snippet || result.title, query, 1),
            status: 'failed',
        };
    }
};

const directSources = (query: string, maxSources: number): WebResearchSource[] => {
    const encoded = encodeURIComponent(query);
    return [
        ['Google Search', `https://www.google.com/search?q=${encoded}`, 'Abre esta fonte quando os motores automáticos limitarem resultados.'],
        ['DuckDuckGo', `https://duckduckgo.com/?q=${encoded}`, 'Alternativa pública para consultar resultados sem enviar memórias locais.'],
        ['Bing', `https://www.bing.com/search?q=${encoded}`, 'Alternativa útil quando outro motor devolve poucos resultados.'],
        ['Google Scholar', `https://scholar.google.com/scholar?q=${encoded}`, 'Útil para estudos, papers e referências técnicas.'],
    ].slice(0, maxSources).map(([title, url, summary]) => ({
        title,
        url,
        snippet: 'Pesquisa pública direta.',
        summary,
        status: 'snippet-only' as SourceStatus,
    }));
};

const compareWithContext = (context: string[], webText: string): string[] => {
    const webTerms = new Set(words(webText));
    return context.slice(0, 8)
        .map((memory, index) => {
            const overlap = [...new Set(words(memory))].filter((term) => webTerms.has(term)).slice(0, 8);
            return overlap.length
                ? `Memória ${index + 1}: encontrou sobreposição com ${overlap.join(', ')}. Rever localmente para confirmar alinhamento ou tensão.`
                : '';
        })
        .filter(Boolean)
        .slice(0, 6);
};

const setCors = (res: functions.Response): void => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Expose-Headers', 'X-RateLimit-Remaining, Retry-After');
};

const enforceAuthAndRateLimit = async (
    req: functions.Request,
    res: functions.Response,
    config: { bucket: string; max: number; windowMs: number },
    operation?: AiOperation,
): Promise<string | null> => {
    const caller = await verifyBearerIdToken(req);
    if (!caller) {
        operation?.finish('auth_required');
        res.status(401).json({
            detail: 'Autenticação obrigatória. Envia Authorization: Bearer <Firebase ID token>.',
        });
        return null;
    }

    if (!await enforceLiveAccount(caller.uid, res, operation)) return null;

    const decision = await consumeServerRateLimit(clientKeyFromRequest(req, caller.uid), config);
    res.set('X-RateLimit-Remaining', String(decision.remaining));
    if (decision.allowed) return caller.uid;
    const retrySec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    res.set('Retry-After', String(retrySec));
    operation?.finish('rate_limited');
    res.status(429).json({
        detail: `Rate limit excedido para ${config.bucket}. Tenta de novo em ~${Math.ceil(retrySec / 60)} min.`,
        retry_after_ms: decision.retryAfterMs,
        bucket: config.bucket,
    });
    return null;
};

const enforceLiveAccount = async (uid: string, res: functions.Response, operation?: AiOperation): Promise<boolean> => {
    if (await isLiveAccount(uid)) return true;
    operation?.finish('account_unavailable');
    res.status(403).json({ error: 'account_unavailable', detail: 'Conta indisponível.' });
    return false;
};

export const webResearchHandler = async (req: functions.Request, res: functions.Response): Promise<void> => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ detail: 'Method not allowed' });
        return;
    }
    const callerUid = await enforceAuthAndRateLimit(req, res, RATE_LIMITS.webResearch);
    if (!callerUid) return;

    const query = normalizeText(String(req.body?.query || ''));
    const parsedResearch = parseResearchModeAndContext(req.body?.mode, req.body?.context);
    if (!parsedResearch) {
        res.status(400).json({ detail: 'Modo ou contexto de pesquisa inválido.' });
        return;
    }
    const { mode, context } = parsedResearch;
    const maxSources = Math.max(1, Math.min(Number(req.body?.max_sources || 8), 12));
    if (query.length < 2) {
        res.status(400).json({ detail: 'A query de pesquisa está vazia.' });
        return;
    }

    let sources: WebResearchSource[];
    try {
        const searchResults = await withLiveAccount(callerUid, () => searchPublicWeb(query, maxSources));
        sources = searchResults.length
            ? await Promise.all(searchResults.map((result) => withLiveAccount(callerUid, () => fetchResearchSource(result, query))))
            : directSources(query, maxSources);
    } catch (error) {
        if (error instanceof AccountUnavailableError) {
            res.status(403).json({ error: 'account_unavailable', detail: 'Conta indisponível.' });
        } else {
            res.status(503).json({ detail: 'Pesquisa temporariamente indisponível.' });
        }
        return;
    }
    const combinedText = sources.map((source) => source.summary).filter(Boolean).join(' ');
    const keyConcepts = extractConcepts(`${query} ${combinedText}`);
    const summary = combinedText
        ? rankSummary(combinedText, query, 6)
        : `Pesquisa preparada para "${query}". Não foi possível ler resultados automaticamente, mas deixei fontes públicas diretas.`;
    const mainIdeas = sources
        .filter((source) => source.summary)
        .slice(0, 6)
        .map((source) => `${source.title}: ${source.summary}`);

    if (!await enforceLiveAccount(callerUid, res)) return;
    res.status(200).json({
        query,
        mode,
        summary,
        key_concepts: keyConcepts,
        main_ideas: mainIdeas,
        suggested_memories: keyConcepts.slice(0, 3).map((concept) => `Pesquisa web sobre ${concept}: ${summary.slice(0, 220)}`),
        sources,
        local_comparisons: context.length ? compareWithContext(context, combinedText) : [],
    });
};

const extractChatCompletionText = (payload: unknown): string => {
    const data = asRecord(payload);
    const choices = Array.isArray(data.choices) ? data.choices : [];
    for (const choice of choices) {
        const choiceRecord = asRecord(choice);
        const message = asRecord(choiceRecord.message);
        const content = getString(message.content);
        if (content) return content;
        const text = getString(choiceRecord.text);
        if (text) return text;
    }
    return '';
};

const requestChatCompletion = async (
    endpoint: string,
    apiKey: string,
    model: string,
    prompt: string,
    maxTokens: number,
    timeoutMs: number,
): Promise<{ text: string; model: string }> => {
    const response = await fetchProviderResponse(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: 'system',
                    content: [
                        'És o assistente do Mnemosyne Cognitive OS.',
                        'Responde em português europeu por defeito.',
                        'Entrega texto claro, útil e pronto para o utilizador rever ou guardar como memória.',
                    ].join(' '),
                },
                { role: 'user', content: prompt },
            ],
            ...(['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b'].includes(model)
                ? { temperature: 1, top_p: 0.95, chat_template_kwargs: { enable_thinking: false } }
                : { temperature: 0.4 }),
            max_tokens: maxTokens,
            stream: false,
        }),
    }, timeoutMs, 1024 * 1024);

    if (!response.ok) {
        throw new ProviderHttpError(response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const text = extractChatCompletionText(data);
    if (!text) throw new Error('resposta vazia');
    return { text, model: reportedTextModel(data.model, model) };
};

const generateTextWithHuggingFace = async (
    prompt: string,
    requestedModel: string | undefined,
    maxTokens: number,
): Promise<GenerationResponsePayload> => {
    const apiKey = envValue('HUGGINGFACE_API_KEY');
    if (!apiKey) throw new Error('HUGGINGFACE_API_KEY não configurada');
    const model = requestedModel || 'openai/gpt-oss-120b:nscale';
    const result = await requestChatCompletion('https://router.huggingface.co/v1/chat/completions', apiKey, model, prompt, maxTokens, GENERATION_HTTP_POLICY.text.providerTimeoutMs);
    return { ...result, provider: 'huggingface-nscale' };
};

const generateTextWithNvidia = async (
    prompt: string,
    requestedModel: string | undefined,
    maxTokens: number,
): Promise<GenerationResponsePayload> => {
    const apiKey = envValue('NVIDIA_API_KEY');
    if (!apiKey) throw new Error('NVIDIA_API_KEY não configurada');
    const model = requestedModel || 'nvidia/nemotron-3-super-120b-a12b';
    const result = await requestChatCompletion('https://integrate.api.nvidia.com/v1/chat/completions', apiKey, model, prompt, maxTokens, GENERATION_HTTP_POLICY.text.providerTimeoutMs);
    return { ...result, provider: 'nvidia-nim' };
};

const generateTextWithOpenAI = async (
    prompt: string,
    requestedModel: string | undefined,
    maxTokens: number,
): Promise<GenerationResponsePayload> => {
    const apiKey = envValue('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');
    const baseUrl = normalizeBaseUrl(envValue('OPENAI_API_BASE_URL') || 'https://api.openai.com/v1');
    const model = requestedModel || 'gpt-4o-mini';
    const result = await requestChatCompletion(`${baseUrl}/chat/completions`, apiKey, model, prompt, maxTokens, GENERATION_HTTP_POLICY.text.providerTimeoutMs);
    return { ...result, provider: 'openai' };
};

const generateImageWithHuggingFace = async (
    prompt: string,
    requestedModel: string | undefined,
    size: unknown,
    _quality: unknown,
): Promise<ImageGenerationResponsePayload> => {
    const apiKey = envValue('HUGGINGFACE_API_KEY');
    if (!apiKey) throw new Error('HUGGINGFACE_API_KEY não configurada');
    const model = requestedModel || 'black-forest-labs/FLUX.1-schnell';
    const { width, height } = imageSizeToDimensions(size);
    const response = await fetchProviderResponse('https://router.huggingface.co/nscale/v1/images/generations', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            model,
            prompt,
            size: `${width}x${height}`,
            n: 1,
            response_format: 'b64_json',
        }),
    }, 60000, 16 * 1024 * 1024);

    if (!response.ok) {
        throw new ProviderHttpError(response.status);
    }

    const data = await response.json() as { data?: Array<{ b64_json?: string }> };
    return {
        ...decodeProviderImage(data.data?.[0]?.b64_json),
        image_url: null,
        model,
        provider: 'huggingface-nscale',
        revised_prompt: null,
    };
};

const generateImageWithNvidia = async (
    prompt: string,
    requestedModel: string | undefined,
    size: unknown,
    _quality: unknown,
): Promise<ImageGenerationResponsePayload> => {
    const apiKey = envValue('NVIDIA_API_KEY');
    if (!apiKey) throw new Error('NVIDIA_API_KEY não configurada');
    const model = requestedModel || 'black-forest-labs/flux.1-schnell';
    const url = `https://ai.api.nvidia.com/v1/genai/${model}`;
    const { width, height } = imageSizeToDimensions(size);

    const response = await fetchProviderResponse(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            prompt: normalizeText(prompt),
            height,
            width,
            cfg_scale: 0,
            mode: 'base',
            image: null,
            steps: 4,
            samples: 1,
        }),
    }, GENERATION_HTTP_POLICY.image.providerTimeoutMs, 16 * 1024 * 1024);

    if (!response.ok) {
        throw new ProviderHttpError(response.status);
    }

    const data = await response.json() as { artifacts?: Array<{ base64?: string }> };
    const artifacts = data.artifacts || [];
    if (!artifacts.length || !artifacts[0].base64) {
        throw new Error('NVIDIA NIM não devolveu bytes de imagem');
    }

    return {
        ...decodeProviderImage(artifacts[0].base64),
        image_url: null,
        model,
        provider: 'nvidia',
        revised_prompt: null,
    };
};

const generateImageWithOpenAI = async (
    prompt: string,
    requestedModel: string | undefined,
    size: unknown,
    quality: unknown,
): Promise<ImageGenerationResponsePayload> => {
    const apiKey = envValue('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');
    const baseUrl = normalizeBaseUrl(envValue('OPENAI_API_BASE_URL') || 'https://api.openai.com/v1');
    const model = requestedModel || envValue('OPENAI_IMAGE_MODEL') || 'dall-e-3';
    const { width, height } = imageSizeToDimensions(size);

    const response = await fetchProviderResponse(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            prompt: normalizeText(prompt),
            n: 1,
            size: `${width}x${height}`,
            response_format: 'b64_json',
        }),
    }, GENERATION_HTTP_POLICY.image.providerTimeoutMs, 16 * 1024 * 1024);

    if (!response.ok) {
        throw new ProviderHttpError(response.status);
    }

    const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
    const items = data.data || [];
    if (!items.length) {
        throw new Error('OpenAI não devolveu dados de imagem');
    }

    return {
        ...decodeProviderImage(items[0].b64_json),
        image_url: null,
        model,
        provider: 'openai',
        revised_prompt: items[0].revised_prompt || null,
    };
};

export const generateTextHandler = observeAiHandler('text', async (req, res, operation) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        operation.finish('method_not_allowed');
        res.status(405).json({ detail: 'Method not allowed' });
        return;
    }
    const callerUid = await enforceAuthAndRateLimit(req, res, RATE_LIMITS.generateText, operation);
    if (!callerUid) return;

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
        Object.keys(req.body).some(key => !['prompt', 'model', 'max_tokens', 'scope', 'expectedUid'].includes(key)) || typeof req.body.prompt !== 'string') {
        operation.finish('invalid_request');
        res.status(400).json({ detail: 'Pedido de geração inválido.' }); return;
    }
    const scope = parseAiGenerationScope(req.body.scope);
    if (!scope || (scope.kind === 'team' && req.body.expectedUid === undefined)) {
        operation.finish('invalid_request');
        res.status(400).json({ detail: 'Âmbito de geração inválido.' }); return;
    }
    if (req.body.expectedUid !== undefined && (!attachmentActorIdValid(req.body.expectedUid) || req.body.expectedUid !== callerUid)) {
        operation.finish('access_changed');
        res.status(403).json({ error: 'ai_access_changed', detail: 'A conta da operação mudou.' }); return;
    }
    const prompt = normalizeText(req.body.prompt);
    if (prompt.length < 2 || prompt.length > 4000) {
        operation.finish('invalid_request');
        res.status(400).json({ detail: 'O prompt deve ter entre 2 e 4000 caracteres.' });
        return;
    }

    const model = resolveTextModel(req.body?.model);
    if (!model || !validTextTokenRequest(req.body?.max_tokens, model)) {
        operation.finish('invalid_request');
        res.status(400).json({ detail: 'Modelo ou limite de tokens não permitido.' });
        return;
    }
    if (!isGenerationProviderEnabled(model.provider)) {
        operation.finish('invalid_request');
        res.status(400).json({ error: 'ai_provider_disabled', detail: 'Fornecedor não ativo neste lançamento.' }); return;
    }
    const maxTokens = req.body?.max_tokens === undefined ? model.maxOutputTokens : req.body.max_tokens as number;
    operation.bind(model.id, scope.kind, Buffer.byteLength(prompt, 'utf8'));
    const attempt = await beginProviderAttempt(`text_${model.provider}`);
    if (!attempt) {
        operation.finish('circuit_unavailable');
        res.status(503).json({ error: 'ai_unavailable', detail: 'Fornecedor de texto temporariamente indisponível.' });
        return;
    }
    const decision = await reserveAiGenerationBudget(callerUid, { kind: 'text', modelId: model.id,
        promptBytes: Buffer.byteLength(prompt, 'utf8'), outputTokens: maxTokens, scope });
    if (!decision.admitted) {
        await releaseProviderAttempt(attempt);
        operation.finish(decision.reason === 'denied' ? 'admission_denied' : decision.reason === 'exhausted' ? 'budget_exhausted' : 'budget_unavailable');
        res.status(decision.reason === 'denied' ? 403 : decision.reason === 'exhausted' ? 429 : 503)
            .json({ error: 'ai_admission_denied', detail: 'Não foi possível autorizar a geração dentro dos limites de IA.' });
        return;
    }
    operation.reservation(maxTokens);
    const provider = {
        huggingface: generateTextWithHuggingFace,
        nvidia: generateTextWithNvidia,
        openai: generateTextWithOpenAI,
        gemini: (prompt: string, model: string, maxTokens: number) => generateGeminiText(prompt, model, maxTokens, readSecret(geminiApiKey, 'GEMINI_API_KEY')),
        openrouter: (prompt: string, model: string, maxTokens: number) => generateOpenRouterFreeText(prompt, model, maxTokens, readSecret(openrouterApiKey, 'OPENROUTER_API_KEY')),
    }[model.provider];
    try {
        const generated = await withLiveAccount(callerUid, async () => {
            if (!await isAiGenerationAdmissionLive(decision.admission)) throw new AiGenerationAccessError();
            operation.providerAttempt();
            const result = await provider(prompt, model.externalModel, maxTokens);
            if (!await isAiGenerationAdmissionLive(decision.admission)) throw new AiGenerationAccessError();
            return result;
        });
        await finishProviderAttempt(attempt, true);
        if (!await enforceLiveAccount(callerUid, res, operation)) return;
        if (!await isAiGenerationAdmissionLive(decision.admission)) {
            operation.finish('access_changed');
            res.status(403).json({ error: 'ai_access_changed', detail: 'O acesso à operação mudou.' }); return;
        }
        operation.finish('success');
        res.status(200).json({ ...generated, cost_reference: { unit: 'relative', reserved: model.costUnitsPerRequest,
            input_token_units_reserved: Buffer.byteLength(prompt, 'utf8') + AI_INPUT_OVERHEAD_RESERVATION,
            output_tokens_reserved: maxTokens } });
    } catch (error) {
        if (error instanceof AiGenerationAccessError) {
            await releaseProviderAttempt(attempt);
            if (!await enforceLiveAccount(callerUid, res, operation)) return;
            operation.finish('access_changed');
            res.status(403).json({ error: 'ai_access_changed', detail: 'O acesso à operação mudou.' }); return;
        }
        if (error instanceof AccountUnavailableError) {
            await releaseProviderAttempt(attempt);
            operation.finish('account_unavailable');
            res.status(403).json({ error: 'account_unavailable', detail: 'Conta indisponível.' });
            return;
        }
        const circuitFailure = shouldTripProviderCircuit(error);
        await finishProviderAttempt(attempt, !circuitFailure);
        if (error instanceof ProviderHttpError && !circuitFailure) {
            operation.finish('provider_rejected');
            res.status(422).json({ error: 'ai_rejected', detail: 'Pedido rejeitado pelo fornecedor de texto.' });
        } else {
            operation.finish('provider_failed');
            res.status(503).json({ error: 'ai_unavailable', detail: 'Fornecedor de texto indisponível de momento.' });
        }
    }
});

export const generateImageHandler = observeAiHandler('image', async (req, res, operation) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        operation.finish('method_not_allowed');
        res.status(405).json({ detail: 'Method not allowed' });
        return;
    }
    const callerUid = await enforceAuthAndRateLimit(req, res, RATE_LIMITS.generateImage, operation);
    if (!callerUid) return;

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
        Object.keys(req.body).some(key => !['prompt', 'model', 'size', 'quality', 'scope', 'expectedUid'].includes(key)) || typeof req.body.prompt !== 'string') {
        operation.finish('invalid_request');
        res.status(400).json({ detail: 'Pedido de geração inválido.' }); return;
    }
    const scope = parseAiGenerationScope(req.body.scope);
    if (!scope || (scope.kind === 'team' && req.body.expectedUid === undefined)) {
        operation.finish('invalid_request');
        res.status(400).json({ detail: 'Âmbito de geração inválido.' }); return;
    }
    if (req.body.expectedUid !== undefined && (!attachmentActorIdValid(req.body.expectedUid) || req.body.expectedUid !== callerUid)) {
        operation.finish('access_changed');
        res.status(403).json({ error: 'ai_access_changed', detail: 'A conta da operação mudou.' }); return;
    }
    const prompt = normalizeText(req.body.prompt);
    if (prompt.length < 2 || prompt.length > 2000) {
        operation.finish('invalid_request');
        res.status(400).json({ detail: 'O prompt deve ter entre 2 e 2000 caracteres.' });
        return;
    }

    const model = resolveImageModel(req.body?.model);
    if (!model || !validImageOptions(req.body?.size, req.body?.quality)) {
        operation.finish('invalid_request');
        res.status(400).json({ detail: 'Modelo, tamanho ou qualidade de imagem não permitido.' });
        return;
    }
    if (!isGenerationProviderEnabled(model.provider)) {
        operation.finish('invalid_request');
        res.status(400).json({ error: 'ai_provider_disabled', detail: 'Fornecedor não ativo neste lançamento.' }); return;
    }
    operation.bind(model.id, scope.kind, Buffer.byteLength(prompt, 'utf8'));
    const attempt = await beginProviderAttempt(`image_${model.provider}`);
    if (!attempt) {
        operation.finish('circuit_unavailable');
        res.status(503).json({ error: 'ai_unavailable', detail: 'Fornecedor de imagem temporariamente indisponível.' });
        return;
    }
    const decision = await reserveAiGenerationBudget(callerUid, { kind: 'image', modelId: model.id,
        promptBytes: Buffer.byteLength(prompt, 'utf8'), outputTokens: 0, scope });
    if (!decision.admitted) {
        await releaseProviderAttempt(attempt);
        operation.finish(decision.reason === 'denied' ? 'admission_denied' : decision.reason === 'exhausted' ? 'budget_exhausted' : 'budget_unavailable');
        res.status(decision.reason === 'denied' ? 403 : decision.reason === 'exhausted' ? 429 : 503)
            .json({ error: 'ai_admission_denied', detail: 'Não foi possível autorizar a geração dentro dos limites de IA.' });
        return;
    }
    operation.reservation(0);
    const provider = {
        huggingface: generateImageWithHuggingFace,
        nvidia: generateImageWithNvidia,
        openai: generateImageWithOpenAI,
        gemini: (prompt: string, model: string) => generateGeminiImage(prompt, model, readSecret(geminiApiKey, 'GEMINI_API_KEY')),
    }[model.provider];
    try {
        const generated = await withLiveAccount(callerUid, async () => {
            if (!await isAiGenerationAdmissionLive(decision.admission)) throw new AiGenerationAccessError();
            operation.providerAttempt();
            const result = await provider(prompt, model.externalModel, `${model.width}x${model.height}`, 'medium');
            if (!await isAiGenerationAdmissionLive(decision.admission)) throw new AiGenerationAccessError();
            return result;
        });
        await finishProviderAttempt(attempt, true);
        if (!await enforceLiveAccount(callerUid, res, operation)) return;
        if (!await isAiGenerationAdmissionLive(decision.admission)) {
            operation.finish('access_changed');
            res.status(403).json({ error: 'ai_access_changed', detail: 'O acesso à operação mudou.' }); return;
        }
        operation.finish('success');
        res.status(200).json({ ...generated, cost_reference: { unit: 'relative', reserved: model.costUnitsPerRequest,
            input_token_units_reserved: Buffer.byteLength(prompt, 'utf8') + AI_INPUT_OVERHEAD_RESERVATION,
            output_tokens_reserved: 0 } });
    } catch (error) {
        if (error instanceof AiGenerationAccessError) {
            await releaseProviderAttempt(attempt);
            if (!await enforceLiveAccount(callerUid, res, operation)) return;
            operation.finish('access_changed');
            res.status(403).json({ error: 'ai_access_changed', detail: 'O acesso à operação mudou.' }); return;
        }
        if (error instanceof AccountUnavailableError) {
            await releaseProviderAttempt(attempt);
            operation.finish('account_unavailable');
            res.status(403).json({ error: 'account_unavailable', detail: 'Conta indisponível.' });
            return;
        }
        const circuitFailure = shouldTripProviderCircuit(error);
        await finishProviderAttempt(attempt, !circuitFailure);
        if (error instanceof ProviderHttpError && !circuitFailure) {
            operation.finish('provider_rejected');
            res.status(422).json({ error: 'ai_rejected', detail: 'Pedido rejeitado pelo fornecedor de imagem.' });
        } else {
            operation.finish('provider_failed');
            res.status(503).json({ error: 'ai_unavailable', detail: 'Fornecedor de imagem indisponível de momento.' });
        }
    }
});
