import { CURRENT_EMBEDDING_SPACE, sameEmbeddingSpace } from './embeddingModel';
import type { MemoryPublicationPatch } from './incrementalMemoryPublication';
import type { MemoryReadScope } from './memoryReadScope';
import { isPersonalSemanticCandidate } from './personalSemanticScope';
import { readSemanticWriteScope, type SemanticWriteScope } from './semanticWriteScope';
import { SEMANTIC_WRITE_LIMITS as limits, semanticWriteId, type SemanticWriteCandidate } from './semanticWriteProtocol';
import type { SemanticWriteOptions, SemanticWriteSelection } from './semanticWriteClient';
import { INDEXED_SEMANTIC_WRITE_LIMITS as capacity, type IndexedSemanticDocument, type IndexedSemanticWriteMessage } from './indexedSemanticWriteProtocol';

type Candidate = SemanticWriteCandidate & { timestamp: number };
type Pending<T> = { type: 'patch'; source: string; patch: MemoryPublicationPatch<T>; priority?: number } | { type: 'remove'; source: string } | { type: 'exclude'; source: string; key: string; changes: Map<string, boolean>; inFlight?: boolean };
interface Binding { owner: IndexedSemanticWriteCorpus<Candidate>; revision: number; size: number; defaultScope?: SemanticWriteScope; source?: string }
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
  private currentSources = new Map<string, Map<string, T | null>>();
  private exclusions = new Map<string, Set<string>>();
  private worker: Worker | null = null;
  private seq = 0;
  private requests = new Map<number, { reject: () => void }>();
  private tail: Promise<unknown> = Promise.resolve();
  private readScope: MemoryReadScope;
  private get: (id: string) => T | undefined;
  private createWorker: () => Worker;
  private options: { direction?: 'asc' | 'desc'; sourceBase?: number };
  constructor(scope: MemoryReadScope, get: (id: string) => T | undefined, createWorker = () => new Worker(new URL('./indexedSemanticWriteWorker.ts', import.meta.url), { type: 'module' }), options: { direction?: 'asc' | 'desc'; sourceBase?: number } = {}) {
    this.readScope = { uid: scope.uid, teamIds: new Set(scope.teamIds) };
    this.get = get; this.createWorker = createWorker; this.options = { direction: options.direction, sourceBase: options.sourceBase };
  }
  private source(key: string): string { let id = this.sources.get(key); if (!id) { id = 's' + this.sources.size; this.sources.set(key, id); } return id; }
  private scope(key: string): string { let id = this.scopes.get(key); if (!id) { id = 'c' + this.scopes.size; this.scopes.set(key, id); } return id; }
  private cohort(row: Candidate): string | null {
    if (row.encLocked || row.deletedAt || row.teamScopeAmbiguous) return null;
    if (row.teamId != null) return this.readScope.teamIds.has(row.teamId) ? this.scope('team:' + row.teamId) : null;
    return isPersonalSemanticCandidate(row, this.readScope.uid) ? this.scope('personal') : null;
  }
  private project(source: string, id: string, value: T | null): IndexedSemanticDocument | null {
    if (!value) return null;
    const scope = this.exclusions.get(source)?.has(id) ? null : this.cohort(value);
    const vector = scope !== null && sameEmbeddingSpace(CURRENT_EMBEDDING_SPACE, value.embeddingModel) ? value.embedding : undefined;
    return { id: value.id, timestamp: value.timestamp, scope, embedding: Array.isArray(vector) && vector.length <= limits.dimensions ? vector : null,
      embeddingModel: scope !== null && sameEmbeddingSpace(CURRENT_EMBEDDING_SPACE, value.embeddingModel) ? CURRENT_EMBEDDING_SPACE : undefined };
  }
  apply(source: string, patch: MemoryPublicationPatch<T>, priority?: number): void {
    if (this.closed) return;
    let values = this.currentSources.get(source);
    if (!values) { values = new Map(); this.currentSources.set(source, values); }
    else if (patch.order.reset) { const retained = new Map<string, T | null>(); for (const id of patch.order.reset) if (values.has(id)) retained.set(id, values.get(id)!); values = retained; this.currentSources.set(source, values); }
    for (const id of patch.removed) values.delete(id);
    for (const row of patch.changed) values.set(row.id, row.value);
    this.pending.push({ type: 'patch', source: this.source(source), patch, priority }); this.pendingChanges += patch.changed.length; this.revision++;
    if (this.pending.length > capacity.pendingBatches || this.pendingChanges > capacity.pendingChanges) { this.clear(); return; }
    if (this.worker) this.scheduleFlush();
  }
  removeSource(source: string): void {
    if (this.closed) return;
    this.currentSources.delete(source);
    this.pending.push({ type: 'remove', source: this.source(source) }); this.revision++;
    if (this.pending.length > capacity.pendingBatches) { this.clear(); return; }
    if (this.worker) this.scheduleFlush();
  }
  exclude(source: string, id: string, excluded: boolean): void {
    if (this.closed) return;
    const key = this.source(source), last = this.pending.at(-1);
    if (Boolean(this.exclusions.get(key)?.has(id)) === excluded) return;
    let ids = this.exclusions.get(key); if (!ids) { ids = new Set(); this.exclusions.set(key, ids); }
    if (excluded) ids.add(id); else ids.delete(id);
    // A tombstone reset can contain thousands of IDs; one queue entry, bounded wire batches.
    if (last?.type === 'exclude' && last.source === key && !last.inFlight) { if (!last.changes.has(id)) this.pendingChanges++; last.changes.set(id, excluded); }
    else { this.pending.push({ type: 'exclude', source: key, key: source, changes: new Map([[id, excluded]]) }); this.pendingChanges++; }
    this.revision++;
    if (this.pending.length > capacity.pendingBatches || this.pendingChanges > capacity.pendingChanges) { this.clear(); return; }
    if (this.worker) this.scheduleFlush();
  }
  /** Membership changes are rare scope transitions, not per-write preparation. Reproject only affected teams. */
  setTeams(teamIds: ReadonlySet<string>): void {
    if (this.closed) return;
    const changed = new Set([...this.readScope.teamIds, ...teamIds].filter(id => this.readScope.teamIds.has(id) !== teamIds.has(id)));
    if (!changed.size) return;
    this.readScope = { uid: this.readScope.uid, teamIds: new Set(teamIds) }; this.revision++;
    for (const [source, values] of this.currentSources) {
      const rows: MemoryPublicationPatch<T>['changed'] = [];
      for (const [id, value] of values) if (value?.teamId && changed.has(value.teamId)) rows.push({ id, value });
      if (rows.length) this.apply(source, { changed: rows, removed: [], order: { changes: [] } });
    }
  }
  sourceSelection(source: string, size: number, eligible: (row: SemanticWriteCandidate) => boolean): Iterable<SemanticWriteCandidate> {
    const scope = readSemanticWriteScope(eligible); if (!scope) throw fail();
    const alias = { [Symbol.iterator](): Iterator<SemanticWriteCandidate> { throw fail(); } };
    bindings.set(alias, { owner: this, revision: this.revision, size, source, defaultScope: scope }); return alias;
  }
  associate(values: readonly T[]): void { bindings.set(values, { owner: this, revision: this.revision, size: values.length }); }
  associateCaptured(source: Iterable<SemanticWriteCandidate>, size: number, scope: SemanticWriteScope): void {
    bindings.set(source, { owner: this, revision: this.revision, size, defaultScope: scope });
  }
  clear(): void {
    if (this.closed) return;
    this.closed = true; this.revision++; this.worker?.terminate(); this.worker = null;
    for (const request of this.requests.values()) request.reject(); this.requests.clear();
    this.pending = []; this.pendingChanges = 0; this.sources.clear(); this.scopes.clear(); this.currentSources.clear(); this.exclusions.clear();
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
    if (!this.worker) await this.exchange({ v: 1, type: 'init', ...this.options });
    while (this.pending.length) {
      if (this.closed) throw fail();
      const next = this.pending[0];
      if (next.type === 'remove') await this.exchange({ v: 1, type: 'remove', source: next.source });
      else if (next.type === 'exclude') {
        next.inFlight = true; let changes: Array<[string, boolean, (IndexedSemanticDocument | null)?]> = [];
        for (const [id, excluded] of next.changes) {
          const value = this.currentSources.get(next.key)?.get(id);
          changes.push(!excluded && value !== undefined ? [id, excluded, this.project(next.source, id, value)] : [id, excluded]);
          if (changes.length === limits.batchSize) { await this.exchange({ v: 1, type: 'exclude', source: next.source, changes }); changes = []; }
        }
        if (changes.length) await this.exchange({ v: 1, type: 'exclude', source: next.source, changes });
        this.pendingChanges -= next.changes.size;
      }
      else {
        let changed: MemoryPublicationPatch<IndexedSemanticDocument>['changed'] = [];
        await this.exchange({ v: 1, type: 'patch-start', source: next.source, changed: next.patch.changed.length, removed: next.patch.removed, order: next.patch.order, priority: next.priority });
        for (let at = 0; at < next.patch.changed.length; at++) {
          const { id, value } = next.patch.changed[at];
          changed.push({ id, value: this.project(next.source, id, value) });
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
  select(query: number[], scope: SemanticWriteScope, revision: number, size: number, options: SemanticWriteOptions, source?: string): Promise<SemanticWriteSelection> {
    const guard = () => { this.current(revision); if (scope.uid !== this.readScope.uid || scope.teamId && !this.readScope.teamIds.has(scope.teamId) || options.signal?.aborted) throw fail(); options.assertCurrent?.(); };
    const work = this.tail.then(async () => {
      guard();
      if (!Array.isArray(query) || !query.length || query.length > limits.dimensions || !query.every(Number.isFinite)) throw fail();
      await this.flush(); guard();
      const response = await this.exchange({ v: 1, type: 'query', query, space: CURRENT_EMBEDDING_SPACE, scope: this.scope(scope.teamId ? 'team:' + scope.teamId : 'personal'), excludeId: scope.excludeId, source: source === undefined ? undefined : this.source(source) }, options.signal); guard();
      if (response.indexed !== size || !Number.isSafeInteger(response.count) || (response.count as number) < 0 || (response.count as number) > size || !Array.isArray(response.neighbors) || response.neighbors.length > limits.neighbors) { this.clear(); throw fail(); }
      const count = response.count as number, seen = new Set<string>(); let priorScore = Infinity, priorOrdinal = -1;
      const invalidResult = () => { this.clear(); return fail(); };
      const neighbors = response.neighbors.map(row => {
        if (!Array.isArray(row) || row.length !== 3 || !semanticWriteId(row[0]) || seen.has(row[0]) || typeof row[1] !== 'number' || !Number.isFinite(row[1]) || row[1] < limits.threshold || row[1] > 1 + 1e-12 || row[1] > priorScore || !Number.isSafeInteger(row[2]) || row[2] < 0 || row[2] >= count || row[1] === priorScore && row[2] <= priorOrdinal) throw invalidResult();
        const candidate = source === undefined ? this.get(row[0]) : this.currentSources.get(source)?.get(row[0]);
        if (!candidate || source !== undefined && this.exclusions.get(this.source(source))?.has(row[0]) || this.cohort(candidate) !== this.scope(scope.teamId ? 'team:' + scope.teamId : 'personal') || candidate.id === scope.excludeId || options.eligible && !options.eligible(candidate)) throw invalidResult();
        seen.add(row[0]); priorScore = row[1]; priorOrdinal = row[2]; return { candidate, score: row[1], ordinal: row[2] };
      }); guard(); return { count, neighbors };
    });
    this.tail = work.then(() => undefined, () => undefined);
    return work;
  }
}

export function selectIndexedSemanticWriteNeighbors(query: number[], source: Iterable<SemanticWriteCandidate>, options: SemanticWriteOptions): Promise<SemanticWriteSelection> | undefined {
  const binding = bindings.get(source), scope = options.eligible ? readSemanticWriteScope(options.eligible) : binding?.defaultScope;
  if (binding?.defaultScope && scope && (scope.uid !== binding.defaultScope.uid || scope.teamId !== binding.defaultScope.teamId || scope.excludeId !== binding.defaultScope.excludeId)) return Promise.reject(fail());
  return binding && scope ? binding.owner.select(query, scope, binding.revision, binding.size, options, binding.source) : undefined;
}

/** Bind a single scoped operation without projecting, copying or changing the shared source binding. */
export function scopedIndexedSemanticSource(source: Iterable<SemanticWriteCandidate>, eligible: (row: SemanticWriteCandidate) => boolean): Iterable<SemanticWriteCandidate> | undefined {
  const binding = bindings.get(source), scope = readSemanticWriteScope(eligible);
  if (!binding || !scope) return undefined;
  const alias: Iterable<SemanticWriteCandidate> = { [Symbol.iterator](): Iterator<SemanticWriteCandidate> { throw fail(); } };
  bindings.set(alias, { ...binding, defaultScope: scope }); return alias;
}
