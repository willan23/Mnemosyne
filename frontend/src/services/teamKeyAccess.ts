/**
 * Unwrap da teamKey no cliente: RSA privada (Comms) + wrap no doc da equipa.
 */

import { getOrCreateIdentity } from '../utils/crypto';
import { loadRetainedCommsIdentities } from './commsIdentityRollover';
import { withPersonalMemoryMutation } from './personalMemoryMutation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { readSessionMnemonic } from '../utils/sessionMnemonic';
import type { TeamRecord } from './teamsService';
import {
  cacheTeamKeyEpoch,
  getCachedTeamKey,
  getTeamKeyCacheGeneration,
  isWrappedTeamKeyEnvelope,
  notifyTeamKeysUpdated,
  unwrapTeamKeyWithPrivateKey,
} from './teamVault';

export async function unlockTeamKey(
  team: TeamRecord,
  uid: string,
  mnemonic: string[] | null,
  options?: { notify?: boolean; epoch?: number; isCurrent?: () => boolean },
): Promise<CryptoKey> {
  const capturedTeam = structuredClone(team);
  const words = mnemonic ? [...mnemonic] : null;
  return withPersonalMemoryMutation(uid, async context => {
  team = capturedTeam;
  mnemonic = words;
  const cacheGeneration = getTeamKeyCacheGeneration();
  const guard = () => {
    context.assertCurrent();
    if (cacheGeneration !== getTeamKeyCacheGeneration() || options?.isCurrent?.() === false) {
      throw new Error('O acesso à equipa mudou durante o desbloqueio.');
    }
  };
  guard();
  const epoch = options?.epoch ?? team.activeKeyEpoch ?? 1;
  if (!Number.isSafeInteger(epoch) || epoch < 1 || !team.memberUids.includes(uid) ||
      (team.activeKeyEpoch === undefined && epoch !== 1)) {
    throw new Error('Não há acesso à época desta equipa.');
  }
  const cached = getCachedTeamKey(team.id, epoch);
  if (cached) return cached;
  if (!mnemonic || mnemonic.length !== 12) {
    throw new Error('Desbloqueia a mnemónica de 12 palavras para usar a teamKey.');
  }
  let envelope = team.wrappedKeys[uid];
  if (team.activeKeyEpoch !== undefined) {
    const epochDoc = await getDoc(doc(db, 'teams', team.id, 'keyEpochs', String(epoch)));
    guard();
    const data = epochDoc.data();
    const rawWrap = data?.wrappedKeys && typeof data.wrappedKeys === 'object'
      ? (data.wrappedKeys as Record<string, unknown>)[uid] : null;
    if (!epochDoc.exists() || data?.epoch !== epoch ||
        (epoch === team.activeKeyEpoch && (!team.activeKeyId || data?.keyId !== team.activeKeyId)) ||
        !Array.isArray(data?.memberUids) || !data.memberUids.includes(uid) ||
        !isWrappedTeamKeyEnvelope(rawWrap)) {
      throw new Error('Envelope da época da equipa indisponível ou inconsistente.');
    }
    envelope = rawWrap;
  }
  if (!envelope) {
    throw new Error('Não há wrap da teamKey para a tua conta. Aceita o convite da equipa.');
  }
  const identity = await getOrCreateIdentity(uid, mnemonic, guard);
  guard();
  let teamKey: CryptoKey;
  try {
    teamKey = await unwrapTeamKeyWithPrivateKey(envelope, identity.privateKey);
  } catch {
    guard();
    const retained = await loadRetainedCommsIdentities(uid, mnemonic, guard);
    guard();
    let recovered: CryptoKey | null = null;
    for (const previous of retained) {
      guard();
      try { recovered = await unwrapTeamKeyWithPrivateKey(envelope, previous.privateKey); }
      catch { guard(); continue; }
      guard();
      break;
    }
    if (!recovered) throw new Error('Não foi possível abrir o envelope cifrado da equipa.');
    teamKey = recovered;
  }
  guard();
  cacheTeamKeyEpoch(team.id, epoch, teamKey, options?.notify !== false);
  return teamKey;
  });
}

/** Tenta unwrap de todas as equipas; falhas individuais não bloqueiam as outras. */
export async function unlockMembershipTeamKeys(
  uid: string,
  teams: TeamRecord[],
  mnemonic: string[] | null = readSessionMnemonic(),
  isCurrent: (teamId: string) => boolean = () => true,
): Promise<void> {
  let changed = false;
  for (const team of teams) {
    if (!isCurrent(team.id)) continue;
    if (getCachedTeamKey(team.id, team.activeKeyEpoch ?? 1)) continue;
    try {
      await unlockTeamKey(team, uid, mnemonic, { notify: false, isCurrent: () => isCurrent(team.id) });
      changed = true;
    } catch {
      console.warn('Team key unavailable');
    }
  }
  if (changed) notifyTeamKeysUpdated();
}
