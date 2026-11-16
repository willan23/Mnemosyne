import { filterSearchCandidates, type SearchableMemory } from '../utils/searchMemories';

export function structuredMemorySearch<T extends SearchableMemory>(memories: T[], query: string,
  filters: { dateRange: string; tags: string[]; category?: string }, now = Date.now()): T[] {
  const ranges: Record<string, number> = {
    today: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000,
  };
  const filtered = memories.filter((memory) => {
    if (filters.dateRange !== 'all' && (memory.timestamp || 0) <= now - (ranges[filters.dateRange] || 0)) return false;
    if (filters.tags.length && !memory.tags?.some((tag) => filters.tags.includes(tag))) return false;
    return !filters.category || memory.category === filters.category;
  });
  return query.trim() ? filterSearchCandidates(filtered, query) : filtered;
}
