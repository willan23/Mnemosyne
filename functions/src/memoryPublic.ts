/**
 * Zero-knowledge public memory projection.
 *
 * The server never decrypts `enc`. Plaintext `text` / `title` are stripped
 * even on legacy documents. Embeddings stay in the clear (same trade-off as
 * the product app) and are used only for cosine search.
 */

export const PLAINTEXT_REFUSED_MESSAGE =
  'Zero-knowledge: o servidor não aceita texto em claro. Envia o envelope cifrado enc: { v, iv, ct } gerado no cliente.';

export const SEARCH_TRADEOFF =
  'Embeddings (quando existem) estão em claro no servidor — permitem cosine sem decifrar enc, mas um vector pode vazar semelhança semântica. A query string nunca é usada para decifrar memórias. Sem vector de query, a busca filtra só tags/ids/category.';

export interface EncEnvelope {
  v: number;
  iv: string;
  ct: string;
}

export interface PublicMemory {
  id: string;
  teamId?: string;
  keyEpoch?: number;
  keyId?: string | null;
  timestamp: number | null;
  updatedAt: number | null;
  tags: string[];
  category: string | null;
  celestialType: string | null;
  encrypted: boolean;
  enc?: EncEnvelope;
  embedding?: number[];
  embeddingModel?: string;
  score?: number;
}

export interface CreateMemoryInput {
  enc: EncEnvelope;
  tags?: string[];
  category?: string;
  celestialType?: string;
  embedding?: number[];
  embeddingModel?: string;
}

export interface ListMemoriesResult {
  memories: PublicMemory[];
  nextStartAfter: string | null;
}

export interface SearchMemoriesResult {
  results: PublicMemory[];
  mode: 'cosine' | 'tags_ids';
  tradeoff: string;
}

export interface ListMemoriesOpts {
  limit?: number;
  startAfter?: string;
}

export interface SearchMemoriesOpts {
  q?: string;
  tags?: string[];
  ids?: string[];
  embedding?: number[];
  embeddingModel?: string;
  limit?: number;
}

export interface MemoryApi {
  list(uid: string, opts: ListMemoriesOpts): Promise<ListMemoriesResult>;
  get(uid: string, id: string): Promise<PublicMemory | null>;
  create(uid: string, input: CreateMemoryInput): Promise<PublicMemory>;
  search(uid: string, opts: SearchMemoriesOpts): Promise<SearchMemoriesResult>;
}

export function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  }
  if (typeof value === 'string') {
    try {
      return parseEmbedding(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  return [];
}

const LEGACY_EMBEDDING_SPACE = 'Xenova/all-MiniLM-L6-v2@legacy-main';

export function embeddingSpaceOf(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : LEGACY_EMBEDDING_SPACE;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!Number.isFinite(denom) || denom === 0) return 0;
  return dot / denom;
}

export function isEncEnvelope(value: unknown): value is EncEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const enc = value as Record<string, unknown>;
  const keys = Object.keys(enc);
  if (keys.length !== 3 || !keys.includes('v') || !keys.includes('iv') || !keys.includes('ct')) {
    return false;
  }
  return enc.v === 1
    && typeof enc.iv === 'string' && enc.iv.length > 0 && enc.iv.length <= 4096
    && typeof enc.ct === 'string' && enc.ct.length > 0 && enc.ct.length <= 400_000;
}

function asMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 64))
    .slice(0, 32);
}

export function toPublicMemory(
  id: string,
  data: Record<string, unknown>,
  opts: { includeEmbedding?: boolean; score?: number } = {},
): PublicMemory {
  const enc = isEncEnvelope(data.enc) ? { v: data.enc.v, iv: data.enc.iv, ct: data.enc.ct } : undefined;
  const memory: PublicMemory = {
    id,
    timestamp: asMillis(data.timestamp),
    updatedAt: asMillis(data.updatedAt),
    tags: asStringArray(data.tags),
    category: typeof data.category === 'string' && data.category.trim() ? data.category.trim().slice(0, 64) : null,
    celestialType: typeof data.celestialType === 'string' && data.celestialType.trim()
      ? data.celestialType.trim().slice(0, 32)
      : null,
    encrypted: Boolean(enc),
  };
  if (enc) memory.enc = enc;
  if (opts.includeEmbedding) {
    const embedding = parseEmbedding(data.embedding);
    if (embedding.length) {
      memory.embedding = embedding;
      memory.embeddingModel = embeddingSpaceOf(data.embeddingModel);
    }
  }
  if (typeof opts.score === 'number') memory.score = opts.score;
  return memory;
}

export function isDeletedSession(data: Record<string, unknown>): boolean {
  return data.deletedAt != null;
}

/** Public API keys in the personal preview may only expose personal sessions.
 * The Admin SDK bypasses Firestore rules, so this check must stay server-side.
 */
export function isPersonalOwnedLiveSession(data: Record<string, unknown>, uid: string): boolean {
  return data.uid === uid && data.teamId === null && !isDeletedSession(data);
}

function hasPlaintextLeak(body: Record<string, unknown>): boolean {
  const fields = ['text', 'title', 'content', 'plaintext', 'body'];
  for (const field of fields) {
    const value = body[field];
    if (typeof value === 'string' && value.trim().length > 0) return true;
  }
  return false;
}

export type ParseCreateResult =
  | { ok: true; input: CreateMemoryInput }
  | { ok: false; status: 400; error: string; code: 'plaintext_refused' | 'invalid_enc' | 'invalid_body' };

export function parseCreateMemoryBody(body: unknown): ParseCreateResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, status: 400, error: 'JSON object required', code: 'invalid_body' };
  }
  const record = body as Record<string, unknown>;
  if (hasPlaintextLeak(record)) {
    return { ok: false, status: 400, error: PLAINTEXT_REFUSED_MESSAGE, code: 'plaintext_refused' };
  }
  if (!isEncEnvelope(record.enc)) {
    return {
      ok: false,
      status: 400,
      error: 'Campo enc: { v, iv, ct } é obrigatório. O servidor não cifra nem guarda plaintext.',
      code: 'invalid_enc',
    };
  }

  const tags = asStringArray(record.tags);
  const category = typeof record.category === 'string' && record.category.trim()
    ? record.category.trim().slice(0, 64)
    : undefined;
  const celestialType = typeof record.celestialType === 'string' && record.celestialType.trim()
    ? record.celestialType.trim().slice(0, 32)
    : undefined;
  const embedding = parseEmbedding(record.embedding);
  if (embedding.length && (embedding.length < 8 || embedding.length > 2048)) {
    return { ok: false, status: 400, error: 'embedding must be a numeric vector of length 8–2048', code: 'invalid_body' };
  }

  const input: CreateMemoryInput = { enc: { v: record.enc.v, iv: record.enc.iv, ct: record.enc.ct } };
  if (tags.length) input.tags = tags;
  if (category) input.category = category;
  if (celestialType) input.celestialType = celestialType;
  if (embedding.length) input.embedding = embedding;
  if (embedding.length && typeof record.embeddingModel === 'string' && record.embeddingModel.trim()) {
    input.embeddingModel = record.embeddingModel.trim().slice(0, 128);
  }
  return { ok: true, input };
}

export function parseSearchQueryTokens(q: string): { tags: string[]; ids: string[]; category?: string; tokens: string[] } {
  const tags: string[] = [];
  const ids: string[] = [];
  const tokens: string[] = [];
  let category: string | undefined;

  for (const raw of q.trim().split(/[\s,]+/).filter(Boolean)) {
    const hash = /^#([\wÀ-ÿ-]+)$/i.exec(raw);
    const tagOp = /^tag:([\wÀ-ÿ-]+)$/i.exec(raw);
    const catOp = /^(?:cat|category|tipo):([\wÀ-ÿ-]+)$/i.exec(raw);
    const idOp = /^id:([A-Za-z0-9_-]+)$/i.exec(raw);
    if (hash) {
      tags.push(hash[1].toLowerCase());
      continue;
    }
    if (tagOp) {
      tags.push(tagOp[1].toLowerCase());
      continue;
    }
    if (catOp) {
      category = catOp[1].toLowerCase();
      continue;
    }
    if (idOp) {
      ids.push(idOp[1]);
      continue;
    }
    if (/^[A-Za-z0-9_-]{16,}$/.test(raw)) {
      ids.push(raw);
      continue;
    }
    tokens.push(raw.toLowerCase());
  }

  return { tags: [...new Set(tags)], ids: [...new Set(ids)], category, tokens };
}

export function filterMemoriesByTagsIds(
  memories: Array<{ id: string; data: Record<string, unknown> }>,
  opts: { q?: string; tags?: string[]; ids?: string[] },
): Array<{ id: string; data: Record<string, unknown> }> {
  const parsed = parseSearchQueryTokens(opts.q || '');
  const tags = [...new Set([...(opts.tags || []).map((t) => t.toLowerCase()), ...parsed.tags])];
  const ids = [...new Set([...(opts.ids || []), ...parsed.ids])];
  const category = parsed.category;
  const tokens = parsed.tokens;

  return memories.filter(({ id, data }) => {
    if (ids.length && !ids.includes(id)) return false;
    const docTags = asStringArray(data.tags).map((t) => t.toLowerCase());
    const docCategory = typeof data.category === 'string' ? data.category.toLowerCase() : '';
    if (tags.length && !tags.some((tag) => docTags.includes(tag))) return false;
    if (category && docCategory !== category) return false;
    if (tokens.length) {
      const haystack = [...docTags, docCategory, id.toLowerCase()].join(' ');
      if (!tokens.every((token) => haystack.includes(token))) return false;
    }
    return true;
  });
}

export function rankByCosine(
  memories: Array<{ id: string; data: Record<string, unknown> }>,
  queryEmbedding: number[],
  limit: number,
  queryEmbeddingModel?: string,
): Array<{ id: string; data: Record<string, unknown>; score: number }> {
  const scored = memories
    .filter(({ data }) => embeddingSpaceOf(data.embeddingModel) === embeddingSpaceOf(queryEmbeddingModel))
    .map(({ id, data }) => {
      const embedding = parseEmbedding(data.embedding);
      const score = cosineSimilarity(queryEmbedding, embedding);
      return { id, data, score };
    })
    .filter((item) => parseEmbedding(item.data.embedding).length === queryEmbedding.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

export function clampLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' && typeof value !== 'string' || typeof value === 'string' && !value.trim()) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}
