import { decryptTextAesGcm, deriveAesKeyFromMnemonic, encryptTextAesGcm } from '../utils/crypto';

export type AiProviderId = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'nvidia';
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
  { id: 'nvidia', label: 'NVIDIA NIM Backend', kind: 'backend', needsSecret: false, defaultEndpoint: import.meta.env.VITE_API_URL || 'http://localhost:8000' },
  { id: 'openai', label: 'OpenAI', kind: 'cloud', needsSecret: true },
  { id: 'anthropic', label: 'Claude', kind: 'cloud', needsSecret: true },
  { id: 'gemini', label: 'Gemini', kind: 'cloud', needsSecret: true },
  { id: 'mistral', label: 'Mistral', kind: 'cloud', needsSecret: true },
];

const normalizeEndpoint = (endpoint: string): string =>
  endpoint.trim().replace(/\/+$/, '');

const providerDefaults = (): Record<AiProviderId, AiProviderConfig> => ({
  ollama: {
    enabled: true,
    endpoint: normalizeEndpoint(import.meta.env.VITE_OLLAMA_HOST || 'http://localhost:11434'),
    model: import.meta.env.VITE_OLLAMA_MODEL || '',
    hasSecret: false,
  },
  nvidia: {
    enabled: false,
    endpoint: normalizeEndpoint(import.meta.env.VITE_API_URL || 'http://localhost:8000'),
    model: import.meta.env.VITE_NVIDIA_MODEL || '',
    hasSecret: false,
  },
  openai: { enabled: false, endpoint: '', model: '', hasSecret: false },
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

  const migratedHost = normalizeEndpoint(parsed.host || providers.ollama.endpoint);
  const migratedModel = (parsed.model || providers.ollama.model).trim();
  providers.ollama.endpoint = migratedHost;
  providers.ollama.model = migratedModel;

  const primaryProvider = AI_PROVIDERS.some((provider) => provider.id === parsed.primaryProvider)
    ? parsed.primaryProvider as AiProviderId
    : 'ollama';

  const parsedMemoryPermission = parsed.memoryPermission as string | undefined;
  const memoryPermission = parsedMemoryPermission === 'cluster-only'
    ? 'allow-cloud'
    : parsed.memoryPermission || 'never-cloud';
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
