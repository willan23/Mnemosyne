import { decryptTextAesGcm, deriveAesKeyFromMnemonic, encryptTextAesGcm } from '../utils/crypto';
import { isGenerationProviderEnabled } from '../../../functions/src/generationProviderPolicy';
import { generationBackendBase } from './generationEndpoints';

export type AiProviderId = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'nvidia' | 'huggingface' | 'openrouter';
export type MemoryPermission = 'never-cloud' | 'confirm-cloud' | 'allow-cloud';
export type AiFailurePolicy = 'save-with-warning' | 'confirm-before-save' | 'block-save';

export interface AiProviderDefinition {
  id: AiProviderId;
  label: string;
  kind: 'local' | 'cloud' | 'backend';
  needsSecret: boolean;
  defaultEndpoint?: string;
}

export interface AiProviderConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  hasSecret: boolean;
}

export interface LocalAiConfig {
  primaryProvider: AiProviderId;
  host: string;
  model: string;
  memoryPermission: MemoryPermission;
  failurePolicy: AiFailurePolicy;
  providers: Record<AiProviderId, AiProviderConfig>;
}

const CONFIG_KEY = 'mnemosyne_local_ai_config';

export const AI_PROVIDERS: AiProviderDefinition[] = [
  { id: 'ollama', label: 'Ollama Local', kind: 'local', needsSecret: false, defaultEndpoint: import.meta.env.VITE_OLLAMA_HOST || 'http://localhost:11434' },
  { id: 'openrouter', label: 'OpenRouter · Gemma gratuito', kind: 'backend', needsSecret: false, defaultEndpoint: generationBackendBase() },
  { id: 'nvidia', label: 'NVIDIA via Mnemosyne', kind: 'backend', needsSecret: false, defaultEndpoint: generationBackendBase() },
  { id: 'huggingface', label: 'Hugging Face → Nscale via Mnemosyne', kind: 'backend', needsSecret: false, defaultEndpoint: generationBackendBase() },
  { id: 'openai', label: 'OpenAI', kind: 'backend', needsSecret: false },
  { id: 'anthropic', label: 'Claude', kind: 'cloud', needsSecret: true },
  { id: 'gemini', label: 'Google Gemini via Mnemosyne', kind: 'backend', needsSecret: false, defaultEndpoint: generationBackendBase() },
  { id: 'mistral', label: 'Mistral', kind: 'cloud', needsSecret: true },
];

/** Known adapters preserve stored selections, independently of this release's enabled providers. */
export const GENERATION_PROVIDER_IDS: readonly AiProviderId[] = ['ollama', 'openrouter', 'nvidia', 'huggingface', 'openai', 'gemini'];
export function isAiProviderEnabled(provider: AiProviderId): boolean {
  return provider === 'ollama' || isGenerationProviderEnabled(provider);
}

export interface AiModelPreset {
  id: string;
  label: string;
  badge?: 'fast';
}

/**
 * Presets the app can actually send. Text generation calls Ollama locally
 * or its regional Firebase function with a server allowlisted model ID.
 * Cloud presets call the server; their release availability is checked separately.
 */
export const AI_MODEL_PRESETS: Record<AiProviderId, AiModelPreset[]> = {
  openrouter: [{ id: 'openrouter-gemma-4-free', label: 'Gemma 4 31B · gratuito' }],
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2', badge: 'fast' },
    { id: 'qwen2.5', label: 'Qwen 2.5', badge: 'fast' },
    { id: 'mistral', label: 'Mistral' },
    { id: 'gemma2', label: 'Gemma 2' },
  ],
  nvidia: [
    { id: 'nvidia-nemotron-ultra', label: 'Nemotron 3 Ultra 550B' },
  ],
  openai: [
    { id: 'openai-mini', label: 'GPT-4o mini', badge: 'fast' },
  ],
  huggingface: [{ id: 'hf-default', label: 'GPT-OSS 120B via Hugging Face' }],
  anthropic: [],
  gemini: [{ id: 'gemini-flash', label: 'Gemini 3.5 Flash-Lite' }],
  mistral: [],
};

const normalizeEndpoint = (endpoint: string): string =>
  endpoint.trim().replace(/\/+$/, '');

const providerDefaults = (): Record<AiProviderId, AiProviderConfig> => ({
  openrouter: { enabled: false, endpoint: generationBackendBase(), model: 'openrouter-gemma-4-free', hasSecret: false },
  ollama: {
    enabled: true,
    endpoint: normalizeEndpoint(import.meta.env.VITE_OLLAMA_HOST || 'http://localhost:11434'),
    model: import.meta.env.VITE_OLLAMA_MODEL || '',
    hasSecret: false,
  },
  nvidia: {
    enabled: false,
    endpoint: generationBackendBase(),
    model: import.meta.env.VITE_NVIDIA_MODEL || '',
    hasSecret: false,
  },
  openai: { enabled: false, endpoint: '', model: '', hasSecret: false },
  huggingface: { enabled: false, endpoint: generationBackendBase(), model: 'hf-default', hasSecret: false },
  anthropic: { enabled: false, endpoint: '', model: '', hasSecret: false },
  gemini: { enabled: false, endpoint: '', model: '', hasSecret: false },
  mistral: { enabled: false, endpoint: '', model: '', hasSecret: false },
});

export const defaultLocalAiConfig: LocalAiConfig = {
  primaryProvider: 'ollama',
  host: providerDefaults().ollama.endpoint,
  model: providerDefaults().ollama.model,
  memoryPermission: 'never-cloud',
  failurePolicy: 'save-with-warning',
  providers: providerDefaults(),
};

function mergeConfig(parsed: Partial<LocalAiConfig>): LocalAiConfig {
  const providers = providerDefaults();
  const parsedProviders = (parsed.providers || {}) as Partial<Record<AiProviderId, Partial<AiProviderConfig>>>;

  for (const provider of AI_PROVIDERS) {
    const current = parsedProviders[provider.id] as Partial<AiProviderConfig> | undefined;
    providers[provider.id] = {
      ...providers[provider.id],
      ...current,
      endpoint: normalizeEndpoint(current?.endpoint || providers[provider.id].endpoint || ''),
      model: (current?.model || providers[provider.id].model || '').trim(),
      hasSecret: Boolean(current?.hasSecret),
    };
  }

  // Old clients persisted upstream model names. Normalize those IDs before
  // showing the picker so its label matches the provider actually called.
  const nvidiaModel = providers.nvidia.model;
  // Preserve an explicit historical selection; switching to Ultra requires
  // selecting it in the picker. New/empty configurations use the tested model.
  providers.nvidia.model = ['nvidia-nemotron', 'nvidia-llama', 'meta/llama-3.1-70b-instruct', 'openai/gpt-oss-120b:cheapest'].includes(nvidiaModel)
    ? 'nvidia-nemotron'
    : AI_MODEL_PRESETS.nvidia.some((preset) => preset.id === nvidiaModel) ? nvidiaModel : 'nvidia-nemotron-ultra';
  const openaiModel = providers.openai.model;
  providers.openai.model = openaiModel === 'gpt-4o-mini' ||
    !AI_MODEL_PRESETS.openai.some((preset) => preset.id === openaiModel)
    ? 'openai-mini'
    : openaiModel;
  if (!AI_MODEL_PRESETS.huggingface.some(preset => preset.id === providers.huggingface.model)) providers.huggingface.model = 'hf-default';
  if (!AI_MODEL_PRESETS.gemini.some(preset => preset.id === providers.gemini.model)) providers.gemini.model = 'gemini-flash';
  if (!AI_MODEL_PRESETS.openrouter.some(preset => preset.id === providers.openrouter.model)) providers.openrouter.model = 'openrouter-gemma-4-free';

  const migratedHost = normalizeEndpoint(parsed.host || providers.ollama.endpoint);
  const migratedModel = (parsed.model || providers.ollama.model).trim();
  providers.ollama.endpoint = migratedHost;
  providers.ollama.model = migratedModel;

  const primaryProvider = GENERATION_PROVIDER_IDS.includes(parsed.primaryProvider as AiProviderId)
    ? parsed.primaryProvider as AiProviderId
    : 'ollama';

  const parsedMemoryPermission = parsed.memoryPermission as string | undefined;
  const memoryPermission: MemoryPermission = parsedMemoryPermission === 'cluster-only'
    ? 'confirm-cloud'
    : parsedMemoryPermission === 'confirm-cloud' || parsedMemoryPermission === 'allow-cloud'
      ? parsedMemoryPermission
      : 'never-cloud';
  const failurePolicy = parsed.failurePolicy === 'confirm-before-save' || parsed.failurePolicy === 'block-save'
    ? parsed.failurePolicy
    : 'save-with-warning';

  return {
    primaryProvider,
    host: providers.ollama.endpoint,
    model: providers.ollama.model,
    memoryPermission,
    failurePolicy,
    providers,
  };
}

export function getLocalAiConfig(): LocalAiConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (!stored) return defaultLocalAiConfig;
    return mergeConfig(JSON.parse(stored) as Partial<LocalAiConfig>);
  } catch {
    return defaultLocalAiConfig;
  }
}

export function saveLocalAiConfig(config: LocalAiConfig): LocalAiConfig {
  const normalized = mergeConfig(config);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent('mnemosyne:local-ai-config', { detail: normalized }));
  return normalized;
}

const secretStorageKey = (uid: string, provider: AiProviderId): string =>
  `mnemosyne_ai_secret_${uid}_${provider}`;

export function hasProviderSecret(uid: string, provider: AiProviderId): boolean {
  return Boolean(localStorage.getItem(secretStorageKey(uid, provider)));
}

export async function saveProviderSecret(uid: string, provider: AiProviderId, secret: string, mnemonic: string[] | null): Promise<void> {
  if (!mnemonic || mnemonic.length !== 12) {
    throw new Error('Desbloqueia primeiro a tua mnemónica Zero-Knowledge para cifrar a API key.');
  }
  if (!secret.trim()) {
    throw new Error('A API key está vazia.');
  }

  const key = await deriveAesKeyFromMnemonic(mnemonic, `mnemosyne:ai-secret:${uid}:${provider}`);
  const encrypted = await encryptTextAesGcm(secret.trim(), key);
  localStorage.setItem(secretStorageKey(uid, provider), JSON.stringify({
    ...encrypted,
    updatedAt: Date.now(),
  }));
}

export async function readProviderSecret(uid: string, provider: AiProviderId, mnemonic: string[] | null): Promise<string | null> {
  if (!mnemonic || mnemonic.length !== 12) return null;
  const stored = localStorage.getItem(secretStorageKey(uid, provider));
  if (!stored) return null;

  const key = await deriveAesKeyFromMnemonic(mnemonic, `mnemosyne:ai-secret:${uid}:${provider}`);
  const payload = JSON.parse(stored) as { iv: string; data: string };
  return decryptTextAesGcm(payload, key);
}

export function clearProviderSecret(uid: string, provider: AiProviderId): void {
  localStorage.removeItem(secretStorageKey(uid, provider));
}
