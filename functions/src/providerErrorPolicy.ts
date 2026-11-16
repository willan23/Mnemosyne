/** Keep upstream response bodies out of exceptions and logs. */
export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super('Fornecedor devolveu erro HTTP.');
    this.name = 'ProviderHttpError';
  }
}

/** A prompt rejected by the provider must not disable that provider for everyone. */
export function shouldTripProviderCircuit(error: unknown): boolean {
  if (!(error instanceof ProviderHttpError)) return true;
  return error.status >= 500 || [401, 402, 404, 408, 410, 429].includes(error.status);
}
