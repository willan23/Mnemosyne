/** Immutable tree nodes share immutable DTO references across revisions. */
export interface PersistentMemoryNode<T extends { id: string }> {
  readonly id: string; readonly value: T; readonly priority: number;
  readonly left: PersistentMemoryNode<T> | null; readonly right: PersistentMemoryNode<T> | null;
  readonly size: number; readonly flags: number; readonly counts: readonly number[];
}
export const memoryNodeCount = <T extends { id: string }>(node: PersistentMemoryNode<T> | null, view = -1): number => node ? view < 0 ? node.size : node.counts[view] ?? 0 : 0;
export const memoryNodeIncluded = <T extends { id: string }>(node: PersistentMemoryNode<T>, view = -1): boolean => view < 0 || Boolean(node.flags & (1 << view));
export function memoryNode<T extends { id: string }>(value: T, priority: number, left: PersistentMemoryNode<T> | null = null, right: PersistentMemoryNode<T> | null = null, flags = 0, views = 0): PersistentMemoryNode<T> {
  const node: PersistentMemoryNode<T> = { id: value.id, value, priority, left, right, flags,
    size: 1 + memoryNodeCount(left) + memoryNodeCount(right),
    counts: Object.freeze(Array.from({ length: views }, (_, at) => Number(Boolean(flags & (1 << at))) + memoryNodeCount(left, at) + memoryNodeCount(right, at))) };
  return Object.freeze(node);
}
function copy<T extends { id: string }>(node: PersistentMemoryNode<T>, left: PersistentMemoryNode<T> | null, right: PersistentMemoryNode<T> | null) {
  return memoryNode(node.value, node.priority, left, right, node.flags, node.counts.length);
}
export function insertMemoryNode<T extends { id: string }>(root: PersistentMemoryNode<T> | null, node: PersistentMemoryNode<T>, compare: (a: string, b: string) => number): PersistentMemoryNode<T> {
  if (!root) return node;
  const order = compare(node.id, root.id);
  if (!order) return memoryNode(node.value, root.priority, root.left, root.right, node.flags, node.counts.length);
  if (order < 0) {
    const left = insertMemoryNode(root.left, node, compare);
    return left.priority < root.priority ? copy(left, left.left, copy(root, left.right, root.right)) : copy(root, left, root.right);
  }
  const right = insertMemoryNode(root.right, node, compare);
  return right.priority < root.priority ? copy(right, copy(root, root.left, right.left), right.right) : copy(root, root.left, right);
}
export function mergeMemoryNodes<T extends { id: string }>(left: PersistentMemoryNode<T> | null, right: PersistentMemoryNode<T> | null): PersistentMemoryNode<T> | null {
  if (!left) return right; if (!right) return left;
  return left.priority < right.priority ? copy(left, left.left, mergeMemoryNodes(left.right, right)) : copy(right, mergeMemoryNodes(left, right.left), right.right);
}
export function eraseMemoryNode<T extends { id: string }>(root: PersistentMemoryNode<T> | null, id: string, compare: (a: string, b: string) => number): PersistentMemoryNode<T> | null {
  if (!root) throw Error('memory_snapshot_unavailable');
  const order = compare(id, root.id);
  return !order ? mergeMemoryNodes(root.left, root.right) : order < 0 ? copy(root, eraseMemoryNode(root.left, id, compare), root.right) : copy(root, root.left, eraseMemoryNode(root.right, id, compare));
}
export function memoryNodeById<T extends { id: string }>(root: PersistentMemoryNode<T> | null, id: string): PersistentMemoryNode<T> | null {
  while (root) { const order = id < root.id ? -1 : id > root.id ? 1 : 0; if (!order) return root; root = order < 0 ? root.left : root.right; } return null;
}
export function memoryNodeAt<T extends { id: string }>(root: PersistentMemoryNode<T> | null, index: number, view = -1): T | undefined {
  if (!Number.isInteger(index) || index < 0) return;
  while (root) { const left = memoryNodeCount(root.left, view), own = Number(memoryNodeIncluded(root, view)); if (index < left) root = root.left; else if (own && index === left) return root.value; else { index -= left + own; root = root.right; } } return;
}
export function memoryNodeRanks<T extends { id: string }>(root: PersistentMemoryNode<T> | null, id: string, compare: (a: string, b: string) => number, views = 0): Array<number | undefined> {
  const ranks = Array<number>(views + 1).fill(0);
  while (root) {
    const order = compare(id, root.id);
    if (order < 0) root = root.left;
    else {
      for (let view = -1; view < views; view++) ranks[view + 1] += memoryNodeCount(root.left, view) + (order ? Number(memoryNodeIncluded(root, view)) : 0);
      if (!order) return ranks.map((value, index) => memoryNodeIncluded(root!, index - 1) ? value : undefined);
      root = root.right;
    }
  }
  throw Error('memory_snapshot_unavailable');
}
/** Skips entire subtrees before/after a requested window, including filtered-out branches. */
export function* memoryNodeRange<T extends { id: string }>(root: PersistentMemoryNode<T> | null, start: number, end: number, view = -1): IterableIterator<T> {
  if (!root || start >= end || end <= 0 || start >= memoryNodeCount(root, view)) return;
  const left = memoryNodeCount(root.left, view), own = Number(memoryNodeIncluded(root, view));
  if (start < left) yield* memoryNodeRange(root.left, start, Math.min(end, left), view);
  if (own && start <= left && end > left) yield root.value;
  if (end > left + own) yield* memoryNodeRange(root.right, start - left - own, end - left - own, view);
}
