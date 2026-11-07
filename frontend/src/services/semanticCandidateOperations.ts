import { captureSemanticCandidates, type CapturedSemanticCandidate } from './semanticCandidateCapture';
import { scopedIndexedSemanticSource } from './indexedSemanticWriteCorpus';
import { createSemanticCandidateOperation, type SemanticCandidateOperation } from './semanticCandidateOperationIndex';
import { readSemanticWriteScope } from './semanticWriteScope';
import { withSemanticWriteScope, type SemanticWriteOptions } from './semanticWriteClient';

type Options = SemanticWriteOptions & { eligible: (row: CapturedSemanticCandidate) => boolean };

/** A single write reuses an authorized published index; other sources retain the guarded capture contract. */
export async function withSemanticCandidates<T>(source: Iterable<CapturedSemanticCandidate>, options: Options,
  work: (candidates: Iterable<CapturedSemanticCandidate>, assertCurrent: () => void) => Promise<T>): Promise<T> {
  return withSemanticWriteScope(options, async scope => {
    const candidates = scopedIndexedSemanticSource(source, options.eligible) ?? await captureSemanticCandidates(source, { ...options, ...scope });
    scope.assertCurrent(); const result = await work(candidates, scope.assertCurrent); scope.assertCurrent(); return result;
  });
}

export type { SemanticCandidateOperation } from './semanticCandidateOperationIndex';

/** Fixed metadata capture for an entire batch, with one volatile Worker and explicit prefix growth. */
export async function withSemanticCandidateOperation<T>(source: Iterable<CapturedSemanticCandidate>, options: Options,
  work: (operation: SemanticCandidateOperation, assertCurrent: () => void) => Promise<T>): Promise<T> {
  return withSemanticWriteScope(options, async scope => {
    const captured = await captureSemanticCandidates(source, { ...options, ...scope }); scope.assertCurrent();
    const operation = createSemanticCandidateOperation(captured, { scope: readSemanticWriteScope(options.eligible), assertCurrent: scope.assertCurrent,
      createWorker: options.createWorker, captureAppend: async value => (await captureSemanticCandidates([value], { ...options, ...scope }))[0] });
    const retire = () => operation.dispose(); scope.signal.addEventListener('abort', retire, { once: true });
    try { const result = await work(operation, scope.assertCurrent); scope.assertCurrent(); return result; }
    finally { scope.signal.removeEventListener('abort', retire); operation.dispose(); }
  });
}
