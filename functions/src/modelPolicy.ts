import type { AiPlan } from './aiCostPolicy';
export type TextProvider = 'huggingface' | 'nvidia' | 'openai' | 'gemini' | 'openrouter';
export type ImageProvider = Exclude<TextProvider, 'openrouter'>;

export interface TextModelPolicy {
  id: string;
  provider: TextProvider;
  externalModel: string;
  maxOutputTokens: number;
  costUnitsPerRequest: number;
}

export interface ImageModelPolicy {
  id: string;
  provider: ImageProvider;
  externalModel: string;
  width: number;
  height: number;
  costUnitsPerRequest: number;
}

const textModels: Record<string, TextModelPolicy> = {
  'openrouter-gemma-4-free': { id: 'openrouter-gemma-4-free', provider: 'openrouter', externalModel: 'google/gemma-4-31b-it:free', maxOutputTokens: 900, costUnitsPerRequest: 1 },
  'hf-default': { id: 'hf-default', provider: 'huggingface', externalModel: 'openai/gpt-oss-120b:nscale', maxOutputTokens: 900, costUnitsPerRequest: 1 },
  'nvidia-nemotron': { id: 'nvidia-nemotron', provider: 'nvidia', externalModel: 'nvidia/nemotron-3-super-120b-a12b', maxOutputTokens: 900, costUnitsPerRequest: 2 },
  'nvidia-nemotron-ultra': { id: 'nvidia-nemotron-ultra', provider: 'nvidia', externalModel: 'nvidia/nemotron-3-ultra-550b-a55b', maxOutputTokens: 900, costUnitsPerRequest: 4 },
  'openai-mini': { id: 'openai-mini', provider: 'openai', externalModel: 'gpt-4o-mini', maxOutputTokens: 900, costUnitsPerRequest: 2 },
  'gemini-flash': { id: 'gemini-flash', provider: 'gemini', externalModel: 'gemini-3.5-flash-lite', maxOutputTokens: 900, costUnitsPerRequest: 1 },
};

const imageModels: Record<string, ImageModelPolicy> = {
  'hf-image': { id: 'hf-image', provider: 'huggingface', externalModel: 'black-forest-labs/FLUX.1-schnell', width: 1024, height: 1024, costUnitsPerRequest: 10 },
  'nvidia-image': { id: 'nvidia-image', provider: 'nvidia', externalModel: 'black-forest-labs/flux.1-schnell', width: 1024, height: 1024, costUnitsPerRequest: 10 },
  'openai-image': { id: 'openai-image', provider: 'openai', externalModel: 'dall-e-3', width: 1024, height: 1024, costUnitsPerRequest: 20 },
  'gemini-image': { id: 'gemini-image', provider: 'gemini', externalModel: 'gemini-3.1-flash-image', width: 1024, height: 1024, costUnitsPerRequest: 20 },
};

// Older clients may still hold these exact IDs in localStorage during rollout.
const textAliases: Record<string, string> = {
  'openai/gpt-oss-120b:cheapest': 'hf-default',
  'nvidia-llama': 'nvidia-nemotron',
  'meta/llama-3.1-70b-instruct': 'nvidia-nemotron',
  'gpt-4o-mini': 'openai-mini',
};

export function resolveTextModel(value: unknown): TextModelPolicy | null {
  if (value === undefined || value === null || value === '') return textModels['openrouter-gemma-4-free'];
  if (typeof value !== 'string') return null;
  const id = Object.prototype.hasOwnProperty.call(textAliases, value) ? textAliases[value] : value;
  return Object.prototype.hasOwnProperty.call(textModels, id) ? textModels[id] : null;
}

export function resolveImageModel(value: unknown): ImageModelPolicy | null {
  if (value === undefined || value === null || value === '') return imageModels['hf-image'];
  if (typeof value !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(imageModels, value) ? imageModels[value] : null;
}

/** Paid free accounts use the basic text model; preview remains open within technical budgets. */
export function aiModelAllowedForPlan(kind: 'text' | 'image', id: string, plan: AiPlan): boolean {
  const model = kind === 'text' ? resolveTextModel(id) : resolveImageModel(id);
  if (!model) return false;
  return ['preview', 'pro', 'sovereign'].includes(plan) || (plan === 'free' && kind === 'text' && ['openrouter-gemma-4-free', 'hf-default', 'nvidia-nemotron', 'nvidia-nemotron-ultra', 'gemini-flash'].includes(model.id));
}

export function validImageOptions(size: unknown, quality: unknown): boolean {
  return (size === undefined || size === '1024x1024') &&
    (quality === undefined || quality === 'medium');
}

export function validTextTokenRequest(value: unknown, model: TextModelPolicy): boolean {
  return value === undefined ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 64 && value <= model.maxOutputTokens);
}
