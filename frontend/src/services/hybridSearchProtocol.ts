import type { MemorySearchHit, SearchableMemory } from '../utils/searchMemories';

export const HYBRID_SEARCH_LIMITS = { documents: 100_000, fieldChars: 1_000_000, indexedChars: 64 * 1024 * 1024, results: 500 } as const;
export const SEARCH_CONTEXT_POLICY = Object.freeze({ v: 1, candidates: 16, seeds: 4, strongFloor: .9,
  anchorsPerSeed: 8, postingLimit: 256, postingSources: 2, cachedKeys: 64, keyChars: 128 } as const);
export interface HybridSearchFilters { dateRange: string; tags: string[]; category?: string }
export type HybridSearchDocument = Omit<SearchableMemory, 'embedding' | 'semanticScore' | 'encLocked'>;
export type HybridSearchSource = SearchableMemory & { deletedAt?: number };
export interface HybridSearchHit {
  id: string;
  score: number;
  semanticScore: number;
  matchKind: MemorySearchHit['matchKind'];
  snippet: string;
  matchedTags: string[];
}
export interface HybridPrepareRequest {
  v: 1; type: 'prepare'; id: number; changed: HybridSearchDocument[]; removed: string[];
  order?: string[]; sortByTimestamp?: true; query: string; filters: HybridSearchFilters; now: number; limit: number; floor: number;
}
export interface HybridRankRequest { v: 1; type: 'rank'; id: number; revision: number; scores: Array<[string, number]> }
export interface HybridContextRequest { v: 1; type: 'context'; id: number; revision: number }
export type HybridSearchRequest = HybridPrepareRequest | HybridRankRequest | HybridContextRequest;
export interface HybridPreparedResult {
  revision: number; candidateIds: string[]; hits: HybridSearchHit[];
  stats: { indexed: number; changed: number; removed: number; normalized: number };
}
export interface HybridRankedResult { revision: number; hits: HybridSearchHit[] }
export interface HybridContextCandidate {
  /** matchedKeys aggregates distinct hints; viaSeedId and kind identify the strongest contributing edge. */
  id: string; kind: 'seed'|'strong'|'term-context'|'entity-context'|'retained'; matchedKeys: number; viaSeedId?: string;
}
export interface HybridContextResult {
  revision: number; candidates: HybridContextCandidate[];
  stats: { seeds: number; anchors: number; postingVisits: number; skippedBroad: number; expanded: number };
}

export function projectSearchDocument(memory: HybridSearchSource): HybridSearchDocument {
  return { id: memory.id, title: memory.title, text: memory.text, tags: memory.tags,
    category: memory.category, celestialType: memory.celestialType, timestamp: memory.timestamp,
    updatedAt: memory.updatedAt, nodes: memory.nodes?.map(node => ({ id: '', type: '', label: node.label })) };
}

export function validSearchId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('/');
}

export function assertSearchDocument(value: HybridSearchDocument): void {
  const keys = new Set(['id', 'title', 'text', 'tags', 'category', 'celestialType', 'timestamp', 'updatedAt', 'nodes']);
  if (!value || typeof value !== 'object' || !validSearchId(value.id) || Object.keys(value).some(key => !keys.has(key)) ||
    [value.title, value.text, value.category, value.celestialType].some(field => field !== undefined && (typeof field !== 'string' || field.length > HYBRID_SEARCH_LIMITS.fieldChars)) ||
    [value.timestamp, value.updatedAt].some(field => field !== undefined && !Number.isFinite(field)) ||
    (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 1000 || value.tags.some(tag => typeof tag !== 'string' || tag.length > HYBRID_SEARCH_LIMITS.fieldChars))) ||
    (value.nodes !== undefined && (!Array.isArray(value.nodes) || value.nodes.length > 1000 || value.nodes.some(node => !node || typeof node.label !== 'string' || node.label.length > HYBRID_SEARCH_LIMITS.fieldChars ||
      typeof node.id !== 'string' || node.id.length > 512 || typeof node.type !== 'string' || node.type.length > 512 ||
      Object.keys(node).some(key => !['id', 'label', 'type'].includes(key)))))) throw new Error('hybrid_document_invalid');
}
