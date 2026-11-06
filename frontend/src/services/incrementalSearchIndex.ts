import { rankSearchVectors, type SearchVectorCandidate } from './searchVectorRanking';

export interface IncrementalSearchRequest {
  id: number;
  changed: SearchVectorCandidate[];
  removed: string[];
  query: number[];
  embeddingModel: string;
  floor: number;
}

export class IncrementalSearchIndex {
  private candidates = new Map<string, SearchVectorCandidate>();

  search(request: IncrementalSearchRequest) {
    for (const id of request.removed) this.candidates.delete(id);
    for (const candidate of request.changed) this.candidates.set(candidate.id, candidate);
    return rankSearchVectors({ ...request, candidates: [...this.candidates.values()] });
  }
}
