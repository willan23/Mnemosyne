/**
 * Pure helpers for semantic connection backfill (cosine edges).
 */
import { embeddingSpaceOf, sameEmbeddingSpace } from './sharedEmbeddingSpace';

export interface SemanticConnectionMemory {
  id: string;
  viewHash?: string;
  embedding?: number[] | null;
  embeddingModel?: string;
  connections?: string[];
  updatedAt?: number;
}

export interface SemanticRelationProposal {
  sourceId: string;
  targetId: string;
  score: number;
  embeddingModel: string;
  algorithmVersion: 'cosine-v1';
  evidence: 'whole-memory-vector';
  sourceUpdatedAt: number;
  targetUpdatedAt: number;
}

/** Proposals are separate from legacy `connections` until the owner accepts. */
export function buildSemanticRelationProposals(
  memories: SemanticConnectionMemory[],
  options: { threshold?: number; maxRelations?: number } = {},
): SemanticRelationProposal[] {
  const threshold = options.threshold ?? 0.75;
  const maxRelations = options.maxRelations ?? 7;
  const vectors = memories.filter((memory) =>
    Array.isArray(memory.embedding) &&
    memory.embedding.length > 0 &&
    memory.embedding.every((value) => Number.isFinite(value)),
  );
  const existing = new Map(memories.map((memory) => [memory.id, new Set(memory.connections || [])]));
  const selected = new Map(memories.map((memory) => [memory.id, 0]));
  const scored: Array<{ a: SemanticConnectionMemory; b: SemanticConnectionMemory; score: number }> = [];
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const a = vectors[i];
      const b = vectors[j];
      if (a.id === b.id || !sameEmbeddingSpace(a.embeddingModel, b.embeddingModel) ||
          existing.get(a.id)?.has(b.id) || existing.get(b.id)?.has(a.id)) continue;
      const score = cosineSimilarity(a.embedding!, b.embedding!);
      if (Number.isFinite(score) && score >= threshold) scored.push({ a, b, score });
    }
  }
  scored.sort((left, right) => right.score - left.score ||
    left.a.id.localeCompare(right.a.id) || left.b.id.localeCompare(right.b.id));
  const proposals: SemanticRelationProposal[] = [];
  for (const { a, b, score } of scored) {
    if ((existing.get(a.id)?.size || 0) + (selected.get(a.id) || 0) >= maxRelations ||
        (existing.get(b.id)?.size || 0) + (selected.get(b.id) || 0) >= maxRelations) continue;
    const common = {
      score: Math.round(score * 10_000) / 10_000,
      embeddingModel: embeddingSpaceOf(a.embeddingModel),
      algorithmVersion: 'cosine-v1' as const,
      evidence: 'whole-memory-vector' as const,
    };
    proposals.push({ sourceId: a.id, targetId: b.id,
      sourceUpdatedAt: a.updatedAt || 0, targetUpdatedAt: b.updatedAt || 0, ...common });
    proposals.push({ sourceId: b.id, targetId: a.id,
      sourceUpdatedAt: b.updatedAt || 0, targetUpdatedAt: a.updatedAt || 0, ...common });
    selected.set(a.id, (selected.get(a.id) || 0) + 1);
    selected.set(b.id, (selected.get(b.id) || 0) + 1);
  }
  return proposals;
}

/** Rank one source against the full authorized candidate set. A background
 * job can resume at the next source without excluding memories past a slice.
 */
export function buildSemanticRelationProposalsForSource(
  source: SemanticConnectionMemory,
  memories: SemanticConnectionMemory[],
  options: { threshold?: number; maxRelations?: number } = {},
): SemanticRelationProposal[] {
  const threshold = options.threshold ?? 0.75;
  const maxRelations = options.maxRelations ?? 7;
  const sourceVector = source.embedding;
  if (!Array.isArray(sourceVector) || sourceVector.length === 0 ||
      !sourceVector.every(Number.isFinite)) return [];
  const sourceConnections = new Set(source.connections || []);
  const room = maxRelations - sourceConnections.size;
  if (room <= 0) return [];

  return memories
    .filter((candidate) => candidate.id !== source.id &&
      !sourceConnections.has(candidate.id) &&
      !(candidate.connections || []).includes(source.id) &&
      (candidate.connections || []).length < maxRelations &&
      sameEmbeddingSpace(source.embeddingModel, candidate.embeddingModel) &&
      Array.isArray(candidate.embedding) &&
      candidate.embedding.length === sourceVector.length &&
      candidate.embedding.every(Number.isFinite))
    .map((candidate) => ({ candidate, score: cosineSimilarity(sourceVector, candidate.embedding!) }))
    .filter(({ score }) => Number.isFinite(score) && score >= threshold)
    .sort((a, b) => b.score - a.score || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0))
    .slice(0, room)
    .map(({ candidate, score }) => ({
      sourceId: source.id,
      targetId: candidate.id,
      score: Math.round(score * 10_000) / 10_000,
      embeddingModel: embeddingSpaceOf(source.embeddingModel),
      algorithmVersion: 'cosine-v1',
      evidence: 'whole-memory-vector',
      sourceUpdatedAt: source.updatedAt || 0,
      targetUpdatedAt: candidate.updatedAt || 0,
    }));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Visual / soft positive decay: shrink importance for memories not revisited.
 */
export function applyPositiveDecayImportance(
  importance: number,
  daysSinceView: number,
  halfLifeDays = 45,
): number {
  const base = Number.isFinite(importance) ? importance : 0.5;
  const recency = Math.exp(-Math.max(0, daysSinceView) / halfLifeDays);
  return Math.max(0.12, Math.min(1, base * (0.5 + 0.5 * recency)));
}
