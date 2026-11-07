import type { MemoryObject } from '../types/universe';
import { getUniverseRenderBudget } from '../engines/celestialLayout';
import { memoryViewId, type MemoryViewOptions, type MemoryViewRecord, type MemoryViewRequest } from './memoryViewProtocol';

export interface MemoryViewResult { memories: MemoryObject[]; lookup: Map<string, MemoryObject>; count: number }
const unavailable = () => new Error('memory_view_unavailable');
export class MemoryViewClient {
  private mode: MemoryViewOptions['mode'];
  private createWorker: () => Worker;
  private yieldTask: () => Promise<void>;
  private worker: Worker | null = null;
  private references = new Map<string, MemoryObject>();
  private source: MemoryObject[] | null = null;
  private generation = 0;
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
    this.references.clear(); this.source = null; pending?.reject();
  }
  private project(row: MemoryObject): MemoryViewRecord {
    return { id: row.id, timestamp: this.mode === 'list' ? row.timestamp : 0,
      updatedAt: this.mode === 'scene' ? row.updatedAt : 0, importance: this.mode === 'scene' ? row.importance || .5 : .5,
      taxonomyLane: this.mode === 'scene' ? row.taxonomyLane ?? null : null,
      fields: this.mode === 'list' ? [row.title, row.encLocked ? '' : row.text, row.category, ...(row.tags ?? [])]
        .filter((value): value is string => typeof value === 'string') : [],
      connections: this.mode === 'scene' ? [...row.connections] : [] };
  }
  private request(message: MemoryViewRequest): Promise<unknown> {
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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(), 30_000);
      this.pending = { id: message.id, resolve: value => { clearTimeout(timer); resolve(value); },
        reject: () => { clearTimeout(timer); reject(unavailable()); } };
      try { this.worker!.postMessage(message); } catch { this.dispose(); }
    });
  }
  /** Compare immutable object references in bounded tasks; only changed projections cross the Worker boundary. */
  async select(memories: MemoryObject[], options: MemoryViewOptions, signal: AbortSignal): Promise<MemoryViewResult> {
    if (this.busy) this.dispose();
    const generation = this.generation;
    const current = () => !signal.aborted && generation === this.generation;
    const abort = () => { if (generation === this.generation) this.dispose(); };
    this.busy = true; signal.addEventListener('abort', abort, { once: true });
    try {
      if (!current() || options.mode !== this.mode) throw unavailable();
      if (memories.length === 0) { this.dispose(); return { memories: [], lookup: new Map(), count: 0 }; }
      let lookup = this.references; const changed: MemoryViewRecord[] = []; let order: string[] | undefined;
      if (memories !== this.source) {
        lookup = new Map(); order = [];
        for (let i = 0; i < memories.length; i++) {
          const row = memories[i];
          if (!row || !memoryViewId(row.id) || lookup.has(row.id)) throw unavailable();
          lookup.set(row.id, row); order.push(row.id);
          if (this.references.get(row.id) !== row) changed.push(this.project(row));
          if ((i + 1) % 256 === 0 && i + 1 < memories.length) { await this.yieldTask(); if (!current()) throw unavailable(); }
        }
      }
      if (!current()) throw unavailable();
      const id = ++this.sequence, response = await this.request({ v: 1, id, changed, ...(order ? { order } : {}), options, now: Date.now() });
      if (!current() || !response || typeof response !== 'object') throw unavailable();
      const result = response as Record<string, unknown>;
      if (result.v !== 1 || result.id !== id || result.ok !== true || !Number.isSafeInteger(result.count) ||
          (result.count as number) < 0 || (result.count as number) > lookup.size || !Array.isArray(result.ids)) throw unavailable();
      const limit = options.mode === 'list' ? options.limit : getUniverseRenderBudget(result.count as number).maxObjects;
      if (result.ids.length !== Math.min(result.count as number, limit)) throw unavailable();
      const seen = new Set<string>(), selected: MemoryObject[] = [], filtered = options.mode === 'scene' && options.filteredIds !== null ? new Set(options.filteredIds) : null;
      for (const selectedId of result.ids) {
        if (!memoryViewId(selectedId) || seen.has(selectedId)) throw unavailable();
        const row = lookup.get(selectedId);
        if (!row || options.mode === 'scene' && (filtered && !filtered.has(selectedId) || options.taxonomy && row.taxonomyLane !== options.taxonomy)) throw unavailable();
        seen.add(selectedId); selected.push(row);
      }
      this.references = lookup; this.source = memories;
      return { memories: selected, lookup, count: result.count as number };
    } catch { if (generation === this.generation) this.dispose(); throw unavailable(); }
    finally { signal.removeEventListener('abort', abort); if (generation === this.generation) this.busy = false; }
  }
}
