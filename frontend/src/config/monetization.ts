export type MonetizationMode = 'free-first' | 'paid';

const requestedMode = (import.meta.env.VITE_MONETIZATION_MODE || 'free-first')
  .toString()
  .trim()
  .toLowerCase();

export const monetizationMode: MonetizationMode = requestedMode === 'paid' ? 'paid' : 'free-first';
export const isFreeFirstMode = monetizationMode === 'free-first';

export const checkoutEnabled = monetizationMode === 'paid' ||
  import.meta.env.VITE_ENABLE_CHECKOUT === 'true';

export const monetizationCopy = {
  previewName: 'Founder Preview',
  previewBadge: 'Gratuito durante a fase de construcao de mercado',
};
