import { MemoryViewOrder } from './memoryViewOrder';
import { memoryViewId, type MemoryViewPatchCounts } from './memoryViewProtocol';
import { OrbitGraph } from './orbitGraph';
import { freezeOrbitRecord, orbitLayoutUnavailable as fail, orbitRecordUnits, ORBIT_LAYOUT_LIMITS as limits, type OrbitFrame, type OrbitLayoutMessage, type OrbitRecord } from './orbitLayoutProtocol';

/** One acknowledged metadata patch at a time. The parent graph is reused between frame samples. */
export class OrbitLayoutIndex {
  private records = new Map<string, OrbitRecord>();
  private order = new MemoryViewOrder();
  private graph: OrbitGraph | null = null;
  private units = 0; private connections = 0; private initialized = false; private seq = 0;
  private patch: { reset: boolean; expected: MemoryViewPatchCounts; seen: Omit<MemoryViewPatchCounts, 'size'>; touched: Set<string>; changed: Set<string>; removed: Set<string> } | null = null;
  clear(): void { this.records.clear(); this.order.clear(); this.graph = null; this.units = this.connections = this.seq = 0; this.initialized = false; this.patch = null; }
  private remove(id: string): void { const row = this.records.get(id); if (row) { this.units -= orbitRecordUnits(row); this.connections -= row.connections.length; this.records.delete(id); } }
  handle(message: OrbitLayoutMessage): { ack: true } | { frame: OrbitFrame } {
    try {
      if (!message || message.v !== 1 || !Number.isSafeInteger(message.seq) || message.seq <= this.seq) throw fail(); this.seq = message.seq;
      if (message.type === 'patch-start' && !this.patch) {
        const { reset, preserve, counts } = message;
        if (typeof reset !== 'boolean' || typeof preserve !== 'boolean' || !counts || !['size', 'changed', 'removed', 'moves', 'order'].every(key => { const value = counts[key as keyof MemoryViewPatchCounts]; return Number.isSafeInteger(value) && value >= 0 && value <= (key === 'moves' ? 200_000 : limits.documents); }) ||
          reset === preserve || !reset && !this.initialized || reset && (counts.order !== counts.size || counts.changed !== counts.size || counts.moves || counts.removed) || !reset && counts.order) throw fail();
        if (!preserve) { this.records.clear(); this.units = this.connections = 0; } if (reset) this.order.clear(); this.graph = null;
        this.patch = { reset, expected: counts, seen: { changed: 0, removed: 0, moves: 0, order: 0 }, touched: new Set(), changed: new Set(), removed: new Set() };
      } else if (message.type === 'patch-chunk' && this.patch) {
        const frame = message.frame, keys = Object.keys(frame ?? {}), patch = this.patch;
        // Pair each baseline record with its canonical ID; one bounded message replaces two ACK/yield round trips.
        if (patch.reset) {
          const rows = frame?.changed, order = frame?.order;
          if (keys.sort().join(',') !== 'changed,order' || !Array.isArray(rows) || !Array.isArray(order) || rows.length < 1 || rows.length > limits.batch || rows.length !== order.length || patch.seen.changed + rows.length > patch.expected.changed || patch.seen.order + order.length > patch.expected.order) throw fail();
          for (let at = 0; at < rows.length; at++) {
            const row = freezeOrbitRecord(rows[at]); if (row.id !== order[at] || patch.changed.has(row.id)) throw fail();
            this.order.append(row.id); this.units += orbitRecordUnits(row); this.connections += row.connections.length;
            if (this.units > limits.units || this.connections > limits.connections) throw fail(); this.records.set(row.id, row); patch.changed.add(row.id); patch.touched.add(row.id);
          }
          patch.seen.changed += rows.length; patch.seen.order += order.length; return { ack: true };
        }
        if (keys.length !== 1 || !['moves', 'removed', 'changed'].includes(keys[0])) throw fail();
        const key = keys[0] as 'moves' | 'removed' | 'changed', rows = frame[key];
        if (!Array.isArray(rows) || rows.length < 1 || rows.length > limits.batch || patch.seen[key] + rows.length > patch.expected[key] || (key === 'removed' || key === 'changed') && patch.seen.moves !== patch.expected.moves || key === 'changed' && patch.seen.removed !== patch.expected.removed) throw fail();
        if (key === 'moves') { if (patch.seen.removed || patch.seen.changed) throw fail(); for (const move of frame.moves!) { this.order.move(move); patch.touched.add(move.id); } }
        else if (key === 'removed') { if (patch.seen.changed) throw fail(); for (const id of frame.removed!) { if (!memoryViewId(id) || patch.removed.has(id) || !this.records.has(id)) throw fail(); patch.removed.add(id); patch.touched.add(id); this.remove(id); } }
        else { for (const value of frame.changed!) {
          const row = freezeOrbitRecord(value); if (patch.changed.has(row.id) || patch.removed.has(row.id)) throw fail(); this.remove(row.id);
          this.units += orbitRecordUnits(row); this.connections += row.connections.length; if (this.units > limits.units || this.connections > limits.connections) throw fail(); this.records.set(row.id, row); patch.changed.add(row.id); patch.touched.add(row.id);
        } }
        patch.seen[key] += rows.length; if (this.records.size > limits.documents) throw fail();
      } else if (message.type === 'patch-end' && this.patch) {
        const patch = this.patch; if (!Object.keys(patch.seen).every(key => patch.seen[key as keyof typeof patch.seen] === patch.expected[key as keyof typeof patch.seen])) throw fail();
        if (this.order.size !== patch.expected.size || this.records.size !== patch.expected.size) throw fail(); for (const id of patch.touched) if (this.order.has(id) !== this.records.has(id)) throw fail(); this.patch = null; this.initialized = true;
      } else if (message.type === 'sample' && !this.patch && this.initialized) {
        if (!Array.isArray(message.ids) || message.ids.length > limits.sampleIds || !message.ids.every(id => memoryViewId(id) && this.records.has(id)) || new Set(message.ids).size !== message.ids.length || !Number.isFinite(message.time) || !Number.isFinite(message.now)) throw fail();
        if (!this.graph) { const records = this.records; this.graph = new OrbitGraph((function* (order: MemoryViewOrder) { for (const id of order.values()) yield records.get(id)!; })(this.order)); }
        return { frame: this.graph.sample(message.ids, message.time, message.now) };
      } else throw fail();
      return { ack: true };
    } catch { this.clear(); throw fail(); }
  }
}
