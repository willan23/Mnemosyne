import { filterSearchCandidates, prepareSearchMemory, searchMemories, type PreparedSearchMemory } from '../utils/searchMemories';
import { assertSearchDocument, HYBRID_SEARCH_LIMITS, validSearchId, type HybridSearchDocument } from './hybridSearchProtocol';

export interface CapturePreviewRequest { v: 1; id: number; changed: HybridSearchDocument[]; order?: string[]; query: string }
export interface CapturePreviewHit { id: string; score: number }
export const CAPTURE_PREVIEW_LIMITS = { batchSize: 256, hits: 4, queryChars: 1_000_000 } as const;
function overlap(a: Set<string>, value: string): number {
  const words = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(word => word.length >= 4);
  return a.size ? words.reduce((sum, word) => sum + Number(a.has(word)), 0) / a.size : 0;
}

/** Authorized plaintext, retained only in the temporary capture Worker. */
export class CapturePreviewIndex {
  private documents = new Map<string, HybridSearchDocument>();
  private prepared = new Map<string, PreparedSearchMemory>();
  private order: string[] = [];
  private chars = new Map<string, number>();
  private totalChars = 0;
  clear(): void { this.documents.clear(); this.prepared.clear(); this.order = []; this.chars.clear(); this.totalChars = 0; }
  handle(request: CapturePreviewRequest): CapturePreviewHit[] {
    try {
      if (!request || request.v !== 1 || !Number.isSafeInteger(request.id) || request.id < 1 || typeof request.query !== 'string' ||
          request.query.length > CAPTURE_PREVIEW_LIMITS.queryChars || !Array.isArray(request.changed) || request.changed.length > HYBRID_SEARCH_LIMITS.documents) throw Error();
      const changedIds = new Set<string>();
      for (const row of request.changed) {
        assertSearchDocument(row);
        if (changedIds.has(row.id)) throw Error(); changedIds.add(row.id);
        const chars = [row.text, row.title, row.category, ...(row.tags ?? []), ...(row.nodes ?? []).map(node => node.label)].reduce((sum, field) => sum + (field?.length ?? 0), 0);
        this.totalChars += chars - (this.chars.get(row.id) ?? 0);
        if (this.totalChars > HYBRID_SEARCH_LIMITS.indexedChars) throw Error();
        this.chars.set(row.id, chars); this.documents.set(row.id, row); this.prepared.set(row.id, prepareSearchMemory(row));
      }
      if (request.order !== undefined) {
        if (!Array.isArray(request.order) || request.order.length > HYBRID_SEARCH_LIMITS.documents || new Set(request.order).size !== request.order.length ||
            request.order.some(id => !validSearchId(id) || !this.documents.has(id))) throw Error();
        const retained = new Set(request.order);
        for (const id of this.documents.keys()) if (!retained.has(id)) {
          this.totalChars -= this.chars.get(id) ?? 0; this.chars.delete(id); this.documents.delete(id); this.prepared.delete(id);
        }
        this.order = [...request.order];
      } else if (request.changed.some(row => !this.order.includes(row.id))) throw Error();
      const query = request.query.trim(); if (query.length < 12) return [];
      const memories = this.order.map(id => this.documents.get(id)!);
      const hits = searchMemories(memories, query, { limit: 4, semanticFloor: .4, prepared: this.prepared });
      if (hits.length) return hits.map(row => ({ id: row.memory.id, score: row.score }));
      const terms = new Set(query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(word => word.length >= 4));
      // The lexical fallback must obey the same explicit operators as the primary search.
      return filterSearchCandidates(memories, query).map(memory => ({ id: memory.id,
        score: Math.max(overlap(terms, memory.text ?? ''), overlap(terms, memory.title ?? '')) }))
        .filter(row => row.score >= .12).sort((a, b) => b.score - a.score).slice(0, 4);
    } catch { this.clear(); throw new Error('capture_preview_unavailable'); }
  }
}
