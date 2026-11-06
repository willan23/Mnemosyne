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
export const INCREMENTAL_SESSION_SNAPSHOT_LIMITS = Object.freeze({ pendingOrderChanges: 20_000 });
const unavailable = () => new Error('incremental_snapshot_unavailable');
type Entry<T> = { promise: Promise<T> };

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

  /** Retire cached plaintext/promises and every outstanding lease. */
  reset(): void {
    this.invalidate();
    this.recoveryIds.clear();
    this.pending.clear();
  }

  private invalidate(): void {
    // Keep IDs only so recovery can remove records omitted by its replacement snapshot.
    for (const id of this.entries.keys()) this.recoveryIds.add(id);
    for (const id of this.removed) this.recoveryIds.add(id);
    this.entries.clear(); this.dirty.clear(); this.removed.clear();
    this.ids = []; this.orderReset = undefined; this.movements = [];
    this.initialized = false;
    this.generation++; this.revision++;
  }

  private mapChanged<D extends { id: string }>(doc: D, mapper: (doc: D) => Promise<T>): void {
    const id = doc.id;
    let promise: Promise<T>;
    try { promise = Promise.resolve(mapper(doc)); }
    catch (error) { promise = Promise.reject(error); }
    const entry = { promise }, generation = this.generation;
    this.entries.set(id, entry);
    this.dirty.add(id); this.removed.delete(id);
    void promise.catch(() => {
      // Replaced/removed work cannot destroy a newer value or a later vault scope.
      if (generation === this.generation && this.entries.get(id) === entry) this.invalidate();
    });
  }

  private rebuild<D extends { id: string }>(snapshot: SessionSnapshotInput<D>, mapper: (doc: D) => Promise<T>): void {
    // This is the only path allowed to enumerate snapshot.docs.
    const docs = snapshot.docs;
    if (!Array.isArray(docs)) throw unavailable();
    for (const doc of docs) {
      if (!doc || typeof doc.id !== 'string' || !doc.id || this.entries.has(doc.id)) throw unavailable();
      this.ids.push(doc.id);
      this.mapChanged(doc, mapper);
    }
    for (const id of this.recoveryIds) if (!this.entries.has(id)) this.removed.add(id);
    this.recoveryIds.clear();
    this.orderReset = Object.freeze([...this.ids]);
    this.initialized = true;
  }

  private applyChanges<D extends { id: string }>(snapshot: SessionSnapshotInput<D>, mapper: (doc: D) => Promise<T>): void {
    const changes = snapshot.docChanges();
    if (!Array.isArray(changes) || this.movements.length + changes.length > INCREMENTAL_SESSION_SNAPSHOT_LIMITS.pendingOrderChanges) throw unavailable();
    for (const change of changes) {
      const { doc, type, oldIndex, newIndex } = change;
      if (!doc || typeof doc.id !== 'string' || !doc.id || !Number.isSafeInteger(oldIndex) || !Number.isSafeInteger(newIndex)) throw unavailable();
      const id = doc.id;
      if (type === 'added') {
        if (oldIndex !== -1 || newIndex < 0 || newIndex > this.ids.length || this.entries.has(id)) throw unavailable();
      } else if (type === 'modified' || type === 'removed') {
        if (oldIndex < 0 || this.ids[oldIndex] !== id || !this.entries.has(id) ||
            (type === 'removed' ? newIndex !== -1 : newIndex < 0 || newIndex >= this.ids.length)) throw unavailable();
        if (type === 'removed' || oldIndex !== newIndex) this.ids.splice(oldIndex, 1);
      } else throw unavailable();
      if (type === 'removed') {
        this.entries.delete(id); this.dirty.delete(id); this.removed.add(id);
      } else {
        if (type === 'added' || oldIndex !== newIndex) this.ids.splice(newIndex, 0, id);
        this.mapChanged(doc, mapper);
      }
      this.movements.push({ id, type, oldIndex, newIndex });
    }
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
      if (this.initialized) this.applyChanges(snapshot, mapper);
      else this.rebuild(snapshot, mapper);
      const pending = [...this.dirty].map(id => ({ id, entry: this.entries.get(id)! }));
      const removed = [...this.removed];
      const order = { ...(this.orderReset ? { reset: this.orderReset } : {}), changes: this.movements.map(change => ({ ...change })) };
      const changed = await Promise.all(pending.map(async ({ id, entry }) => ({ id, value: await entry.promise })));
      const isCurrent = () => generation === this.generation && revision === this.revision;
      let committed = false;
      return { changed, removed, order, isCurrent, commit: () => {
        if (committed || !isCurrent()) return false;
        committed = true;
        this.dirty.clear(); this.removed.clear(); this.orderReset = undefined; this.movements = [];
        return true;
      } };
    } catch (error) {
      if (generation === this.generation && revision === this.revision) this.invalidate();
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
