import { describe, expect, it } from 'vitest';
import {
  applyPositiveDecayImportance,
  buildSemanticRelationProposals,
  buildSemanticRelationProposalsForSource,
  cosineSimilarity,
} from './semanticConnectionBackfill';

describe('semanticConnectionBackfill', () => {
  it('builds scored private proposals without changing existing links', () => {
    const proposals = buildSemanticRelationProposals([
      { id: 'a', embedding: [1, 0], connections: ['manual'], updatedAt: 2 },
      { id: 'b', embedding: [1, 0], connections: [], updatedAt: 3 },
      { id: 'c', embedding: [0, 1], connections: [] },
    ], { threshold: 0.8, maxRelations: 2 });
    expect(proposals).toEqual([
      expect.objectContaining({ sourceId: 'a', targetId: 'b', score: 1,
        algorithmVersion: 'cosine-v1', evidence: 'whole-memory-vector',
        sourceUpdatedAt: 2, targetUpdatedAt: 3 }),
      expect.objectContaining({ sourceId: 'b', targetId: 'a', score: 1,
        sourceUpdatedAt: 3, targetUpdatedAt: 2 }),
    ]);
  });

  it('does not re-suggest an existing link or compare malformed vectors', () => {
    expect(buildSemanticRelationProposals([
      { id: 'a', embedding: [1, 0], connections: ['b'] },
      { id: 'b', embedding: [1, 0], connections: [] },
      { id: 'c', embedding: [1, Number.NaN], connections: [] },
    ])).toEqual([]);
  });
  it('computes cosine similarity for aligned vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('creates bidirectional proposals above threshold', () => {
    const proposals = buildSemanticRelationProposals([
      { id: 'a', embedding: [1, 0, 0], connections: [] },
      { id: 'b', embedding: [0.98, 0.1, 0], connections: [] },
      { id: 'c', embedding: [0, 1, 0], connections: [] },
    ], { threshold: 0.8, maxRelations: 3 });
    expect(proposals.map(({ sourceId, targetId }) => `${sourceId}:${targetId}`))
      .toEqual(['a:b', 'b:a']);
  });

  it('skips memories without embeddings', () => {
    const proposals = buildSemanticRelationProposals([
      { id: 'a', connections: [] },
      { id: 'b', embedding: [1, 0], connections: [] },
    ]);
    expect(proposals).toEqual([]);
  });

  it('skips equally sized vectors from different embedding spaces', () => {
    const proposals = buildSemanticRelationProposals([
      { id: 'legacy', embedding: [1, 0], connections: [] },
      { id: 'future', embedding: [1, 0], embeddingModel: 'future-model@revision-1', connections: [] },
    ]);
    expect(proposals).toEqual([]);
  });

  it('respects existing link capacity without truncating links', () => {
    const proposals = buildSemanticRelationProposals([
      { id: 'a', embedding: [1, 0], connections: ['user-z', 'user-y', 'user-x'] },
      { id: 'b', embedding: [1, 0], connections: [] },
    ], { threshold: 0.8, maxRelations: 3 });
    expect(proposals).toEqual([]);
  });

  it('does not infer a link when a historical backlink already exists', () => {
    const proposals = buildSemanticRelationProposals([
      { id: 'a', embedding: [1, 0], connections: ['b'] },
      { id: 'b', embedding: [1, 0], connections: [] },
    ], { threshold: 0.8, maxRelations: 2 });
    expect(proposals).toEqual([]);
  });

  it('prioritizes the highest score while respecting room on both ends', () => {
    const proposals = buildSemanticRelationProposals([
      { id: 'a', embedding: [1, 0], connections: ['manual'] },
      { id: 'b', embedding: [1, 0], connections: [] },
      { id: 'c', embedding: [0.9, 0.1], connections: [] },
    ], { threshold: 0.8, maxRelations: 2 });
    expect(proposals.filter((proposal) => proposal.sourceId === 'a')
      .map((proposal) => proposal.targetId)).toEqual(['b']);
  });

  it('applies positive decay over time', () => {
    expect(applyPositiveDecayImportance(1, 0)).toBeCloseTo(1);
    expect(applyPositiveDecayImportance(1, 45)).toBeLessThan(0.85);
    expect(applyPositiveDecayImportance(1, 365)).toBeGreaterThanOrEqual(0.12);
  });

  it('finds a compatible match beyond the first 80 candidates', () => {
    const source = { id: 'source', embedding: [1, 0], connections: [], updatedAt: 4 };
    const unrelated = Array.from({ length: 100 }, (_, index) => ({
      id: `other-${index}`, embedding: [0, 1], connections: [], updatedAt: 5,
    }));
    const proposals = buildSemanticRelationProposalsForSource(source, [source, ...unrelated,
      { id: 'late', embedding: [1, 0], connections: [], updatedAt: 6 },
    ]);
    expect(proposals).toEqual([expect.objectContaining({
      sourceId: 'source', targetId: 'late', score: 1, sourceUpdatedAt: 4, targetUpdatedAt: 6,
    })]);
  });

  it('skips incompatible spaces, existing links and full targets for a source', () => {
    const source = { id: 'source', embedding: [1, 0], connections: ['manual'] };
    const proposals = buildSemanticRelationProposalsForSource(source, [
      source,
      { id: 'future', embedding: [1, 0], embeddingModel: 'future@1' },
      { id: 'manual', embedding: [1, 0] },
      { id: 'backlink', embedding: [1, 0], connections: ['source'] },
      { id: 'full', embedding: [1, 0], connections: Array.from({ length: 7 }, (_, n) => `x${n}`) },
      { id: 'eligible', embedding: [1, 0] },
    ]);
    expect(proposals.map((proposal) => proposal.targetId)).toEqual(['eligible']);
  });
});
