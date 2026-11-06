import type { SessionData } from '../hooks/useSessions';
import { isPersonalSemanticCandidate } from './personalSemanticScope';
import { projectSearchDocument, validSearchId, HYBRID_SEARCH_LIMITS } from './hybridSearchProtocol';
import { CAPTURE_PREVIEW_LIMITS as limits, type CapturePreviewRequest } from './capturePreviewIndex';

export interface CapturePreviewScope { key: string; uid: string; teamId?: string }
export interface CapturePreviewResult { memory: SessionData; score: number }
export function capturePreviewEligible(row: SessionData, scope: CapturePreviewScope): boolean {
  return scope.teamId ? row.teamId === scope.teamId && !row.teamScopeAmbiguous && !row.encLocked && !row.deletedAt : isPersonalSemanticCandidate(row, scope.uid);
}
const unavailable = () => new Error('capture_preview_unavailable');
export class CapturePreviewClient {
  private references = new Map<string, SessionData>();
  private source: SessionData[] | null = null;
  private worker: Worker | null = null;
  private pending: { resolve: (value: unknown) => void; reject: () => void } | null = null;
  private generation = 0;
  private sequence = 0;
  private busy = false;
  private scope: CapturePreviewScope;
  private options: { createWorker?: () => Worker; yieldTask?: () => Promise<void> };
  constructor(scope: CapturePreviewScope, options: { createWorker?: () => Worker; yieldTask?: () => Promise<void> } = {}) { this.scope = scope; this.options = options; }
  dispose(): void {
    this.generation++; this.busy = false;
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
  async select(source: SessionData[], query: string, signal: AbortSignal): Promise<CapturePreviewResult[]> {
    if (this.busy) this.dispose();
    const generation = this.generation, guard = () => { if (signal.aborted || generation !== this.generation) throw unavailable(); };
    const abort = () => { if (generation === this.generation) this.dispose(); };
    signal.addEventListener('abort', abort, { once: true }); this.busy = true;
    try {
      guard();
      if (typeof query !== 'string' || query.length > limits.queryChars || source.length > HYBRID_SEARCH_LIMITS.documents) throw unavailable();
      if (query.trim().length < 12 || !source.length) { this.dispose(); return []; }
      let next = this.references; const changed: ReturnType<typeof projectSearchDocument>[] = []; let order: string[] | undefined;
      if (source !== this.source) {
        next = new Map(); order = [];
        for (let i = 0; i < source.length; i++) {
          const row = source[i]; guard();
          // ACL precedes plaintext projection, including getters on excluded records.
          if (capturePreviewEligible(row, this.scope)) {
            if (!validSearchId(row.id) || next.has(row.id)) throw unavailable();
            next.set(row.id, row); order.push(row.id);
            if (this.references.get(row.id) !== row) changed.push(projectSearchDocument(row));
          }
          if ((i + 1) % limits.batchSize === 0 && i + 1 < source.length) { await (this.options.yieldTask?.() ?? new Promise<void>(resolve => setTimeout(resolve, 0))); guard(); }
        }
      }
      guard(); const id = ++this.sequence, response = await this.exchange({ v: 1, id, changed, ...(order ? { order } : {}), query }); guard();
      if (!response || typeof response !== 'object') throw unavailable(); const result = response as Record<string, unknown>;
      if (result.v !== 1 || result.id !== id || result.ok !== true || !Array.isArray(result.hits) || result.hits.length > limits.hits) throw unavailable();
      const seen = new Set<string>(); let previous = Infinity;
      const hits = result.hits.map(hit => {
        if (!hit || typeof hit !== 'object' || !validSearchId(hit.id) || seen.has(hit.id) || typeof hit.score !== 'number' || !Number.isFinite(hit.score) || hit.score < .12 || hit.score > previous) throw unavailable();
        const memory = next.get(hit.id); if (!memory || !capturePreviewEligible(memory, this.scope)) throw unavailable();
        seen.add(hit.id); previous = hit.score; return { memory, score: hit.score };
      });
      this.references = next; this.source = source; return hits;
    } catch { if (generation === this.generation) this.dispose(); throw unavailable(); }
    finally { signal.removeEventListener('abort', abort); if (generation === this.generation) this.busy = false; }
  }
}
