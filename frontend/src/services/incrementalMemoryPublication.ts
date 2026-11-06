import type { SessionSnapshotLease } from './incrementalSessionSnapshot';

export interface MemoryPublicationPatch<T> {
  changed: Array<{ id: string; value: T | null }>;
  removed: string[];
  order: SessionSnapshotLease<unknown>['order'];
}
export interface MemoryPublicationDelta<T> { changed: T[]; removed: string[] }
type OrderNode = { id: string; priority: number; size: number; left: OrderNode | null; right: OrderNode | null; parent: OrderNode | null };
const size = (node: OrderNode | null): number => node?.size ?? 0;
const update = (node: OrderNode) => {
  node.size = 1 + size(node.left) + size(node.right);
  if (node.left) node.left.parent = node;
  if (node.right) node.right.parent = node;
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
  constructor(random: () => number) { this.random = random; }
  position(id: string): number {
    let node = this.nodes.get(id); if (!node) throw Error('memory_publication_unavailable');
    let result = size(node.left);
    while (node.parent) { if (node === node.parent.right) result += size(node.parent.left) + 1; node = node.parent; }
    return result;
  }
  insert(id: string, index: number, prior?: OrderNode): void {
    if (this.nodes.has(id) || !Number.isSafeInteger(index) || index < 0 || index > size(this.root)) throw Error('memory_publication_unavailable');
    const node = prior ?? { id, priority: this.random(), size: 1, left: null, right: null, parent: null };
    node.left = node.right = node.parent = null; node.size = 1;
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
type Source<T> = { key: string; priority: number; ordinal: number; order: SnapshotOrder; values: Map<string, T | null> };
type Resolved<T> = { value: T; first: Source<T> };
type SortedNode = { id: string; priority: number; left: SortedNode | null; right: SortedNode | null };
const unavailable = () => new Error('memory_publication_unavailable');
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('/');

/**
 * Scoped, in-memory publication. Values are local authorized objects, never sent to a Worker or storage.
 * Only changed IDs are reconciled/reordered. Existing array consumers still require O(N) materialization,
 * performed in cancellable task batches; this class does not claim to paginate those consumers.
 */
export class IncrementalMemoryPublication<T extends { id: string; timestamp: number }> {
  private sources = new Map<string, Source<T>>();
  private variants = new Map<string, Map<string, T | null>>();
  private excluded = new Map<string, Set<string>>();
  private resolved = new Map<string, Resolved<T>>();
  private root: SortedNode | null = null;
  private nextSource = 0;
  private revision = 0;
  private cached: { revision: number; values: T[] } | null = null;
  private seed = (Math.random() * 0x100000000) >>> 0 || 1;
  private direction: 'asc' | 'desc';
  private options: { sourceBase?: number; batchSize?: number; yieldTask?: () => Promise<void> };
  constructor(direction: 'asc' | 'desc', options: { sourceBase?: number; batchSize?: number; yieldTask?: () => Promise<void> } = {}) {
    this.direction = direction; this.options = options;
    if (direction !== 'asc' && direction !== 'desc' || options.sourceBase !== undefined && !Number.isFinite(options.sourceBase) ||
        options.batchSize !== undefined && (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 4096)) throw unavailable();
  }
  get count(): number { return this.resolved.size; }
  get(id: string): T | undefined { return this.resolved.get(id)?.value; }
  sourceValue(key: string, id: string): T | null | undefined { return this.sources.get(key)?.values.get(id); }
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
    const stack: SortedNode[] = []; let node = this.root;
    while (node || stack.length) {
      while (node) { stack.push(node); node = node.left; }
      node = stack.pop()!; yield this.resolved.get(node.id)!.value; node = node.right;
    }
  }
  private random = () => {
    let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0;
    return this.seed;
  };
  clear(): void {
    this.sources.clear(); this.variants.clear(); this.excluded.clear(); this.resolved.clear();
    this.root = null; this.cached = null; this.nextSource = 0; this.revision++;
  }
  private compareSources(a: Source<T>, b: Source<T>): number { return a.priority - b.priority || a.ordinal - b.ordinal; }
  private compare(a: string, b: string): number {
    if (a === b) return 0;
    const left = this.resolved.get(a)!, right = this.resolved.get(b)!;
    const time = this.direction === 'asc' ? left.value.timestamp - right.value.timestamp : right.value.timestamp - left.value.timestamp;
    return time || this.compareSources(left.first, right.first) || left.first.order.position(a) - right.first.order.position(b);
  }
  private rotateInsert(root: SortedNode | null, node: SortedNode): SortedNode {
    if (!root) return node;
    if (this.compare(node.id, root.id) < 0) {
      root.left = this.rotateInsert(root.left, node);
      if (root.left.priority < root.priority) { const top = root.left; root.left = top.right; top.right = root; return top; }
    } else {
      root.right = this.rotateInsert(root.right, node);
      if (root.right.priority < root.priority) { const top = root.right; root.right = top.left; top.left = root; return top; }
    }
    return root;
  }
  private mergeSorted(left: SortedNode | null, right: SortedNode | null): SortedNode | null {
    if (!left) return right; if (!right) return left;
    if (left.priority < right.priority) { left.right = this.mergeSorted(left.right, right); return left; }
    right.left = this.mergeSorted(left, right.left); return right;
  }
  private erase(root: SortedNode | null, id: string): SortedNode | null {
    if (!root) throw unavailable();
    const order = this.compare(id, root.id);
    if (!order) return this.mergeSorted(root.left, root.right);
    if (order < 0) root.left = this.erase(root.left, id); else root.right = this.erase(root.right, id);
    return root;
  }
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
  private reconcile(ids: Set<string>, mutate: () => void): MemoryPublicationDelta<T> {
    const previous = new Map<string, T>();
    // Remove every moving key before altering source positions. All other relative orders remain valid.
    for (const id of ids) { const old = this.resolved.get(id); if (old) { previous.set(id, old.value); this.root = this.erase(this.root, id); } }
    mutate();
    const delta: MemoryPublicationDelta<T> = { changed: [], removed: [] };
    for (const id of ids) {
      const next = this.resolve(id), old = previous.get(id);
      if (next) {
        this.resolved.set(id, next); this.root = this.rotateInsert(this.root, { id, priority: this.random(), left: null, right: null });
        if (old !== next.value) delta.changed.push(next.value);
      } else { this.resolved.delete(id); if (old) delta.removed.push(id); }
    }
    if (ids.size) { this.revision++; this.cached = null; }
    return delta;
  }
  apply(key: string, patch: MemoryPublicationPatch<T>, priority?: number): MemoryPublicationDelta<T> {
    try {
      if (!validId(key) || priority !== undefined && !Number.isFinite(priority) || !patch || !Array.isArray(patch.changed) ||
          !Array.isArray(patch.removed) || !patch.order || !Array.isArray(patch.order.changes) ||
          patch.order.reset !== undefined && (!Array.isArray(patch.order.reset) || patch.order.reset.some(id => !validId(id)))) throw unavailable();
      const changedIds = new Set<string>();
      for (const row of patch.changed) {
        if (!row || !validId(row.id) || changedIds.has(row.id) || row.value !== null &&
            (!row.value || typeof row.value !== 'object' || Array.isArray(row.value) || row.value.id !== row.id || !Number.isFinite(row.value.timestamp))) throw unavailable();
        changedIds.add(row.id);
      }
      const removedIds = new Set<string>();
      for (const id of patch.removed) { if (!validId(id) || removedIds.has(id) || changedIds.has(id)) throw unavailable(); removedIds.add(id); }
      for (const move of patch.order.changes) {
        if (!move || !validId(move.id) || !Number.isSafeInteger(move.oldIndex) || !Number.isSafeInteger(move.newIndex) ||
            (move.type === 'added' ? move.oldIndex !== -1 || move.newIndex < 0 :
              move.type === 'removed' ? move.oldIndex < 0 || move.newIndex !== -1 :
                move.type === 'modified' ? move.oldIndex < 0 || move.newIndex < 0 : true)) throw unavailable();
      }
      let source = this.sources.get(key);
      if (!source) {
        const ordinal = this.nextSource++;
        source = { key, priority: priority ?? (this.options.sourceBase ?? 0) + ordinal, ordinal, order: new SnapshotOrder(this.random), values: new Map() };
        this.sources.set(key, source);
      } else if (priority !== undefined && priority !== source.priority) throw unavailable();
      const target = source, ids = new Set([...patch.changed.map(row => row.id), ...patch.removed, ...patch.order.changes.map(row => row.id)]);
      if (patch.order.reset) { for (const id of source.values.keys()) ids.add(id); for (const id of patch.order.reset) ids.add(id); }
      return this.reconcile(ids, () => {
        if (patch.order.reset) {
          const order = new SnapshotOrder(this.random);
          patch.order.reset.forEach((id, index) => order.insert(id, index)); target.order = order;
        }
        for (const move of patch.order.changes) {
          if (move.type === 'added') target.order.insert(move.id, move.newIndex);
          else {
            const node = target.order.remove(move.id, move.oldIndex);
            if (move.type === 'modified') target.order.insert(move.id, move.newIndex, node);
            else if (move.type !== 'removed') throw unavailable();
          }
        }
        for (const id of ids) {
          if (!target.order.nodes.has(id)) {
            target.values.delete(id); const variants = this.variants.get(id); variants?.delete(key); if (!variants?.size) this.variants.delete(id);
          }
        }
        for (const { id, value } of patch.changed) {
          if (!target.order.nodes.has(id)) throw unavailable(); target.values.set(id, value);
          let variants = this.variants.get(id); if (!variants) { variants = new Map(); this.variants.set(id, variants); } variants.set(key, value);
        }
        for (const id of patch.removed) if (target.order.nodes.has(id)) throw unavailable();
        for (const id of ids) if (target.order.nodes.has(id) && !target.values.has(id)) throw unavailable();
      });
    } catch { this.clear(); throw unavailable(); }
  }
  exclude(key: string, id: string, excluded: boolean): MemoryPublicationDelta<T> {
    if (!validId(key) || !validId(id) || typeof excluded !== 'boolean') { this.clear(); throw unavailable(); }
    let ids = this.excluded.get(key);
    if (Boolean(ids?.has(id)) === excluded) return { changed: [], removed: [] };
    return this.reconcile(new Set([id]), () => {
      if (excluded) { if (!ids) { ids = new Set(); this.excluded.set(key, ids); } ids.add(id); }
      else { ids?.delete(id); if (!ids?.size) this.excluded.delete(key); }
    });
  }
  /** Suppression belongs to the vault scope, so a listener error/retry must not undo its tombstones. */
  removeSource(key: string): MemoryPublicationDelta<T> {
    if (!validId(key)) { this.clear(); throw unavailable(); }
    const source = this.sources.get(key); if (!source) return { changed: [], removed: [] };
    return this.reconcile(new Set(source.values.keys()), () => {
      for (const id of source.values.keys()) { const variants = this.variants.get(id); variants?.delete(key); if (!variants?.size) this.variants.delete(id); }
      this.sources.delete(key);
    });
  }
  /** Small views publish synchronously; large arrays yield tasks and cannot deliver after mutation/retirement. */
  async publish(isCurrent: () => boolean, deliver: (values: T[]) => void): Promise<boolean> {
    const revision = this.revision, current = () => revision === this.revision && isCurrent();
    if (!current()) return false;
    if (this.cached?.revision === revision) { deliver(this.cached.values); return true; }
    const values: T[] = [], stack: SortedNode[] = []; let node = this.root, visited = 0;
    const batchSize = this.options.batchSize ?? 256;
    while (node || stack.length) {
      while (node) { stack.push(node); node = node.left; }
      node = stack.pop()!; values.push(this.resolved.get(node.id)!.value); node = node.right;
      if (++visited % batchSize === 0 && (node || stack.length)) {
        await (this.options.yieldTask?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0)));
        if (!current()) return false;
      }
    }
    if (!current()) return false;
    this.cached = { revision, values }; deliver(values); return true;
  }
}
