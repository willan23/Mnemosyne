import { expect, it } from 'vitest';
import { IncrementalSessionResources } from './incrementalSessionResources';

it('counts canonical live rows and preserves catalog identities through text-only edits and partial removals', () => {
  const resources = new IncrementalSessionResources();
  const a = { id: 'a', tags: ['one', 'one', 'two'], category: 'Work' }, b = { id: 'b', tags: ['one'], category: 'Work' };
  resources.apply({ changed: [a, b], removed: [] }); const first = resources.capture(); expect(first).toEqual({ tags: ['one', 'two'], categories: ['Work'] });
  resources.apply({ changed: [{ ...a }], removed: [] }); expect(resources.capture()).toBe(first);
  resources.apply({ changed: [], removed: ['b'] }); expect(resources.capture()).toBe(first);
  resources.apply({ changed: [], removed: ['a'] }); expect(resources.capture()).toEqual({ tags: [], categories: [] });
});
it('excludes deleted metadata before accessing its tags and restores the catalog on undelete', () => {
  const resources = new IncrementalSessionResources(); resources.apply({ changed: [{ id: 'a', tags: ['one'], category: 'Work' }], removed: [] });
  resources.apply({ changed: [{ id: 'a', deletedAt: 1, get tags(): string[] { throw Error('Read deleted tags'); } }], removed: [] }); expect(resources.capture()).toEqual({ tags: [], categories: [] });
  resources.apply({ changed: [{ id: 'a', tags: ['two'], category: 'Other' }], removed: [] }); expect(resources.capture()).toEqual({ tags: ['two'], categories: ['Other'] });
});
it('deduplicates counts and retains a catalog after replacing its only contributing ID', () => {
  const resources = new IncrementalSessionResources(); resources.apply({ changed: [{ id: 'a', tags: ['x'], category: 'Y' }], removed: [] }); const before = resources.capture();
  resources.apply({ changed: [{ id: 'b', tags: ['x'], category: 'Y' }], removed: ['a'] }); expect(resources.capture()).toBe(before);
});
it('withdraws every resource count on scope retirement and permits an independent fresh catalog', () => {
  const resources = new IncrementalSessionResources(); resources.apply({ changed: [{ id: 'same', tags: ['private'], category: 'Private' }], removed: [] }); const previous = resources.capture();
  resources.clear(); expect(resources.capture()).toEqual({ tags: [], categories: [] }); expect(previous.tags).toEqual(['private']);
  resources.apply({ changed: [{ id: 'same', tags: ['fresh'], category: 'Fresh' }], removed: [] }); expect(resources.capture()).toEqual({ tags: ['fresh'], categories: ['Fresh'] });
});
