export const SEMANTIC_WRITE_LIMITS = Object.freeze({ batchSize: 128, neighbors: 7, threshold: .55, dimensions: 4096 });
export interface SemanticWriteCandidate {
  id: string; uid: string; teamId?: string; teamScopeAmbiguous?: boolean; sharedWithIds?: unknown;
  deletedAt?: number; encLocked?: boolean; embedding?: number[]; embeddingModel?: string;
  position?: [number, number, number]; semanticClusterId?: string;
}
export type SemanticWriteMessage = { v: 1; seq: 0; type: 'begin'; query: number[]; space: string } |
  { v: 1; seq: number; type: 'chunk'; candidates: Array<{ id: string; embedding: number[]; embeddingModel?: string }> };
export const semanticWriteId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('/');
