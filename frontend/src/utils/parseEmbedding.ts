import { readStoredEmbedding } from '../../../functions/src/embeddingStorage';

/** Accept current JSON storage and historical arrays without changing dimensions. */
export function parseEmbedding(value: unknown): number[] {
  return readStoredEmbedding(value) ?? [];
}
