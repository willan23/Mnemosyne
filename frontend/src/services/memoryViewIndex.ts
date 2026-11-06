import { getRenderPriority, getUniverseRenderBudget } from '../engines/celestialLayout';
import { memoryViewId, type MemoryViewOptions, type MemoryViewRecord, type MemoryViewRequest, type MemoryViewSelection } from './memoryViewProtocol';

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
  private order: string[] | null = null;
  private normalized = new Map<string, string[]>();
  private locale = '';
  clear(): void { this.records.clear(); this.normalized.clear(); this.order = null; this.locale = ''; }
  handle(input: MemoryViewRequest): MemoryViewSelection {
    try {
      if (!input || input.v !== 1 || !Number.isSafeInteger(input.id) || input.id < 1 || !Number.isFinite(input.now) || !Array.isArray(input.changed)) throw fail();
      this.validateOptions(input.options);
      const ids = new Set<string>();
      for (const row of input.changed) {
        if (!row || !memoryViewId(row.id) || ids.has(row.id) || !Number.isFinite(row.timestamp) || !Number.isFinite(row.updatedAt) ||
            !Number.isFinite(row.importance) || !strings(row.fields) || !strings(row.connections) ||
            row.taxonomyLane !== null && typeof row.taxonomyLane !== 'string') throw fail();
        ids.add(row.id); this.records.set(row.id, row); this.normalized.delete(row.id);
      }
      if (input.order !== undefined) {
        if (!Array.isArray(input.order) || !input.order.every(memoryViewId)) throw fail();
        const present = new Set(input.order);
        if (present.size !== input.order.length || input.order.some(id => !this.records.has(id)) || [...ids].some(id => !present.has(id))) throw fail();
        for (const id of this.records.keys()) if (!present.has(id)) { this.records.delete(id); this.normalized.delete(id); }
        this.order = input.order;
      }
      if (!this.order || this.records.size !== this.order.length) throw fail();
      return input.options.mode === 'list' ? this.list(input.options) : this.scene(input.options, input.now);
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
    const needle = options.query.trim().toLocaleLowerCase(options.locale), ranked: Ranked[] = [];
    for (let ordinal = 0; ordinal < this.order!.length; ordinal++) {
      const id = this.order![ordinal], row = this.records.get(id)!;
      if (needle) {
        let fields = this.normalized.get(id);
        if (!fields) { fields = row.fields.map(value => value.toLocaleLowerCase(options.locale)); this.normalized.set(id, fields); }
        if (!fields.some(value => value.includes(needle))) continue;
      }
      ranked.push({ id, score: row.timestamp, ordinal });
    }
    return { count: ranked.length, ids: top(ranked, options.limit, (a, b) => b.score - a.score || a.ordinal - b.ordinal) };
  }
  private scene(options: Extract<MemoryViewOptions, { mode: 'scene' }>, now: number): MemoryViewSelection {
    const filtered = options.filteredIds === null ? null : new Set(options.filteredIds);
    const eligible = this.order!.filter(id => {
      const row = this.records.get(id)!;
      return (!options.taxonomy || row.taxonomyLane === options.taxonomy) && (!filtered || filtered.has(id));
    });
    const limit = getUniverseRenderBudget(eligible.length).maxObjects;
    if (eligible.length <= limit) return { count: eligible.length, ids: eligible };
    const active = options.activeId && eligible.includes(options.activeId) ? this.records.get(options.activeId) : null;
    const connections = new Set(active?.connections ?? []), records = this.records;
    function* ranked() { for (let ordinal = 0; ordinal < eligible.length; ordinal++) { const id = eligible[ordinal];
      yield { id, ordinal, score: getRenderPriority(records.get(id)!, options.activeId, connections, now) }; } }
    return { count: eligible.length, ids: top(ranked(), limit, (a, b) => b.score - a.score || a.id.localeCompare(b.id)) };
  }
}
