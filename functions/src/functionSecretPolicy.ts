import { generationSecretNames, generationImageSecretNames } from './generationProviderPolicy';
/** All credential names remain forbidden in dotenv/Vite, even when their provider is disabled. */
export const FUNCTION_CREDENTIAL_NAMES = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'OPENAI_API_KEY', 'NVIDIA_API_KEY', 'HUGGINGFACE_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'] as const;
export const AI_SECRET_NAMES = generationSecretNames();
export const FUNCTION_SECRET_NAMES = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', ...AI_SECRET_NAMES] as const;
export const LEGACY_PROVIDER_SECRET_NAMES = ['NVIDIA_API_KEY_FAST', 'NVIDIA_API_KEY_CORE', 'HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY'] as const;
export const FUNCTION_SECRET_BINDINGS = [
  { functionId: 'generateText', secretNames: AI_SECRET_NAMES },
  { functionId: 'generateImage', secretNames: generationImageSecretNames() },
  { functionId: 'createCheckoutSession', secretNames: ['STRIPE_SECRET_KEY'] },
  { functionId: 'createBillingPortalSession', secretNames: ['STRIPE_SECRET_KEY'] },
  { functionId: 'getSubscriptionStatus', secretNames: ['STRIPE_SECRET_KEY'] },
  { functionId: 'handleStripeWebhook', secretNames: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  { functionId: 'deleteUserAccount', secretNames: ['STRIPE_SECRET_KEY'] },
] as const;
export function isFunctionCredentialName(name: string): boolean {
  const canonical = name.startsWith('VITE_') ? name.slice(5) : name;
  return [...FUNCTION_CREDENTIAL_NAMES, ...LEGACY_PROVIDER_SECRET_NAMES].some(value => value === canonical);
}
