import { eraseMemoryNode, insertMemoryNode, memoryNode, memoryNodeAt, memoryNodeById, memoryNodeCount, memoryNodeRange, mergeMemoryNodes, type PersistentMemoryNode } from './persistentMemoryTree';
import type { MemoryPublicationPatch } from './incrementalMemoryPublication';
import { semanticWriteId } from './semanticWriteProtocol';
import { INDEXED_SEMANTIC_WRITE_LIMITS as limits } from './indexedSemanticWriteProtocol';
import type { PublicationSourceSnapshot } from './publicationSourceSnapshot';

type IdNode = PersistentMemoryNode<{ id: string }>;
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function splitOrder(root: IdNode | null, count: number): [IdNode | null, IdNode | null] {
  if (!root) return [null, null];
  const leftSize = memoryNodeCount(root.left);
  if (leftSize >= count) { const [left, right] = splitOrder(root.left, count); return [left, memoryNode(root.value, root.priority, right, root.right)]; }
  const [left, right] = splitOrder(root.right, count - leftSize - 1); return [memoryNode(root.value, root.priority, root.left, left), right];
}
export interface SemanticWriteSourceSnapshot<T> { readonly priority: number; readonly count: number; orderedRows(): IterableIterator<{ id: string; value: T | null }> }

/** Latest raw references and persistent listener positions. Capturing a version reads no rows or vectors. */
export class SemanticWriteSourceState<T extends { id: string; timestamp: number }> {
  readonly priority: number;
  readonly ordinal: number;
  private values = new Map<string, T | null>();
  private ids = new Set<string>();
  private order: IdNode | null = null;
  private byId: PersistentMemoryNode<{ id: string; value: T | null }> | null = null;
  private random: () => number;
  private external: PublicationSourceSnapshot<T> | null = null;
  constructor(priority: number, random: () => number, ordinal: number) { this.priority = priority; this.random = random; this.ordinal = ordinal; }
  get size(): number { return this.external?.count ?? this.values.size; }
  get(id: string): T | null | undefined { return this.external ? this.external.get(id) : this.values.get(id); }
  *entries(): IterableIterator<[string, T | null]> { if (this.external) { for (const row of this.external.orderedRows()) yield [row.id, row.value]; } else yield* this.values.entries(); }
  adopt(source: PublicationSourceSnapshot<T>): void {
    if (!source.active() || source.priority !== this.priority || source.ordinal !== this.ordinal || !Number.isSafeInteger(source.count) || source.count < 0 || source.count > limits.documents) throw Error('semantic_write_unavailable');
    this.external = source; this.values.clear(); this.ids.clear(); this.order = this.byId = null;
  }
  capture(): SemanticWriteSourceSnapshot<T> {
    if (this.external) return this.external;
    const order = this.order, byId = this.byId;
    return Object.freeze({ priority: this.priority, count: this.size, *orderedRows() {
      for (const { id } of memoryNodeRange(order, 0, memoryNodeCount(order))) { const value = memoryNodeById(byId, id); if (!value) throw Error('semantic_write_unavailable'); yield value.value; }
    } });
  }
  private insert(id: string, index: number): void {
    if (this.ids.has(id) || index < 0 || index > memoryNodeCount(this.order)) throw Error('semantic_write_unavailable');
    const [left, right] = splitOrder(this.order, index); this.order = mergeMemoryNodes(mergeMemoryNodes(left, memoryNode({ id }, this.random())), right); this.ids.add(id);
  }
  private remove(id: string, index: number): void {
    if (memoryNodeAt(this.order, index)?.id !== id) throw Error('semantic_write_unavailable');
    const [left, rest] = splitOrder(this.order, index), [, right] = splitOrder(rest, 1); this.order = mergeMemoryNodes(left, right); this.ids.delete(id);
  }
  private setValue(id: string, value: T | null): void { this.values.set(id, value); this.byId = insertMemoryNode(this.byId, memoryNode(Object.freeze({ id, value }), this.random()), compareIds); }
  private removeValue(id: string): void { if (!this.values.has(id)) return; this.values.delete(id); this.byId = eraseMemoryNode(this.byId, id, compareIds); }
  apply(patch: MemoryPublicationPatch<T>): void {
    if (this.external) {
      // Membership reprojection changes the read scope, not these immutable raw rows.
      // A data mutation must adopt the publication's next version instead of rebuilding it here.
      if (this.external.active() && patch && Array.isArray(patch.changed) && patch.changed.length <= limits.documents && Array.isArray(patch.removed) && !patch.removed.length && patch.order && patch.order.reset === undefined && Array.isArray(patch.order.changes) && !patch.order.changes.length) {
        const seen = new Set<string>();
        for (const row of patch.changed) { if (!row || !semanticWriteId(row.id) || seen.has(row.id) || row.value !== null && (!row.value || typeof row.value !== 'object' || row.value.id !== row.id) || this.external.get(row.id) !== row.value) throw Error('semantic_write_unavailable'); seen.add(row.id); }
        return;
      }
      throw Error('semantic_write_unavailable');
    }
    if (!patch || !Array.isArray(patch.changed) || patch.changed.length > limits.documents || !Array.isArray(patch.removed) || patch.removed.length > limits.documents ||
        !patch.order || !Array.isArray(patch.order.changes) || patch.order.changes.length > limits.documents ||
        patch.order.reset !== undefined && (!Array.isArray(patch.order.reset) || patch.order.reset.length > limits.documents)) throw Error('semantic_write_unavailable');
    const affected = new Set<string>(), changed = new Set<string>();
    for (const row of patch.changed) {
      if (!row || !semanticWriteId(row.id) || changed.has(row.id) || row.value !== null &&
          (!row.value || typeof row.value !== 'object' || Array.isArray(row.value) || row.value.id !== row.id || !Number.isFinite(row.value.timestamp))) throw Error('semantic_write_unavailable');
      changed.add(row.id); affected.add(row.id);
    }
    const removed = new Set<string>();
    for (const id of patch.removed) { if (!semanticWriteId(id) || removed.has(id) || changed.has(id)) throw Error('semantic_write_unavailable'); removed.add(id); affected.add(id); }
    if (patch.order.reset !== undefined) {
      const values = this.values; this.order = this.byId = null; this.ids = new Set(); this.values = new Map();
      for (const id of patch.order.reset) { if (!semanticWriteId(id)) throw Error('semantic_write_unavailable'); this.insert(id, memoryNodeCount(this.order)); if (values.has(id)) this.setValue(id, values.get(id)!); affected.add(id); }
    }
    for (const move of patch.order.changes) {
      if (!move || !semanticWriteId(move.id) || !Number.isSafeInteger(move.oldIndex) || !Number.isSafeInteger(move.newIndex)) throw Error('semantic_write_unavailable');
      affected.add(move.id);
      if (move.type === 'added' && move.oldIndex === -1 && move.newIndex >= 0) this.insert(move.id, move.newIndex);
      else if ((move.type === 'removed' && move.newIndex === -1 || move.type === 'modified' && move.newIndex >= 0) && move.oldIndex >= 0) {
        this.remove(move.id, move.oldIndex); if (move.type === 'modified') this.insert(move.id, move.newIndex);
      } else throw Error('semantic_write_unavailable');
    }
    for (const id of affected) if (!this.ids.has(id)) this.removeValue(id);
    for (const row of patch.changed) { if (!this.ids.has(row.id)) throw Error('semantic_write_unavailable'); this.setValue(row.id, row.value); }
    for (const id of removed) if (this.ids.has(id)) throw Error('semantic_write_unavailable');
    for (const id of affected) if (this.ids.has(id) && !this.values.has(id)) throw Error('semantic_write_unavailable');
    if (this.values.size !== memoryNodeCount(this.order) || this.values.size > limits.documents) throw Error('semantic_write_unavailable');
  }
}
