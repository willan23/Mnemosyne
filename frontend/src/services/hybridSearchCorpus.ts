import { HYBRID_SEARCH_LIMITS, validSearchId, type HybridSearchSource } from './hybridSearchProtocol';

export interface HybridCorpusSnapshot { readonly revision: number; readonly size: number }
export const HYBRID_CORPUS_JOURNAL_LIMITS = { batches: 256, changes: 20_000 } as const;
const snapshots = new WeakMap<HybridCorpusSnapshot, { owner: HybridSearchCorpus; revision: number }>();
const invalid = () => new Error('hybrid_corpus_unavailable');

/** Feed only current, ACL-checked immutable sessions. The journal retains IDs, never old plaintext. */
export class HybridSearchCorpus {
  private values = new Map<string, HybridSearchSource>();
  private revision = 0;
  private minimumCursor = 0;
  private journal: Array<{ revision: number; ids: string[] }> = [];
  private journalChanges = 0;
  private closed = false;

  /** Retires this scope permanently; late listeners must use no references from it. */
  clear(): void {
    if (this.closed) return;
    this.closed = true;
    this.values.clear(); this.journal = []; this.journalChanges = 0;
    this.minimumCursor = ++this.revision;
  }

  update(changed: HybridSearchSource[], removed: string[]): void {
    if (this.closed || changed.length > HYBRID_SEARCH_LIMITS.documents || removed.length > HYBRID_SEARCH_LIMITS.documents) throw invalid();
    const next = new Map<string, HybridSearchSource | undefined>();
    for (const id of removed) { if (!validSearchId(id) || next.has(id)) throw invalid(); next.set(id, undefined); }
    const seen = new Set<string>();
    for (const memory of changed) {
      if (!validSearchId(memory.id) || seen.has(memory.id)) throw invalid(); seen.add(memory.id);
      next.set(memory.id, memory.encLocked || memory.deletedAt ? undefined : memory);
    }
    let size = this.values.size;
    for (const [id, value] of next) size += Number(value !== undefined) - Number(this.values.has(id));
    if (size > HYBRID_SEARCH_LIMITS.documents) throw invalid();
    const ids: string[] = [];
    for (const [id, value] of next) {
      if (this.values.get(id) === value) continue;
      ids.push(id); if (value) this.values.set(id, value); else this.values.delete(id);
    }
    if (!ids.length) return;
    this.journal.push({ revision: ++this.revision, ids }); this.journalChanges += ids.length;
    while (this.journal.length > HYBRID_CORPUS_JOURNAL_LIMITS.batches || this.journalChanges > HYBRID_CORPUS_JOURNAL_LIMITS.changes) {
      const retired = this.journal.shift()!; this.journalChanges -= retired.ids.length; this.minimumCursor = retired.revision;
    }
  }

  capture(): HybridCorpusSnapshot {
    const snapshot = Object.freeze({ revision: this.revision, size: this.values.size });
    snapshots.set(snapshot, { owner: this, revision: this.revision }); return snapshot;
  }

  static sameOwner(a: HybridCorpusSnapshot, b: HybridCorpusSnapshot): boolean {
    const first = snapshots.get(a), second = snapshots.get(b);
    return Boolean(first && second && first.owner === second.owner);
  }

  static read(snapshot: HybridCorpusSnapshot, previous: HybridCorpusSnapshot | null) {
    const current = snapshots.get(snapshot), prior = previous ? snapshots.get(previous) : undefined;
    if (!current || current.owner.revision !== current.revision) throw invalid();
    const owner = current.owner;
    const incremental = prior?.owner === owner && prior.revision >= owner.minimumCursor && prior.revision <= current.revision;
    let changed: HybridSearchSource[] = [];
    const removed: string[] = [];
    if (incremental) {
      const ids = new Set<string>();
      for (const batch of owner.journal) if (batch.revision > prior.revision) for (const id of batch.ids) ids.add(id);
      for (const id of ids) { const value = owner.values.get(id); if (value) changed.push(value); else removed.push(id); }
    } else changed = Array.from(owner.values.values());
    return { changed, removed, size: owner.values.size, rebuild: !incremental,
      isCurrent: () => owner.revision === current.revision,
      has: (id: string) => owner.revision === current.revision && owner.values.has(id) };
  }
}
