/**
 * Cliente fino da API pública Mnemosyne v1.
 * Autentica com Bearer `mne_live_…`. Nunca decifra `enc`.
 */

export const DEFAULT_BASE_URL = 'https://mnemosyne-one.web.app';

export interface EncEnvelope {
  v: number;
  iv: string;
  ct: string;
}

export interface MnemosyneClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface ListMemoriesOptions {
  limit?: number;
  startAfter?: string;
}

export interface CreateMemoryInput {
  enc: EncEnvelope;
  tags?: string[];
  category?: string;
  celestialType?: string;
  embedding?: number[];
  embeddingModel?: string;
}

export interface SearchMemoriesOptions {
  q?: string;
  tags?: string[];
  ids?: string[];
  embedding?: number[];
  embeddingModel?: string;
  limit?: number;
}
/** One existing memory in the vault bound to an explicit reviewed OAuth grant. */
export interface AgentMemoryTarget { sessionId: string; teamId: string | null }
export interface AgentMemoryChange {
  operationId: string; operation: 'edit' | 'delete';
  baseline: AgentMemoryTarget & {
    kind: 'personal' | 'team'; authorUid: string; ownerUid: string; stateHash: string; stateDigest: string; revision: number;
    teamStateHash: string | null; epochStateHash: string | null; keyEpoch: number | null; keyId: string | null; priorKeyEpoch: number | null; priorKeyId: string | null;
  };
  priorEnc: EncEnvelope; enc: EncEnvelope | null; metadata: Record<string, unknown>;
}

export class MnemosyneApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, _body: unknown = null, _message: string = '') {
    super(`Mnemosyne API request failed (HTTP ${status}).`);
    this.name = 'MnemosyneApiError';
    this.status = status;
    this.body = null;
  }
}

export class MnemosyneTransportError extends Error {
  constructor(readonly code: 'invalid_configuration' | 'request_failed' | 'deadline_exceeded' | 'response_too_large' | 'invalid_response') {
    super(`Mnemosyne API transport failed (${code}).`);
    this.name = 'MnemosyneTransportError';
  }
}

const PLAINTEXT_KEYS = ['text', 'title', 'content'];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function assertNoPlaintext(input: object): void {
  const rec = asRecord(input);
  for (const key of PLAINTEXT_KEYS) {
    if (key in rec && rec[key] != null && rec[key] !== '') {
      throw new Error(
        'O SDK recusa plaintext (text/title/content). Cifra no cliente e envia enc: { v, iv, ct }.',
      );
    }
  }
}

export class MnemosyneClient {
  readonly #apiKey: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: MnemosyneClientOptions) {
    if (!options || typeof options.apiKey !== 'string' ||
      (options.baseUrl !== undefined && typeof options.baseUrl !== 'string') ||
      (options.fetch !== undefined && typeof options.fetch !== 'function')) throw new MnemosyneTransportError('invalid_configuration');
    this.#apiKey = options.apiKey.trim();
    if (/[^\x21-\x7e]/.test(this.#apiKey)) throw new MnemosyneTransportError('invalid_configuration');
    let url: URL;
    try { url = new URL(options.baseUrl || DEFAULT_BASE_URL); }
    catch { throw new MnemosyneTransportError('invalid_configuration'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new MnemosyneTransportError('invalid_configuration');
    this.baseUrl = url.origin;
    this.fetchImpl = options.fetch || fetch;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120000 ||
      !Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1 || this.maxResponseBytes > 16 * 1024 * 1024) throw new MnemosyneTransportError('invalid_configuration');
  }

  private headers(json = false): HeadersInit {
    const headers: Record<string, string> = {};
    if (this.#apiKey) headers.Authorization = `Bearer ${this.#apiKey}`;
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
        cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new MnemosyneApiError(response.status);
      }
      const declaredLength = response.headers.get('content-length');
      if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > this.maxResponseBytes)) {
        await response.body?.cancel();
        throw new MnemosyneTransportError('response_too_large');
      }
      if (!response.body) return null;
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > this.maxResponseBytes) throw new MnemosyneTransportError('response_too_large');
        chunks.push(chunk.value);
      }
      if (controller.signal.aborted) throw new MnemosyneTransportError('deadline_exceeded');
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return text ? JSON.parse(text) as unknown : null;
      } catch { throw new MnemosyneTransportError('invalid_response'); }
    } catch (error) {
      if (error instanceof MnemosyneApiError || error instanceof MnemosyneTransportError) throw error;
      throw new MnemosyneTransportError(controller.signal.aborted ? 'deadline_exceeded' : 'request_failed');
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      clearTimeout(timer);
    }
  }

  listMemories(options: ListMemoriesOptions = {}): Promise<unknown> {
    const query = new URLSearchParams();
    if (options.limit) query.set('limit', String(options.limit));
    if (options.startAfter) query.set('startAfter', options.startAfter);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/v1/memories${suffix}`, { headers: this.headers() });
  }

  getMemory(id: string): Promise<unknown> {
    const encoded = encodeURIComponent(id);
    return this.request(`/api/v1/memories/${encoded}`, { headers: this.headers() });
  }

  /** @deprecated Direct agent creation is retired. Use a reviewed proposal for an existing memory. */
  createMemory(input: CreateMemoryInput): Promise<unknown> {
    assertNoPlaintext(input);
    throw new Error('Direct agent creation is retired; review a proposal in the vault.');
  }

  prepareMemoryChange(target: AgentMemoryTarget): Promise<unknown> {
    if (!target || Object.keys(target).sort().join(',') !== 'sessionId,teamId' ||
      typeof target.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(target.sessionId) ||
      target.teamId !== null && (typeof target.teamId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(target.teamId))) throw new MnemosyneTransportError('invalid_configuration');
    return this.request('/api/v1/agent/changes/prepare', { method: 'POST', headers: this.headers(true), body: JSON.stringify(target) });
  }

  proposeMemoryChange(input: AgentMemoryChange): Promise<unknown> {
    const clean = (value: unknown, depth = 0): void => {
      if (depth > 12) throw new MnemosyneTransportError('invalid_configuration');
      if (value && typeof value === 'object') {
        assertNoPlaintext(value);
        if ('confirmed' in value || 'expectedUid' in value || 'authority' in value) throw new MnemosyneTransportError('invalid_configuration');
        Object.values(value).forEach(item => clean(item, depth + 1));
      }
    };
    clean(input);
    if (!input || Object.keys(input).sort().join(',') !== 'baseline,enc,metadata,operation,operationId,priorEnc' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId) ||
      !['edit', 'delete'].includes(input.operation) || !input.priorEnc || input.operation === 'edit' && !input.enc || input.operation === 'delete' && input.enc !== null) throw new MnemosyneTransportError('invalid_configuration');
    const body = JSON.stringify(input);
    if (new TextEncoder().encode(body).byteLength > 640 * 1024) throw new MnemosyneTransportError('invalid_configuration');
    clean(JSON.parse(body));
    return this.request('/api/v1/agent/changes/propose', { method: 'POST', headers: this.headers(true), body });
  }

  getMemoryChange(target: { proposalId: string; digest: string }): Promise<unknown> {
    if (!target || Object.keys(target).sort().join(',') !== 'digest,proposalId' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target.proposalId) || !/^[a-f0-9]{64}$/.test(target.digest)) throw new MnemosyneTransportError('invalid_configuration');
    return this.request('/api/v1/agent/changes/status', { method: 'POST', headers: this.headers(true), body: JSON.stringify(target) });
  }

  search(options: SearchMemoriesOptions = {}): Promise<unknown> {
    const query = new URLSearchParams();
    if (options.q) query.set('q', options.q);
    if (options.tags?.length) query.set('tags', options.tags.join(','));
    if (options.ids?.length) query.set('ids', options.ids.join(','));
    if (options.limit) query.set('limit', String(options.limit));
    if (options.embedding?.length) query.set('embedding', JSON.stringify(options.embedding));
    if (options.embeddingModel) query.set('embeddingModel', options.embeddingModel);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/v1/search${suffix}`, { headers: this.headers() });
  }
}
