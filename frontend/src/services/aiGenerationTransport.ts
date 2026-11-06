import { GENERATION_HTTP_POLICY, type GenerationHttpKind } from '../../../functions/src/generationHttpPolicy';

export class AiGenerationTransportError extends Error {
  constructor() { super('Geração indisponível, cancelada ou fora dos limites.'); this.name = 'AiGenerationTransportError'; }
}
export class AiGenerationHttpError extends Error {
  readonly status: number;
  constructor(kind: GenerationHttpKind, status: number) {
    super(`Geração de ${kind === 'text' ? 'texto' : 'imagem'} indisponível (${status}).`);
    this.name = 'AiGenerationHttpError';
    this.status = status;
  }
}

/** The deadline covers auth preparation, headers and the decoded response body. No redirects or retries. */
export async function requestGenerationJson(kind: GenerationHttpKind, url: string, body: unknown,
  contextSignal: AbortSignal, prepareHeaders: () => Promise<Record<string, string>>,
  limits?: { timeoutMs: number; maxBytes: number }): Promise<Record<string, unknown>> {
  const policy = GENERATION_HTTP_POLICY[kind];
  if (!policy) throw new AiGenerationTransportError();
  const bounds = { ...(limits ?? { timeoutMs: policy.clientTimeoutMs, maxBytes: policy.maxResponseBytes }) };
  if (!Number.isSafeInteger(bounds.timeoutMs) || bounds.timeoutMs < 1 || bounds.timeoutMs > policy.clientTimeoutMs ||
      !Number.isSafeInteger(bounds.maxBytes) || bounds.maxBytes < 1 || bounds.maxBytes > policy.maxResponseBytes) throw new AiGenerationTransportError();
  const controller = new AbortController(), started = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let responseBody: ReadableStream<Uint8Array> | null = null;
  let rejectAbort!: (reason: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(); rejectAbort(new AiGenerationTransportError()); };
  const check = () => {
    if (contextSignal.aborted || controller.signal.aborted || performance.now() - started >= bounds.timeoutMs) throw new AiGenerationTransportError();
  };
  const timer = window.setTimeout(abort, bounds.timeoutMs);
  contextSignal.addEventListener('abort', abort, { once: true });
  const work = async () => {
    try {
      check(); const headers = await prepareHeaders(); check();
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
        redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      responseBody = response.body;
      check();
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new AiGenerationHttpError(kind, response.status);
      }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > bounds.maxBytes)) throw new AiGenerationTransportError();
      if (!response.body) throw new AiGenerationTransportError();
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) {
        check(); const chunk = await reader.read(); check(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > bounds.maxBytes) throw new AiGenerationTransportError(); chunks.push(chunk.value);
      }
      const data = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); check();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AiGenerationTransportError();
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AiGenerationHttpError) throw error;
      throw new AiGenerationTransportError();
    } finally {
      try { reader?.releaseLock(); } catch { /* The abort cleanup also cancels a still-pending read. */ }
    }
  };
  try { return await Promise.race([work(), cancelled]); }
  finally {
    window.clearTimeout(timer); contextSignal.removeEventListener('abort', abort); controller.abort();
    const cancelBody = () => responseBody?.cancel().catch(() => undefined);
    if (reader) void reader.cancel().catch(cancelBody); else void cancelBody();
  }
}
