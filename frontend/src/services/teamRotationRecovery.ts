import { auth } from '../firebase';
import { getOrCreateIdentity } from '../utils/crypto';
import { unlockTeamKey } from './teamKeyAccess';
import { encryptMemoryFields, decryptMemoryEnvelope, isEncryptedMemoryEnvelope, isMemoryCryptoReady,
  onMemoryCryptoChanged, type EncryptedMemoryEnvelope } from './memoryCrypto';
import { commitTeamKeyRotationRemote, loadPendingTeamRotation, loadTeamForRotationRecovery, loadTeamMemberPublicKeys,
  roleOf, type TeamRecord, type TeamKeyRotationRecord } from './teamsService';
import { cacheTeamKeyEpoch, fingerprintTeamPublicKey, generateTeamKey, getTeamKeyCacheGeneration, isWrappedTeamKeyEnvelope,
  MAX_TEAM_MEMBERS, unwrapTeamKeyWithPrivateKey, wrapTeamKeyForPublicPem, type WrappedTeamKeyEnvelope } from './teamVault';

interface RotationCheckpoint {
  version: 1; uid: string; teamId: string; rotationId: string; oldEpoch: number;
  newKeyId: string; memberUids: string[]; wrappedKeys: Record<string, WrappedTeamKeyEnvelope>;
  publicKeyFingerprints: Record<string, string>;
}
export interface RotationRecoveryDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  currentUid: () => string | null;
  cryptoReady: () => boolean;
  subscribeCrypto: (callback: () => void) => () => void;
  cacheGeneration: () => number;
  loadTeam: (teamId: string) => Promise<TeamRecord>;
  loadRotation: (team: TeamRecord) => Promise<TeamKeyRotationRecord>;
  loadPublicKeys: (memberUids: string[]) => Promise<Record<string, string>>;
  unlock: (team: TeamRecord, uid: string, mnemonic: string[] | null, options?: { epoch?: number }) => Promise<CryptoKey>;
  identity: (uid: string, mnemonic: string[],guard?:()=>void) => Promise<{ privateKey: CryptoKey }>;
  generate: () => Promise<CryptoKey>;
  wrap: (key: CryptoKey, pem: string) => Promise<WrappedTeamKeyEnvelope>;
  unwrap: (wrap: WrappedTeamKeyEnvelope, privateKey: CryptoKey) => Promise<CryptoKey>;
  encrypt: (value: { text: string }) => Promise<EncryptedMemoryEnvelope>;
  decrypt: (envelope: EncryptedMemoryEnvelope) => Promise<{ text: string }>;
  commit: typeof commitTeamKeyRotationRemote;
  cache: typeof cacheTeamKeyEpoch;
  exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>;
}
export class TeamRotationRecoveryError extends Error {
  readonly reason: 'access-changed' | 'unavailable' | 'unsupported' | 'checkpoint-invalid' | 'checkpoint-obsolete' | 'storage' | 'busy' | 'commit';
  constructor(reason: TeamRotationRecoveryError['reason']) {
    super('Não foi possível confirmar a rotação. O checkpoint local foi conservado quando disponível.');
    this.reason = reason;
    this.name = 'TeamRotationRecoveryError';
  }
}
const recoveryKey = (uid: string, teamId: string) => `mnemosyne:team-rotation-recovery:v1:${encodeURIComponent(uid)}:${encodeURIComponent(teamId)}`;
const CHECKPOINT_CHANGED = 'mnemosyne:team-rotation-checkpoint-changed';
const changed = () => window.dispatchEvent(new Event(CHECKPOINT_CHANGED));
export function hasTeamRotationCheckpoint(uid: string, teamId: string): boolean {
  try { return localStorage.getItem(recoveryKey(uid, teamId)) !== null; } catch { return false; }
}
export function observeTeamRotationCheckpoint(callback: () => void) {
  window.addEventListener(CHECKPOINT_CHANGED, callback);
  window.addEventListener('storage', callback);
  return () => { window.removeEventListener(CHECKPOINT_CHANGED, callback); window.removeEventListener('storage', callback); };
}
export async function discardTeamRotationCheckpoint(uid: string, teamId: string) {
  if (auth.currentUser?.uid !== uid) throw new TeamRotationRecoveryError('access-changed');
  if (!navigator.locks) throw new TeamRotationRecoveryError('unsupported');
  await navigator.locks.request(`mnemosyne:team-rotation:${teamId}`, { mode: 'exclusive', ifAvailable: true }, lock => {
    if (!lock) throw new TeamRotationRecoveryError('busy');
    if (auth.currentUser?.uid !== uid) throw new TeamRotationRecoveryError('access-changed');
    localStorage.removeItem(recoveryKey(uid, teamId));
    changed();
  });
}
function defaultDeps(): RotationRecoveryDeps {
  return { storage: localStorage, currentUid: () => auth.currentUser?.uid ?? null,
    cryptoReady: isMemoryCryptoReady, subscribeCrypto: onMemoryCryptoChanged, cacheGeneration: getTeamKeyCacheGeneration,
    loadTeam: loadTeamForRotationRecovery, loadRotation: loadPendingTeamRotation,
    loadPublicKeys: loadTeamMemberPublicKeys, unlock: unlockTeamKey, identity: getOrCreateIdentity,
    generate: generateTeamKey, wrap: wrapTeamKeyForPublicPem, unwrap: unwrapTeamKeyWithPrivateKey,
    encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope, commit: commitTeamKeyRotationRemote,
    cache: cacheTeamKeyEpoch, exclusive: async (name, work) => {
      if (!navigator.locks) throw new TeamRotationRecoveryError('unsupported');
      return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) throw new TeamRotationRecoveryError('busy');
        return work();
      });
    } };
}
function readCheckpoint(raw: unknown, uid: string, teamId: string): RotationCheckpoint {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TeamRotationRecoveryError('checkpoint-invalid');
  const data = raw as Record<string, unknown>;
  if (data.version !== 1 || data.uid !== uid || data.teamId !== teamId ||
      Object.keys(data).some(k => !['version', 'uid', 'teamId', 'rotationId', 'oldEpoch', 'newKeyId', 'memberUids', 'wrappedKeys', 'publicKeyFingerprints'].includes(k)) ||
      typeof data.rotationId !== 'string' || !data.rotationId || data.rotationId.includes('/') || data.rotationId.length > 128 ||
      !Number.isSafeInteger(data.oldEpoch) || (data.oldEpoch as number) < 1 ||
      typeof data.newKeyId !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/.test(data.newKeyId) ||
      !Array.isArray(data.memberUids) || !data.memberUids.includes(uid) || data.memberUids.length > MAX_TEAM_MEMBERS ||
      !data.memberUids.every(v => typeof v === 'string' && v.length > 0) ||
      new Set(data.memberUids).size !== data.memberUids.length || !data.wrappedKeys ||
      typeof data.wrappedKeys !== 'object' || Array.isArray(data.wrappedKeys) || !data.publicKeyFingerprints ||
      typeof data.publicKeyFingerprints !== 'object' || Array.isArray(data.publicKeyFingerprints)) throw new TeamRotationRecoveryError('checkpoint-invalid');
  const wraps = data.wrappedKeys as Record<string, unknown>;
  const fingerprints = data.publicKeyFingerprints as Record<string, unknown>;
  if (Object.keys(wraps).length !== data.memberUids.length ||
      Object.keys(fingerprints).length !== data.memberUids.length ||
      data.memberUids.some(uid => !isWrappedTeamKeyEnvelope(wraps[uid]) ||
        typeof fingerprints[uid] !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprints[uid] as string))) throw new TeamRotationRecoveryError('checkpoint-invalid');
  return data as unknown as RotationCheckpoint;
}
const sameMembers = (a: string[], b: string[]) => a.length === b.length && a.every(uid => b.includes(uid));

/** Persist only encrypted wraps, never the AES key; server acknowledgement precedes caching. */
export async function completeTeamRotationWithRecovery(uid: string, teamId: string, mnemonic: string[],
  deps: RotationRecoveryDeps = defaultDeps()) {
  const generation = deps.cacheGeneration();
  let cancelled = false;
  const stop = deps.subscribeCrypto(() => { cancelled = true; });
  const assertCurrent = () => {
    if (cancelled || !deps.cryptoReady() || deps.currentUid() !== uid || deps.cacheGeneration() !== generation) {
      throw new TeamRotationRecoveryError('access-changed');
    }
  };
  const assertAdmin = (team: TeamRecord) => {
    if (team.id !== teamId || !team.memberUids.includes(uid) || !['owner', 'admin'].includes(roleOf(team, uid)) ||
        !team.activeKeyEpoch || !team.activeKeyId) throw new TeamRotationRecoveryError('unavailable');
  };
  const storeKey = recoveryKey(uid, teamId);
  try {
    assertCurrent();
    return await deps.exclusive(`mnemosyne:team-rotation:${teamId}`, async () => {
      assertCurrent();
      let stored: string | null;
      try { stored = deps.storage.getItem(storeKey); } catch { throw new TeamRotationRecoveryError('storage'); }
      let checkpoint: RotationCheckpoint | null = null;
      if (stored !== null) {
        try {
          const envelope: unknown = JSON.parse(stored);
          if (!isEncryptedMemoryEnvelope(envelope)) throw new Error('Invalid envelope');
          checkpoint = readCheckpoint(JSON.parse((await deps.decrypt(envelope)).text), uid, teamId);
        } catch { throw new TeamRotationRecoveryError('checkpoint-invalid'); }
        assertCurrent();
      }
      let team = await deps.loadTeam(teamId);
      assertCurrent(); assertAdmin(team);
      if (team.keyRotationStatus === 'active' && !team.pendingRotationId) {
        // A lost commit response or another administrator's commit: use only the acknowledged active key.
        const key = await deps.unlock(team, uid, mnemonic);
        assertCurrent();
        deps.cache(teamId, team.activeKeyEpoch!, key);
        try { deps.storage.removeItem(storeKey); changed(); } catch { throw new TeamRotationRecoveryError('storage'); }
        return { newEpoch: team.activeKeyEpoch!, alreadyCommitted: true };
      }
      const rotation = await deps.loadRotation(team);
      assertCurrent();
      if (checkpoint && (checkpoint.rotationId !== rotation.id || checkpoint.oldEpoch !== rotation.oldEpoch ||
          !sameMembers(checkpoint.memberUids, team.memberUids))) throw new TeamRotationRecoveryError('checkpoint-obsolete');
      const publicKeys = await deps.loadPublicKeys(team.memberUids);
      assertCurrent();
      const publicKeyFingerprints = Object.fromEntries(await Promise.all(team.memberUids.map(async memberUid => {
        if (typeof publicKeys[memberUid] !== 'string' || !publicKeys[memberUid]) throw new TeamRotationRecoveryError('unavailable');
        return [memberUid, await fingerprintTeamPublicKey(publicKeys[memberUid])] as const;
      })));
      assertCurrent();
      if (checkpoint && team.memberUids.some(memberUid => checkpoint!.publicKeyFingerprints[memberUid] !== publicKeyFingerprints[memberUid])) {
        throw new TeamRotationRecoveryError('checkpoint-obsolete');
      }
      if (!checkpoint) {
        await deps.unlock(team, uid, mnemonic, { epoch: rotation.oldEpoch });
        assertCurrent();
        const key = await deps.generate();
        assertCurrent();
        const wrappedKeys = Object.fromEntries(await Promise.all(team.memberUids.map(async memberUid =>
          [memberUid, await deps.wrap(key, publicKeys[memberUid])] as const)));
        assertCurrent();
        checkpoint = readCheckpoint({ version: 1, uid, teamId, rotationId: rotation.id, oldEpoch: rotation.oldEpoch,
          newKeyId: crypto.randomUUID(), memberUids: [...team.memberUids], wrappedKeys, publicKeyFingerprints }, uid, teamId);
        const envelope = await deps.encrypt({ text: JSON.stringify(checkpoint) });
        assertCurrent();
        try { deps.storage.setItem(storeKey, JSON.stringify(envelope)); changed(); }
        catch { throw new TeamRotationRecoveryError('storage'); }
      }
      const identity = await deps.identity(uid, mnemonic,assertCurrent);
      assertCurrent();
      // Verify that the saved owner/admin wrap is recoverable before committing it.
      const key = await deps.unwrap(checkpoint.wrappedKeys[uid], identity.privateKey);
      assertCurrent();
      let result;
      try {
        result = await deps.commit({ rotationId: checkpoint.rotationId, expectedOldEpoch: checkpoint.oldEpoch,
          newKeyId: checkpoint.newKeyId, wrappedKeys: checkpoint.wrappedKeys, publicKeyFingerprints: checkpoint.publicKeyFingerprints });
      } catch { throw new TeamRotationRecoveryError('commit'); }
      assertCurrent();
      if (result.newEpoch !== checkpoint.oldEpoch + 1) throw new TeamRotationRecoveryError('unavailable');
      team = await deps.loadTeam(teamId);
      assertCurrent(); assertAdmin(team);
      if (team.keyRotationStatus !== 'active' || team.pendingRotationId || team.activeKeyEpoch !== result.newEpoch ||
          team.activeKeyId !== checkpoint.newKeyId) throw new TeamRotationRecoveryError('unavailable');
      deps.cache(teamId, result.newEpoch, key);
      try { deps.storage.removeItem(storeKey); changed(); } catch { throw new TeamRotationRecoveryError('storage'); }
      return result;
    });
  } finally { stop(); }
}
