import type { SessionData } from '../hooks/useSessions';
import { isPersonalSemanticCandidate } from './personalSemanticScope';
import { projectSearchDocument, validSearchId, HYBRID_SEARCH_LIMITS } from './hybridSearchProtocol';
import { CAPTURE_PREVIEW_LIMITS as limits, type CapturePreviewRequest, type CapturePreviewOrderMove } from './capturePreviewIndex';
import { memoryById, memorySnapshotDelta, memorySnapshotScopeActive } from './memorySnapshot';

export interface CapturePreviewScope { key: string; uid: string; teamId?: string }
export interface CapturePreviewResult { memory: SessionData; score: number }
export function capturePreviewEligible(row: SessionData, scope: CapturePreviewScope): boolean {
  return scope.teamId ? row.teamId === scope.teamId && !row.teamScopeAmbiguous && !row.encLocked && !row.deletedAt : isPersonalSemanticCandidate(row, scope.uid);
}
const unavailable = () => new Error('capture_preview_unavailable');
const cancelled = Symbol('capture_preview_cancelled');
export class CapturePreviewClient {
  private references = new Map<string, SessionData>();
  private source: readonly SessionData[] | null = null;
  private worker: Worker | null = null;
  private pending: { resolve: (value: unknown) => void; reject: () => void } | null = null;
  private generation = 0;
  private sequence = 0;
  private tail: Promise<void> | null = null;
  private scope: CapturePreviewScope;
  private options: { createWorker?: () => Worker; yieldTask?: () => Promise<void> };
  constructor(scope: CapturePreviewScope, options: { createWorker?: () => Worker; yieldTask?: () => Promise<void> } = {}) { this.scope = Object.freeze({ ...scope }); this.options = options; }
  dispose(): void {
    this.generation++; this.tail = null;
    this.worker?.terminate(); this.worker = null;
    this.references.clear(); this.source = null;
    const pending = this.pending; this.pending = null; pending?.reject();
  }
  private exchange(message: CapturePreviewRequest): Promise<unknown> {
    if (!this.worker) this.worker = this.options.createWorker?.() ?? new Worker(new URL('./capturePreviewWorker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(), 30_000);
      const cleanup = () => { clearTimeout(timer); worker.onmessage = worker.onerror = worker.onmessageerror = null; this.pending = null; };
      this.pending = { resolve: value => { cleanup(); resolve(value); }, reject: () => { cleanup(); reject(unavailable()); } };
      worker.onerror = worker.onmessageerror = () => this.dispose();
      worker.onmessage = event => { if (this.worker === worker) this.pending?.resolve(event.data); };
      try { worker.postMessage(message); } catch { this.dispose(); }
    });
  }
  select(source: readonly SessionData[], query: string, signal: AbortSignal): Promise<CapturePreviewResult[]> {
    const generation = this.generation, run = () => this.selectCurrent(source, query, signal, generation);
    // Superseded queries may finish a transfer, keeping a coherent index for the next draft.
    // Key/scope disposal still rejects the outstanding exchange immediately.
    const result = this.tail ? this.tail.then(run) : run();
    const tail = result.then(() => {}, () => {}); this.tail = tail;
    void tail.then(() => { if (this.tail === tail) this.tail = null; });
    return result;
  }
  private async selectCurrent(source: readonly SessionData[], query: string, signal: AbortSignal, generation: number): Promise<CapturePreviewResult[]> {
    const scopeGuard = () => { if (generation !== this.generation || !memorySnapshotScopeActive(source)) throw unavailable(); };
    const guard = () => { scopeGuard(); if (signal.aborted) throw cancelled; };
    try {
      guard();
      if (typeof query !== 'string' || query.length > limits.queryChars || source.length > HYBRID_SEARCH_LIMITS.documents) throw unavailable();
      if (query.trim().length < 12 && !this.worker) return [];
      const changed: ReturnType<typeof projectSearchDocument>[] = [], removed = new Set<string>(), updates = new Map<string, SessionData>();
      let next = this.references, order: Array<string | null> | undefined, moves: CapturePreviewOrderMove[] | undefined;
      if (source !== this.source) {
        const delta = memorySnapshotDelta(this.source, source);
        if (delta) {
          for (const id of delta.removed) removed.add(id);
          for (let index = 0; index < delta.changed.length; index++) {
            const row = delta.changed[index]; guard();
            // ACL precedes plaintext projection, including getters on excluded records.
            if (capturePreviewEligible(row, this.scope)) {
              if (!validSearchId(row.id)) throw unavailable();
              updates.set(row.id, row); changed.push(projectSearchDocument(row));
            } else removed.add(row.id);
            if ((index + 1) % limits.batchSize === 0) { await this.yieldTask(); guard(); }
          }
          moves = [];
          for (let index = 0; index < delta.order.length; index++) {
            const move = delta.order[index]; guard();
            if (move.type === 'removed') moves.push({ type: 'removed', index: move.oldIndex });
            else {
              const row = memoryById(source, move.id), allowed = row && capturePreviewEligible(row, this.scope);
              if (allowed && !validSearchId(move.id)) throw unavailable();
              moves.push({ type: 'added', index: move.newIndex, id: allowed ? move.id : null });
            }
            if ((index + 1) % limits.batchSize === 0) { await this.yieldTask(); guard(); }
          }
        } else {
          next = new Map(); order = [];
          for (let index = 0; index < source.length; index++) {
            const row = source[index]; guard();
            if (capturePreviewEligible(row, this.scope)) {
              if (!validSearchId(row.id) || next.has(row.id)) throw unavailable();
              next.set(row.id, row); order.push(row.id);
              if (this.references.get(row.id) !== row) changed.push(projectSearchDocument(row));
            } else order.push(null);
            if ((index + 1) % limits.batchSize === 0 && index + 1 < source.length) { await this.yieldTask(); guard(); }
          }
        }
      }
      guard(); const id = ++this.sequence;
      const response = await this.exchange({ v: 1, id, changed, ...(removed.size ? { removed: [...removed].filter(id => this.references.has(id)) } : {}), ...(order ? { order } : {}), ...(moves ? { moves } : {}), query });
      // Validate and commit even when the draft changed while the Worker was running.
      // Malformed replies and retired keys must never become a reusable index.
      scopeGuard();
      if (!response || typeof response !== 'object') throw unavailable(); const result = response as Record<string, unknown>;
      if (result.v !== 1 || result.id !== id || result.ok !== true || !Array.isArray(result.hits) || result.hits.length > limits.hits) throw unavailable();
      const seen = new Set<string>(); let previous = Infinity;
      const hits = result.hits.map(hit => {
        if (!hit || typeof hit !== 'object' || !validSearchId(hit.id) || seen.has(hit.id) || typeof hit.score !== 'number' || !Number.isFinite(hit.score) || hit.score < .12 || hit.score > previous) throw unavailable();
        const memory = removed.has(hit.id) ? undefined : updates.get(hit.id) ?? next.get(hit.id);
        if (!memory || !capturePreviewEligible(memory, this.scope)) throw unavailable();
        seen.add(hit.id); previous = hit.score; return { memory, score: hit.score };
      });
      for (const id of removed) next.delete(id); for (const [id, row] of updates) next.set(id, row);
      this.references = next; this.source = source; guard(); return hits;
    } catch (error) { if (error !== cancelled && generation === this.generation) this.dispose(); throw unavailable(); }
  }
  private yieldTask(): Promise<void> { return this.options.yieldTask?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0)); }
}
