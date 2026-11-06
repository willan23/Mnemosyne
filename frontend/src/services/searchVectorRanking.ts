import { sameEmbeddingSpace } from './embeddingModel';
import { cosineSimilarity } from './semanticConnectionBackfill';

export interface SearchVectorCandidate {
  id: string;
  embedding: number[];
  embeddingModel?: string;
}

export interface SearchVectorRequest {
  candidates: SearchVectorCandidate[];
  query: number[];
  embeddingModel: string;
  floor: number;
}

export function rankSearchVectors(request: SearchVectorRequest): Array<[string, number]> {
  if (!request.query.length || !request.query.every(Number.isFinite) ||
      !Number.isFinite(request.floor) || request.floor < -1 || request.floor > 1) return [];
  const scores: Array<[string, number]> = [];
  for (const candidate of request.candidates) {
    if (!sameEmbeddingSpace(candidate.embeddingModel, request.embeddingModel) ||
        candidate.embedding.length !== request.query.length || !candidate.embedding.every(Number.isFinite)) continue;
    const score = cosineSimilarity(request.query, candidate.embedding);
    if (Number.isFinite(score) && score >= request.floor) scores.push([candidate.id, score]);
  }
  return scores;
}
