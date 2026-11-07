import { CURRENT_EMBEDDING_SPACE, sameEmbeddingSpace } from './embeddingModel';
import { IncrementalMemoryPublication } from './incrementalMemoryPublication';
import type { MemoryPublicationPatch } from './incrementalMemoryPublication';
import { cosineSimilarity } from './semanticConnectionBackfill';
import { SEMANTIC_WRITE_LIMITS as limits, semanticWriteId } from './semanticWriteProtocol';
import { INDEXED_SEMANTIC_WRITE_LIMITS, type IndexedSemanticDocument, type IndexedSemanticWriteMessage, type IndexedSemanticWriteResult } from './indexedSemanticWriteProtocol';

function validateDocument(value: IndexedSemanticDocument) {
  if (!semanticWriteId(value.id) || !Number.isFinite(value.timestamp) || Object.keys(value).some(key => !['id', 'timestamp', 'scope', 'embedding', 'embeddingModel'].includes(key)) ||
      value.scope !== null && !semanticWriteId(value.scope) || value.scope === null && value.embedding !== null ||
      value.embeddingModel !== undefined && value.embeddingModel !== CURRENT_EMBEDDING_SPACE ||
      value.embedding !== null && (!Array.isArray(value.embedding) || value.embedding.length > limits.dimensions || !value.embedding.every(Number.isFinite))) throw Error();
}

/** Canonical source order and cosine traversal live only in the Worker. No original content enters it. */
export class IndexedSemanticWriteIndex {
  private publication = new IncrementalMemoryPublication<IndexedSemanticDocument>('desc');
  private seq = 0;
  private initialized = false;
  private pending: { source: string; expected: number; patch: MemoryPublicationPatch<IndexedSemanticDocument>; priority?: number } | null = null;
  clear(): void { this.publication.clear(); this.seq = 0; this.initialized = false; this.pending = null; }
  handle(message: IndexedSemanticWriteMessage): IndexedSemanticWriteResult {
    try {
      if (!message || message.v !== 1 || message.seq !== this.seq + 1) throw Error();
      if (message.type === 'init') {
        if (this.initialized || message.seq !== 1 || message.direction !== undefined && !['asc', 'desc'].includes(message.direction) || message.sourceBase !== undefined && !Number.isFinite(message.sourceBase)) throw Error();
        this.publication = new IncrementalMemoryPublication(message.direction ?? 'desc', { sourceBase: message.sourceBase });
        this.initialized = true;
      } else {
        if (!this.initialized) throw Error();
        if (message.type === 'patch-start') {
          if (this.pending || !semanticWriteId(message.source) || !Number.isSafeInteger(message.changed) || message.changed < 0 || message.changed > INDEXED_SEMANTIC_WRITE_LIMITS.documents || !Array.isArray(message.removed) || message.removed.length > INDEXED_SEMANTIC_WRITE_LIMITS.documents || !message.order || !Array.isArray(message.order.changes) || message.order.changes.length > INDEXED_SEMANTIC_WRITE_LIMITS.documents || message.order.reset !== undefined && (!Array.isArray(message.order.reset) || message.order.reset.length > INDEXED_SEMANTIC_WRITE_LIMITS.documents)) throw Error();
          if (message.priority !== undefined && !Number.isFinite(message.priority)) throw Error();
          this.pending = { source: message.source, expected: message.changed, patch: { changed: [], removed: message.removed, order: message.order }, priority: message.priority };
          this.seq = message.seq; return { indexed: this.publication.count };
        }
        if (message.type === 'patch-chunk') {
          if (!this.pending || !Array.isArray(message.changed) || !message.changed.length || message.changed.length > limits.batchSize || this.pending.patch.changed.length + message.changed.length > this.pending.expected) throw Error();
          for (const { value } of message.changed) if (value) validateDocument(value);
          this.pending.patch.changed.push(...message.changed);
          this.seq = message.seq; return { indexed: this.publication.count, changed: message.changed.length };
        }
        if (message.type === 'patch-end') {
          if (!this.pending || this.pending.patch.changed.length !== this.pending.expected) throw Error();
          const { source, patch, priority } = this.pending;
          this.publication.apply(source, patch, priority); this.pending = null;
          if (this.publication.count > INDEXED_SEMANTIC_WRITE_LIMITS.documents) throw Error();
          this.seq = message.seq;
          return { indexed: this.publication.count, changed: patch.changed.length, removed: patch.removed.length };
        }
        if (this.pending) throw Error();
        if (message.type === 'remove') {
          this.publication.removeSource(message.source);
        } else if (message.type === 'exclude') {
          if (!semanticWriteId(message.source) || !Array.isArray(message.changes) || !message.changes.length || message.changes.length > limits.batchSize) throw Error();
          const seen = new Set<string>();
          for (const row of message.changes) {
            if (!Array.isArray(row) || row.length < 2 || row.length > 3 || !semanticWriteId(row[0]) || typeof row[1] !== 'boolean' || seen.has(row[0]) || row[1] && row.length !== 2) throw Error();
            if (row.length === 3 && row[2] !== null) { if (!row[2] || typeof row[2] !== 'object' || Array.isArray(row[2])) throw Error(); validateDocument(row[2]); if (row[2].id !== row[0]) throw Error(); }
            const prior = this.publication.sourceValue(message.source, row[0]);
            if (prior !== undefined) {
              const value = row[1] ? prior ? { ...prior, scope: null, embedding: null, embeddingModel: undefined } : null : row.length === 3 ? row[2]! : prior;
              this.publication.apply(message.source, { changed: [{ id: row[0], value }], removed: [], order: { changes: [] } });
            }
            seen.add(row[0]); this.publication.exclude(message.source, row[0], row[1]);
          }
        } else if (message.type === 'query') {
          if (message.space !== CURRENT_EMBEDDING_SPACE || !semanticWriteId(message.scope) || message.excludeId !== undefined && !semanticWriteId(message.excludeId) || message.source !== undefined && !semanticWriteId(message.source) ||
              !Array.isArray(message.query) || !message.query.length || message.query.length > limits.dimensions || !message.query.every(Number.isFinite)) throw Error();
          let count = 0;
          const neighbors: Array<[string, number, number]> = [];
          for (const row of message.source === undefined ? this.publication.orderedValues() : this.publication.orderedSourceValues(message.source)) {
            if (row.scope !== message.scope || row.id === message.excludeId) continue;
            const ordinal = count++;
            if (!row.embedding || row.embedding.length !== message.query.length || !sameEmbeddingSpace(CURRENT_EMBEDDING_SPACE, row.embeddingModel)) continue;
            const score = cosineSimilarity(message.query, row.embedding);
            if (!Number.isFinite(score) || score < limits.threshold) continue;
            let at = 0; while (at < neighbors.length && neighbors[at][1] >= score) at++;
            if (at < limits.neighbors) { neighbors.splice(at, 0, [row.id, score, ordinal]); if (neighbors.length > limits.neighbors) neighbors.pop(); }
          }
          this.seq = message.seq;
          return { indexed: this.publication.count, count, neighbors };
        } else throw Error();
      }
      this.seq = message.seq;
      return { indexed: this.publication.count };
    } catch { this.clear(); throw new Error('semantic_write_unavailable'); }
  }
}
