import { createCognitiveAnalysisYield as createControlledYield } from './cognitiveAnalysisYield';
import { cancelQueuedSnapshotMapping, readSnapshotMapping, SnapshotMappingQueue, SNAPSHOT_MAPPING_LIMITS, type SnapshotMapping } from './snapshotMappingQueue';

export type SessionSnapshotChangeType = 'added' | 'modified' | 'removed';

export interface SessionSnapshotChange<D extends { id: string }> {
  type: SessionSnapshotChangeType;
  doc: D;
  oldIndex: number;
  newIndex: number;
}

export interface SessionSnapshotInput<D extends { id: string }> {
  readonly docs: readonly D[];
  docChanges(): readonly SessionSnapshotChange<D>[];
}

export interface SessionSnapshotOrderChange {
  id: string;
  type: SessionSnapshotChangeType;
  oldIndex: number;
  newIndex: number;
}

export interface SessionSnapshotLease<T> {
  changed: Array<{ id: string; value: T }>;
  removed: string[];
  order: { reset?: readonly string[]; changes: SessionSnapshotOrderChange[] };
  isCurrent(): boolean;
  commit(): boolean;
}

/** Full rebuilds use one reset; only subsequent uncommitted movements consume this budget. */
export const INCREMENTAL_SESSION_SNAPSHOT_LIMITS = Object.freeze({ pendingOrderChanges: 20_000, pendingSnapshots: 64 });
const unavailable = () => new Error('incremental_snapshot_unavailable');
const obsoleteCapture = Symbol('obsolete_snapshot_capture');
type Entry<T> = SnapshotMapping<T>;
type Capture<T> = { pending: Entry<T>[]; removed: string[]; order: SessionSnapshotLease<T>['order'] };
type CaptureJob<T> = { work: () => Capture<T> | null | Promise<Capture<T> | null>; resolve: (value: Capture<T> | null) => void; reject: (error: unknown) => void };
type Preparation<T> = {
  active: boolean; error: unknown; running: boolean; jobs: CaptureJob<T>[];
  releaseMappings: (() => void) | null; failures: Set<Entry<T>>; pauses: Set<(error: unknown) => void>;
};
const after = <T>(work: void | Promise<void>, next: () => T | Promise<T>): T | Promise<T> => work ? work.then(next) : next();
const preparation = <T>(): Preparation<T> => ({ active: true, error: undefined, running: false, jobs: [], releaseMappings: null, failures: new Set(), pauses: new Set() });

/** Per-listener cache; reset it whenever account, keys or team scope changes. */
export class IncrementalSessionSnapshot<T> {
  // Legacy full-array API remains independent while its callers migrate to leases.
  private pending = new Map<string, Promise<T>>();
  private entries = new Map<string, Entry<T>>();
  private dirty = new Set<string>();
  private removed = new Set<string>();
  private ids: string[] = [];
  private orderReset: readonly string[] | undefined;
  private movements: SessionSnapshotOrderChange[] = [];
  private recoveryIds = new Set<string>();
  private initialized = false;
  private generation = 0;
  private revision = 0;
  private mappings: SnapshotMappingQueue<T>;
  private controlled = createControlledYield();
  private preparation = preparation<T>();
  private readonly options: { yieldTask?: () => Promise<void> };
  constructor(options: { yieldTask?: () => Promise<void> } = {}) {
    this.options = options;
    this.mappings = new SnapshotMappingQueue<T>(options.yieldTask);
  }

  /** Retire cached plaintext/promises and every outstanding lease. */
  reset(): void {
    this.invalidate(false);
    this.recoveryIds.clear();
    this.pending.clear();
  }

  private invalidate(recover = true, error: unknown = unavailable()): void {
    const scope = this.preparation; scope.active = false; scope.error = error;
    for (const reject of scope.pauses) reject(error);
    for (const job of scope.jobs) job.reject(error);
    scope.pauses.clear(); scope.jobs = []; scope.failures.clear(); scope.releaseMappings = null;
    this.preparation = preparation<T>();
    this.mappings.retire(); this.mappings = new SnapshotMappingQueue<T>(this.options.yieldTask);
    this.controlled.cancel(); this.controlled = createControlledYield();
    // Keep IDs only so recovery can remove records omitted by its replacement snapshot.
    if (recover) {
      for (const id of this.entries.keys()) this.recoveryIds.add(id);
      for (const id of this.removed) this.recoveryIds.add(id);
    }
    this.entries.clear(); this.dirty.clear(); this.removed.clear();
    this.ids = []; this.orderReset = undefined; this.movements = [];
    this.initialized = false;
    this.generation++; this.revision++;
  }

  private mapChanged<D extends { id: string }>(doc: D, id: string, mapper: (doc: D) => Promise<T>): void {
    const previous = this.entries.get(id); if (previous) cancelQueuedSnapshotMapping(previous);
    const generation = this.generation;
    const entry = this.mappings.enqueue(id, () => mapper(doc), () => {
      // A replaced/removed failure cannot retire the newer mapping or vault scope.
      if (generation === this.generation && this.entries.get(id) === entry) {
        if (this.preparation.running) this.preparation.failures.add(entry);
        else this.invalidate(true, entry.error);
      }
    });
    if (generation !== this.generation) throw unavailable();
    this.entries.set(id, entry);
    this.dirty.add(id); this.removed.delete(id);
  }

  private assertPreparing(scope: Preparation<T>): void { if (!scope.active) throw scope.error; }

  private pause(scope: Preparation<T>): Promise<void> {
    this.assertPreparing(scope);
    let reject!: (error: unknown) => void;
    const retired = new Promise<never>((_, fail) => { reject = fail; scope.pauses.add(fail); });
    let task: Promise<void>;
    try { task = this.options.yieldTask?.() ?? this.controlled.yieldTask(); }
    catch (error) { scope.pauses.delete(reject); return Promise.reject(error); }
    return Promise.race([task, retired]).finally(() => { scope.pauses.delete(reject); }).then(() => { this.assertPreparing(scope); });
  }

  /** Serialize metadata only; collectors/native mappings remain independent. */
  private consume<I>(scope: Preparation<T>, values: Iterable<I>, visit: (value: I) => void): void | Promise<void> {
    const iterator = values[Symbol.iterator](); let next = iterator.next();
    const step = (): void | Promise<void> => {
      this.assertPreparing(scope);
      for (let at = 0; at < SNAPSHOT_MAPPING_LIMITS.batch && !next.done; at++) {
        const value = next.value; this.assertPreparing(scope);
        visit(value); this.assertPreparing(scope); next = iterator.next();
      }
      if (next.done) return;
      scope.releaseMappings ??= this.mappings.hold();
      return this.pause(scope).then(step);
    };
    return step();
  }

  private checkFailures(scope: Preparation<T>): void {
    for (const entry of scope.failures) if (this.entries.get(entry.id) === entry) throw entry.error;
    scope.failures.clear();
  }

  private drainPreparations(scope: Preparation<T>): void {
    if (!scope.active || scope.running) return;
    scope.running = true;
    const finish = (job: CaptureJob<T>, value: Capture<T> | null) => {
      if (!scope.active) return;
      scope.jobs.shift(); job.resolve(value); scope.running = false; this.drainPreparations(scope);
    };
    const fail = (error: unknown) => { if (scope.active) this.invalidate(true, error); };
    const job = scope.jobs[0];
    if (!job) {
      scope.running = false;
      try { this.checkFailures(scope); } catch (error) { fail(error); return; }
      const release = scope.releaseMappings; scope.releaseMappings = null; release?.(); return;
    }
    try {
      const value = job.work();
      if (value instanceof Promise) void value.then(result => finish(job, result), fail);
      else finish(job, value);
    } catch (error) { fail(error); }
  }

  private captureMetadata(scope: Preparation<T>, revision: number): Capture<T> | null | Promise<Capture<T> | null> {
    const pending: Entry<T>[] = [], removed: string[] = [], changes: SessionSnapshotOrderChange[] = [];
    const guard = () => { if (revision !== this.revision) throw obsoleteCapture; };
    const result = () => ({ pending, removed, order: { ...(this.orderReset ? { reset: this.orderReset } : {}), changes } });
    try {
      guard(); this.checkFailures(scope);
      const copy = after(this.consume(scope, this.dirty, id => { guard(); pending.push(this.entries.get(id)!); }), () =>
        after(this.consume(scope, this.removed, id => { guard(); removed.push(id); }), () =>
          after(this.consume(scope, this.movements, change => { guard(); changes.push({ ...change }); }), result)));
      return copy instanceof Promise ? copy.catch(error => { if (error === obsoleteCapture) return null; throw error; }) : copy;
    } catch (error) { if (error === obsoleteCapture) return null; throw error; }
  }

  private captureInput<D extends { id: string }>(snapshot: SessionSnapshotInput<D>, mapper: (doc: D) => Promise<T>, revision: number): Promise<Capture<T> | null> {
    const scope = this.preparation;
    if (scope.jobs.length >= INCREMENTAL_SESSION_SNAPSHOT_LIMITS.pendingSnapshots) {
      this.invalidate(); return Promise.reject(unavailable());
    }
    return new Promise((resolve, reject) => {
      scope.jobs.push({ resolve, reject, work: () => after(
        this.initialized ? this.applyChanges(scope, snapshot, mapper) : this.rebuild(scope, snapshot, mapper),
        () => this.captureMetadata(scope, revision)) });
      this.drainPreparations(scope);
    });
  }

  private rebuild<D extends { id: string }>(scope: Preparation<T>, snapshot: SessionSnapshotInput<D>, mapper: (doc: D) => Promise<T>): void | Promise<void> {
    // This is the only path allowed to enumerate snapshot.docs.
    const docs = snapshot.docs;
    if (!Array.isArray(docs)) throw unavailable();
    const reset: string[] = [];
    return after(this.consume(scope, docs, doc => {
      const id = doc?.id; this.assertPreparing(scope);
      if (typeof id !== 'string' || !id || this.entries.has(id)) throw unavailable();
      this.ids.push(id); reset.push(id);
      this.mapChanged(doc, id, mapper);
    }), () => after(this.consume(scope, this.recoveryIds, id => { if (!this.entries.has(id)) this.removed.add(id); }), () => {
      this.recoveryIds.clear(); this.orderReset = Object.freeze(reset); this.initialized = true;
    }));
  }

  private applyChanges<D extends { id: string }>(scope: Preparation<T>, snapshot: SessionSnapshotInput<D>, mapper: (doc: D) => Promise<T>): void | Promise<void> {
    const changes = snapshot.docChanges();
    if (!Array.isArray(changes) || this.movements.length + changes.length > INCREMENTAL_SESSION_SNAPSHOT_LIMITS.pendingOrderChanges) throw unavailable();
    return this.consume(scope, changes, change => {
      const { doc, type, oldIndex, newIndex } = change;
      const id = doc?.id; this.assertPreparing(scope);
      if (typeof id !== 'string' || !id || !Number.isSafeInteger(oldIndex) || !Number.isSafeInteger(newIndex)) throw unavailable();
      if (type === 'added') {
        if (oldIndex !== -1 || newIndex < 0 || newIndex > this.ids.length || this.entries.has(id)) throw unavailable();
      } else if (type === 'modified' || type === 'removed') {
        if (oldIndex < 0 || this.ids[oldIndex] !== id || !this.entries.has(id) ||
            (type === 'removed' ? newIndex !== -1 : newIndex < 0 || newIndex >= this.ids.length)) throw unavailable();
        if (type === 'removed' || oldIndex !== newIndex) this.ids.splice(oldIndex, 1);
      } else throw unavailable();
      if (type === 'removed') {
        cancelQueuedSnapshotMapping(this.entries.get(id)!);
        this.entries.delete(id); this.dirty.delete(id); this.removed.add(id);
      } else {
        if (type === 'added' || oldIndex !== newIndex) this.ids.splice(newIndex, 0, id);
        this.mapChanged(doc, id, mapper);
      }
      this.movements.push({ id, type, oldIndex, newIndex });
    });
  }

  /**
   * Prepare a delta since the last committed lease, including pending earlier changes.
   * Consumers apply order.reset (when present), then movements, before publishing.
   * Resolution never acknowledges work: only the current lease may commit once.
   * Bad indices, current mapping failures or movement overflow force a full rebuild
   * on the next snapshot. A 100k-document initial reset does not consume the 20k cap.
   */
  async prepare<D extends { id: string }>(snapshot: SessionSnapshotInput<D>, mapper: (doc: D) => Promise<T>): Promise<SessionSnapshotLease<T>> {
    const revision = ++this.revision, generation = this.generation;
    try {
      const capture = await this.captureInput(snapshot, mapper, revision);
      if (!capture) throw unavailable();
      const { pending, removed, order } = capture;
      const isCurrent = () => generation === this.generation && revision === this.revision;
      const changed: SessionSnapshotLease<T>['changed'] = [];
      for (let at = 0; at < pending.length; at += SNAPSHOT_MAPPING_LIMITS.batch) {
        changed.push(...await Promise.all(pending.slice(at, at + SNAPSHOT_MAPPING_LIMITS.batch).map(async entry => ({ id: entry.id, value: await readSnapshotMapping(entry) }))));
        if (at + SNAPSHOT_MAPPING_LIMITS.batch < pending.length) {
          await (this.options.yieldTask?.() ?? this.controlled.yieldTask());
          if (!isCurrent()) throw unavailable();
        }
      }
      let committed = false;
      return { changed, removed, order, isCurrent, commit: () => {
        if (committed || !isCurrent()) return false;
        committed = true;
        this.dirty.clear(); this.removed.clear(); this.orderReset = undefined; this.movements = [];
        return true;
      } };
    } catch (error) {
      if (generation === this.generation && revision === this.revision) this.invalidate(true, error);
      throw error;
    }
  }

  map<D extends { id: string }>(docs: D[], changedIds: Set<string>, mapper: (doc: D) => Promise<T>): Promise<T[]> {
    const present = new Set(docs.map(doc => doc.id));
    for (const id of this.pending.keys()) if (!present.has(id)) this.pending.delete(id);
    return Promise.all(docs.map(doc => {
      let mapped = this.pending.get(doc.id);
      if (!mapped || changedIds.has(doc.id)) {
        mapped = mapper(doc);
        this.pending.set(doc.id, mapped);
        // Failed work must be retryable, without discarding a newer replacement.
        const current = mapped;
        void mapped.catch(() => { if (this.pending.get(doc.id) === current) this.pending.delete(doc.id); });
      }
      return mapped;
    }));
  }
}
