import { describe, expect, it } from 'vitest';
import { structuredMemorySearch } from './structuredMemorySearch';

describe('structured memory candidates', () => {
  it('combines date, UI tags/category and query operators before ranking', () => {
    const now = 1_800_000_000_000;
    const base = { timestamp: now - 1000, tags: ['work', 'launch'], category: 'note' };
    const candidates = [
      { id: 'match', ...base },
      { id: 'old', ...base, timestamp: now - 2 * 86_400_000 },
      { id: 'wrong-tag', ...base, tags: ['work'] },
      { id: 'wrong-category', ...base, category: 'other' },
      { id: 'locked', ...base, encLocked: true },
    ];
    expect(structuredMemorySearch(candidates, '#launch plan', {
      dateRange: 'today', tags: ['work'], category: 'note',
    }, now).map((memory) => memory.id)).toEqual(['match']);
  });
});
