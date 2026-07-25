import { getLocalAiConfig } from './localAiConfig';

const productionAiBackendBaseUrl = 'https://mnemosyne-one.web.app';

const normalizeBase = (value: string): string =>
  value.trim()
    .replace(/\/api\/v1\/generate\/?$/i, '')
    .replace(/\/api\/v1\/images\/generate\/?$/i, '')
    .replace(/\/api\/v1\/web\/research\/?$/i, '')
    .replace(/\/+$/, '');

const unique = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.map((value) => value ? normalizeBase(value) : '').filter(Boolean)));

const imageModelOrUndefined = (model?: string): string | undefined => {
  const normalized = model?.trim();
  if (!normalized) return undefined;
  return /^(?:gpt-image-|dall-e-|chatgpt-image-)/i.test(normalized) ? normalized : undefined;
};

async function requestBackendGeneration(baseUrl: string, prompt: string, model?: string): Promise<string> {
  const response = await fetch(`${normalizeBase(baseUrl)}/api/v1/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: model || undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }

  const payload = await response.json() as { text?: string; response?: string; output?: string };
  return (payload.text || payload.response || payload.output || '').trim();
}

export interface GeneratedImageResult {
  imageBase64?: string;
  imageUrl?: string;
  dataUrl?: string;
  mediaType: string;
  model?: string;
  provider: string;
  revisedPrompt?: string;
  warning?: string;
}

async function requestBackendImageGeneration(baseUrl: string, prompt: string, model?: string): Promise<GeneratedImageResult> {
  const response = await fetch(`${normalizeBase(baseUrl)}/api/v1/images/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: model || undefined,
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail || `${response.status} ${response.statusText}`.trim());
  }

  const payload = await response.json() as {
    image_base64?: string | null;
    image_url?: string | null;
    media_type?: string;
    model?: string;
    provider?: string;
    revised_prompt?: string | null;
    warning?: string | null;
  };
  const mediaType = payload.media_type || 'image/png';
  const imageBase64 = payload.image_base64 || undefined;
  const imageUrl = payload.image_url || undefined;
  return {
    imageBase64,
    imageUrl,
    dataUrl: imageBase64 ? `data:${mediaType};base64,${imageBase64}` : undefined,
    mediaType,
    model: payload.model,
    provider: payload.provider || 'backend',
    revisedPrompt: payload.revised_prompt || undefined,
    warning: payload.warning || undefined,
  };
}

async function generateWithBackendFallback(prompt: string, preferredBase?: string, model?: string): Promise<string> {
  const webResearchEndpoint = import.meta.env.VITE_WEB_RESEARCH_ENDPOINT as string | undefined;
  const candidates = unique([
    preferredBase,
    import.meta.env.VITE_API_URL as string | undefined,
    'http://localhost:8000',
    webResearchEndpoint,
    'https://mnemosyne-web-research-tq3vyofasq-ew.a.run.app',
    productionAiBackendBaseUrl,
  ]);

  const failures: string[] = [];
  for (const baseUrl of candidates) {
    try {
      const generated = await requestBackendGeneration(baseUrl, prompt, model);
      if (generated) return generated;
      failures.push(`${baseUrl}: resposta vazia`);
    } catch (error) {
      failures.push(`${baseUrl}: ${error instanceof Error ? error.message : 'indisponível'}`);
    }
  }

  throw new Error(`Backend de geração indisponível. ${failures.join(' | ')}`);
}

async function generateImageWithBackendFallback(prompt: string, preferredBase?: string, model?: string): Promise<GeneratedImageResult> {
  const webResearchEndpoint = import.meta.env.VITE_WEB_RESEARCH_ENDPOINT as string | undefined;
  const candidates = unique([
    preferredBase,
    import.meta.env.VITE_API_URL as string | undefined,
    'http://localhost:8000',
    webResearchEndpoint,
    'https://mnemosyne-web-research-tq3vyofasq-ew.a.run.app',
    productionAiBackendBaseUrl,
  ]);

  const failures: string[] = [];
  for (const baseUrl of candidates) {
    try {
      const generated = await requestBackendImageGeneration(baseUrl, prompt, model);
      if (generated.dataUrl || generated.imageUrl) return generated;
      failures.push(`${baseUrl}: resposta vazia`);
    } catch (error) {
      failures.push(`${baseUrl}: ${error instanceof Error ? error.message : 'indisponível'}`);
    }
  }

  throw new Error(`Backend de imagem indisponível. ${failures.join(' | ')}`);
}

export async function generateTextFromPrompt(prompt: string): Promise<string> {
  const config = getLocalAiConfig();
  const provider = config.providers[config.primaryProvider];

  if (config.primaryProvider === 'ollama') {
    if (!provider.model) return generateWithBackendFallback(prompt);

    try {
      const response = await fetch(`${provider.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: provider.model,
          prompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama indisponível: ${response.statusText || response.status}`);
      }

      const payload = await response.json() as { response?: string };
      const generated = payload.response?.trim() || '';
      if (generated) return generated;
    } catch (error) {
      console.warn('Ollama generation unavailable, trying backend fallback:', error);
    }

    return generateWithBackendFallback(prompt);
  }

  if (config.primaryProvider === 'nvidia') {
    return generateWithBackendFallback(prompt, provider.endpoint, provider.model);
  }

  return generateWithBackendFallback(prompt);
}

export async function generateImageFromPrompt(prompt: string): Promise<GeneratedImageResult> {
  const config = getLocalAiConfig();
  const provider = config.providers[config.primaryProvider];

  if (config.primaryProvider === 'nvidia') {
    return generateImageWithBackendFallback(prompt, provider.endpoint, imageModelOrUndefined(provider.model));
  }

  if (config.primaryProvider === 'openai') {
    return generateImageWithBackendFallback(prompt, provider.endpoint, imageModelOrUndefined(provider.model));
  }

  return generateImageWithBackendFallback(prompt);
}
