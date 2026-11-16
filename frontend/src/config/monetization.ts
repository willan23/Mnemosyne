export type MonetizationMode = 'free-first' | 'paid';

const requestedMode = (import.meta.env.VITE_MONETIZATION_MODE || 'free-first')
  .toString()
  .trim()
  .toLowerCase();

export const monetizationMode: MonetizationMode = requestedMode === 'paid' ? 'paid' : 'free-first';
export const isFreeFirstMode = monetizationMode === 'free-first';

/**
 * Checkout Stripe: activo se modo paid, VITE_ENABLE_CHECKOUT=true,
 * ou (default) se existir chave publishable — sem forçar paid enforcement
 * nas rules (Founder Preview continua free-first).
 * Defina VITE_ENABLE_CHECKOUT=false para desligar checkout explicitamente.
 */
const checkoutFlag = (import.meta.env.VITE_ENABLE_CHECKOUT || '')
  .toString()
  .trim()
  .toLowerCase();
const hasStripePublishableKey = Boolean(
  (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').toString().trim(),
);

export const checkoutEnabled =
  monetizationMode === 'paid' ||
  checkoutFlag === 'true' ||
  (checkoutFlag !== 'false' && hasStripePublishableKey);

export const monetizationCopy = {
  previewName: 'Founder Preview',
  previewBadge: 'Gratuito durante a fase de construcao de mercado',
};
