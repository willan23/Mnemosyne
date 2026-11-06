/** Monthly EUR catalogue approved by the owner; amounts are integer cents. */
export const MONTHLY_PRICE_CENTS = { pro: 799, sovereign: 2999 } as const;
export const BILLING_CURRENCY = 'eur' as const;
export const BILLING_TAX_BEHAVIOR = 'inclusive' as const;
/** Annual amounts are pending the owner's decision; they cannot be offered yet. */
export const ANNUAL_PRICE_CENTS: Record<keyof typeof MONTHLY_PRICE_CENTS, number | null> = { pro: null, sovereign: null };
export const yearlyBillingAvailable = Object.values(ANNUAL_PRICE_CENTS).every(amount => amount !== null && Number.isSafeInteger(amount) && amount > 0);

export function monthlyPriceAmount(plan: keyof typeof MONTHLY_PRICE_CENTS): string {
    return new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(MONTHLY_PRICE_CENTS[plan] / 100);
}

export function monthlyPriceLabel(plan: keyof typeof MONTHLY_PRICE_CENTS): string {
    return `€${monthlyPriceAmount(plan)}`;
}
