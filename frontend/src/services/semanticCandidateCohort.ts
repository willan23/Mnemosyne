import type { CapturedSemanticCandidate } from './semanticCandidateCapture';

/** A fixed prefix without copying the growing capsule cohort for every imported item. */
export function semanticCandidateCohort(captured: CapturedSemanticCandidate[]): Iterable<CapturedSemanticCandidate> {
  const length = captured.length;
  return { *[Symbol.iterator]() { for (let index = 0; index < length; index++) yield captured[index]; } };
}
