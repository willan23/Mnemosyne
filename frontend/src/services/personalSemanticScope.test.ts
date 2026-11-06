import { describe, expect, it } from 'vitest';
import { personalSemanticCandidates } from './personalSemanticScope';

describe('personal semantic scope', () => {
  it('excludes team, shared, deleted and locked records from personal links', () => {
    const memories = [
      { id: 'personal', uid: 'alice' },
      { id: 'team-owned', uid: 'alice', teamId: 'team' },
      { id: 'ambiguous-team', uid: 'alice', teamId: '' },
      { id: 'mapped-ambiguous-team', uid: 'alice', teamScopeAmbiguous: true },
      { id: 'team-other', uid: 'bob', teamId: 'team' },
      { id: 'shared', uid: 'bob' },
      { id: 'owned-shared', uid: 'alice', sharedWithIds: ['bob'] },
      { id: 'malformed-share', uid: 'alice', sharedWithIds: 'bob' },
      { id: 'empty-share', uid: 'alice', sharedWithIds: [] },
      { id: 'deleted', uid: 'alice', deletedAt: 1 },
      { id: 'locked', uid: 'alice', encLocked: true },
    ];
    expect(personalSemanticCandidates(memories, 'alice').map((memory) => memory.id))
      .toEqual(['personal', 'empty-share']);
  });
});
