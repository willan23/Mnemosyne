import { GENERATION_HTTP_POLICY } from './generationHttpPolicy';
import { ProviderHttpError } from './providerErrorPolicy';
import { fetchProviderResponse } from './providerTransport';

export const OPENROUTER_FREE_MODEL = 'google/gemma-4-31b-it:free' as const;
export const OPENROUTER_FREE_POLICY_ID = 'openrouter-gemma-4-free' as const;
export const OPENROUTER_FREE_UPSTREAM = 'google-ai-studio' as const;

const unavailable = () => new Error('Não foi possível confirmar uma resposta gratuita do modelo selecionado.');
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** One exact free variant and processor. No model array, router, plugins or paid fallback. */
export function openRouterFreeRequest(prompt: string, model: string, maxTokens: number) {
  if (model !== OPENROUTER_FREE_MODEL || typeof prompt !== 'string' || prompt.trim().length < 2 ||
      prompt.length > 4000 || !Number.isSafeInteger(maxTokens) || maxTokens < 64 || maxTokens > 900) throw unavailable();
  return {
    model: OPENROUTER_FREE_MODEL,
    messages: [
      { role: 'system', content: 'És o assistente do Mnemosyne. Responde em português europeu por defeito. Entrega texto claro para o utilizador rever.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    stream: false,
    reasoning: { enabled: false },
    provider: {
      only: [OPENROUTER_FREE_UPSTREAM],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: 'deny',
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    },
  };
}

export function openRouterFreeResponse(value: unknown): { text: string; model: string; provider: string; inference_cost_usd: 0 } {
  const data = record(value);
  if (!data || data.error !== undefined) {
    const error = record(data?.error);
    if (typeof error?.code === 'number' && Number.isSafeInteger(error.code) && error.code >= 400 && error.code <= 599) throw new ProviderHttpError(error.code);
    throw unavailable();
  }
  const models = [OPENROUTER_FREE_MODEL, 'google/gemma-4-31b-it', 'google/gemma-4-31b-it-20260402', 'google/gemma-4-31b-it-20260402:free'];
  if (typeof data.model !== 'string' || !models.includes(data.model) ||
      (data.provider !== undefined && !['Google AI Studio', OPENROUTER_FREE_UPSTREAM].includes(data.provider as string))) throw unavailable();
  const usage = record(data.usage);
  if (usage?.cost !== 0) throw unavailable();
  const choices = Array.isArray(data.choices) ? data.choices : [];
  if (choices.length !== 1) throw unavailable();
  const choice = record(choices[0]), message = record(choice?.message);
  if (typeof message?.content !== 'string' || !message.content.trim() || message.content.length > 128_000 ||
      (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)) ||
      choice?.finish_reason === 'tool_calls') throw unavailable();
  return { text: message.content.trim(), model: data.model, provider: 'openrouter-google-ai-studio', inference_cost_usd: 0 };
}

export async function generateOpenRouterFreeText(prompt: string, model: string, maxTokens: number, apiKey: string) {
  const body = openRouterFreeRequest(prompt, model, maxTokens);
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 2048 || /[\r\n]/.test(apiKey)) throw unavailable();
  const response = await fetchProviderResponse('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
      'HTTP-Referer': 'https://mnemosyne-one.web.app', 'X-OpenRouter-Title': 'Mnemosyne' },
    body: JSON.stringify(body),
  }, GENERATION_HTTP_POLICY.text.providerTimeoutMs, 1024 * 1024);
  if (!response.ok) throw new ProviderHttpError(response.status);
  let value: unknown;
  try { value = await response.json(); } catch { throw unavailable(); }
  return openRouterFreeResponse(value);
}
