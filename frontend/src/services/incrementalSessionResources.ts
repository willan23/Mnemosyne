interface ResourceRow { id: string; deletedAt?: unknown; tags?: readonly string[]; category?: string | null }
export interface SessionResources { tags: string[]; categories: string[] }
/** Counts only changed canonical rows. An unchanged catalog retains its array identities. */
export class IncrementalSessionResources {
  private rows = new Map<string, { tags: Set<string>; category?: string }>();
  private tags = new Map<string, number>();
  private categories = new Map<string, number>();
  private dirty = false;
  private cached: SessionResources = { tags: [], categories: [] };
  clear(): void { this.rows.clear(); this.tags.clear(); this.categories.clear(); this.dirty = false; this.cached = { tags: [], categories: [] }; }
  private count(table: Map<string, number>, key: string, amount: number) {
    const before = table.get(key) ?? 0, next = before + amount;
    if (next < 0) throw Error('memory_resources_unavailable');
    if (next) table.set(key, next); else table.delete(key);
    if (Boolean(before) !== Boolean(next)) this.dirty = true;
  }
  private remove(id: string) { const old = this.rows.get(id); if (!old) return; for (const tag of old.tags) this.count(this.tags, tag, -1); if (old.category) this.count(this.categories, old.category, -1); this.rows.delete(id); }
  apply(delta: { changed: readonly ResourceRow[]; removed: readonly string[] }): void {
    for (const id of delta.removed) this.remove(id);
    for (const value of delta.changed) {
      const old = this.rows.get(value.id), tags = new Set(value.deletedAt ? [] : value.tags ?? []), category = !value.deletedAt && value.category ? value.category : undefined;
      if (old) {
        for (const tag of old.tags) if (!tags.has(tag)) this.count(this.tags, tag, -1);
        for (const tag of tags) if (!old.tags.has(tag)) this.count(this.tags, tag, 1);
        if (old.category !== category) { if (old.category) this.count(this.categories, old.category, -1); if (category) this.count(this.categories, category, 1); }
      } else { for (const tag of tags) this.count(this.tags, tag, 1); if (category) this.count(this.categories, category, 1); }
      this.rows.set(value.id, { tags, category });
    }
  }
  capture(): SessionResources {
    if (this.dirty) {
      const tags = [...this.tags.keys()].sort(), categories = [...this.categories.keys()].sort();
      if (tags.length !== this.cached.tags.length || categories.length !== this.cached.categories.length || tags.some((tag, at) => tag !== this.cached.tags[at]) || categories.some((category, at) => category !== this.cached.categories[at])) this.cached = { tags, categories };
      this.dirty = false;
    }
    return this.cached;
  }
}
