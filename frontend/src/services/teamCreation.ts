import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { getOrCreateIdentity } from '../utils/crypto';
import { publishCommsIdentity } from './commsIdentity';
import { encryptMemoryFields, decryptMemoryEnvelope, isEncryptedMemoryEnvelope, isMemoryCryptoReady,
  onMemoryCryptoChanged, type EncryptedMemoryEnvelope } from './memoryCrypto';
import { cacheTeamKeyEpoch, fingerprintTeamPublicKey, generateTeamKey, getTeamKeyCacheGeneration,
  isWrappedTeamKeyEnvelope, unwrapTeamKeyWithPrivateKey, wrapTeamKeyForIdentity, type WrappedTeamKeyEnvelope } from './teamVault';
import { createTeamRemote, cancelTeamCreationRemote, loadTeamForRotationRecovery } from './teamsService';
import { unlockTeamKey } from './teamKeyAccess';

export interface TeamCreationDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  currentUid: () => string | null;
  cryptoReady: () => boolean;
  subscribeCrypto: (callback: () => void) => () => void;
  cacheGeneration: () => number;
  publish: typeof publishCommsIdentity;
  identity: typeof getOrCreateIdentity;
  generate: typeof generateTeamKey;
  wrap: typeof wrapTeamKeyForIdentity;
  unwrap: typeof unwrapTeamKeyWithPrivateKey;
  fingerprint: typeof fingerprintTeamPublicKey;
  create: typeof createTeamRemote;
  cancel: typeof cancelTeamCreationRemote;
  cache: typeof cacheTeamKeyEpoch;
  encrypt: (value: { text: string }) => Promise<EncryptedMemoryEnvelope>;
  decrypt: (value: EncryptedMemoryEnvelope) => Promise<{ text: string }>;
  loadTeam: typeof loadTeamForRotationRecovery;
  unlock: typeof unlockTeamKey;
  exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>;
}
function defaults(): TeamCreationDeps { return {
  storage: localStorage,
  currentUid: () => auth.currentUser?.uid ?? null, cryptoReady: isMemoryCryptoReady,
  subscribeCrypto: onMemoryCryptoChanged, cacheGeneration: getTeamKeyCacheGeneration,
  publish: publishCommsIdentity, identity: getOrCreateIdentity, generate: generateTeamKey, wrap: wrapTeamKeyForIdentity,
  unwrap: unwrapTeamKeyWithPrivateKey, fingerprint: fingerprintTeamPublicKey,
  create: createTeamRemote, cancel: cancelTeamCreationRemote, cache: cacheTeamKeyEpoch,
  encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope, loadTeam: loadTeamForRotationRecovery, unlock: unlockTeamKey,
  exclusive: async (name, work) => {
    if (!navigator.locks) throw new TeamCreationError('unsupported');
    return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock) throw new TeamCreationError('busy');
      return work();
    });
  },
}; }
export class TeamCreationError extends Error {
  readonly reason: 'access-changed' | 'storage' | 'checkpoint-invalid' | 'checkpoint-obsolete' | 'pending' | 'unsupported' | 'busy' | 'unavailable';
  constructor(reason: TeamCreationError['reason']) { super('Não foi possível confirmar a criação da equipa.'); this.reason = reason; }
}
interface CreationCheckpoint {
  version: 1; uid: string; name: string; requestId: string; wrappedKey: WrappedTeamKeyEnvelope; publicKeyFingerprint: string;
}
const storeKey = (uid: string) => `mnemosyne:team-creation:v1:${encodeURIComponent(uid)}`;
const EVENT = 'mnemosyne:team-creation-checkpoint-changed';
const changed = () => window.dispatchEvent(new Event(EVENT));
export function hasTeamCreationCheckpoint(uid: string) {
  try { return localStorage.getItem(storeKey(uid)) !== null; } catch { return false; }
}
export function observeTeamCreationCheckpoint(callback: () => void) {
  window.addEventListener(EVENT, callback); window.addEventListener('storage', callback);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', callback); };
}
function parseCheckpoint(value: unknown, uid: string): CreationCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TeamCreationError('checkpoint-invalid');
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || data.uid !== uid || typeof data.name !== 'string' || !data.name ||
      data.name !== data.name.trim() || data.name.length > 80 || typeof data.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.requestId) ||
      typeof data.publicKeyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.publicKeyFingerprint) ||
      !isWrappedTeamKeyEnvelope(data.wrappedKey) ||
      Object.keys(data.wrappedKey).some(k => !['v', 'alg', 'ct'].includes(k)) ||
      Object.keys(data).some(k => !['version', 'uid', 'name', 'requestId', 'wrappedKey', 'publicKeyFingerprint'].includes(k))) {
    throw new TeamCreationError('checkpoint-invalid');
  }
  try {
    const bytes = atob(data.wrappedKey.ct);
    if (bytes.length < 256 || bytes.length > 512 || btoa(bytes) !== data.wrappedKey.ct) throw new Error();
  } catch { throw new TeamCreationError('checkpoint-invalid'); }
  return data as unknown as CreationCheckpoint;
}
export async function cancelPendingTeamCreation(user: User, deps = defaults()) {
  const generation = deps.cacheGeneration(); let contextChanged = false;
  const stop = deps.subscribeCrypto(() => { contextChanged = true; });
  const guard = () => {
    if (contextChanged || deps.currentUid() !== user.uid || !deps.cryptoReady() || deps.cacheGeneration() !== generation) {
      throw new TeamCreationError('access-changed');
    }
  };
  try {
    await deps.exclusive(`mnemosyne:team-creation:${user.uid}`, async () => {
      guard(); let raw: string | null;
      try { raw = deps.storage.getItem(storeKey(user.uid)); } catch { throw new TeamCreationError('storage'); }
      if (raw === null) return;
      let checkpoint: CreationCheckpoint;
      try { const envelope: unknown = JSON.parse(raw); if (!isEncryptedMemoryEnvelope(envelope)) throw new Error();
        checkpoint = parseCheckpoint(JSON.parse((await deps.decrypt(envelope)).text), user.uid);
      } catch { throw new TeamCreationError('checkpoint-invalid'); }
      guard(); await deps.cancel(checkpoint.requestId, user.uid); guard();
      try { deps.storage.removeItem(storeKey(user.uid)); changed(); } catch { throw new TeamCreationError('storage'); }
    });
  } finally { stop(); }
}
/** Persist wrapped preparation before sending. A null name explicitly resumes the pending creation. */
export async function createTeamWithActiveEpoch(user: User, mnemonic: string[], name: string | null, deps = defaults()) {
  const generation = deps.cacheGeneration();
  let contextChanged = false;
  const stop = deps.subscribeCrypto(() => { contextChanged = true; });
  const guard = () => {
    if (contextChanged || deps.currentUid() !== user.uid || !deps.cryptoReady() || deps.cacheGeneration() !== generation) {
      throw new TeamCreationError('access-changed');
    }
  };
  try {
    return await deps.exclusive(`mnemosyne:team-creation:${user.uid}`, async () => {
      guard();
      let raw: string | null;
      try { raw = deps.storage.getItem(storeKey(user.uid)); } catch { throw new TeamCreationError('storage'); }
      let checkpoint: CreationCheckpoint | null = null;
      if (raw !== null) {
        try {
          const envelope: unknown = JSON.parse(raw);
          if (!isEncryptedMemoryEnvelope(envelope)) throw new Error();
          checkpoint = parseCheckpoint(JSON.parse((await deps.decrypt(envelope)).text), user.uid);
        } catch { throw new TeamCreationError('checkpoint-invalid'); }
        guard();
        if (name !== null && name.trim().slice(0, 80) !== checkpoint.name) throw new TeamCreationError('pending');
      }
      if (!checkpoint && (name === null || !name.trim())) throw new TeamCreationError('unavailable');
      const identity = checkpoint ? await deps.identity(user.uid, mnemonic,guard) : await deps.publish(user, mnemonic,guard); guard();
      const fingerprint = await deps.fingerprint(identity.pemPublic); guard();
      if (checkpoint && fingerprint !== checkpoint.publicKeyFingerprint) throw new TeamCreationError('checkpoint-obsolete');
      if (!checkpoint) {
        const key = await deps.generate(); guard();
        const wrap = await deps.wrap(key, identity); guard();
        await deps.unwrap(wrap, identity.privateKey); guard();
        checkpoint = parseCheckpoint({ version: 1, uid: user.uid, name: name!.trim().slice(0, 80),
          requestId: crypto.randomUUID(), wrappedKey: wrap, publicKeyFingerprint: fingerprint }, user.uid);
        const envelope = await deps.encrypt({ text: JSON.stringify(checkpoint) }); guard();
        try { deps.storage.setItem(storeKey(user.uid), JSON.stringify(envelope)); changed(); }
        catch { throw new TeamCreationError('storage'); }
      }
      const recovered = await deps.unwrap(checkpoint.wrappedKey, identity.privateKey); guard();
      const created = await deps.create(checkpoint.name, checkpoint.wrappedKey, user.uid, checkpoint.publicKeyFingerprint, checkpoint.requestId); guard();
      const team = await deps.loadTeam(created.teamId); guard();
      if (team.ownerUid !== user.uid || !team.memberUids.includes(user.uid) || team.activeKeyEpoch !== created.activeKeyEpoch ||
          team.activeKeyId !== created.activeKeyId || (team.activeKeyEpoch === 1 && team.wrappedKeys[user.uid]?.ct !== checkpoint.wrappedKey.ct)) {
        throw new TeamCreationError('unavailable');
      }
      // A recovery may happen after a later rotation. Cache only the current server-confirmed key.
      const activeKey = team.activeKeyEpoch === 1 ? recovered : await deps.unlock(team, user.uid, mnemonic); guard();
      deps.cache(created.teamId, created.activeKeyEpoch, activeKey);
      try { deps.storage.removeItem(storeKey(user.uid)); changed(); } catch { throw new TeamCreationError('storage'); }
      return created;
    });
  } finally { stop(); }
}
