import { describe, expect, it } from 'vitest';
import {
  readSemanticProposalCursor,
  readSemanticProposalProgress,
  semanticProposalRevision,
} from './semanticProposalCheckpoint';

describe('semantic proposal checkpoint', () => {
  it('resumes only when the candidate revision still matches', () => {
    const base = [{ id: 'a', updatedAt: 1, embedding: [1, 0], connections: [] }];
    const revision = semanticProposalRevision(base);
    expect(readSemanticProposalCursor(JSON.stringify({ revision, next: 1 }), revision, 1)).toBe(1);
    expect(readSemanticProposalCursor(JSON.stringify({ revision, next: 2 }), revision, 1)).toBe(0);
    expect(readSemanticProposalCursor('{broken', revision, 1)).toBe(0);
    expect(readSemanticProposalCursor(JSON.stringify({ revision, next: -1 }), revision, 1)).toBe(0);
  });

  it('restarts after a new candidate, revision or accepted connection', () => {
    const base = [{ id: 'a', updatedAt: 1, embedding: [1, 0], connections: [] }];
    const revision = semanticProposalRevision(base);
    const saved = JSON.stringify({ revision, next: 1 });
    expect(readSemanticProposalCursor(saved, semanticProposalRevision([
      ...base, { id: 'b', updatedAt: 2, embedding: [1, 0], connections: [] },
    ]), 2)).toBe(0);
    expect(readSemanticProposalCursor(saved, semanticProposalRevision([
      { ...base[0], updatedAt: 2 },
    ]), 1)).toBe(0);
    expect(readSemanticProposalCursor(saved, semanticProposalRevision([
      { ...base[0], connections: ['b'] },
    ]), 1)).toBe(0);
  });

  it('keeps the daily budget when a candidate revision changes', () => {
    const saved = JSON.stringify({ revision: 'old', next: 42, day: 10, processedToday: 37 });
    expect(readSemanticProposalProgress(saved, 'new', 100, 10))
      .toEqual({ next: 0, processedToday: 37 });
    expect(readSemanticProposalProgress(saved, 'new', 100, 11))
      .toEqual({ next: 0, processedToday: 0 });
  });
});
