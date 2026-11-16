import type { SessionSnapshotLease } from './incrementalSessionSnapshot';
import { createMemorySnapshot, type MemorySnapshot, type MemorySnapshotFence, type MemorySnapshotJournal, type MemorySnapshotMove } from './memorySnapshot';
import { eraseMemoryNode, insertMemoryNode, memoryNode, memoryNodeById, memoryNodeRanks, memoryNodeRange, type PersistentMemoryNode } from './persistentMemoryTree';
import { publicationOrderIds, type PublicationOrderVersion, type PublicationSourceSnapshot } from './publicationSourceSnapshot';
import { createCognitiveAnalysisYield as createControlledYield } from './cognitiveAnalysisYield';

export interface MemoryPublicationPatch<T> {
  changed: Array<{ id: string; value: T | null }>;
  removed: string[];
  order: SessionSnapshotLease<unknown>['order'];
}
export interface MemoryPublicationDelta<T> { changed: T[]; removed: string[] }
export interface MemoryPublicationControl<T> {
  isCurrent(): boolean;
  priority?: number;
  beforeCommit?: () => boolean;
  afterCommit?: (delta: MemoryPublicationDelta<T>) => void;
}
type Replay<T> = { type: 'apply'; key: string; patch: MemoryPublicationPatch<T>; priority: number; ordinal: number; nextSource: number; ids: string[]; weight: number } |
  { type: 'exclude'; key: string; id: string; excluded: boolean; weight: number; ids: string[] } |
  { type: 'remove'; key: string; weight: number; ids: string[] };
type Preparation<T> = { key: string; aborted: boolean; mutations: Replay<T>[]; weight: number; cancel(): void };
type ExclusionVersion = { id: string; key: string; documentId: string };
const PREPARATION_BATCH = 128, PREPARATION_REPLAY_LIMIT = 20_000;
type OrderNode = { id: string; priority: number; size: number; left: OrderNode | null; right: OrderNode | null; parent: OrderNode | null; version?: PublicationOrderVersion };
const size = (node: OrderNode | null): number => node?.size ?? 0;
const update = (node: OrderNode) => {
  node.size = 1 + size(node.left) + size(node.right);
  if (node.left) node.left.parent = node;
  if (node.right) node.right.parent = node;
  if (node.version) node.version = Object.freeze({ id: node.id, size: node.size, priority: node.priority, left: node.left?.version ?? null, right: node.right?.version ?? null });
};
function split(root: OrderNode | null, count: number): [OrderNode | null, OrderNode | null] {
  if (!root) return [null, null];
  if (size(root.left) >= count) {
    const [left, right] = split(root.left, count); root.left = right; update(root); root.parent = null;
    if (left) left.parent = null;
    return [left, root];
  }
  const [left, right] = split(root.right, count - size(root.left) - 1); root.right = left; update(root); root.parent = null;
  if (right) right.parent = null;
  return [root, right];
}
function merge(left: OrderNode | null, right: OrderNode | null): OrderNode | null {
  if (!left) { if (right) right.parent = null; return right; }
  if (!right) { left.parent = null; return left; }
  if (left.priority <= right.priority) { left.right = merge(left.right, right); update(left); left.parent = null; return left; }
  right.left = merge(left, right.left); update(right); right.parent = null; return right;
}

/** Implicit tree: positions change without renumbering every later document. */
class SnapshotOrder {
  root: OrderNode | null = null;
  nodes = new Map<string, OrderNode>();
  private random: () => number;
  private capture: boolean;
  constructor(random: () => number, capture = false) { this.random = random; this.capture = capture; }
  position(id: string): number {
    let node = this.nodes.get(id); if (!node) throw Error('memory_publication_unavailable');
    let result = size(node.left);
    while (node.parent) { if (node === node.parent.right) result += size(node.parent.left) + 1; node = node.parent; }
    return result;
  }
  insert(id: string, index: number, prior?: OrderNode): void {
    if (this.nodes.has(id) || !Number.isSafeInteger(index) || index < 0 || index > size(this.root)) throw Error('memory_publication_unavailable');
    const node: OrderNode = prior ?? { id, priority: this.random(), size: 1, left: null, right: null, parent: null };
    node.left = node.right = node.parent = null; node.size = 1;
    if (this.capture) node.version = Object.freeze({ id, size: 1, priority: node.priority, left: null, right: null });
    const [left, right] = split(this.root, index); this.root = merge(merge(left, node), right); this.nodes.set(id, node);
  }
  remove(id: string, index: number): OrderNode {
    if (this.position(id) !== index) throw Error('memory_publication_unavailable');
    const [left, rest] = split(this.root, index), [node, right] = split(rest, 1);
    if (!node || node.id !== id) throw Error('memory_publication_unavailable');
    this.root = merge(left, right); this.nodes.delete(id); node.left = node.right = node.parent = null; node.size = 1;
    return node;
  }
}
type Source<T> = { key: string; priority: number; ordinal: number; order: SnapshotOrder; values: Map<string, T | null>; byId: PersistentMemoryNode<{ id: string; value: T | null }> | null };
type Resolved<T> = { value: T; first: Source<T> };
type SortedNode<T extends { id: string }> = PersistentMemoryNode<T>;
const unavailable = () => new Error('memory_publication_unavailable');
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('/');
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function finishPublicationSteps<R>(steps: Generator<void, R>): R { let next = steps.next(); while (!next.done) next = steps.next(); return next.value; }

/**
 * Scoped, in-memory publication. Values are local authorized objects, never sent to a Worker or storage.
 * Only changed IDs are reconciled/reordered. Snapshot consumers receive immutable persistent roots in O(1).
 * The legacy publish method still materializes arrays in cancellable batches for unmigrated consumers.
 */
export class IncrementalMemoryPublication<T extends { id: string; timestamp: number }> {
  private sources = new Map<string, Source<T>>();
  private variants = new Map<string, Map<string, T | null>>();
  private excluded = new Map<string, Set<string>>();
  private resolved = new Map<string, Resolved<T>>();
  private root: SortedNode<T> | null = null;
  private byId: SortedNode<T> | null = null;
  private fence: MemorySnapshotFence = { active: true };
  private journal: MemorySnapshotJournal = { entries: new Map(), weight: 0 };
  private snapshotCache: MemorySnapshot<T> | null = null;
  private viewNames: string[];
  private nextSource = 0;
  private revision = 0;
  private cached: { revision: number; values: T[] } | null = null;
  private seed = (Math.random() * 0x100000000) >>> 0 || 1;
  private direction: 'asc' | 'desc';
  private options: { sourceBase?: number; batchSize?: number; yieldTask?: () => Promise<void>; views?: Record<string, (value: T) => boolean>; captureSources?: boolean };
  private exclusionVersions: PersistentMemoryNode<ExclusionVersion> | null = null;
  private preparation: Preparation<T> | null = null;
  private preparationTail: Promise<unknown> = Promise.resolve();
  private reservations = new Map<string, Source<T>>();
  constructor(direction: 'asc' | 'desc', options: { sourceBase?: number; batchSize?: number; yieldTask?: () => Promise<void>; views?: Record<string, (value: T) => boolean>; captureSources?: boolean } = {}) {
    this.direction = direction; this.options = { ...options };
    this.viewNames = Object.keys(options.views ?? {}); if (this.viewNames.length > 8) throw unavailable();
    if (direction !== 'asc' && direction !== 'desc' || options.sourceBase !== undefined && !Number.isFinite(options.sourceBase) ||
        options.batchSize !== undefined && (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 4096)) throw unavailable();
  }
  get count(): number { return this.resolved.size; }
  get(id: string): T | undefined { return this.resolved.get(id)?.value; }
  sourceValue(key: string, id: string): T | null | undefined { return this.sources.get(key)?.values.get(id); }
  sourceSize(key: string): number { return this.sources.get(key)?.order.nodes.size ?? 0; }
  sourcePosition(key: string, id: string): number | undefined { const source = this.sources.get(key); return source?.order.nodes.has(id) ? source.order.position(id) : undefined; }
  /** Capturing does not enumerate a source. Its raw values remain guarded by the vault fence. */
  captureSource(key: string): PublicationSourceSnapshot<T> | undefined {
    if (!this.options.captureSources) throw unavailable();
    const source = this.sources.get(key); if (!source) return;
    const order = source.order.root?.version ?? null, byId = source.byId, fence = this.fence;
    const guard = () => { if (!fence.active) throw unavailable(); };
    return Object.freeze({ key, priority: source.priority, ordinal: source.ordinal, count: source.values.size,
      active: () => fence.active,
      get(id: string) { guard(); return memoryNodeById(byId, id)?.value.value; },
      *orderedRows() { guard(); for (const id of publicationOrderIds(order)) { guard(); const row = memoryNodeById(byId, id); if (!row) throw unavailable(); yield row.value; } },
    });
  }
  private setSourceValue(source: Source<T>, id: string, value: T | null): void {
    source.values.set(id, value);
    if (this.options.captureSources) source.byId = insertMemoryNode(source.byId, memoryNode(Object.freeze({ id, value }), this.random()), compareIds);
  }
  private removeSourceValue(source: Source<T>, id: string): void {
    if (!source.values.delete(id)) return;
    if (this.options.captureSources) source.byId = eraseMemoryNode(source.byId, id, compareIds);
  }
  /** Listener order can differ from the merged view; only controlled Worker consumers enumerate it. */
  *orderedSourceValues(key: string): IterableIterator<T> {
    const source = this.sources.get(key); if (!source) return;
    const stack: OrderNode[] = []; let node = source.order.root;
    while (node || stack.length) {
      while (node) { stack.push(node); node = node.left; }
      node = stack.pop()!;
      const value = source.values.get(node.id); if (value && !this.excluded.get(key)?.has(node.id)) yield value;
      node = node.right;
    }
  }
  /** Ordered iteration for controlled consumers such as the semantic Worker. */
  *orderedValues(): IterableIterator<T> {
    const stack: SortedNode<T>[] = []; let node = this.root;
    while (node || stack.length) {
      while (node) { stack.push(node); node = node.left; }
      node = stack.pop()!; yield node.value; node = node.right;
    }
  }
  private random = () => {
    let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0;
    return this.seed;
  };
  clear(): void {
    this.abortPreparation(); this.exclusionVersions = null;
    this.reservations.clear();
    this.sources.clear(); this.variants.clear(); this.excluded.clear(); this.resolved.clear();
    this.fence.active = false; this.fence = { active: true }; this.byId = null;
    this.journal.entries.clear(); this.journal.weight = 0; this.snapshotCache = null;
    this.root = null; this.cached = null; this.nextSource = 0; this.revision++;
  }
  private abortPreparation(): void {
    const active = this.preparation; if (!active || active.aborted) return; active.aborted = true; active.cancel();
  }
  private replayAllowed(key: string, weight: number, exclusion = false): Preparation<T> | null {
    const active = this.preparation; if (!active || active.aborted) return null;
    if ((!exclusion && active.key === key) || !Number.isFinite(weight) || weight < 0 || weight > PREPARATION_BATCH || active.weight + weight > PREPARATION_REPLAY_LIMIT) { this.abortPreparation(); return null; }
    return active;
  }
  private appendReplay(active: Preparation<T> | null, operation: Replay<T>): void {
    if (!active || active.aborted || this.preparation !== active) return;
    active.weight += operation.weight; active.mutations.push(operation);
  }
  private ownedPatch(patch: MemoryPublicationPatch<T>): MemoryPublicationPatch<T> {
    if (!patch || !Array.isArray(patch.changed) || !Array.isArray(patch.removed) || !patch.order || !Array.isArray(patch.order.changes) || patch.order.reset !== undefined && !Array.isArray(patch.order.reset)) throw unavailable();
    return { changed: patch.changed.map(row => ({ id: row.id, value: row.value })), removed: patch.removed.slice(), order: {
      ...(patch.order.reset !== undefined ? { reset: patch.order.reset.slice() } : {}), changes: patch.order.changes.map(move => ({ ...move })),
    } };
  }
  private patchWeight(key: string, patch: MemoryPublicationPatch<T>): number {
    return patch.changed.length + patch.removed.length + patch.order.changes.length + (patch.order.reset?.length ?? 0) + (patch.order.reset ? this.sourceSize(key) : 0);
  }
  private compareSources(a: Source<T>, b: Source<T>): number { return a.priority - b.priority || a.ordinal - b.ordinal; }
  private compare(a: string, b: string): number {
    if (a === b) return 0;
    const left = this.resolved.get(a)!, right = this.resolved.get(b)!;
    const time = this.direction === 'asc' ? left.value.timestamp - right.value.timestamp : right.value.timestamp - left.value.timestamp;
    return time || this.compareSources(left.first, right.first) || left.first.order.position(a) - right.first.order.position(b);
  }
  private rotateInsert(root: SortedNode<T> | null, node: SortedNode<T>): SortedNode<T> {
    return insertMemoryNode(root, node, (a, b) => this.compare(a, b));
  }
  private erase(root: SortedNode<T> | null, id: string): SortedNode<T> | null {
    return eraseMemoryNode(root, id, (a, b) => this.compare(a, b));
  }
  private flags(value: T): number { let flags = 0; this.viewNames.forEach((name, index) => { if (this.options.views![name](value)) flags |= 1 << index; }); return flags; }
  private resolve(id: string): Resolved<T> | undefined {
    let first: Source<T> | undefined, last: Source<T> | undefined, value: T | undefined;
    for (const [key, item] of this.variants.get(id) ?? []) {
      if (!item || this.excluded.get(key)?.has(id)) continue;
      const source = this.sources.get(key)!;
      if (!first || this.compareSources(source, first) < 0) first = source;
      if (!last || this.compareSources(source, last) > 0) { last = source; value = item; }
    }
    return first && value ? { first, value } : undefined;
  }
  private *reconcileSteps(ids: Set<string>, mutate: () => Generator<void>, journal = true): Generator<void, MemoryPublicationDelta<T>> {
    try {
      const previous = new Map<string, T>();
      const moves: MemorySnapshotMove[][] = Array.from({ length: this.viewNames.length + 1 }, () => []);
      // Every moving key is removed before source positions change. Private preparation
      // can yield here; synchronous writers exhaust the same steps without yielding.
      for (const id of ids) {
        const old = this.resolved.get(id);
        if (old) {
          previous.set(id, old.value);
          if (journal) memoryNodeRanks(this.root, id, (a, b) => this.compare(a, b), this.viewNames.length).forEach((at, view) => { if (at !== undefined) moves[view].push({ type: 'removed', id, oldIndex: at, newIndex: -1 }); });
          this.root = this.erase(this.root, id); this.byId = eraseMemoryNode(this.byId, id, compareIds);
        }
        yield;
      }
      yield* mutate();
      const delta: MemoryPublicationDelta<T> = { changed: [], removed: [] };
      for (const id of ids) {
        const next = this.resolve(id), old = previous.get(id);
        if (next) {
          const flags = this.flags(next.value); this.resolved.set(id, next);
          this.root = this.rotateInsert(this.root, memoryNode(next.value, this.random(), null, null, flags, this.viewNames.length));
          this.byId = insertMemoryNode(this.byId, memoryNode(next.value, this.random(), null, null, flags), compareIds);
          if (journal) memoryNodeRanks(this.root, id, (a, b) => this.compare(a, b), this.viewNames.length).forEach((at, view) => { if (at !== undefined) moves[view].push({ type: 'added', id, oldIndex: -1, newIndex: at }); });
          if (old !== next.value) delta.changed.push(next.value);
        } else { this.resolved.delete(id); if (old) delta.removed.push(id); }
        yield;
      }
      if (ids.size) {
        this.revision++; this.cached = null; this.snapshotCache = null;
        if (journal) {
          const entry = { ids: [...ids], moves }, weight = entry.ids.length + moves.reduce((sum, rows) => sum + rows.length, 0);
          this.journal.entries.set(this.revision, entry); this.journal.weight += weight;
          while (this.journal.entries.size > 64 || this.journal.weight > 200_000) { const key = this.journal.entries.keys().next().value!; const old = this.journal.entries.get(key)!; this.journal.weight -= old.ids.length + old.moves.reduce((sum, rows) => sum + rows.length, 0); this.journal.entries.delete(key); }
        }
      }
      return delta;
    } catch { this.clear(); throw unavailable(); }
  }
  private reconcile(ids: Set<string>, mutate: () => void): MemoryPublicationDelta<T> {
    return finishPublicationSteps(this.reconcileSteps(ids, function* () { mutate(); yield; }));
  }
  private *applySteps(key: string, patch: MemoryPublicationPatch<T>, priority?: number, journal = true): Generator<void, MemoryPublicationDelta<T>> {
    try {
      if (!validId(key) || priority !== undefined && !Number.isFinite(priority) || !patch || !Array.isArray(patch.changed) ||
          !Array.isArray(patch.removed) || !patch.order || !Array.isArray(patch.order.changes) ||
          patch.order.reset !== undefined && !Array.isArray(patch.order.reset)) throw unavailable();
      if (patch.order.reset) for (const id of patch.order.reset) { if (!validId(id)) throw unavailable(); yield; }
      const changedIds = new Set<string>();
      for (const row of patch.changed) {
        if (!row || !validId(row.id) || changedIds.has(row.id) || row.value !== null &&
            (!row.value || typeof row.value !== 'object' || Array.isArray(row.value) || row.value.id !== row.id || !Number.isFinite(row.value.timestamp))) throw unavailable();
        changedIds.add(row.id); yield;
      }
      const removedIds = new Set<string>();
      for (const id of patch.removed) { if (!validId(id) || removedIds.has(id) || changedIds.has(id)) throw unavailable(); removedIds.add(id); yield; }
      for (const move of patch.order.changes) {
        if (!move || !validId(move.id) || !Number.isSafeInteger(move.oldIndex) || !Number.isSafeInteger(move.newIndex) ||
            (move.type === 'added' ? move.oldIndex !== -1 || move.newIndex < 0 :
              move.type === 'removed' ? move.oldIndex < 0 || move.newIndex !== -1 :
                move.type === 'modified' ? move.oldIndex < 0 || move.newIndex < 0 : true)) throw unavailable();
        yield;
      }
      let source = this.sources.get(key);
      if (!source) {
        source = this.reservations.get(key);
        if (source) this.reservations.delete(key);
        else { const ordinal = this.nextSource++;
          source = { key, priority: priority ?? (this.options.sourceBase ?? 0) + ordinal, ordinal, order: new SnapshotOrder(this.random, this.options.captureSources), values: new Map(), byId: null };
        }
        this.sources.set(key, source);
      }
      if (priority !== undefined && priority !== source.priority) throw unavailable();
      const target = source, ids = changedIds;
      for (const id of patch.removed) { ids.add(id); yield; }
      for (const move of patch.order.changes) { ids.add(move.id); yield; }
      if (patch.order.reset) { for (const id of source.values.keys()) { ids.add(id); yield; } for (const id of patch.order.reset) { ids.add(id); yield; } }
      return yield* this.reconcileSteps(ids, function* (this: IncrementalMemoryPublication<T>) {
        if (patch.order.reset) {
          const order = new SnapshotOrder(this.random, this.options.captureSources); let at = 0;
          for (const id of patch.order.reset) { order.insert(id, at++); yield; } target.order = order;
        }
        for (const move of patch.order.changes) {
          if (move.type === 'added') target.order.insert(move.id, move.newIndex);
          else { const node = target.order.remove(move.id, move.oldIndex); if (move.type === 'modified') target.order.insert(move.id, move.newIndex, node); else if (move.type !== 'removed') throw unavailable(); }
          yield;
        }
        for (const id of ids) {
          if (!target.order.nodes.has(id)) { this.removeSourceValue(target, id); const variants = this.variants.get(id); variants?.delete(key); if (!variants?.size) this.variants.delete(id); }
          yield;
        }
        for (const { id, value } of patch.changed) {
          if (!target.order.nodes.has(id)) throw unavailable(); this.setSourceValue(target, id, value);
          let variants = this.variants.get(id); if (!variants) { variants = new Map(); this.variants.set(id, variants); } variants.set(key, value); yield;
        }
        for (const id of patch.removed) { if (target.order.nodes.has(id)) throw unavailable(); yield; }
        for (const id of ids) { if (target.order.nodes.has(id) && !target.values.has(id)) throw unavailable(); yield; }
      }.bind(this), journal);
    } catch { this.clear(); throw unavailable(); }
  }
  apply(key: string, patch: MemoryPublicationPatch<T>, priority?: number): MemoryPublicationDelta<T> {
    try {
    const weight = patch?.changed?.length + patch?.removed?.length + patch?.order?.changes?.length + (patch?.order?.reset?.length ?? 0) + (patch?.order?.reset ? this.sourceSize(key) : 0);
    const active = this.replayAllowed(key, weight), ids = active ? new Set<string>([...patch.changed.map(row => row.id), ...patch.removed, ...patch.order.changes.map(move => move.id), ...(patch.order.reset ?? []), ...(patch.order.reset ? this.sources.get(key)?.values.keys() ?? [] : [])]) : null;
    const owned = active ? this.ownedPatch(patch) : null, delta = finishPublicationSteps(this.applySteps(key, patch, priority));
    if (active && owned && ids) { const source = this.sources.get(key)!; this.appendReplay(active, { type: 'apply', key, patch: owned, priority: source.priority, ordinal: source.ordinal, nextSource: this.nextSource, ids: [...ids], weight }); }
    return delta;
    } catch { this.clear(); throw unavailable(); }
  }
  /** Large source patches prepare privately. Commit callbacks must be synchronous. */
  applyControlled(key: string, patch: MemoryPublicationPatch<T>, control: MemoryPublicationControl<T>): Promise<MemoryPublicationDelta<T>> {
    try {
      const scope = this.fence, captured = { ...control }, owned = this.ownedPatch(patch);
      const current = () => scope.active && this.fence === scope && captured.isCurrent();
      if (!validId(key) || captured.priority !== undefined && !Number.isFinite(captured.priority) || !current()) throw unavailable();
      if (this.patchWeight(key, owned) <= PREPARATION_BATCH) {
        if (captured.beforeCommit && !captured.beforeCommit() || !current()) throw unavailable();
        const delta = this.apply(key, owned, captured.priority);
        try { captured.afterCommit?.(delta); } catch { this.clear(); throw unavailable(); }
        return Promise.resolve(delta);
      }
      if (!this.options.captureSources) throw unavailable();
      const prepare = () => this.prepareAtomic(key, owned, captured, current);
      const result = this.preparationTail.then(prepare, prepare); this.preparationTail = result.then(() => undefined, () => undefined); return result;
    } catch { return Promise.reject(unavailable()); }
  }
  private async prepareAtomic(key: string, patch: MemoryPublicationPatch<T>, control: MemoryPublicationControl<T>, current: () => boolean): Promise<MemoryPublicationDelta<T>> {
    const controlled = createControlledYield();
    let cancelPause: (() => void) | null = null;
    const preparation: Preparation<T> = { key, aborted: false, mutations: [], weight: 0, cancel: () => { controlled.cancel(); cancelPause?.(); } };
    let adopted = false;
    const candidate = new IncrementalMemoryPublication<T>(this.direction, this.options);
    const guard = () => { if (preparation.aborted || !current()) throw unavailable(); };
    const pause = async () => {
      guard(); await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cancel = () => { if (!settled) { settled = true; if (cancelPause === cancel) cancelPause = null; reject(unavailable()); } };
        cancelPause = cancel;
        const waiting = this.options.yieldTask?.() ?? controlled.yieldTask();
        void waiting.then(() => { if (!settled) { settled = true; if (cancelPause === cancel) cancelPause = null; resolve(); } }, cancel);
        if (preparation.aborted || !current()) cancel();
      }); guard();
    };
    const drive = async <R,>(steps: Generator<void, R>): Promise<R> => {
      let next: IteratorResult<void, R> | undefined, visited = 0;
      try { while (true) { guard(); next = steps.next(); if (next.done) return next.value; if (++visited === PREPARATION_BATCH) { visited = 0; await pause(); } } }
      finally { if (!next?.done) steps.return(undefined as never); }
    };
    try {
      guard();
      if (!this.sources.has(key)) {
        if (!this.reservations.has(key)) { const ordinal = this.nextSource++;
          this.reservations.set(key, { key, priority: control.priority ?? (this.options.sourceBase ?? 0) + ordinal, ordinal, order: new SnapshotOrder(this.random, true), values: new Map(), byId: null });
        }
      }
      const original = this.sources.get(key) ?? this.reservations.get(key)!;
      if (control.priority !== undefined && control.priority !== original.priority) throw unavailable();
      const captures = Array.from(this.sources.values(), source => ({ version: this.captureSource(source.key)!, order: source.order.root?.version ?? null, byId: source.byId }));
      const exclusions = this.exclusionVersions, nextSource = this.nextSource;
      this.preparation = preparation;
      await drive(candidate.restoreSteps(captures, exclusions, nextSource));
      if (!candidate.sources.has(key)) candidate.sources.set(key, { key, priority: original.priority, ordinal: original.ordinal, order: new SnapshotOrder(candidate.random, true), values: new Map(), byId: null });
      await drive(candidate.applySteps(key, patch, control.priority, false));
      const ids = new Set<string>();
      const collect = function* () {
        for (const row of patch.changed) { ids.add(row.id); yield; }
        for (const id of patch.removed) { ids.add(id); yield; }
        for (const move of patch.order.changes) { ids.add(move.id); yield; }
        if (patch.order.reset) { for (const id of original.values.keys()) { ids.add(id); yield; } for (const id of patch.order.reset) { ids.add(id); yield; } }
      };
      await drive(collect());
      const changed = new Map<string, T>(), removed = new Set<string>();
      const refresh = (id: string) => {
        const before = this.resolved.get(id)?.value, after = candidate.resolved.get(id)?.value;
        if (before === after) { changed.delete(id); removed.delete(id); }
        else if (after) { changed.set(id, after); removed.delete(id); }
        else { changed.delete(id); if (before) removed.add(id); }
      };
      await drive((function* () { for (const id of ids) { refresh(id); yield; } })());
      let cursor = 0, replayed = 0;
      while (cursor < preparation.mutations.length) {
        guard(); const operation = preparation.mutations[cursor++]; candidate.replay(operation);
        for (const id of operation.ids) if (ids.has(id)) refresh(id);
        replayed += operation.weight;
        if (replayed >= PREPARATION_BATCH && cursor < preparation.mutations.length) { replayed = 0; await pause(); }
      }
      guard(); const revision = this.revision; if (control.beforeCommit && !control.beforeCommit()) throw unavailable(); guard();
      if (revision !== this.revision || cursor !== preparation.mutations.length) throw unavailable();
      const delta = { changed: [...changed.values()], removed: [...removed] };
      this.preparation = null;
      this.sources = candidate.sources; this.variants = candidate.variants; this.excluded = candidate.excluded; this.resolved = candidate.resolved;
      this.root = candidate.root; this.byId = candidate.byId; this.exclusionVersions = candidate.exclusionVersions; this.nextSource = candidate.nextSource; this.seed = candidate.seed;
      this.revision++; this.cached = null; this.snapshotCache = null; this.journal.entries.clear(); this.journal.weight = 0; adopted = true;
      this.reservations.delete(key);
      try { control.afterCommit?.(delta); } catch { this.clear(); throw unavailable(); }
      return delta;
    } finally {
      preparation.cancel(); if (this.preparation === preparation) this.preparation = null;
      if (!adopted) candidate.clear();
    }
  }
  private *restoreSteps(captures: Array<{ version: PublicationSourceSnapshot<T>; order: PublicationOrderVersion | null; byId: Source<T>['byId'] }>, exclusions: PersistentMemoryNode<ExclusionVersion> | null, nextSource: number): Generator<void> {
    this.nextSource = nextSource; this.exclusionVersions = exclusions;
    for (const capture of captures) {
      const version = capture.version, source: Source<T> = { key: version.key, priority: version.priority, ordinal: version.ordinal, order: new SnapshotOrder(this.random, true), values: new Map(), byId: capture.byId };
      this.sources.set(source.key, source);
      const stack: Array<{ version: PublicationOrderVersion; parent: OrderNode | null; side: 'left' | 'right' }> = capture.order ? [{ version: capture.order, parent: null, side: 'left' }] : [];
      while (stack.length) {
        const item = stack.pop()!, value = version.get(item.version.id); if (value === undefined) throw unavailable();
        const node: OrderNode = { id: item.version.id, priority: item.version.priority, size: item.version.size, left: null, right: null, parent: item.parent, version: item.version };
        if (item.parent) item.parent[item.side] = node; else source.order.root = node; source.order.nodes.set(node.id, node); source.values.set(node.id, value);
        let variants = this.variants.get(node.id); if (!variants) { variants = new Map(); this.variants.set(node.id, variants); } variants.set(source.key, value);
        if (item.version.right) stack.push({ version: item.version.right, parent: node, side: 'right' }); if (item.version.left) stack.push({ version: item.version.left, parent: node, side: 'left' }); yield;
      }
    }
    for (const row of memoryNodeRange(exclusions, 0, exclusions?.size ?? 0)) { let ids = this.excluded.get(row.key); if (!ids) { ids = new Set(); this.excluded.set(row.key, ids); } ids.add(row.documentId); yield; }
    for (const id of this.variants.keys()) {
      const resolved = this.resolve(id); if (resolved) { this.resolved.set(id, resolved); const flags = this.flags(resolved.value);
        this.root = this.rotateInsert(this.root, memoryNode(resolved.value, this.random(), null, null, flags, this.viewNames.length));
        this.byId = insertMemoryNode(this.byId, memoryNode(resolved.value, this.random(), null, null, flags), compareIds);
      } yield;
    }
  }
  private replay(operation: Replay<T>): void {
    if (operation.type === 'exclude') this.exclude(operation.key, operation.id, operation.excluded);
    else if (operation.type === 'remove') this.removeSource(operation.key);
    else {
      if (!this.sources.has(operation.key)) this.sources.set(operation.key, { key: operation.key, priority: operation.priority, ordinal: operation.ordinal, order: new SnapshotOrder(this.random, true), values: new Map(), byId: null });
      this.nextSource = Math.max(this.nextSource, operation.nextSource); this.apply(operation.key, operation.patch, operation.priority);
    }
  }
  exclude(key: string, id: string, excluded: boolean): MemoryPublicationDelta<T> {
    if (!validId(key) || !validId(id) || typeof excluded !== 'boolean') { this.clear(); throw unavailable(); }
    let ids = this.excluded.get(key);
    if (Boolean(ids?.has(id)) === excluded) return { changed: [], removed: [] };
    const active = this.replayAllowed(key, 1, true);
    const delta = this.reconcile(new Set([id]), () => {
      if (excluded) { if (!ids) { ids = new Set(); this.excluded.set(key, ids); } ids.add(id); }
      else { ids?.delete(id); if (!ids?.size) this.excluded.delete(key); }
      if (this.options.captureSources) { const version = { id: JSON.stringify([key, id]), key, documentId: id }; this.exclusionVersions = excluded
        ? insertMemoryNode(this.exclusionVersions, memoryNode(Object.freeze(version), this.random()), compareIds)
        : eraseMemoryNode(this.exclusionVersions, version.id, compareIds); }
    });
    this.appendReplay(active, { type: 'exclude', key, id, excluded, weight: 1, ids: [id] }); return delta;
  }
  /** Suppression belongs to the vault scope, so a listener error/retry must not undo its tombstones. */
  removeSource(key: string): MemoryPublicationDelta<T> {
    if (!validId(key)) { this.clear(); throw unavailable(); }
    this.reservations.delete(key);
    const source = this.sources.get(key); if (!source) { if (this.preparation?.key === key) this.abortPreparation(); return { changed: [], removed: [] }; }
    const active = this.replayAllowed(key, source.values.size), affected = active ? [...source.values.keys()] : [];
    const delta = this.reconcile(new Set(source.values.keys()), () => {
      for (const id of source.values.keys()) { const variants = this.variants.get(id); variants?.delete(key); if (!variants?.size) this.variants.delete(id); }
      this.sources.delete(key);
    });
    this.appendReplay(active, { type: 'remove', key, weight: affected.length, ids: affected }); return delta;
  }
  /** Small views publish synchronously; large arrays yield tasks and cannot deliver after mutation/retirement. */
  async publish(isCurrent: () => boolean, deliver: (values: T[]) => void): Promise<boolean> {
    const revision = this.revision, current = () => revision === this.revision && isCurrent();
    if (!current()) return false;
    if (this.cached?.revision === revision) { deliver(this.cached.values); return true; }
    const values: T[] = [], stack: SortedNode<T>[] = []; let node = this.root, visited = 0;
    const batchSize = this.options.batchSize ?? 256;
    while (node || stack.length) {
      while (node) { stack.push(node); node = node.left; }
      node = stack.pop()!; values.push(node.value); node = node.right;
      if (++visited % batchSize === 0 && (node || stack.length)) {
        await (this.options.yieldTask?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0)));
        if (!current()) return false;
      }
    }
    if (!current()) return false;
    this.cached = { revision, values }; deliver(values); return true;
  }
  snapshot(): MemorySnapshot<T> {
    if (!this.snapshotCache) this.snapshotCache = createMemorySnapshot({ root: this.root, byId: this.byId, views: this.viewNames, fence: this.fence, journal: this.journal, revision: this.revision });
    return this.snapshotCache;
  }
  /** O(1) delivery: a snapshot retains roots, never copies or visits the collection. */
  async publishSnapshot(isCurrent: () => boolean, deliver: (values: MemorySnapshot<T>) => void): Promise<boolean> {
    if (!isCurrent()) return false; const snapshot = this.snapshot(); if (!isCurrent()) return false; deliver(snapshot); return true;
  }
}
