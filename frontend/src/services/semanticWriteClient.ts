import { CURRENT_EMBEDDING_SPACE, sameEmbeddingSpace } from './embeddingModel';
import { onMemoryCryptoChanged } from './memoryCrypto';
import { onTeamKeyChanged } from './teamVault';
import { SEMANTIC_WRITE_LIMITS as limits, semanticWriteId, type SemanticWriteCandidate, type SemanticWriteMessage } from './semanticWriteProtocol';
import { selectIndexedSemanticWriteNeighbors } from './indexedSemanticWriteCorpus';

export interface SemanticWriteOptions {
  assertCurrent?: () => void;
  signal?: AbortSignal;
  eligible?: (candidate: SemanticWriteCandidate) => boolean;
  createWorker?: () => Worker;
  yieldTask?: () => Promise<void>;
}
export interface SemanticWriteNeighbor { candidate: SemanticWriteCandidate; ordinal: number; score: number }
export interface SemanticWriteSelection { count: number; neighbors: SemanticWriteNeighbor[] }
const fail = () => new Error('semantic_write_unavailable');

/** Captures retirement before embedding inference, not only before vector selection. */
export async function withSemanticWriteScope<T>(options: SemanticWriteOptions, work: (scope: { signal: AbortSignal; assertCurrent: () => void }) => Promise<T>): Promise<T> {
  const controller = new AbortController(), retire = () => controller.abort();
  const personal = onMemoryCryptoChanged(retire), team = onTeamKeyChanged(retire);
  options.signal?.addEventListener('abort', retire, { once: true });
  const assertCurrent = () => { if (controller.signal.aborted || options.signal?.aborted) throw fail(); options.assertCurrent?.(); };
  try { assertCurrent(); const result = await work({ signal: controller.signal, assertCurrent }); assertCurrent(); return result; }
  finally { personal(); team(); options.signal?.removeEventListener('abort', retire); controller.abort(); }
}

/** Bounded projection/ACK batches; only the seven retained candidates survive between batches. */
export async function selectSemanticWriteNeighbors(query: number[], source: Iterable<SemanticWriteCandidate>, options: SemanticWriteOptions): Promise<SemanticWriteSelection> {
  const indexed = selectIndexedSemanticWriteNeighbors(query, source, options);
  if (indexed) return indexed;
  let worker: Worker | null = null, cancel: (() => void) | null = null, seq = 0, count = 0;
  const seen = new Set<string>(); let neighbors: SemanticWriteNeighbor[] = [];
  const guard = () => { if (options.signal?.aborted) throw fail(); options.assertCurrent?.(); };
  const stop = () => { worker?.terminate(); worker = null; const pending = cancel; cancel = null; pending?.(); };
  options.signal?.addEventListener('abort', stop, { once: true });
  const send = (message: SemanticWriteMessage): Promise<unknown> => {
    guard();
    if (!worker) worker = options.createWorker?.() ?? new Worker(new URL('./semanticWriteWorker.ts', import.meta.url), { type: 'module' });
    const current = worker;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { clearTimeout(timer); current.onmessage = current.onerror = current.onmessageerror = null; cancel = null; };
      const rejectRequest = () => { if (settled) return; settled = true; cleanup(); reject(fail()); };
      const timer = setTimeout(() => { rejectRequest(); stop(); }, 30_000); cancel = rejectRequest;
      current.onerror = current.onmessageerror = rejectRequest;
      current.onmessage = event => { if (settled) return; settled = true; cleanup(); resolve(event.data); };
      try { current.postMessage(message); } catch { rejectRequest(); }
    });
  };
  const scores = (response: unknown, expectedSeq: number): Array<[string, number]> => {
    if (!response || typeof response !== 'object') throw fail();
    const value = response as Record<string, unknown>;
    if (value.v !== 1 || value.seq !== expectedSeq || value.ok !== true || !Array.isArray(value.scores) || value.scores.length > limits.neighbors) throw fail();
    const unique = new Set<string>(); let previous = Infinity;
    return value.scores.map(row => {
      if (!Array.isArray(row) || row.length !== 2 || !semanticWriteId(row[0]) || unique.has(row[0]) || typeof row[1] !== 'number' ||
          !Number.isFinite(row[1]) || row[1] < limits.threshold || row[1] > 1 + 1e-12 || row[1] > previous) throw fail();
      unique.add(row[0]); previous = row[1]; return [row[0], row[1]];
    });
  };
  try {
    guard();
    if (!Array.isArray(query) || !query.length || query.length > limits.dimensions || !query.every(Number.isFinite)) throw fail();
    let chunk: Array<{ candidate: SemanticWriteCandidate; ordinal: number }> = [], visited = 0;
    const flush = async () => {
      guard();
      if (chunk.length) {
        if (!worker) { const begin = scores(await send({ v: 1, seq: 0, type: 'begin', query, space: CURRENT_EMBEDDING_SPACE }), 0); if (begin.length) throw fail(); guard(); }
        const candidates = chunk.map(({ candidate }) => ({ id: candidate.id, embedding: candidate.embedding!, embeddingModel: candidate.embeddingModel }));
        const permitted = new Map(neighbors.map(row => [row.candidate.id, row]));
        for (const row of chunk) permitted.set(row.candidate.id, { ...row, score: 0 });
        const selected = scores(await send({ v: 1, seq: ++seq, type: 'chunk', candidates }), seq); guard();
        neighbors = selected.map(([id, score]) => { const row = permitted.get(id); if (!row) throw fail(); return { ...row, score }; });
        // Stable ties must preserve input order, including across acknowledged batches.
        for (let i = 1; i < neighbors.length; i++) if (neighbors[i].score === neighbors[i - 1].score && neighbors[i].ordinal < neighbors[i - 1].ordinal) throw fail();
      }
      chunk = [];
    };
    for (const candidate of source) {
      guard();
      if (!options.eligible || options.eligible(candidate)) {
        if (!semanticWriteId(candidate.id) || seen.has(candidate.id)) throw fail(); seen.add(candidate.id);
        const ordinal = count++;
        if (Array.isArray(candidate.embedding) && candidate.embedding.length > 0 && candidate.embedding.length === query.length && sameEmbeddingSpace(CURRENT_EMBEDDING_SPACE, candidate.embeddingModel)) chunk.push({ candidate, ordinal });
      }
      if (++visited % limits.batchSize === 0) { await flush(); await (options.yieldTask?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0))); guard(); }
    }
    await flush(); guard();
    for (const { candidate } of neighbors) if (options.eligible && !options.eligible(candidate)) throw fail();
    return { count, neighbors };
  } finally { options.signal?.removeEventListener('abort', stop); stop(); seen.clear(); }
}
