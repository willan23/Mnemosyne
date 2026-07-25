import * as functions from 'firebase-functions/v1';
import * as cheerio from 'cheerio';
import { clientKeyFromRequest, consumeServerRateLimit, RATE_LIMITS } from './rateLimit';

type ResearchMode = 'public' | 'contextual' | 'private-local';
type SourceStatus = 'read' | 'snippet-only' | 'failed';

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

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const HUGGINGFACE_TEXT_MODEL_DEFAULT = 'openai/gpt-oss-120b:cheapest';
const HUGGINGFACE_IMAGE_MODEL_DEFAULT = 'black-forest-labs/FLUX.1-schnell';
const OPENAI_TEXT_MODEL_DEFAULT = 'gpt-4o-mini';
const NVIDIA_TEXT_MODEL_DEFAULT = 'meta/llama-3.1-70b-instruct';
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
        const value = process.env[name]?.trim();
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

const maxTokensFromBody = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? clampNumber(Math.floor(parsed), 64, 4096) : 900;
};

const imageSizeToDimensions = (size: unknown): { width: number; height: number } => {
    const match = /^(\d{3,4})x(\d{3,4})$/.exec(String(size || '1024x1024'));
    if (!match) return { width: 1024, height: 1024 };
    return {
        width: clampNumber(Number(match[1]), 256, 1024),
        height: clampNumber(Number(match[2]), 256, 1024),
    };
};

const imageQualityToSteps = (quality: unknown): number => {
    const normalized = String(quality || '').toLowerCase();
    if (normalized === 'high') return 8;
    if (normalized === 'low') return 2;
    return 4;
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
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
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
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

const fetchText = async (url: string, init?: RequestInit): Promise<string> => {
    const response = await fetch(url, {
        ...init,
        headers: {
            'user-agent': USER_AGENT,
            ...(init?.headers || {}),
        },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
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
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = await response.json() as [string, string[], string[], string[]];
    const titles = Array.isArray(payload[1]) ? payload[1] : [];
    const snippets = Array.isArray(payload[2]) ? payload[2] : [];
    const urls = Array.isArray(payload[3]) ? payload[3] : [];
    return titles
        .map((title, index) => ({ title, snippet: snippets[index] || '', url: urls[index] || '' }))
        .filter((result) => isUsableUrl(result.url))
        .slice(0, maxSources);
};

const searchPublicWeb = async (query: string, maxSources: number): Promise<WebSearchResult[]> => {
    const collected: WebSearchResult[] = [];
    const seen = new Set<string>();
    for (const searcher of [searchDuckDuckGo, searchWikipedia]) {
        if (collected.length >= maxSources) break;
        try {
            const results = await searcher(query, maxSources);
            for (const result of results) {
                if (seen.has(result.url) || !isUsableUrl(result.url)) continue;
                seen.add(result.url);
                collected.push(result);
                if (collected.length >= maxSources) break;
            }
        } catch (error) {
            console.warn(`Search provider failed: ${error instanceof Error ? error.message : String(error)}`);
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
        const response = await fetch(result.url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.includes('text/html')) {
            return {
                title: result.title,
                url: result.url,
                snippet: result.snippet,
                summary: rankSummary(result.snippet || result.title, query, 1),
                status: 'snippet-only',
            };
        }
        const { title, text } = extractPageText(await response.text());
        if (text.length < 160) {
            return {
                title: title || result.title,
                url: response.url || result.url,
                snippet: result.snippet,
                summary: rankSummary([result.snippet, text, result.title].join(' '), query, 1),
                status: 'snippet-only',
            };
        }
        return {
            title: title || result.title,
            url: response.url || result.url,
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

const enforceRateLimit = async (
    req: functions.Request,
    res: functions.Response,
    config: { bucket: string; max: number; windowMs: number },
): Promise<boolean> => {
    const decision = await consumeServerRateLimit(clientKeyFromRequest(req), config);
    res.set('X-RateLimit-Remaining', String(decision.remaining));
    if (decision.allowed) return true;
    const retrySec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    res.set('Retry-After', String(retrySec));
    res.status(429).json({
        detail: `Rate limit excedido para ${config.bucket}. Tenta de novo em ~${Math.ceil(retrySec / 60)} min.`,
        retry_after_ms: decision.retryAfterMs,
        bucket: config.bucket,
    });
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
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.webResearch))) return;

    const query = normalizeText(String(req.body?.query || ''));
    const mode = (req.body?.mode || 'public') as ResearchMode;
    const context = Array.isArray(req.body?.context) ? req.body.context.filter((item: unknown): item is string => typeof item === 'string') : [];
    const maxSources = Math.max(1, Math.min(Number(req.body?.max_sources || 8), 12));
    if (query.length < 2) {
        res.status(400).json({ detail: 'A query de pesquisa está vazia.' });
        return;
    }

    const searchResults = await searchPublicWeb(query, maxSources);
    const sources = searchResults.length
        ? await Promise.all(searchResults.map((result) => fetchResearchSource(result, query)))
        : directSources(query, maxSources);
    const combinedText = sources.map((source) => source.summary).filter(Boolean).join(' ');
    const keyConcepts = extractConcepts(`${query} ${combinedText}`);
    const summary = combinedText
        ? rankSummary(combinedText, query, 6)
        : `Pesquisa preparada para "${query}". Não foi possível ler resultados automaticamente, mas deixei fontes públicas diretas.`;
    const mainIdeas = sources
        .filter((source) => source.summary)
        .slice(0, 6)
        .map((source) => `${source.title}: ${source.summary}`);

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

const fallbackGeneratedText = (prompt: string): string => {
    const normalized = normalizeText(prompt);
    const conceptLine = extractConcepts(normalized, 6).join(', ') || 'tema principal';
    if (/\b(frase curta|slogan|uma frase)\b/i.test(normalized)) {
        return 'Mnemosyne transforma memórias dispersas num universo vivo, pesquisável e pronto para agir.';
    }
    if (/\b(lista|checklist|passos)\b/i.test(normalized)) {
        return [
            `Checklist para: ${normalized}`,
            '',
            '1. Definir o objetivo em uma frase.',
            '2. Separar factos confirmados de hipóteses.',
            '3. Recolher fontes ou memórias relevantes.',
            '4. Criar uma ação concreta para o próximo passo.',
            '5. Guardar o resultado como memória ligada ao tema.',
        ].join('\n');
    }
    if (/\b(resumo|resumir|sumariza)\b/i.test(normalized)) {
        return `Resumo de trabalho sobre ${conceptLine}:\n\nO pedido aponta para organizar informação dispersa num formato curto e acionável. A versão final deve destacar o ponto central, as evidências principais e a próxima decisão prática.`;
    }
    return [
        'Rascunho gerado a partir do pedido:',
        '',
        normalized,
        '',
        'Estrutura sugerida:',
        `1. Contexto: delimitar ${conceptLine} e explicar por que isto importa agora.`,
        '2. Desenvolvimento: separar factos, hipóteses e próximos passos.',
        '3. Ação: transformar o resultado numa memória, plano ou checklist verificável.',
    ].join('\n');
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
): Promise<string> => {
    const response = await fetchWithTimeout(endpoint, {
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
            temperature: 0.4,
            max_tokens: maxTokens,
            stream: false,
        }),
    }, timeoutMs);

    if (!response.ok) {
        const detail = (await response.text()).slice(0, 320);
        throw new Error(`${response.status} ${response.statusText} ${detail}`.trim());
    }

    const text = extractChatCompletionText(await response.json());
    if (!text) throw new Error('resposta vazia');
    return text;
};

const generateTextWithHuggingFace = async (
    prompt: string,
    requestedModel: string | undefined,
    maxTokens: number,
): Promise<GenerationResponsePayload> => {
    const apiKey = envValue('HUGGINGFACE_API_KEY', 'HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN');
    if (!apiKey) throw new Error('HUGGINGFACE_API_KEY/HF_TOKEN não configurada');
    const baseUrl = normalizeBaseUrl(envValue('HUGGINGFACE_API_BASE_URL') || 'https://router.huggingface.co');
    const model = requestedModel || envValue('HUGGINGFACE_TEXT_MODEL') || HUGGINGFACE_TEXT_MODEL_DEFAULT;
    const text = await requestChatCompletion(`${baseUrl}/v1/chat/completions`, apiKey, model, prompt, maxTokens, 22000);
    return { text, model, provider: 'huggingface' };
};

const generateTextWithNvidia = async (
    prompt: string,
    requestedModel: string | undefined,
    maxTokens: number,
): Promise<GenerationResponsePayload> => {
    const apiKey = envValue('NVIDIA_API_KEY', 'NVIDIA_API_KEY_FAST', 'NVIDIA_API_KEY_CORE');
    if (!apiKey) throw new Error('NVIDIA_API_KEY não configurada');
    const baseUrl = normalizeBaseUrl(envValue('NVIDIA_BASE_URL') || 'https://integrate.api.nvidia.com/v1');
    const model = requestedModel || envValue('NVIDIA_MODEL_FAST', 'NVIDIA_MODEL_CORE') || NVIDIA_TEXT_MODEL_DEFAULT;
    const text = await requestChatCompletion(`${baseUrl}/chat/completions`, apiKey, model, prompt, maxTokens, 30000);
    return { text, model, provider: 'nvidia-nim' };
};

const generateTextWithOpenAI = async (
    prompt: string,
    requestedModel: string | undefined,
    maxTokens: number,
): Promise<GenerationResponsePayload> => {
    const apiKey = envValue('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');
    const baseUrl = normalizeBaseUrl(envValue('OPENAI_API_BASE_URL') || 'https://api.openai.com/v1');
    const model = requestedModel || envValue('OPENAI_TEXT_MODEL') || OPENAI_TEXT_MODEL_DEFAULT;
    const text = await requestChatCompletion(`${baseUrl}/chat/completions`, apiKey, model, prompt, maxTokens, 30000);
    return { text, model, provider: 'openai' };
};

const generateImageWithHuggingFace = async (
    prompt: string,
    requestedModel: string | undefined,
    size: unknown,
    quality: unknown,
): Promise<ImageGenerationResponsePayload> => {
    const apiKey = envValue('HUGGINGFACE_API_KEY', 'HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN');
    if (!apiKey) throw new Error('HUGGINGFACE_API_KEY/HF_TOKEN não configurada');
    const model = requestedModel || envValue('HUGGINGFACE_IMAGE_MODEL') || HUGGINGFACE_IMAGE_MODEL_DEFAULT;
    const { width, height } = imageSizeToDimensions(size);
    const response = await fetchWithTimeout(`https://api-inference.huggingface.co/models/${model}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'image/png',
        },
        body: JSON.stringify({
            inputs: prompt,
            parameters: {
                width,
                height,
                num_inference_steps: imageQualityToSteps(quality),
            },
        }),
    }, 60000);

    if (!response.ok) {
        const detail = (await response.text()).slice(0, 320);
        throw new Error(`${response.status} ${response.statusText} ${detail}`.trim());
    }

    const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    if (mediaType.includes('application/json')) {
        const detail = (await response.text()).slice(0, 320);
        throw new Error(`sem bytes de imagem: ${detail}`);
    }

    const imageBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    return {
        image_base64: imageBase64,
        image_url: null,
        media_type: mediaType,
        model,
        provider: 'huggingface',
        revised_prompt: null,
    };
};

const generateImageWithPollinations = async (
    prompt: string,
    requestedModel: string | undefined,
    size: unknown,
    quality: unknown,
): Promise<ImageGenerationResponsePayload> => {
    const { width, height } = imageSizeToDimensions(size);
    const seed = Math.floor(Math.random() * 1000000);
    const encodedPrompt = encodeURIComponent(normalizeText(prompt));
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;

    const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { 'Accept': 'image/jpeg, image/png, image/*' },
    }, 45000);

    if (!response.ok) {
        throw new Error(`Pollinations falhou: ${response.status}`);
    }

    const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    const imageBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    return {
        image_base64: imageBase64,
        image_url: url,
        media_type: mediaType,
        model: 'flux-pollinations',
        provider: 'pollinations',
        revised_prompt: null,
    };
};

const generateImageWithNvidia = async (
    prompt: string,
    requestedModel: string | undefined,
    size: unknown,
    quality: unknown,
): Promise<ImageGenerationResponsePayload> => {
    const apiKey = envValue('NVIDIA_API_KEY', 'NVIDIA_API_KEY_FAST', 'NVIDIA_API_KEY_CORE');
    if (!apiKey) throw new Error('NVIDIA_API_KEY não configurada');
    const model = requestedModel || envValue('NVIDIA_IMAGE_MODEL') || 'stabilityai/sdxl-turbo';
    const url = `https://ai.api.nvidia.com/v1/genai/${model}`;

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            text_prompts: [{ text: normalizeText(prompt), weight: 1 }],
            cfg_scale: 7,
            steps: 25,
            samples: 1,
        }),
    }, 120000);

    if (!response.ok) {
        const detail = (await response.text()).slice(0, 320);
        throw new Error(`NVIDIA NIM imagem falhou: ${response.status} ${response.statusText} ${detail}`);
    }

    const data = await response.json() as { artifacts?: Array<{ base64?: string }> };
    const artifacts = data.artifacts || [];
    if (!artifacts.length || !artifacts[0].base64) {
        throw new Error('NVIDIA NIM não devolveu bytes de imagem');
    }

    return {
        image_base64: artifacts[0].base64,
        image_url: null,
        media_type: 'image/png',
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

    const response = await fetchWithTimeout(`${baseUrl}/images/generations`, {
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
    }, 120000);

    if (!response.ok) {
        const detail = (await response.text()).slice(0, 320);
        throw new Error(`OpenAI imagem falhou: ${response.status} ${response.statusText} ${detail}`);
    }

    const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
    const items = data.data || [];
    if (!items.length) {
        throw new Error('OpenAI não devolveu dados de imagem');
    }

    return {
        image_base64: items[0].b64_json || null,
        image_url: items[0].url || null,
        media_type: 'image/png',
        model,
        provider: 'openai',
        revised_prompt: items[0].revised_prompt || null,
    };
};

export const generateTextHandler = async (req: functions.Request, res: functions.Response): Promise<void> => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ detail: 'Method not allowed' });
        return;
    }
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.generateText))) return;

    const prompt = normalizeText(String(req.body?.prompt || ''));
    if (prompt.length < 2) {
        res.status(400).json({ detail: 'O prompt está vazio.' });
        return;
    }

    const model = getString(req.body?.model);
    const maxTokens = maxTokensFromBody(req.body?.max_tokens);
    const warnings: string[] = [];
    for (const provider of [generateTextWithHuggingFace, generateTextWithNvidia, generateTextWithOpenAI]) {
        try {
            const generated = await provider(prompt, model, maxTokens);
            res.status(200).json(generated);
            return;
        } catch (error) {
            warnings.push(error instanceof Error ? error.message.slice(0, 180) : 'provider indisponível');
        }
    }

    res.status(200).json({
        text: fallbackGeneratedText(prompt),
        model: model || null,
        provider: 'firebase-fallback',
        warning: warnings.join(' | '),
    });
};

export const generateImageHandler = async (req: functions.Request, res: functions.Response): Promise<void> => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ detail: 'Method not allowed' });
        return;
    }
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.generateImage))) return;

    const prompt = normalizeText(String(req.body?.prompt || ''));
    if (prompt.length < 2) {
        res.status(400).json({ detail: 'O prompt está vazio.' });
        return;
    }

    const model = getString(req.body?.model);
    const size = req.body?.size;
    const quality = req.body?.quality;
    const warnings: string[] = [];

    for (const provider of [generateImageWithNvidia, generateImageWithHuggingFace, generateImageWithOpenAI, generateImageWithPollinations]) {
        try {
            const generated = await provider(prompt, model, size, quality);
            res.status(200).json(generated);
            return;
        } catch (error) {
            warnings.push(error instanceof Error ? error.message.slice(0, 180) : 'provider indisponível');
        }
    }

    res.status(503).json({
        detail: `Nenhum provider de imagem conseguiu gerar o resultado. ${warnings.join(' | ')}`,
    });
};
