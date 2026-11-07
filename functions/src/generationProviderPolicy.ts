/** Public release policy shared with the web client. No SDKs, environment reads or credentials. */
export type GenerationProviderId = 'nvidia' | 'huggingface' | 'openai' | 'gemini' | 'openrouter';
// The release owner requires free inference only. Retained paid adapters remain unavailable.
export const ACTIVE_GENERATION_PROVIDERS: readonly GenerationProviderId[] = Object.freeze(['openrouter']);
/** Explicit HF routing prevents the broker from silently choosing another processor. */
export const HUGGING_FACE_UPSTREAM = 'nscale' as const;
export function generationProviderLabel(provider: string): string {
  return provider === 'huggingface' ? 'Hugging Face Router → Nscale (via Mnemosyne)'
    : provider === 'nvidia' ? 'NVIDIA (via Mnemosyne)' : provider === 'gemini' ? 'Google Gemini (via Mnemosyne)'
      : provider === 'openrouter' ? 'OpenRouter → Google AI Studio (gratuito, via Mnemosyne)' : 'OpenAI (via Mnemosyne)';
}
export const GENERATION_PROVIDER_SECRET_NAMES = Object.freeze({
  nvidia: 'NVIDIA_API_KEY', huggingface: 'HUGGINGFACE_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', openrouter: 'OPENROUTER_API_KEY',
} as const);
export type GenerationSecretName = typeof GENERATION_PROVIDER_SECRET_NAMES[GenerationProviderId];

export function isGenerationProviderEnabled(provider: string, enabled: readonly GenerationProviderId[] = ACTIVE_GENERATION_PROVIDERS): boolean {
  return enabled.some(id => id === provider);
}

export function generationSecretNames(providers: readonly GenerationProviderId[] = ACTIVE_GENERATION_PROVIDERS): GenerationSecretName[] {
  if (!Array.isArray(providers) || providers.length > 5 || new Set(providers).size !== providers.length ||
      providers.some(id => !Object.prototype.hasOwnProperty.call(GENERATION_PROVIDER_SECRET_NAMES, id))) {
    throw new Error('Configuração de fornecedores de geração inválida.');
  }
  return providers.map((id: GenerationProviderId) => GENERATION_PROVIDER_SECRET_NAMES[id]);
}

/** OpenRouter's selected free model produces text only; never bind its key to image generation. */
export function generationImageSecretNames(providers: readonly GenerationProviderId[] = ACTIVE_GENERATION_PROVIDERS): GenerationSecretName[] {
  generationSecretNames(providers); // Validate before filtering.
  return generationSecretNames(providers.filter(provider => provider !== 'openrouter'));
}

/** Register only enabled SecretParams: an unused defineSecret is still a deployment requirement. */
export function declareGenerationSecrets<T>(providers: readonly GenerationProviderId[], declare: (name: GenerationSecretName) => T): {
  byProvider: Readonly<Partial<Record<GenerationProviderId, T>>>; secrets: T[];
} {
  const names = generationSecretNames(providers), byProvider: Partial<Record<GenerationProviderId, T>> = {};
  const secrets = providers.map((provider, index) => { const parameter = declare(names[index]); byProvider[provider] = parameter; return parameter; });
  return { byProvider: Object.freeze(byProvider), secrets };
}
