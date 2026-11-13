import type { MemoryObject } from '../types/universe';
import { getUniverseRenderBudget } from '../engines/celestialLayout';
import { isMemorySnapshot, memoryById, memorySnapshotDelta, memorySnapshotScopeActive } from './memorySnapshot';
import { memoryViewId, MEMORY_VIEW_LIMITS as limits, type MemoryViewOptions, type MemoryViewRecord, type MemoryViewMessage, type MemoryViewPatchFrame } from './memoryViewProtocol';

export interface MemoryViewResult { memories: MemoryObject[]; lookup: ReadonlyMap<string, MemoryObject>; count: number }
const unavailable = () => new Error('memory_view_unavailable');
type Message = MemoryViewMessage extends infer M ? M extends { id: number } ? Omit<M, 'id' | 'v'> : never : never;

/** Keyed snapshot access needs no copied Map. Resumed iterators also check retirement. */
function lookupView(source: readonly MemoryObject[], native: ReadonlyMap<string, MemoryObject> | null, active: () => boolean): ReadonlyMap<string, MemoryObject> {
  const live = () => active() && memorySnapshotScopeActive(source);
  function* entries(): MapIterator<[string, MemoryObject]> {
    if (!live()) return;
    if (native) { for (const entry of native) { if (!live()) return; yield entry; } }
    else for (const row of source) { if (!live()) return; yield [row.id, row]; }
  }
  const result: ReadonlyMap<string, MemoryObject> = Object.freeze({
    get size() { return live() ? source.length : 0; },
    get: (id: string) => live() ? native ? native.get(id) : memoryById(source, id) : undefined,
    has: (id: string) => live() && (native ? native.has(id) : Boolean(memoryById(source, id))),
    entries, [Symbol.iterator]: entries, [Symbol.toStringTag]: 'Map',
    *keys(): MapIterator<string> { for (const [id] of entries()) yield id; },
    *values(): MapIterator<MemoryObject> { for (const [, row] of entries()) yield row; },
    forEach(callback: (value: MemoryObject, key: string, map: ReadonlyMap<string, MemoryObject>) => void, thisArg?: unknown) {
      for (const [id, row] of entries()) callback.call(thisArg, row, id, result);
    },
  });
  return result;
}

export class MemoryViewClient {
  private mode: MemoryViewOptions['mode'];
  private createWorker: () => Worker;
  private yieldTask: () => Promise<void>;
  private worker: Worker | null = null;
  private references = new Map<string, MemoryObject>();
  private source: readonly MemoryObject[] | null = null;
  private filterSource: string[] | null | undefined;
  private filterSet: Set<string> | null = null;
  private generation = 0;
  private lookupEpoch = 0;
  private sequence = 0;
  private busy = false;
  private pending: { id: number; resolve: (value: unknown) => void; reject: () => void } | null = null;
  constructor(mode: MemoryViewOptions['mode'], options: { createWorker?: () => Worker; yieldTask?: () => Promise<void> } = {}) {
    this.mode = mode;
    this.createWorker = options.createWorker ?? (() => new Worker(new URL('./memoryViewWorker.ts', import.meta.url), { type: 'module' }));
    this.yieldTask = options.yieldTask ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
  }
  dispose(): void {
    this.generation++; this.busy = false;
    const pending = this.pending; this.pending = null;
    this.worker?.terminate(); this.worker = null;
    this.references.clear(); this.source = null; this.filterSource = undefined; this.filterSet = null; pending?.reject();
  }
  private project(row: MemoryObject): MemoryViewRecord {
    return { id: row.id, timestamp: this.mode === 'list' ? row.timestamp : 0,
      updatedAt: this.mode === 'scene' ? row.updatedAt : 0, importance: this.mode === 'scene' ? row.importance || .5 : .5,
      taxonomyLane: this.mode === 'scene' ? row.taxonomyLane ?? null : null,
      fields: this.mode === 'list' ? [...(row.encLocked ? [] : [row.title, row.text]), row.category, ...(row.tags ?? [])]
        .filter((value): value is string => typeof value === 'string') : [],
      connections: this.mode === 'scene' ? [...row.connections] : [] };
  }
  private request(message: Message): Promise<unknown> {
    if (!this.worker) {
      const worker = this.createWorker(); this.worker = worker;
      worker.onmessage = event => {
        if (this.worker !== worker) return;
        const pending = this.pending;
        if (!pending || event.data?.id !== pending.id) { this.dispose(); return; }
        this.pending = null; pending.resolve(event.data);
      };
      worker.onerror = worker.onmessageerror = () => { if (this.worker === worker) this.dispose(); };
    }
    const worker = this.worker, id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.worker === worker && this.pending?.id === id) this.dispose(); }, 30_000);
      this.pending = { id, resolve: value => { clearTimeout(timer); resolve(value); }, reject: () => { clearTimeout(timer); reject(unavailable()); } };
      try { worker.postMessage({ ...message, v: 2, id } satisfies MemoryViewMessage); } catch { this.dispose(); }
    });
  }
  private async exchange(message: Message, guard: () => void, acknowledgement: boolean): Promise<Record<string, unknown>> {
    guard(); const response = await this.request(message), id = this.sequence; guard();
    if (!response || typeof response !== 'object') throw unavailable(); const result = response as Record<string, unknown>;
    if (result.v !== 2 || result.id !== id || result.ok !== true || (acknowledgement ? result.ack !== true || result.ids !== undefined || result.count !== undefined : result.ack !== undefined)) throw unavailable();
    return result;
  }
  private async frame(frame: MemoryViewPatchFrame, guard: () => void): Promise<void> {
    await this.exchange({ type: 'patch-chunk', frame }, guard, true); await this.yieldTask(); guard();
  }
  private async rows(rows: Iterable<MemoryObject>, guard: () => void): Promise<void> {
    let changed: MemoryViewRecord[] = [], units = 0;
    for (const row of rows) {
      guard(); const value = this.project(row), size = value.id.length + value.fields.reduce((sum, field) => sum + field.length, 0) + value.connections.reduce((sum, id) => sum + id.length, 0);
      if (changed.length && (changed.length === limits.batch || units + size > limits.targetChunkUnits)) { await this.frame({ changed }, guard); changed = []; units = 0; }
      changed.push(value); units += size;
    }
    if (changed.length) await this.frame({ changed }, guard);
  }
  async select(memories: readonly MemoryObject[], options: MemoryViewOptions, signal: AbortSignal): Promise<MemoryViewResult> {
    if (this.busy || this.source && !memorySnapshotScopeActive(this.source)) this.dispose();
    const generation = this.generation, lookupEpoch = ++this.lookupEpoch;
    const guard = () => { if (signal.aborted || generation !== this.generation || !memorySnapshotScopeActive(memories)) throw unavailable(); };
    const abort = () => { if (generation === this.generation) this.dispose(); };
    this.busy = true; signal.addEventListener('abort', abort, { once: true });
    try {
      guard(); if (options.mode !== this.mode || memories.length > limits.documents) throw unavailable();
      if (!memories.length) { this.dispose(); return { memories: [], lookup: new Map(), count: 0 }; }
      const snapshot = isMemorySnapshot(memories); let native: Map<string, MemoryObject> | null = snapshot ? null : this.references;
      if (memories !== this.source) {
        const delta = memorySnapshotDelta(this.source, memories);
        if (delta) {
          await this.exchange({ type: 'patch-start', reset: false, preserve: true, counts: { size: memories.length, changed: delta.changed.length, removed: delta.removed.length, moves: delta.order.length, order: 0 } }, guard, true);
          for (let index = 0; index < delta.order.length; index += limits.batch) await this.frame({ moves: delta.order.slice(index, index + limits.batch) }, guard);
          for (let index = 0; index < delta.removed.length; index += limits.batch) await this.frame({ removed: delta.removed.slice(index, index + limits.batch) }, guard);
          await this.rows(delta.changed, guard);
        } else if (snapshot) {
          await this.exchange({ type: 'patch-start', reset: true, preserve: false, counts: { size: memories.length, changed: memories.length, removed: 0, moves: 0, order: memories.length } }, guard, true);
          let order: string[] = [];
          for (const row of memories) { guard(); order.push(row.id); if (order.length === limits.batch) { await this.frame({ order }, guard); order = []; } }
          if (order.length) await this.frame({ order }, guard);
          await this.rows(memories, guard);
        } else {
          const preserve = this.source !== null && !isMemorySnapshot(this.source), changed: MemoryObject[] = [], order: string[] = []; native = new Map();
          for (const row of memories) {
            guard(); if (!row || !memoryViewId(row.id) || native.has(row.id)) throw unavailable(); native.set(row.id, row); order.push(row.id);
            if (!preserve || this.references.get(row.id) !== row) changed.push(row);
            if (order.length % 256 === 0 && order.length < memories.length) { await this.yieldTask(); guard(); }
          }
          await this.exchange({ type: 'patch-start', reset: true, preserve, counts: { size: memories.length, changed: changed.length, removed: 0, moves: 0, order: order.length } }, guard, true);
          for (let index = 0; index < order.length; index += limits.batch) await this.frame({ order: order.slice(index, index + limits.batch) }, guard);
          await this.rows(changed, guard);
        }
        await this.exchange({ type: 'patch-end' }, guard, true);
      }
      const filter = options.mode !== 'list' ? options.filteredIds : undefined, reuse = options.mode !== 'list' && this.filterSource !== undefined && filter === this.filterSource;
      if (options.mode === 'related' && filter == null) throw unavailable();
      const filtered = reuse ? this.filterSet : filter ? new Set<string>() : null;
      if (filter && filter.length > limits.documents) throw unavailable();
      await this.exchange({ type: 'query-start', options: options.mode !== 'list' ? { ...options, filteredIds: null } : options, now: Date.now(), filteredCount: reuse || filter === undefined || filter === null ? null : filter.length, reuseFilter: reuse }, guard, true);
      if (!reuse && filter) for (let index = 0; index < filter.length; index += limits.batch) {
        const ids = filter.slice(index, index + limits.batch); for (const id of ids) { if (!memoryViewId(id)) throw unavailable(); filtered!.add(id); }
        await this.exchange({ type: 'filter-chunk', ids }, guard, true); await this.yieldTask(); guard();
      }
      const result = await this.exchange({ type: 'query-end' }, guard, false);
      const lookup = lookupView(memories, native, () => generation === this.generation && lookupEpoch === this.lookupEpoch);
      if (!Number.isSafeInteger(result.count) || (result.count as number) < 0 || (result.count as number) > memories.length || !Array.isArray(result.ids)) throw unavailable();
      const limit = options.mode === 'scene' ? getUniverseRenderBudget(result.count as number).maxObjects : options.limit;
      if (options.mode === 'related' && (!filtered || (result.count as number) > filtered.size)) throw unavailable();
      if (result.ids.length !== Math.min(result.count as number, limit)) throw unavailable();
      const seen = new Set<string>(), selected: MemoryObject[] = [];
      for (const id of result.ids) {
        if (!memoryViewId(id) || seen.has(id)) throw unavailable(); const row = lookup.get(id);
        if (!row || options.mode !== 'list' && filtered && !filtered.has(id) || options.mode === 'scene' && options.taxonomy && row?.taxonomyLane !== options.taxonomy) throw unavailable();
        seen.add(id); selected.push(row);
      }
      this.references = native ?? new Map(); this.source = memories; this.filterSource = filter; this.filterSet = filtered;
      return { memories: selected, lookup, count: result.count as number };
    } catch { if (generation === this.generation) this.dispose(); throw unavailable(); }
    finally { signal.removeEventListener('abort', abort); if (generation === this.generation) this.busy = false; }
  }
}
