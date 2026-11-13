import { memoryNode, memoryNodeAt, memoryNodeCount, memoryNodeRange, mergeMemoryNodes, type PersistentMemoryNode } from './persistentMemoryTree';
import { memoryViewId, MEMORY_VIEW_LIMITS } from './memoryViewProtocol';
import type { MemorySnapshotMove } from './memorySnapshot';

type Node = PersistentMemoryNode<{ id: string }>;
const fail = () => new Error('memory_view_unavailable');
function split(root: Node | null, count: number): [Node | null, Node | null] {
  if (!root) return [null, null];
  const leftSize = memoryNodeCount(root.left);
  if (leftSize >= count) { const [left, right] = split(root.left, count); return [left, memoryNode(root.value, root.priority, right, root.right)]; }
  const [left, right] = split(root.right, count - leftSize - 1); return [memoryNode(root.value, root.priority, root.left, left), right];
}
/** Worker-owned implicit order tree: one insertion/removal does not shift the whole vault. */
export class MemoryViewOrder {
  private root: Node | null = null;
  private ids = new Set<string>();
  private seed = 0x6d6e656d;
  get size(): number { return memoryNodeCount(this.root); }
  has(id: string): boolean { return this.ids.has(id); }
  clear(): void { this.root = null; this.ids.clear(); }
  *values(): IterableIterator<string> { for (const row of memoryNodeRange(this.root, 0, this.size)) yield row.id; }
  append(id: string): void { this.insert(id, this.size); }
  private insert(id: string, index: number): void {
    if (!memoryViewId(id) || this.ids.has(id) || index < 0 || index > this.size || this.size >= MEMORY_VIEW_LIMITS.documents) throw fail();
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    const [left, right] = split(this.root, index); this.root = mergeMemoryNodes(mergeMemoryNodes(left, memoryNode({ id }, this.seed)), right); this.ids.add(id);
  }
  move(move: MemorySnapshotMove): void {
    if (!move || !memoryViewId(move.id) || !Number.isSafeInteger(move.oldIndex) || !Number.isSafeInteger(move.newIndex)) throw fail();
    if (move.type === 'added' && move.oldIndex === -1 && move.newIndex >= 0) this.insert(move.id, move.newIndex);
    else if (move.type === 'removed' && move.newIndex === -1 && move.oldIndex >= 0) {
      if (memoryNodeAt(this.root, move.oldIndex)?.id !== move.id) throw fail();
      const [left, rest] = split(this.root, move.oldIndex), [, right] = split(rest, 1); this.root = mergeMemoryNodes(left, right); this.ids.delete(move.id);
    } else throw fail();
  }
}
