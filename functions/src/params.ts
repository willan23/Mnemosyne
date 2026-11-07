import { defineSecret } from 'firebase-functions/params';
import { isFunctionCredentialName } from './functionSecretPolicy';
import { ACTIVE_GENERATION_PROVIDERS, declareGenerationSecrets, generationImageSecretNames } from './generationProviderPolicy';

export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const generationParameters = declareGenerationSecrets(ACTIVE_GENERATION_PROVIDERS, defineSecret);
export const openaiApiKey = generationParameters.byProvider.openai;
export const nvidiaApiKey = generationParameters.byProvider.nvidia;
export const huggingfaceApiKey = generationParameters.byProvider.huggingface;
export const geminiApiKey = generationParameters.byProvider.gemini;
export const openrouterApiKey = generationParameters.byProvider.openrouter;
export const aiProviderSecrets = generationParameters.secrets;
const imageSecretNames = new Set<string>(generationImageSecretNames());
export const aiImageProviderSecrets = aiProviderSecrets.filter(parameter => imageSecretNames.has(parameter.name));
const secretParameters: Record<string, ReturnType<typeof defineSecret> | undefined> = {
  STRIPE_SECRET_KEY: stripeSecretKey, STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
  OPENAI_API_KEY: openaiApiKey, NVIDIA_API_KEY: nvidiaApiKey, HUGGINGFACE_API_KEY: huggingfaceApiKey, GEMINI_API_KEY: geminiApiKey, OPENROUTER_API_KEY: openrouterApiKey,
};

/** Runtime-only access through the declared parameter, never an alias/dotenv fallback. */
export function readSecret(parameter: unknown, envName: string): string {
  if (!Object.prototype.hasOwnProperty.call(secretParameters, envName)) return '';
  const declared = secretParameters[envName];
  if (!declared || declared !== parameter) return '';
  try {
    const value = declared.value();
    return typeof value === 'string' ? value.trim() : '';
  } catch { return ''; } // No SDK/raw error or value enters logs or a provider request.
}

/** Non-sensitive configuration only. Credentials must use bound SecretParams. */
export function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    if (isFunctionCredentialName(name)) continue;
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}
