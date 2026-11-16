import type { CapturedSemanticCandidate } from './semanticCandidateCapture';
import { semanticCandidateCohort } from './semanticCandidateCohort';
import { IndexedSemanticWriteCorpus } from './indexedSemanticWriteCorpus';
import type { SemanticWriteScope } from './semanticWriteScope';
import type { MemoryPublicationPatch } from './incrementalMemoryPublication';

type Position = [number, number, number];
type Row = CapturedSemanticCandidate & { timestamp: number };
export interface SemanticCandidateOperation {
  prefix(): Iterable<CapturedSemanticCandidate>;
  append(value: CapturedSemanticCandidate): Promise<void>;
  sunPositions(): Position[];
}
interface Options {
  scope?: SemanticWriteScope;
  assertCurrent: () => void;
  captureAppend: (value: CapturedSemanticCandidate) => Promise<CapturedSemanticCandidate | undefined>;
  createWorker?: () => Worker;
}

/** Owns one already captured, immutable baseline and its explicit local additions. No content or persistence. */
export function createSemanticCandidateOperation(captured: CapturedSemanticCandidate[], options: Options): SemanticCandidateOperation & { dispose(): void } {
  let closed = false, prefix: Iterable<CapturedSemanticCandidate> | undefined;
  const guard = () => { if (closed) throw new Error('semantic_write_unavailable'); options.assertCurrent(); };
  guard();
  const values = new Map<string, Row>(), suns: Position[] = [], order: string[] = [];
  const patch: MemoryPublicationPatch<Row> = { changed: [], removed: [], order: { reset: order, changes: [] } };
  for (const value of captured) {
    if (values.has(value.id)) throw new Error('semantic_write_unavailable');
    const row = { ...value, timestamp: 0 }; values.set(row.id, row);
    patch.changed.push({ id: row.id, value: row }); order.push(row.id);
    if (value.celestialType === 'sun') suns.push(value.position ?? [0, 0, 0]);
  }
  const descriptor = options.scope;
  const corpus = descriptor ? new IndexedSemanticWriteCorpus({ uid: descriptor.uid, teamIds: new Set(descriptor.teamId ? [descriptor.teamId] : []) }, id => values.get(id), options.createWorker) : null;
  corpus?.apply('captured', patch);
  return {
    prefix() {
      guard();
      if (!prefix) { prefix = semanticCandidateCohort(captured); if (descriptor) corpus?.associateCaptured(prefix, captured.length, descriptor); }
      return prefix;
    },
    async append(value) {
      guard(); if (values.has(value.id)) throw new Error('semantic_write_unavailable');
      const copy = await options.captureAppend(value); guard();
      if (!copy || values.has(copy.id)) throw new Error('semantic_write_unavailable');
      const next = { ...copy, timestamp: 0 }, index = captured.length;
      values.set(next.id, next); captured.push(copy); prefix = undefined;
      if (copy.celestialType === 'sun') suns.push(copy.position ?? [0, 0, 0]);
      corpus?.apply('captured', { changed: [{ id: next.id, value: next }], removed: [], order: { changes: [{ type: 'added', id: next.id, oldIndex: -1, newIndex: index }] } });
    },
    sunPositions() { guard(); return suns.map(value => [...value] as Position); },
    dispose() { if (closed) return; closed = true; corpus?.clear(); values.clear(); suns.length = 0; prefix = undefined; },
  };
}
