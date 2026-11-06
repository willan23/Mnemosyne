import type { SessionData } from '../hooks/useSessions';
import type { EmbeddingProfileId } from './embeddingProfile';
import { readPreparedEmbedding, type PreparedEmbedding } from './embeddingReindex';
import { onEmbeddingSelectionChanged } from './embeddingSelection';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';

export const PREPARED_SEARCH_CACHE_LIMITS = { entries: 8_192, vectorBytes: 32 * 1024 * 1024 } as const;
const cancelled = () => new Error('Prepared search cancelled');

/** Validated vectors for immutable session objects; never persisted or shared across vault scopes. */
export class PreparedEmbeddingSearchCache {
  private values = new WeakMap<SessionData, PreparedEmbedding>();
  private entries = 0;
  private vectorBytes = 0;
  private generation = 0;
  private scope: { uid: string; profile: EmbeddingProfileId } | null = null;
  private stops: Array<() => void> = [];
  private readonly limits: { entries: number; vectorBytes: number };

  constructor(limits: { entries: number; vectorBytes: number } = PREPARED_SEARCH_CACHE_LIMITS) {
    if (!Number.isSafeInteger(limits.entries) || limits.entries < 1 || limits.entries > PREPARED_SEARCH_CACHE_LIMITS.entries ||
        !Number.isSafeInteger(limits.vectorBytes) || limits.vectorBytes < 1 || limits.vectorBytes > PREPARED_SEARCH_CACHE_LIMITS.vectorBytes) {
      throw new Error('Invalid prepared search cache limit');
    }
    this.limits = { ...limits };
  }

  private clearValues() {
    this.values = new WeakMap(); this.entries = 0; this.vectorBytes = 0;
  }

  private invalidate = () => { this.generation++; this.clearValues(); };

  dispose() {
    this.invalidate();
    for (const stop of this.stops) stop();
    this.stops = []; this.scope = null;
  }

  async read(uid: string, profile: EmbeddingProfileId, memory: SessionData, signal: AbortSignal): Promise<PreparedEmbedding | null> {
    if (signal.aborted || !uid || !isMemoryCryptoReady()) throw cancelled();
    if (this.scope?.uid !== uid || this.scope.profile !== profile) {
      this.dispose(); this.scope = { uid, profile };
      // Subscribe lazily: construction during a discarded React render owns no listeners.
      this.stops = [onMemoryCryptoChanged(this.invalidate), onEmbeddingSelectionChanged(uid, this.invalidate)];
    }
    const generation = this.generation;
    const check = () => {
      if (signal.aborted || generation !== this.generation || !isMemoryCryptoReady() ||
          this.scope?.uid !== uid || this.scope.profile !== profile) throw cancelled();
    };
    check();
    const cached = this.values.get(memory);
    if (cached) return cached;
    const saved = await readPreparedEmbedding(uid, profile, () => memory, { signal });
    check();
    // Missing/corrupt/failed reads are never cached. A later preparation may supply a checkpoint.
    if (saved) {
      const bytes = saved.vector.length * Float64Array.BYTES_PER_ELEMENT;
      if (bytes <= this.limits.vectorBytes) {
        if (this.entries >= this.limits.entries || this.vectorBytes + bytes > this.limits.vectorBytes) this.clearValues();
        // Another concurrent query may already have validated this same immutable object.
        if (!this.values.has(memory)) { this.values.set(memory, saved); this.entries++; this.vectorBytes += bytes; }
      }
    }
    return saved;
  }
}
