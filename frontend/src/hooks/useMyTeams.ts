import { useEffect, useMemo, useRef, useState } from 'react';
import { onMemoryCryptoChanged } from '../services/memoryCrypto';
import { clearTeamKeyCache } from '../services/teamVault';
import { unlockMembershipTeamKeys } from '../services/teamKeyAccess';
import { watchMyTeams, type TeamRecord } from '../services/teamsService';
import { readSessionMnemonic } from '../utils/sessionMnemonic';

export function useMyTeams(uid: string | null): TeamRecord[] {
  const [snapshot, setSnapshot] = useState<{ uid: string | null; teams: TeamRecord[] }>({ uid: null, teams: [] });
  const previousUid = useRef<string | null>(null);
  const visibleTeamIds = useRef(new Set<string>());

  useEffect(() => {
    if (previousUid.current !== uid) {
      clearTeamKeyCache();
      visibleTeamIds.current.clear();
      previousUid.current = uid;
    }
    if (!uid) {
      return undefined;
    }
    return watchMyTeams(uid, (nextTeams) => {
      const nextIds = new Set(nextTeams.map((team) => team.id));
      for (const id of visibleTeamIds.current) {
        if (!nextIds.has(id)) clearTeamKeyCache(id);
      }
      visibleTeamIds.current = nextIds;
      setSnapshot({ uid, teams: nextTeams });
    });
  }, [uid]);

  return snapshot.uid === uid ? snapshot.teams : [];
}

export function useTeamIds(teams: TeamRecord[]): string[] {
  const key = teams.map((team) => team.id).sort().join(',');
  return useMemo(
    () => (key ? key.split(',') : []),
    [key],
  );
}

/** Unwrap em background quando a mnemónica ou a lista de equipas muda. */
export function useUnlockTeamKeys(uid: string | null, teams: TeamRecord[]): void {
  const [cryptoEpoch, setCryptoEpoch] = useState(0);
  const teamIdsKey = teams.map((team) => team.id).sort().join(',');

  useEffect(() => onMemoryCryptoChanged(() => setCryptoEpoch((epoch) => epoch + 1)), []);

  useEffect(() => {
    if (!uid || teams.length === 0) return undefined;
    const mnemonic = readSessionMnemonic();
    if (!mnemonic || mnemonic.length !== 12) {
      clearTeamKeyCache();
      return undefined;
    }
    let cancelled = false;
    void unlockMembershipTeamKeys(uid, teams, mnemonic, () => !cancelled);
    return () => { cancelled = true; };
  }, [uid, teamIdsKey, cryptoEpoch, teams]);
}
