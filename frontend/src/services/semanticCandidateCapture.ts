import { CURRENT_EMBEDDING_SPACE, sameEmbeddingSpace } from './embeddingModel';
import { isPersonalSemanticCandidate } from './personalSemanticScope';
import { withSemanticWriteScope, type SemanticWriteOptions } from './semanticWriteClient';
import { SEMANTIC_WRITE_LIMITS as limits, semanticWriteId, type SemanticWriteCandidate } from './semanticWriteProtocol';

export type CapturedSemanticCandidate = SemanticWriteCandidate & { celestialType?: string };
/** A fixed prefix without copying the growing capsule cohort for every imported item. */
export function semanticCandidateCohort(captured: CapturedSemanticCandidate[]): Iterable<CapturedSemanticCandidate> {
  const length = captured.length;
  return { *[Symbol.iterator]() { for (let index = 0; index < length; index++) yield captured[index]; } };
}
/** Same captured cohort for every item in an import; never copy plaintext, envelopes or attachments. */
export async function captureSemanticCandidates(
  source: Iterable<CapturedSemanticCandidate>,
  options: SemanticWriteOptions & { eligible: (row: CapturedSemanticCandidate) => boolean },
): Promise<CapturedSemanticCandidate[]> {
  return withSemanticWriteScope(options, async scope => {
    const captured: CapturedSemanticCandidate[] = [], seen = new Set<string>(); let visited = 0;
    for (const row of source) {
      scope.assertCurrent();
      if (options.eligible(row)) {
        if (!semanticWriteId(row.id) || seen.has(row.id)) throw new Error('semantic_write_unavailable'); seen.add(row.id);
        // Legacy vectors still count as memories but cannot be compared with the current query.
        const vector = sameEmbeddingSpace(CURRENT_EMBEDDING_SPACE, row.embeddingModel) ? row.embedding : undefined;
        captured.push({ id: row.id, uid: row.uid, teamId: row.teamId, teamScopeAmbiguous: row.teamScopeAmbiguous,
          deletedAt: row.deletedAt, encLocked: row.encLocked,
          embedding: Array.isArray(vector) && vector.length <= limits.dimensions ? vector.slice() : undefined,
          embeddingModel: row.embeddingModel, position: row.position ? [...row.position] : undefined,
          semanticClusterId: row.semanticClusterId, celestialType: row.celestialType });
      }
      if (++visited % limits.batchSize === 0) { await (options.yieldTask?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0))); scope.assertCurrent(); }
    }
    scope.assertCurrent(); return captured;
  });
}
export function semanticCandidateEligibility(uid: string, teamId?: string, excludeId?: string) {
  return (row: CapturedSemanticCandidate): boolean => row.id !== excludeId && (teamId
    ? row.teamId === teamId && !row.teamScopeAmbiguous && !row.encLocked && !row.deletedAt
    : isPersonalSemanticCandidate(row, uid));
}
