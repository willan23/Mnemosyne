import { CURRENT_EMBEDDING_SPACE, sameEmbeddingSpace } from './embeddingModel';
import type { MemoryPublicationPatch } from './incrementalMemoryPublication';
import type { MemoryReadScope } from './memoryReadScope';
import { isPersonalSemanticCandidate } from './personalSemanticScope';
import { readSemanticWriteScope, type SemanticWriteScope } from './semanticWriteScope';
import { SEMANTIC_WRITE_LIMITS as limits, semanticWriteId, type SemanticWriteCandidate } from './semanticWriteProtocol';
import type { SemanticWriteOptions, SemanticWriteSelection } from './semanticWriteClient';
import { INDEXED_SEMANTIC_WRITE_LIMITS as capacity, type IndexedSemanticDocument, type IndexedSemanticWriteMessage } from './indexedSemanticWriteProtocol';
import { SemanticWriteSourceState, type SemanticWriteSourceSnapshot } from './semanticWriteSourceState';
import { eraseMemoryNode, insertMemoryNode, memoryNode, memoryNodeById, memoryNodeCount, memoryNodeRange, type PersistentMemoryNode } from './persistentMemoryTree';
import type { PublicationSourceSnapshot } from './publicationSourceSnapshot';

type Candidate = SemanticWriteCandidate & { timestamp: number };
type Pending<T> = { type: 'patch'; source: string; key: string; patch: MemoryPublicationPatch<T>; priority: number } | { type: 'remove'; source: string } | { type: 'exclude'; source: string; key: string; changes: Map<string, boolean>; inFlight?: boolean };
type SourceVersion<T> = { id: string; key: string; version: SemanticWriteSourceSnapshot<T> };
type ExclusionVersion = { id: string; key: string; documentId: string };
type RecoveryCapture<T> = { revision: number; sources: PersistentMemoryNode<SourceVersion<T>> | null; exclusions: PersistentMemoryNode<ExclusionVersion> | null };
interface Binding { owner: IndexedSemanticWriteCorpus<Candidate>; revision: number; size: number; defaultScope?: SemanticWriteScope; source?: string }
const bindings = new WeakMap<object, Binding>();
const fail = () => new Error('semantic_write_unavailable');
const compareKeys = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type Message = IndexedSemanticWriteMessage extends infer M ? M extends { seq: number } ? Omit<M, 'seq'> : never : never;

/** Scope-owned replica. Initial load is batched once; subsequent requests project only snapshot deltas. */
export class IndexedSemanticWriteCorpus<T extends Candidate> {
  private revision = 0;
  private closed = false;
  private pending: Pending<T>[] = [];
  private pendingChanges = 0;
  private sources = new Map<string, string>();
  private scopes = new Map<string, string>();
  private currentSources = new Map<string, SemanticWriteSourceState<T>>();
  private exclusions = new Map<string, Set<string>>();
  private sourceVersions: RecoveryCapture<T>['sources'] = null;
  private exclusionVersions: RecoveryCapture<T>['exclusions'] = null;
  private pauses = new Set<() => void>();
  private nextSourceOrdinal = 0;
  private retainedReferences = 0;
  private needsRebuild = true;
  private transportGeneration = 0;
  private flushScheduled = false;
  private seed = (Math.random() * 0x100000000) >>> 0 || 1;
  private worker: Worker | null = null;
  private seq = 0;
  private requests = new Map<number, { reject: () => void }>();
  private tail: Promise<unknown> = Promise.resolve();
  private readScope: MemoryReadScope;
  private get: (id: string) => T | undefined;
  private createWorker: () => Worker;
  private options: { direction?: 'asc' | 'desc'; sourceBase?: number; yieldTask?: () => Promise<void> };
  constructor(scope: MemoryReadScope, get: (id: string) => T | undefined, createWorker = () => new Worker(new URL('./indexedSemanticWriteWorker.ts', import.meta.url), { type: 'module' }), options: { direction?: 'asc' | 'desc'; sourceBase?: number; yieldTask?: () => Promise<void> } = {}) {
    this.readScope = { uid: scope.uid, teamIds: new Set(scope.teamIds) };
    this.get = get; this.createWorker = createWorker; this.options = { direction: options.direction, sourceBase: options.sourceBase, yieldTask: options.yieldTask };
  }
  private random = () => { let value = this.seed; value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return this.seed = value >>> 0; };
  private yieldTask(): Promise<void> {
    if (this.closed) return Promise.reject(fail());
    const generation = this.transportGeneration, waiting = this.options.yieldTask?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0));
    return new Promise((resolve, reject) => {
      let settled = false;
      const cancel = () => { if (!settled) { settled = true; this.pauses.delete(cancel); reject(fail()); } };
      this.pauses.add(cancel);
      void waiting.then(() => { if (generation !== this.transportGeneration || this.closed) { cancel(); return; } if (!settled) { settled = true; this.pauses.delete(cancel); resolve(); } }, cancel);
      if (generation !== this.transportGeneration || this.closed) cancel();
    });
  }
  private versionId(state: SemanticWriteSourceState<T>): string { return String(state.ordinal).padStart(16, '0'); }
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
    try {
      if (!semanticWriteId(source) || priority !== undefined && !Number.isFinite(priority)) throw fail();
      let state = this.currentSources.get(source);
      if (!state) { const ordinal = this.nextSourceOrdinal++; state = new SemanticWriteSourceState(priority ?? (this.options.sourceBase ?? 0) + ordinal, this.random, ordinal); this.currentSources.set(source, state); this.retainedReferences++; }
      else if (priority !== undefined && priority !== state.priority) throw fail();
      const before = state.size; state.apply(patch); this.retainedReferences += state.size - before; this.revision++;
      this.sourceVersions = insertMemoryNode(this.sourceVersions, memoryNode(Object.freeze({ id: this.versionId(state), key: source, version: state.capture() }), this.random()), compareKeys);
      if (this.retainedReferences > capacity.retainedReferences) throw fail();
      if (this.needsRebuild) return;
      this.enqueue({ type: 'patch', source: this.source(source), key: source, patch, priority: state.priority }, this.patchWeight(patch));
    } catch { this.clear(); }
  }
  /** The publication already prepared this source; retain its immutable roots in O(1). */
  adoptPublicationSource(source: string, snapshot: PublicationSourceSnapshot<T> | undefined, patch: MemoryPublicationPatch<T>): void {
    if (this.closed) return;
    try {
      if (!semanticWriteId(source) || !snapshot || snapshot.key !== source || !snapshot.active() || !Number.isFinite(snapshot.priority) || !Number.isSafeInteger(snapshot.ordinal) || snapshot.ordinal < 0) throw fail();
      const ordinalOwner = memoryNodeById(this.sourceVersions, String(snapshot.ordinal).padStart(16, '0'))?.value.key; if (ordinalOwner !== undefined && ordinalOwner !== source) throw fail();
      let state = this.currentSources.get(source); const lateOrdinal = !state && snapshot.ordinal < this.nextSourceOrdinal;
      if (!state) { state = new SemanticWriteSourceState<T>(snapshot.priority, this.random, snapshot.ordinal); this.currentSources.set(source, state); this.retainedReferences++; }
      else if (state.priority !== snapshot.priority || state.ordinal !== snapshot.ordinal) throw fail();
      const before = state.size; state.adopt(snapshot); this.retainedReferences += state.size - before; this.nextSourceOrdinal = Math.max(this.nextSourceOrdinal, snapshot.ordinal + 1); this.revision++;
      this.sourceVersions = insertMemoryNode(this.sourceVersions, memoryNode(Object.freeze({ id: this.versionId(state), key: source, version: state.capture() }), this.random()), compareKeys);
      if (this.retainedReferences > capacity.retainedReferences) throw fail();
      if (lateOrdinal && !this.needsRebuild) { const hot = Boolean(this.worker || this.flushScheduled); this.needsRebuild = true; this.pending = []; this.pendingChanges = 0; this.retireTransport(); if (hot) this.scheduleFlush(); }
      if (this.needsRebuild) return;
      this.enqueue({ type: 'patch', source: this.source(source), key: source, patch, priority: state.priority }, this.patchWeight(patch));
    } catch { this.clear(); }
  }
  removeSource(source: string): void {
    if (this.closed) return;
    if (!semanticWriteId(source)) { this.clear(); return; }
    const state = this.currentSources.get(source); if (state) { this.retainedReferences -= state.size + 1; this.sourceVersions = eraseMemoryNode(this.sourceVersions, this.versionId(state), compareKeys); this.currentSources.delete(source); }
    this.revision++; if (!this.needsRebuild) this.enqueue({ type: 'remove', source: this.source(source) }, 0);
  }
  exclude(source: string, id: string, excluded: boolean): void {
    if (this.closed) return;
    if (!semanticWriteId(source) || !semanticWriteId(id) || typeof excluded !== 'boolean') { this.clear(); return; }
    if (Boolean(this.exclusions.get(source)?.has(id)) === excluded) return;
    let ids = this.exclusions.get(source); if (!ids) { ids = new Set(); this.exclusions.set(source, ids); }
    const versionId = JSON.stringify([source, id]);
    if (excluded) { ids.add(id); this.retainedReferences++; this.exclusionVersions = insertMemoryNode(this.exclusionVersions, memoryNode(Object.freeze({ id: versionId, key: source, documentId: id }), this.random()), compareKeys); }
    else { ids.delete(id); this.retainedReferences--; if (!ids.size) this.exclusions.delete(source); this.exclusionVersions = eraseMemoryNode(this.exclusionVersions, versionId, compareKeys); }
    this.revision++; if (this.retainedReferences > capacity.retainedReferences) { this.clear(); return; }
    if (this.needsRebuild) return;
    const key = this.source(source), last = this.pending.at(-1);
    // A tombstone reset can contain thousands of IDs; one queue entry, bounded wire batches.
    if (last?.type === 'exclude' && last.source === key && !last.inFlight) { if (!last.changes.has(id)) this.pendingChanges++; last.changes.set(id, excluded); }
    else { this.enqueue({ type: 'exclude', source: key, key: source, changes: new Map([[id, excluded]]) }, 1); return; }
    this.checkQueue();
  }
  /** Membership changes are rare scope transitions, not per-write preparation. Reproject only affected teams. */
  setTeams(teamIds: ReadonlySet<string>): void {
    if (this.closed) return;
    const changed = new Set([...this.readScope.teamIds, ...teamIds].filter(id => this.readScope.teamIds.has(id) !== teamIds.has(id)));
    if (!changed.size) return;
    this.readScope = { uid: this.readScope.uid, teamIds: new Set(teamIds) }; this.revision++;
    for (const [source, values] of this.currentSources) {
      const rows: MemoryPublicationPatch<T>['changed'] = [];
      for (const [id, value] of values.entries()) if (value?.teamId && changed.has(value.teamId)) rows.push({ id, value });
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
    this.closed = true; this.revision++; this.retireTransport();
    this.pending = []; this.pendingChanges = 0; this.currentSources.clear(); this.exclusions.clear(); this.sourceVersions = this.exclusionVersions = null; this.retainedReferences = 0; this.needsRebuild = false;
  }
  private retireTransport(): void {
    this.transportGeneration++; this.worker?.terminate(); this.worker = null;
    for (const request of this.requests.values()) request.reject(); this.requests.clear();
    for (const cancel of this.pauses) cancel(); this.pauses.clear();
    this.seq = 0; this.sources.clear(); this.scopes.clear();
  }
  private enqueue(entry: Pending<T>, changes: number): void { this.pending.push(entry); this.pendingChanges += changes; this.checkQueue(); }
  private patchWeight(patch: MemoryPublicationPatch<T>): number { return patch.changed.length + patch.removed.length + patch.order.changes.length + (patch.order.reset?.length ?? 0); }
  private checkQueue(): void {
    const hot = Boolean(this.worker || this.flushScheduled);
    if (this.pending.length > capacity.pendingBatches || this.pendingChanges > capacity.pendingChanges || this.sources.size > this.currentSources.size + this.exclusions.size + capacity.pendingBatches || this.scopes.size > this.readScope.teamIds.size + 1 + capacity.pendingBatches) {
      this.needsRebuild = true; this.pending = []; this.pendingChanges = 0; this.retireTransport();
    }
    if (hot) this.scheduleFlush();
  }
  private current(revision: number) { if (this.closed || revision !== this.revision) throw fail(); }
  private exchange(message: Message, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (this.closed || signal?.aborted) return Promise.reject(fail());
    const seq = ++this.seq;
    if (!this.worker) this.worker = this.createWorker();
    const worker = this.worker, generation = this.transportGeneration;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { clearTimeout(timer); worker.removeEventListener('message', receive); worker.removeEventListener('error', error); worker.removeEventListener('messageerror', error); signal?.removeEventListener('abort', abort); this.requests.delete(seq); };
      const refuse = () => { if (!settled) { settled = true; cleanup(); reject(fail()); } };
      const error = () => { refuse(); if (generation === this.transportGeneration) this.clear(); };
      const abort = () => refuse();
      const receive = (event: MessageEvent) => {
        if (generation !== this.transportGeneration || this.worker !== worker) return;
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
  /** Immutable source, order and flag roots are captured together without enumerating any records. */
  private captureRecovery(): RecoveryCapture<T> { return { revision: this.revision, sources: this.sourceVersions, exclusions: this.exclusionVersions }; }
  private async recover(): Promise<void> {
    while (this.needsRebuild) {
      const capture = this.captureRecovery();
      // No await between selecting the baseline and switching subsequent events to the delta queue.
      this.needsRebuild = false;
      const generation = this.transportGeneration;
      const guard = () => { if (this.closed || generation !== this.transportGeneration) throw fail(); };
      await this.exchange({ v: 1, type: 'init', direction: this.options.direction, sourceBase: this.options.sourceBase }); guard();
      let flagKey: string | null = null, flags: Array<[string, boolean]> = [];
      for (const flag of memoryNodeRange(capture.exclusions, 0, memoryNodeCount(capture.exclusions))) {
        guard();
        if (flags.length && flagKey !== flag.key) { await this.exchange({ v: 1, type: 'exclude', source: this.source(flagKey!), changes: flags }); guard(); flags = []; }
        flagKey = flag.key; flags.push([flag.documentId, true]);
        if (flags.length === limits.batchSize) { await this.exchange({ v: 1, type: 'exclude', source: this.source(flagKey), changes: flags }); guard(); flags = []; await this.yieldTask(); guard(); }
      }
      if (flags.length) { await this.exchange({ v: 1, type: 'exclude', source: this.source(flagKey!), changes: flags }); guard(); }
      for (const { key, version } of memoryNodeRange(capture.sources, 0, memoryNodeCount(capture.sources))) {
        guard(); const wire = this.source(key);
        await this.exchange({ v: 1, type: 'patch-start', source: wire, changed: version.count, removed: [], order: { reset: [], changes: [] }, priority: version.priority, orderedReset: true }); guard();
        let changed: MemoryPublicationPatch<IndexedSemanticDocument>['changed'] = [];
        for (const { id, value } of version.orderedRows()) {
          guard(); changed.push({ id, value: this.project(key, id, value) });
          if (changed.length !== limits.batchSize) continue;
          const ack = await this.exchange({ v: 1, type: 'patch-chunk', changed }); guard();
          if (ack.changed !== changed.length) { this.clear(); throw fail(); }
          changed = []; await this.yieldTask(); guard();
        }
        if (changed.length) { const ack = await this.exchange({ v: 1, type: 'patch-chunk', changed }); guard(); if (ack.changed !== changed.length) { this.clear(); throw fail(); } }
        const ack = await this.exchange({ v: 1, type: 'patch-end' }); guard();
        if (ack.changed !== version.count || ack.removed !== 0) { this.clear(); throw fail(); }
      }
    }
  }
  private async flush(): Promise<void> {
    if (this.closed) throw fail();
    if (this.needsRebuild) await this.recover();
    const generation = this.transportGeneration;
    const guard = () => { if (this.closed || generation !== this.transportGeneration) throw fail(); };
    if (!this.worker) { await this.exchange({ v: 1, type: 'init', direction: this.options.direction, sourceBase: this.options.sourceBase }); guard(); }
    while (this.pending.length) {
      guard();
      const next = this.pending[0];
      if (next.type === 'remove') { await this.exchange({ v: 1, type: 'remove', source: next.source }); guard(); }
      else if (next.type === 'exclude') {
        next.inFlight = true; let changes: Array<[string, boolean, (IndexedSemanticDocument | null)?]> = [];
        for (const [id, excluded] of next.changes) {
          const value = this.currentSources.get(next.key)?.get(id);
          guard(); changes.push(!excluded && value !== undefined ? [id, excluded, this.project(next.key, id, value)] : [id, excluded]);
          if (changes.length === limits.batchSize) { await this.exchange({ v: 1, type: 'exclude', source: next.source, changes }); guard(); changes = []; }
        }
        if (changes.length) { await this.exchange({ v: 1, type: 'exclude', source: next.source, changes }); guard(); }
        this.pendingChanges -= next.changes.size;
      }
      else {
        let changed: MemoryPublicationPatch<IndexedSemanticDocument>['changed'] = [];
        const metadata = { removed: next.patch.removed.length, changes: next.patch.order.changes.length, ...(next.patch.order.reset !== undefined ? { reset: next.patch.order.reset.length } : {}) };
        await this.exchange({ v: 1, type: 'patch-start', source: next.source, changed: next.patch.changed.length, removed: [], order: { ...(next.patch.order.reset !== undefined ? { reset: [] } : {}), changes: [] }, metadata, priority: next.priority });
        guard();
        for (let at = 0; at < next.patch.removed.length; at += limits.batchSize) { const removed = next.patch.removed.slice(at, at + limits.batchSize), ack = await this.exchange({ v: 1, type: 'patch-metadata', removed }); guard(); if (ack.removed !== removed.length) { this.clear(); throw fail(); } }
        for (let at = 0; at < next.patch.order.changes.length; at += limits.batchSize) { const changes = next.patch.order.changes.slice(at, at + limits.batchSize).map(({ id, type, oldIndex, newIndex }) => ({ id, type, oldIndex, newIndex })), ack = await this.exchange({ v: 1, type: 'patch-metadata', changes }); guard(); if (ack.orderChanges !== changes.length) { this.clear(); throw fail(); } }
        if (next.patch.order.reset) for (let at = 0; at < next.patch.order.reset.length; at += limits.batchSize) { const resetIds = next.patch.order.reset.slice(at, at + limits.batchSize), ack = await this.exchange({ v: 1, type: 'patch-metadata', resetIds }); guard(); if (ack.resetIds !== resetIds.length) { this.clear(); throw fail(); } }
        for (let at = 0; at < next.patch.changed.length; at++) {
          const { id, value } = next.patch.changed[at];
          guard(); changed.push({ id, value: this.project(next.key, id, value) });
          if (changed.length === limits.batchSize || at + 1 === next.patch.changed.length) {
            const ack = await this.exchange({ v: 1, type: 'patch-chunk', changed }); guard(); if (ack.changed !== changed.length) { this.clear(); throw fail(); }
            changed = [];
            if (at + 1 < next.patch.changed.length) { await this.yieldTask(); guard(); }
          }
        }
        const ack = await this.exchange({ v: 1, type: 'patch-end' });
        guard();
        if (ack.changed !== next.patch.changed.length || ack.removed !== next.patch.removed.length) { this.clear(); throw fail(); }
        this.pendingChanges -= this.patchWeight(next.patch);
      }
      this.pending.shift();
    }
  }
  private async flushRecovering(): Promise<void> {
    while (!this.closed) {
      const generation = this.transportGeneration;
      try { await this.flush(); return; }
      catch { if (generation === this.transportGeneration) { this.clear(); throw fail(); } }
    }
    throw fail();
  }
  private scheduleFlush() {
    if (this.closed || this.flushScheduled) return;
    this.flushScheduled = true;
    const job = this.tail.then(() => this.flushRecovering());
    this.tail = job.then(() => undefined, () => undefined);
    const finish = () => { this.flushScheduled = false; if (!this.closed && this.worker && (this.pending.length || this.needsRebuild)) this.scheduleFlush(); };
    void job.then(finish, finish);
  }
  select(query: number[], scope: SemanticWriteScope, revision: number, size: number, options: SemanticWriteOptions, source?: string): Promise<SemanticWriteSelection> {
    const guard = () => { this.current(revision); if (scope.uid !== this.readScope.uid || scope.teamId && !this.readScope.teamIds.has(scope.teamId) || options.signal?.aborted) throw fail(); options.assertCurrent?.(); };
    const work = this.tail.then(async () => {
      guard();
      if (!Array.isArray(query) || !query.length || query.length > limits.dimensions || !query.every(Number.isFinite)) throw fail();
      await this.flushRecovering(); guard();
      const response = await this.exchange({ v: 1, type: 'query', query, space: CURRENT_EMBEDDING_SPACE, scope: this.scope(scope.teamId ? 'team:' + scope.teamId : 'personal'), excludeId: scope.excludeId, source: source === undefined ? undefined : this.sources.get(source) ?? 'absent' }, options.signal); guard();
      if (response.indexed !== size || !Number.isSafeInteger(response.count) || (response.count as number) < 0 || (response.count as number) > size || !Array.isArray(response.neighbors) || response.neighbors.length > limits.neighbors) { this.clear(); throw fail(); }
      const count = response.count as number, seen = new Set<string>(); let priorScore = Infinity, priorOrdinal = -1;
      const invalidResult = () => { this.clear(); return fail(); };
      const neighbors = response.neighbors.map(row => {
        if (!Array.isArray(row) || row.length !== 3 || !semanticWriteId(row[0]) || seen.has(row[0]) || typeof row[1] !== 'number' || !Number.isFinite(row[1]) || row[1] < limits.threshold || row[1] > 1 + 1e-12 || row[1] > priorScore || !Number.isSafeInteger(row[2]) || row[2] < 0 || row[2] >= count || row[1] === priorScore && row[2] <= priorOrdinal) throw invalidResult();
        const candidate = source === undefined ? this.get(row[0]) : this.currentSources.get(source)?.get(row[0]);
        if (!candidate || source !== undefined && this.exclusions.get(source)?.has(row[0]) || this.cohort(candidate) !== this.scope(scope.teamId ? 'team:' + scope.teamId : 'personal') || candidate.id === scope.excludeId || options.eligible && !options.eligible(candidate)) throw invalidResult();
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
