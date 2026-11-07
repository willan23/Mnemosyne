import { GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse } from '@google/genai';
import { fetchProviderResponse, ProviderTransportError } from './providerTransport';
import { ProviderHttpError } from './providerErrorPolicy';
import { decodeProviderImage } from './providerResponsePolicy';
import { GENERATION_HTTP_POLICY } from './generationHttpPolicy';

const models = { text: 'gemini-3.5-flash-lite', image: 'gemini-3.1-flash-image' } as const;

/** Official SDK, restricted to one selected generation endpoint and our bounded transport. */
async function request(kind: 'text' | 'image', prompt: string, model: string, maxTokens: number, apiKey: string): Promise<GenerateContentResponse> {
  if (model !== models[kind] || !apiKey || !Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 900) throw new ProviderTransportError();
  const timeout = GENERATION_HTTP_POLICY[kind].providerTimeoutMs;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const client = new GoogleGenAI({ apiKey, vertexai: false, httpOptions: {
    baseUrl: 'https://generativelanguage.googleapis.com', apiVersion: 'v1beta', timeout,
    retryOptions: { attempts: 1 },
    fetch: async (input, init) => {
      // No query-key URLs, uploads, tools, alternate hosts or model switching by the SDK.
      if (String(input) !== endpoint || init?.method !== 'POST') throw new ProviderTransportError();
      const response = await fetchProviderResponse(endpoint, init, timeout, kind === 'text' ? 1048576 : 16777216);
      if (!response.ok) throw new ProviderHttpError(response.status);
      return response;
    },
  } });
  const config: GenerateContentConfig = { candidateCount: 1, maxOutputTokens: maxTokens,
    automaticFunctionCalling: { disable: true },
    ...(kind === 'text' ? { temperature: 0.4 } : { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } }),
  };
  try {
    const response = await client.models.generateContent({ model, contents: prompt, config });
    const version = response.modelVersion;
    if (response.promptFeedback?.blockReason || response.candidates?.some(candidate => ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(String(candidate.finishReason)))) throw new ProviderHttpError(422);
    if (typeof version !== 'string' || !(version === model || new RegExp('^' + model.replace(/\./g, '\\.') + '-[0-9]{3}$').test(version))) throw new ProviderTransportError();
    if (!response.candidates || response.candidates.length !== 1 || !['STOP', 'MAX_TOKENS'].includes(String(response.candidates[0].finishReason))) throw new ProviderTransportError();
    const parts = response.candidates[0].content?.parts;
    if (!parts || parts.some(part => part.functionCall || part.executableCode || part.codeExecutionResult || part.fileData)) throw new ProviderTransportError();
    return response;
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    throw new ProviderTransportError();
  }
}

export async function generateGeminiText(prompt: string, model: string, maxTokens: number, apiKey: string) {
  const response = await request('text', prompt, model, maxTokens, apiKey);
  const text = response.candidates![0].content!.parts!.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('').trim();
  if (!text) throw new ProviderTransportError();
  return { text, model: response.modelVersion!, provider: 'gemini' };
}

export async function generateGeminiImage(prompt: string, model: string, apiKey: string) {
  const response = await request('image', prompt, model, 900, apiKey);
  const images = response.candidates![0].content!.parts!.filter(part => !part.thought && part.inlineData);
  if (images.length !== 1) throw new ProviderTransportError();
  const image = decodeProviderImage(images[0].inlineData!.data);
  if (images[0].inlineData!.mimeType !== image.media_type) throw new ProviderTransportError();
  return { ...image, image_url: null, model: response.modelVersion!, provider: 'gemini', revised_prompt: null };
}
