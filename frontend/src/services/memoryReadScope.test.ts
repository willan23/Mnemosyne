import { describe, expect, it } from 'vitest';
import { canReadCachedMemory } from './memoryReadScope';

describe('memory read scope', () => {
  it('requires current team membership even for an author or previous recipient', () => {
    const scope = { uid: 'alice', teamIds: new Set(['active']) };
    expect(canReadCachedMemory({ uid: 'alice', teamId: 'removed', sharedWithIds: ['alice'] }, scope)).toBe(false);
    expect(canReadCachedMemory({ uid: 'bob', teamId: 'active' }, scope)).toBe(true);
    expect(canReadCachedMemory({ uid: 'alice', teamScopeAmbiguous: true }, scope)).toBe(false);
    expect(canReadCachedMemory({ uid: 'alice', teamId: '' }, scope)).toBe(false);
  });
  it('permits owned or explicitly shared personal memories', () => {
    const scope = { uid: 'alice', teamIds: new Set<string>() };
    expect(canReadCachedMemory({ uid: 'alice' }, scope)).toBe(true);
    expect(canReadCachedMemory({ uid: 'bob', sharedWithIds: ['alice'] }, scope)).toBe(true);
    expect(canReadCachedMemory({ uid: 'bob', sharedWithIds: 'alice' }, scope)).toBe(false);
  });
});
