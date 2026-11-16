import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamRecord } from '../services/teamsService';
import { useMyTeams, useUnlockTeamKeys } from './useMyTeams';

const state = vi.hoisted(() => ({
  onTeams: null as ((teams: TeamRecord[]) => void) | null,
  mnemonic: null as string[] | null,
  clear: vi.fn(),
  unlock: vi.fn(),
}));

vi.mock('../services/teamsService', () => ({
  watchMyTeams: (_uid: string, onChange: (teams: TeamRecord[]) => void) => {
    state.onTeams = onChange;
    return () => { state.onTeams = null; };
  },
}));
vi.mock('../services/teamVault', () => ({ clearTeamKeyCache: (...args: unknown[]) => state.clear(...args) }));
vi.mock('../services/teamKeyAccess', () => ({ unlockMembershipTeamKeys: (...args: unknown[]) => state.unlock(...args) }));
vi.mock('../services/memoryCrypto', () => ({ onMemoryCryptoChanged: () => () => {} }));
vi.mock('../utils/sessionMnemonic', () => ({ readSessionMnemonic: () => state.mnemonic }));

const team = (id: string): TeamRecord => ({
  id, name: id, ownerUid: 'alice', createdAt: 1, memberUids: ['alice'],
  wrappedKeys: {}, roles: { alice: 'owner' },
});

beforeEach(() => {
  state.onTeams = null;
  state.mnemonic = null;
  state.clear.mockReset();
  state.unlock.mockReset().mockResolvedValue(undefined);
});

describe('team key lifecycle', () => {
  it('drops a removed team key and all keys when the account changes', () => {
    const hook = renderHook(({ uid }) => useMyTeams(uid), { initialProps: { uid: 'alice' as string | null } });
    act(() => { state.onTeams?.([team('a'), team('b')]); });
    act(() => { state.onTeams?.([team('a')]); });
    expect(state.clear).toHaveBeenCalledWith('b');
    hook.rerender({ uid: 'bob' });
    expect(state.clear).toHaveBeenCalledWith();
    hook.unmount();
  });

  it('clears cached keys when the mnemonic is locked', () => {
    renderHook(() => useUnlockTeamKeys('alice', [team('a')]));
    expect(state.clear).toHaveBeenCalledWith();
    expect(state.unlock).not.toHaveBeenCalled();
  });
});
