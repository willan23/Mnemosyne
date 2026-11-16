import { fetch as patchedFetch } from 'undici';

/** Explicit dependency: Node's embedded fetch may carry an older undici. Tests replace this seam only. */
export const providerHttp: { fetch: typeof globalThis.fetch } = {
  fetch: patchedFetch as unknown as typeof globalThis.fetch,
};

/** Provider responses stay within one deadline and byte budget; never follow redirects. */
export class ProviderTransportError extends Error {
  constructor() { super('Resposta do fornecedor indisponível ou fora dos limites.'); this.name = 'ProviderTransportError'; }
}

export async function fetchProviderResponse(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<Response> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 16 * 1024 * 1024) {
    throw new ProviderTransportError();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await providerHttp.fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      return new Response(null, { status: response.status });
    }
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)) throw new ProviderTransportError();
    if (!response.body) throw new ProviderTransportError();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxResponseBytes) throw new ProviderTransportError();
      chunks.push(chunk.value);
    }
    if (controller.signal.aborted) throw new ProviderTransportError();
    const headers = new Headers(response.headers);
    // fetch has decoded content encodings; the materialized Response contains decoded bytes.
    headers.delete('content-encoding'); headers.delete('content-length');
    return new Response(Uint8Array.from(Buffer.concat(chunks)), { status: response.status, headers });
  } catch {
    // No upstream body, URL, credential, prompt or raw exception is included.
    throw new ProviderTransportError();
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    clearTimeout(timeout);
  }
}
