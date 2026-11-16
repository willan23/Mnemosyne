import { MemoryViewIndex } from './memoryViewIndex';
import { memoryViewId, MEMORY_VIEW_LIMITS as limits, type MemoryViewMessage, type MemoryViewOptions } from './memoryViewProtocol';

const fail = () => new Error('memory_view_unavailable');
/** A partial transfer cannot be queried or reused. One ACK authorizes only the next bounded frame. */
export class MemoryViewTransport {
  private index = new MemoryViewIndex();
  private phase: 'idle' | 'patch' | 'query' = 'idle';
  private initialized = false;
  private lastId = 0;
  private query: { options: MemoryViewOptions; now: number; expected: number | null; ids: string[] | null; reuse: boolean } | null = null;
  private filters: string[] | null = null;
  private filtersKnown = false;
  clear(): void { this.index.clear(); this.phase = 'idle'; this.initialized = false; this.query = null; this.filters = null; this.filtersKnown = false; this.lastId = 0; }
  handle(message: MemoryViewMessage): { ack: true } | { ids: string[]; count: number } {
    try {
      if (!message || message.v !== 2 || !Number.isSafeInteger(message.id) || message.id <= this.lastId) throw fail();
      this.lastId = message.id;
      if (message.type === 'patch-start' && this.phase === 'idle') {
        this.index.begin(message.reset, message.preserve, message.counts); this.phase = 'patch';
      } else if (message.type === 'patch-chunk' && this.phase === 'patch') this.index.chunk(message.frame);
      else if (message.type === 'patch-end' && this.phase === 'patch') { this.index.commit(); this.phase = 'idle'; this.initialized = true; }
      else if (message.type === 'query-start' && this.phase === 'idle' && this.initialized) {
        const options = message.options;
        if (!options || !['list', 'scene', 'related'].includes(options.mode) || typeof message.reuseFilter !== 'boolean' ||
          message.filteredCount !== null && (!Number.isSafeInteger(message.filteredCount) || message.filteredCount < 0 || message.filteredCount > limits.documents) ||
          options.mode !== 'list' && options.filteredIds !== null || options.mode === 'list' && (message.filteredCount !== null || message.reuseFilter) ||
          options.mode === 'related' && (message.reuseFilter ? this.filters === null : message.filteredCount === null) ||
          message.reuseFilter && (!this.filtersKnown || message.filteredCount !== null)) throw fail();
        this.query = { options, now: message.now, expected: message.filteredCount, ids: message.reuseFilter ? this.filters : message.filteredCount === null ? null : [], reuse: message.reuseFilter };
        this.phase = 'query';
      } else if (message.type === 'filter-chunk' && this.phase === 'query') {
        const query = this.query!;
        if (query.reuse || query.expected === null || !Array.isArray(message.ids) || message.ids.length < 1 || message.ids.length > limits.batch ||
          query.ids!.length + message.ids.length > query.expected || !message.ids.every(memoryViewId)) throw fail();
        query.ids!.push(...message.ids);
      } else if (message.type === 'query-end' && this.phase === 'query') {
        const query = this.query!;
        if (!query.reuse && query.expected !== null && query.ids!.length !== query.expected) throw fail();
        const result = this.index.query(query.options.mode !== 'list' ? { ...query.options, filteredIds: query.ids } : query.options, query.now);
        if (query.options.mode !== 'list') { this.filters = query.ids; this.filtersKnown = true; }
        this.query = null; this.phase = 'idle'; return result;
      } else throw fail();
      return { ack: true };
    } catch { this.clear(); throw fail(); }
  }
}
