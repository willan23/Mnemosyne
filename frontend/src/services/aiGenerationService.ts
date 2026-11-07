import { getLocalAiConfig } from './localAiConfig';
import { getAuthJsonHeaders } from './authHttp';
import { approximateBytes, guardCloudUse, isLoopbackEndpoint } from './cloudUsePolicy';
import { withAiGenerationContext, type AiGenerationContext } from './aiGenerationContext';
import { isGenerationProviderEnabled, generationProviderLabel } from '../../../functions/src/generationProviderPolicy';
import { generationBackendUrl } from './generationEndpoints';
import { requestGenerationJson } from './aiGenerationTransport';

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

export interface AiGenerationOptions { uid?: string; teamId?: string; context?: AiGenerationContext }
async function inGenerationContext<T>(options: AiGenerationOptions, work: (context: AiGenerationContext) => Promise<T>): Promise<T> {
  if (!options.context) return withAiGenerationContext(options, work);
  const context = options.context; context.assertCurrent();
  if ((options.uid !== undefined && options.uid !== context.uid) || (options.teamId !== undefined &&
      (context.scope.kind !== 'team' || context.scope.teamId !== options.teamId))) throw new Error('O destino da geração mudou.');
  const result = await work(context); await context.assertAccess(); return result;
}
async function requestBackendGeneration(prompt: string, model: string | undefined, context: AiGenerationContext): Promise<string> {
  let payload: Record<string, unknown>;
  try {
    payload = await requestGenerationJson('text', generationBackendUrl('text'),
      { prompt, model: model || undefined, expectedUid: context.uid, scope: context.scope }, context.signal,
      async () => { const headers = await getAuthJsonHeaders(context.uid); await context.assertAccess(); return headers; });
  } catch (error) { context.assertCurrent(); throw error; }
  if (typeof payload.text !== 'string' || !payload.text.trim()) throw new Error('O fornecedor não devolveu texto.');
  return payload.text.trim();
}

async function requestBackendImageGeneration(prompt: string, model: string | undefined, context: AiGenerationContext): Promise<GeneratedImageResult> {
  let result: Record<string, unknown>;
  try {
    result = await requestGenerationJson('image', generationBackendUrl('image'),
      { prompt, model: model || undefined, size: '1024x1024', quality: 'medium', expectedUid: context.uid, scope: context.scope }, context.signal,
      async () => { const headers = await getAuthJsonHeaders(context.uid); await context.assertAccess(); return headers; });
  } catch (error) { context.assertCurrent(); throw error; }
  const payload = result as {
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
  // A provider URL may encode the prompt. Only bytes may be persisted as an attachment.
  if (!imageBase64) throw new Error('O fornecedor não devolveu bytes de imagem seguros para guardar.');
  return {
    imageBase64,
    dataUrl: `data:${mediaType};base64,${imageBase64}`,
    mediaType,
    model: payload.model,
    provider: payload.provider || 'backend',
    revisedPrompt: payload.revised_prompt || undefined,
    warning: payload.warning || undefined,
  };
}

function guardPrompt(prompt: string, purpose: 'text-generation' | 'image-generation', provider: string, providerInferenceCostUsd?: 0): void {
  guardCloudUse(purpose, provider, {
    bytes: approximateBytes(prompt),
    containsMemory: false,
    containsAttachment: false,
    containsPrompt: true,
  }, providerInferenceCostUsd);
}

export async function generateTextFromPrompt(prompt: string, options: AiGenerationOptions = {}): Promise<string> {
  const config = getLocalAiConfig();
  const provider = config.providers[config.primaryProvider];
  if (config.primaryProvider === 'ollama') {
    if (!provider.model) throw new Error('Configura um modelo Ollama local antes de gerar texto.');
    if (!isLoopbackEndpoint(provider.endpoint)) guardPrompt(prompt, 'text-generation', 'Ollama remoto');
    return inGenerationContext(options, async context => {
      await context.assertAccess();
      const response = await fetch(`${provider.endpoint.replace(/\/+$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, signal: context.signal,
        body: JSON.stringify({ model: provider.model, prompt, stream: false }),
      });
      if (!response.ok) throw new Error(`Ollama indisponível (${response.status}).`);
      const payload = await response.json() as { response?: string };
      if (!payload.response?.trim()) throw new Error('Ollama não devolveu texto.');
      return payload.response.trim();
    });
  }
  if (!['nvidia', 'huggingface', 'openai', 'gemini', 'openrouter'].includes(config.primaryProvider)) {
    throw new Error('Este fornecedor ainda não está ligado ao backend de geração.');
  }
  if (!isGenerationProviderEnabled(config.primaryProvider)) throw new Error('Este fornecedor não está ativo neste lançamento. Seleciona um fornecedor disponível nas Definições.');
  guardPrompt(prompt, 'text-generation', generationProviderLabel(config.primaryProvider), config.primaryProvider === 'openrouter' ? 0 : undefined);
  const selectedModel = provider.model || (config.primaryProvider === 'openrouter' ? 'openrouter-gemma-4-free' : config.primaryProvider === 'nvidia' ? 'nvidia-nemotron-ultra' : config.primaryProvider === 'huggingface' ? 'hf-default' : config.primaryProvider === 'gemini' ? 'gemini-flash' : 'openai-mini');
  return inGenerationContext(options, context => requestBackendGeneration(prompt, selectedModel, context));
}

export async function generateImageFromPrompt(prompt: string, options: AiGenerationOptions = {}): Promise<GeneratedImageResult> {
  const config = getLocalAiConfig();
  if (config.primaryProvider === 'openrouter') throw new Error('O Gemma gratuito gera texto. A geração de imagens não está disponível com este modelo.');
  if (!['nvidia', 'huggingface', 'openai', 'gemini'].includes(config.primaryProvider)) {
    throw new Error('Seleciona um fornecedor de imagem configurado nas Definições.');
  }
  if (!isGenerationProviderEnabled(config.primaryProvider)) throw new Error('Este fornecedor não está ativo neste lançamento. Seleciona um fornecedor disponível nas Definições.');
  guardPrompt(prompt, 'image-generation', generationProviderLabel(config.primaryProvider));
  return inGenerationContext(options, context => requestBackendImageGeneration(prompt,
    config.primaryProvider === 'nvidia' ? 'nvidia-image' : config.primaryProvider === 'huggingface' ? 'hf-image' : config.primaryProvider === 'gemini' ? 'gemini-image' : 'openai-image', context));
}
