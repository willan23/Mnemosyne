import { CURRENT_EMBEDDING_SPACE, sameEmbeddingSpace } from './embeddingModel';
import { cosineSimilarity } from './semanticConnectionBackfill';
import { SEMANTIC_WRITE_LIMITS as limits, semanticWriteId, type SemanticWriteMessage } from './semanticWriteProtocol';

/** Streaming top seven. Vectors are discarded after each acknowledged batch. */
export class SemanticWriteIndex {
  private query: number[] | null = null;
  private seq = -1;
  private seen = new Set<string>();
  private best: Array<[string, number]> = [];
  clear(): void { this.query = null; this.seq = -1; this.seen.clear(); this.best = []; }
  handle(message: SemanticWriteMessage): Array<[string, number]> {
    try {
      if (!message || message.v !== 1 || !Number.isSafeInteger(message.seq)) throw Error();
      if (message.type === 'begin') {
        this.clear();
        if (message.seq !== 0 || message.space !== CURRENT_EMBEDDING_SPACE || !Array.isArray(message.query) ||
            !message.query.length || message.query.length > limits.dimensions || !message.query.every(Number.isFinite)) throw Error();
        this.query = message.query; this.seq = 0; return [];
      }
      if (message.type !== 'chunk' || !this.query || message.seq !== this.seq + 1 || !Array.isArray(message.candidates) || message.candidates.length > limits.batchSize) throw Error();
      for (const row of message.candidates) {
        if (!row || !semanticWriteId(row.id) || this.seen.has(row.id)) throw Error();
        this.seen.add(row.id);
        if (!sameEmbeddingSpace(CURRENT_EMBEDDING_SPACE, row.embeddingModel) || !Array.isArray(row.embedding) ||
            row.embedding.length !== this.query.length || !row.embedding.every(Number.isFinite)) continue;
        const score = cosineSimilarity(this.query, row.embedding);
        if (!Number.isFinite(score) || score < limits.threshold) continue;
        let index = 0; while (index < this.best.length && this.best[index][1] >= score) index++;
        if (index < limits.neighbors) { this.best.splice(index, 0, [row.id, score]); if (this.best.length > limits.neighbors) this.best.pop(); }
      }
      this.seq = message.seq; return this.best.map(([id, score]) => [id, score]);
    } catch { this.clear(); throw new Error('semantic_write_unavailable'); }
  }
}
