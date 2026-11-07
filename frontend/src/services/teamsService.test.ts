import { describe, expect, it } from 'vitest';
import { canInviteMembers, roleOf, type TeamRecord } from './teamsService';

function team(partial: Partial<TeamRecord> = {}): TeamRecord {
  return {
    id: 'crew',
    name: 'Crew',
    ownerUid: 'alice',
    createdAt: 1,
    memberUids: ['alice', 'bob', 'carol'],
    wrappedKeys: {},
    roles: { alice: 'owner', bob: 'admin', carol: 'member' },
    ...partial,
  };
}

describe('team roles', () => {
  it('treats ownerUid as owner even if the map is stale', () => {
    const stale = team({ roles: { alice: 'member', bob: 'admin' } });
    expect(roleOf(stale, 'alice')).toBe('owner');
    expect(canInviteMembers(stale, 'alice')).toBe(true);
  });

  it('lets admin invite and blocks members', () => {
    const crew = team();
    expect(canInviteMembers(crew, 'bob')).toBe(true);
    expect(canInviteMembers(crew, 'carol')).toBe(false);
    expect(roleOf(crew, 'bob')).toBe('admin');
    expect(roleOf(crew, 'carol')).toBe('member');
  });
});
