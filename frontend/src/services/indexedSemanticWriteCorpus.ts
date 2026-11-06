import { CURRENT_EMBEDDING_SPACE, sameEmbeddingSpace } from './embeddingModel';
import type { MemoryPublicationPatch } from './incrementalMemoryPublication';
import type { MemoryReadScope } from './memoryReadScope';
import { isPersonalSemanticCandidate } from './personalSemanticScope';
import { readSemanticWriteScope, type SemanticWriteScope } from './semanticWriteScope';
import { SEMANTIC_WRITE_LIMITS as limits, semanticWriteId, type SemanticWriteCandidate } from './semanticWriteProtocol';
import type { SemanticWriteOptions, SemanticWriteSelection } from './semanticWriteClient';
import { INDEXED_SEMANTIC_WRITE_LIMITS as capacity, type IndexedSemanticDocument, type IndexedSemanticWriteMessage } from './indexedSemanticWriteProtocol';

type Candidate = SemanticWriteCandidate & { timestamp: number };
type Pending<T> = { type: 'patch'; source: string; patch: MemoryPublicationPatch<T> } | { type: 'remove'; source: string };
interface Binding { owner: IndexedSemanticWriteCorpus<Candidate>; revision: number; size: number }
const bindings = new WeakMap<object, Binding>();
const fail = () => new Error('semantic_write_unavailable');
type Message = IndexedSemanticWriteMessage extends infer M ? M extends { seq: number } ? Omit<M, 'seq'> : never : never;

/** Scope-owned replica. Initial load is batched once; subsequent requests project only snapshot deltas. */
export class IndexedSemanticWriteCorpus<T extends Candidate> {
  private revision = 0;
  private closed = false;
  private pending: Pending<T>[] = [];
  private pendingChanges = 0;
  private sources = new Map<string, string>();
  private scopes = new Map<string, string>();
  private worker: Worker | null = null;
  private seq = 0;
  private requests = new Map<number, { reject: () => void }>();
  private tail: Promise<unknown> = Promise.resolve();
  private readScope: MemoryReadScope;
  private get: (id: string) => T | undefined;
  private createWorker: () => Worker;
  constructor(scope: MemoryReadScope, get: (id: string) => T | undefined, createWorker = () => new Worker(new URL('./indexedSemanticWriteWorker.ts', import.meta.url), { type: 'module' })) {
    this.readScope = { uid: scope.uid, teamIds: new Set(scope.teamIds) };
    this.get = get; this.createWorker = createWorker;
  }
  private source(key: string): string { let id = this.sources.get(key); if (!id) { id = 's' + this.sources.size; this.sources.set(key, id); } return id; }
  private scope(key: string): string { let id = this.scopes.get(key); if (!id) { id = 'c' + this.scopes.size; this.scopes.set(key, id); } return id; }
  private cohort(row: Candidate): string | null {
    if (row.encLocked || row.deletedAt || row.teamScopeAmbiguous) return null;
    if (row.teamId != null) return this.readScope.teamIds.has(row.teamId) ? this.scope('team:' + row.teamId) : null;
    return isPersonalSemanticCandidate(row, this.readScope.uid) ? this.scope('personal') : null;
  }
  apply(source: string, patch: MemoryPublicationPatch<T>): void {
    if (this.closed) return;
    this.pending.push({ type: 'patch', source: this.source(source), patch }); this.pendingChanges += patch.changed.length; this.revision++;
    if (this.pending.length > capacity.pendingBatches || this.pendingChanges > capacity.pendingChanges) { this.clear(); return; }
    if (this.worker) this.scheduleFlush();
  }
  removeSource(source: string): void {
    if (this.closed) return;
    this.pending.push({ type: 'remove', source: this.source(source) }); this.revision++;
    if (this.pending.length > capacity.pendingBatches) { this.clear(); return; }
    if (this.worker) this.scheduleFlush();
  }
  associate(values: T[]): void { bindings.set(values, { owner: this, revision: this.revision, size: values.length }); }
  clear(): void {
    if (this.closed) return;
    this.closed = true; this.revision++; this.worker?.terminate(); this.worker = null;
    for (const request of this.requests.values()) request.reject(); this.requests.clear();
    this.pending = []; this.pendingChanges = 0; this.sources.clear(); this.scopes.clear();
  }
  private current(revision: number) { if (this.closed || revision !== this.revision) throw fail(); }
  private exchange(message: Message, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (this.closed || signal?.aborted) return Promise.reject(fail());
    const seq = ++this.seq;
    if (!this.worker) this.worker = this.createWorker();
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { clearTimeout(timer); worker.removeEventListener('message', receive); worker.removeEventListener('error', error); worker.removeEventListener('messageerror', error); signal?.removeEventListener('abort', abort); this.requests.delete(seq); };
      const refuse = () => { if (!settled) { settled = true; cleanup(); reject(fail()); } };
      const error = () => { refuse(); this.clear(); };
      const abort = () => refuse();
      const receive = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown>;
        if (!data || data.seq !== seq) return;
        if (data.v !== 1 || data.ok !== true || !Number.isSafeInteger(data.indexed) || (data.indexed as number) < 0 || (data.indexed as number) > capacity.documents) { error(); return; }
        if (!settled) { settled = true; cleanup(); resolve(data); }
      };
      const timer = setTimeout(error, 30_000);
      this.requests.set(seq, { reject: refuse });
      worker.addEventListener('message', receive); worker.addEventListener('error', error); worker.addEventListener('messageerror', error); signal?.addEventListener('abort', abort, { once: true });
      try { worker.postMessage({ ...message, seq }); } catch { error(); }
    });
  }
  private async flush(): Promise<void> {
    if (this.closed) throw fail();
    if (!this.worker) await this.exchange({ v: 1, type: 'init' });
    while (this.pending.length) {
      if (this.closed) throw fail();
      const next = this.pending[0];
      if (next.type === 'remove') await this.exchange({ v: 1, type: 'remove', source: next.source });
      else {
        let changed: MemoryPublicationPatch<IndexedSemanticDocument>['changed'] = [];
        await this.exchange({ v: 1, type: 'patch-start', source: next.source, changed: next.patch.changed.length, removed: next.patch.removed, order: next.patch.order });
        for (let at = 0; at < next.patch.changed.length; at++) {
          const { id, value } = next.patch.changed[at];
          if (!value) changed.push({ id, value: null });
          else {
            const scope = this.cohort(value), vector = scope !== null && sameEmbeddingSpace(CURRENT_EMBEDDING_SPACE, value.embeddingModel) ? value.embedding : undefined;
            changed.push({ id, value: { id: value.id, timestamp: value.timestamp, scope,
              embedding: Array.isArray(vector) && vector.length <= limits.dimensions ? vector.slice() : null, embeddingModel: scope !== null && sameEmbeddingSpace(CURRENT_EMBEDDING_SPACE, value.embeddingModel) ? CURRENT_EMBEDDING_SPACE : undefined } });
          }
          if (changed.length === limits.batchSize || at + 1 === next.patch.changed.length) {
            const ack = await this.exchange({ v: 1, type: 'patch-chunk', changed }); if (ack.changed !== changed.length) { this.clear(); throw fail(); }
            changed = [];
            if (at + 1 < next.patch.changed.length) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (this.closed) throw fail(); }
          }
        }
        const ack = await this.exchange({ v: 1, type: 'patch-end' });
        if (ack.changed !== next.patch.changed.length || ack.removed !== next.patch.removed.length) { this.clear(); throw fail(); }
        this.pendingChanges -= next.patch.changed.length;
      }
      this.pending.shift();
    }
  }
  private scheduleFlush() {
    this.tail = this.tail.then(() => this.flush()).catch(() => { this.clear(); });
  }
  select(query: number[], scope: SemanticWriteScope, revision: number, size: number, options: SemanticWriteOptions): Promise<SemanticWriteSelection> {
    const guard = () => { this.current(revision); if (scope.uid !== this.readScope.uid || scope.teamId && !this.readScope.teamIds.has(scope.teamId) || options.signal?.aborted) throw fail(); options.assertCurrent?.(); };
    const work = this.tail.then(async () => {
      guard();
      if (!Array.isArray(query) || !query.length || query.length > limits.dimensions || !query.every(Number.isFinite)) throw fail();
      await this.flush(); guard();
      const response = await this.exchange({ v: 1, type: 'query', query, space: CURRENT_EMBEDDING_SPACE, scope: this.scope(scope.teamId ? 'team:' + scope.teamId : 'personal'), excludeId: scope.excludeId }, options.signal); guard();
      if (response.indexed !== size || !Number.isSafeInteger(response.count) || (response.count as number) < 0 || (response.count as number) > size || !Array.isArray(response.neighbors) || response.neighbors.length > limits.neighbors) { this.clear(); throw fail(); }
      const count = response.count as number, seen = new Set<string>(); let priorScore = Infinity, priorOrdinal = -1;
      const invalidResult = () => { this.clear(); return fail(); };
      const neighbors = response.neighbors.map(row => {
        if (!Array.isArray(row) || row.length !== 3 || !semanticWriteId(row[0]) || seen.has(row[0]) || typeof row[1] !== 'number' || !Number.isFinite(row[1]) || row[1] < limits.threshold || row[1] > 1 + 1e-12 || row[1] > priorScore || !Number.isSafeInteger(row[2]) || row[2] < 0 || row[2] >= count || row[1] === priorScore && row[2] <= priorOrdinal) throw invalidResult();
        const candidate = this.get(row[0]);
        if (!candidate || this.cohort(candidate) !== this.scope(scope.teamId ? 'team:' + scope.teamId : 'personal') || candidate.id === scope.excludeId || options.eligible && !options.eligible(candidate)) throw invalidResult();
        seen.add(row[0]); priorScore = row[1]; priorOrdinal = row[2]; return { candidate, score: row[1], ordinal: row[2] };
      }); guard(); return { count, neighbors };
    });
    this.tail = work.then(() => undefined, () => undefined);
    return work;
  }
}

export function selectIndexedSemanticWriteNeighbors(query: number[], source: Iterable<SemanticWriteCandidate>, options: SemanticWriteOptions): Promise<SemanticWriteSelection> | undefined {
  const binding = bindings.get(source), scope = readSemanticWriteScope(options.eligible);
  return binding && scope ? binding.owner.select(query, scope, binding.revision, binding.size, options) : undefined;
}
