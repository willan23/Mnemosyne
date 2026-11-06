import type { SearchVectorCandidate, SearchVectorRequest } from './searchVectorRanking';

/** Ephemeral per-vault index. Dispose on lock/account change; never persists vectors. */
export class IncrementalSearchClient {
  private worker: Worker | null = null;
  private indexed = new Map<string, SearchVectorCandidate>();
  private cancel: (() => void) | null = null;
  private sequence = 0;

  dispose() {
    this.cancel?.();
    this.worker?.terminate();
    this.worker = null;
    this.indexed.clear();
  }

  rank(request: SearchVectorRequest, signal: AbortSignal): Promise<Map<string, number>> {
    if (signal.aborted) return Promise.reject(new Error('Ranking cancelado.'));
    this.cancel?.();
    if (!this.worker) this.worker = new Worker(new URL('./incrementalSearchWorker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    const id = ++this.sequence;
    const next = new Map(request.candidates.map(candidate => [candidate.id, candidate]));
    const removed = [...this.indexed.keys()].filter(key => !next.has(key));
    const changed = request.candidates.filter(candidate => {
      const previous = this.indexed.get(candidate.id);
      return previous?.embedding !== candidate.embedding || previous?.embeddingModel !== candidate.embeddingModel;
    });
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', fail);
        this.cancel = null;
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        worker.terminate();
        this.worker = null;
        this.indexed.clear();
        reject(new Error('Ranking local indisponível.'));
      };
      const timeout = window.setTimeout(fail, 30_000);
      this.cancel = fail;
      signal.addEventListener('abort', fail, { once: true });
      worker.onerror = fail;
      worker.onmessageerror = fail;
      worker.onmessage = (event: MessageEvent) => {
        if (settled || event.data.id !== id) return;
        if (!event.data.ok || !Array.isArray(event.data.scores)) { fail(); return; }
        settled = true;
        cleanup();
        this.indexed = next;
        resolve(new Map(event.data.scores));
      };
      try {
        worker.postMessage({ id, changed, removed, query: request.query,
          embeddingModel: request.embeddingModel, floor: request.floor });
      } catch { fail(); }
    });
  }
}
