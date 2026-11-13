import { getRenderPriority, getUniverseRenderBudget } from '../engines/celestialLayout';
import { memoryViewId, MEMORY_VIEW_LIMITS as limits, type MemoryViewOptions, type MemoryViewRecord, type MemoryViewRequest, type MemoryViewSelection, type MemoryViewPatchCounts, type MemoryViewPatchFrame } from './memoryViewProtocol';
import { MemoryViewOrder } from './memoryViewOrder';

const fail = () => new Error('memory_view_unavailable');
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
type Ranked = { id: string; score: number; ordinal: number };

/** A worst-first heap keeps only the requested page/render budget. */
function top(rows: Iterable<Ranked>, limit: number, compare: (a: Ranked, b: Ranked) => number): string[] {
  const heap: Ranked[] = [];
  for (const row of rows) {
    if (heap.length < limit) {
      heap.push(row); let i = heap.length - 1;
      while (i > 0) { const parent = (i - 1) >>> 1; if (compare(heap[i], heap[parent]) <= 0) break; [heap[i], heap[parent]] = [heap[parent], heap[i]]; i = parent; }
    } else if (compare(row, heap[0]) < 0) {
      heap[0] = row; let i = 0;
      for (;;) { const left = 2 * i + 1, right = left + 1; let worst = i;
        if (left < heap.length && compare(heap[left], heap[worst]) > 0) worst = left;
        if (right < heap.length && compare(heap[right], heap[worst]) > 0) worst = right;
        if (worst === i) break; [heap[i], heap[worst]] = [heap[worst], heap[i]]; i = worst;
      }
    }
  }
  return heap.sort(compare).map(row => row.id);
}

/** Worker-owned projection only. No embeddings, ciphertext, identity or persistence. */
export class MemoryViewIndex {
  private records = new Map<string, MemoryViewRecord>();
  private order = new MemoryViewOrder();
  private initialized = false;
  private patch: { reset: boolean; expected: MemoryViewPatchCounts; seen: Omit<MemoryViewPatchCounts, 'size'>; touched: Set<string>; changed: Set<string>; removed: Set<string>; pruned: boolean } | null = null;
  private normalized = new Map<string, string[]>();
  private locale = '';
  clear(): void { this.records.clear(); this.normalized.clear(); this.order.clear(); this.locale = ''; this.patch = null; this.initialized = false; }
  begin(reset: boolean, preserve: boolean, counts: MemoryViewPatchCounts): void {
    if (this.patch || typeof reset !== 'boolean' || typeof preserve !== 'boolean' || !counts || !['size', 'changed', 'removed', 'moves', 'order'].every(key => {
      const value = counts[key as keyof MemoryViewPatchCounts]; return Number.isSafeInteger(value) && value >= 0 && value <= (key === 'moves' ? limits.changes : limits.documents);
    }) || !reset && (!preserve || !this.initialized) || reset && (counts.order !== counts.size || counts.moves !== 0 || counts.removed !== 0) || !reset && counts.order !== 0 || !preserve && !reset) throw fail();
    if (!preserve) { this.records.clear(); this.normalized.clear(); }
    if (reset) this.order.clear();
    this.patch = { reset, expected: counts, seen: { changed: 0, removed: 0, moves: 0, order: 0 }, touched: new Set(), changed: new Set(), removed: new Set(), pruned: !reset };
  }
  private prune(): void {
    const patch = this.patch!; if (patch.pruned) return;
    for (const id of this.records.keys()) if (!this.order.has(id)) { this.records.delete(id); this.normalized.delete(id); }
    patch.pruned = true;
  }
  chunk(frame: MemoryViewPatchFrame): void {
    const patch = this.patch;
    if (!patch || !frame || typeof frame !== 'object') throw fail();
    const keys = Object.keys(frame); if (keys.length !== 1 || !['changed', 'removed', 'moves', 'order'].includes(keys[0])) throw fail();
    const key = keys[0] as keyof MemoryViewPatchFrame, rows = frame[key];
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > limits.batch || patch.seen[key] + rows.length > patch.expected[key]) throw fail();
    if (key !== 'order' && patch.seen.order !== patch.expected.order || (key === 'removed' || key === 'changed') && patch.seen.moves !== patch.expected.moves || key === 'changed' && patch.seen.removed !== patch.expected.removed) throw fail();
    if (key === 'order') {
      if (!patch.reset || patch.seen.moves || patch.seen.removed || patch.seen.changed) throw fail();
      for (const id of frame.order!) { this.order.append(id); patch.touched.add(id); }
    } else if (key === 'moves') {
      if (patch.seen.removed || patch.seen.changed) throw fail();
      for (const move of frame.moves!) { this.order.move(move); patch.touched.add(move.id); }
    } else if (key === 'removed') {
      if (patch.seen.changed) throw fail(); this.prune();
      for (const id of frame.removed!) { if (!memoryViewId(id) || patch.removed.has(id) || !this.records.has(id)) throw fail(); patch.removed.add(id); patch.touched.add(id); this.records.delete(id); this.normalized.delete(id); }
    } else {
      this.prune();
      for (const row of frame.changed!) {
        if (!row || !memoryViewId(row.id) || patch.changed.has(row.id) || patch.removed.has(row.id) || !Number.isFinite(row.timestamp) || !Number.isFinite(row.updatedAt) ||
          !Number.isFinite(row.importance) || !strings(row.fields) || !strings(row.connections) || row.taxonomyLane !== null && typeof row.taxonomyLane !== 'string') throw fail();
        patch.changed.add(row.id); patch.touched.add(row.id); this.records.set(row.id, row); this.normalized.delete(row.id);
      }
    }
    patch.seen[key] += rows.length;
    if (this.records.size > limits.documents) throw fail();
  }
  commit(): void {
    const patch = this.patch;
    if (!patch || !Object.keys(patch.seen).every(key => patch.seen[key as keyof typeof patch.seen] === patch.expected[key as keyof typeof patch.seen])) throw fail();
    this.prune();
    if (this.records.size !== patch.expected.size || this.order.size !== patch.expected.size) throw fail();
    for (const id of patch.touched) if (this.records.has(id) !== this.order.has(id)) throw fail();
    this.patch = null; this.initialized = true;
  }
  query(options: MemoryViewOptions, now: number): MemoryViewSelection {
    if (!this.initialized || this.patch || !Number.isFinite(now)) throw fail(); this.validateOptions(options);
    return options.mode === 'list' ? this.list(options) : this.scene(options, now);
  }
  handle(input: MemoryViewRequest): MemoryViewSelection {
    try {
      if (!input || input.v !== 1 || !Number.isSafeInteger(input.id) || input.id < 1 || !Number.isFinite(input.now) || !Array.isArray(input.changed)) throw fail();
      if (input.order !== undefined && !Array.isArray(input.order)) throw fail();
      this.begin(input.order !== undefined, this.initialized, { size: input.order?.length ?? this.order.size, order: input.order?.length ?? 0, changed: input.changed.length, removed: 0, moves: 0 });
      for (let index = 0; index < (input.order?.length ?? 0); index += limits.batch) this.chunk({ order: input.order!.slice(index, index + limits.batch) });
      for (let index = 0; index < input.changed.length; index += limits.batch) this.chunk({ changed: input.changed.slice(index, index + limits.batch) });
      this.commit(); return this.query(input.options, input.now);
    } catch { this.clear(); throw fail(); }
  }
  private validateOptions(options: MemoryViewOptions): void {
    if (!options || typeof options !== 'object') throw fail();
    if (options.mode === 'list') {
      if (typeof options.query !== 'string' || !['pt-PT', 'pt-BR', 'en', 'fr'].includes(options.locale) || typeof options.locale !== 'string' ||
          !Number.isSafeInteger(options.limit) || options.limit < 1) throw fail();
    } else if (options.mode === 'scene') {
      if (options.activeId !== null && !memoryViewId(options.activeId) || options.taxonomy !== null && typeof options.taxonomy !== 'string' ||
          options.filteredIds !== null && (!Array.isArray(options.filteredIds) || !options.filteredIds.every(memoryViewId))) throw fail();
    } else throw fail();
  }
  private list(options: Extract<MemoryViewOptions, { mode: 'list' }>): MemoryViewSelection {
    if (this.locale !== options.locale) { this.normalized.clear(); this.locale = options.locale; }
    const needle = options.query.trim().toLocaleLowerCase(options.locale), records = this.records, normalized = this.normalized, order = this.order;
    let count = 0;
    function* ranked(): IterableIterator<Ranked> {
      let ordinal = 0;
      for (const id of order.values()) {
        const position = ordinal++, row = records.get(id)!;
        if (needle) {
          let fields = normalized.get(id);
          if (!fields) { fields = row.fields.map(value => value.toLocaleLowerCase(options.locale)); normalized.set(id, fields); }
          if (!fields.some(value => value.includes(needle))) continue;
        }
        count++; yield { id, score: row.timestamp, ordinal: position };
      }
    }
    const ids = top(ranked(), options.limit, (a, b) => b.score - a.score || a.ordinal - b.ordinal); return { count, ids };
  }
  private scene(options: Extract<MemoryViewOptions, { mode: 'scene' }>, now: number): MemoryViewSelection {
    const filtered = options.filteredIds === null ? null : new Set(options.filteredIds);
    const eligible = (id: string) => {
      const row = this.records.get(id)!;
      return (!options.taxonomy || row.taxonomyLane === options.taxonomy) && (!filtered || filtered.has(id));
    };
    let count = 0; for (const id of this.order.values()) if (eligible(id)) count++;
    const limit = getUniverseRenderBudget(count).maxObjects;
    if (count <= limit) { const ids: string[] = []; for (const id of this.order.values()) if (eligible(id)) ids.push(id); return { count, ids }; }
    const active = options.activeId && this.order.has(options.activeId) && eligible(options.activeId) ? this.records.get(options.activeId) : null;
    const connections = new Set(active?.connections ?? []), records = this.records, order = this.order;
    function* ranked() { let ordinal = 0; for (const id of order.values()) if (eligible(id)) yield { id, ordinal: ordinal++, score: getRenderPriority(records.get(id)!, options.activeId, connections, now) }; }
    return { count, ids: top(ranked(), limit, (a, b) => b.score - a.score || a.id.localeCompare(b.id)) };
  }
}
