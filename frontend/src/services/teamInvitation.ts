import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { getOrCreateIdentity } from '../utils/crypto';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';
import { cacheTeamKeyEpoch, fingerprintTeamPublicKey, getTeamKeyCacheGeneration, unwrapTeamKeyWithPrivateKey, wrapTeamKeyForPublicPem } from './teamVault';
import { acceptInviteRemote, inviteMemberRemote, loadTeamForRotationRecovery, lookupTeamInvitee, type TeamInviteRecord, type TeamRecord } from './teamsService';
import { unlockTeamKey } from './teamKeyAccess';

export interface TeamInvitationDeps {
  currentUid: () => string | null;
  cryptoReady: () => boolean;
  cacheGeneration: () => number;
  subscribeContext: (uid: string, changed: () => void) => () => void;
  lookup: typeof lookupTeamInvitee;
  unlock: typeof unlockTeamKey;
  fingerprint: typeof fingerprintTeamPublicKey;
  wrap: typeof wrapTeamKeyForPublicPem;
  invite: typeof inviteMemberRemote;
}
function defaults(): TeamInvitationDeps {
  return {
    currentUid: () => auth.currentUser?.uid ?? null, cryptoReady: isMemoryCryptoReady,
    cacheGeneration: getTeamKeyCacheGeneration,
    subscribeContext: (uid, changed) => {
      const stopCrypto = onMemoryCryptoChanged(changed);
      const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed(); });
      return () => { stopCrypto(); stopAuth(); };
    },
    lookup: lookupTeamInvitee, unlock: unlockTeamKey, fingerprint: fingerprintTeamPublicKey,
    wrap: wrapTeamKeyForPublicPem, invite: inviteMemberRemote,
  };
}

/** Bind the envelope to the snapshot used to unwrap it; the server performs the final CAS. */
export async function inviteWithCurrentTeamKey(
  uid: string, mnemonic: string[], team: TeamRecord, email: string,
  isCurrent: () => boolean = () => true, deps = defaults(),
): Promise<{ inviteId: string; displayName: string }> {
  const epoch = team.activeKeyEpoch ?? 1;
  const keyId = team.activeKeyId ?? null;
  const generation = deps.cacheGeneration();
  let contextChanged = false;
  const stop = deps.subscribeContext(uid, () => { contextChanged = true; });
  const guard = () => {
    if (contextChanged || deps.currentUid() !== uid || !deps.cryptoReady() ||
        deps.cacheGeneration() !== generation || !isCurrent()) {
      throw new Error('O acesso mudou durante o convite. Tenta novamente.');
    }
  };
  try {
    guard();
    if (mnemonic.length !== 12 || !team.memberUids.includes(uid) ||
        (team.roles[uid] !== 'admin' && team.ownerUid !== uid) ||
        (team.keyRotationStatus && team.keyRotationStatus !== 'active') ||
        !Number.isSafeInteger(epoch) || epoch < 1 || (team.activeKeyEpoch !== undefined && !keyId)) {
      throw new Error('A equipa não está disponível para convites.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const profile = await deps.lookup(normalizedEmail); guard();
    const fingerprint = await deps.fingerprint(profile.publicKeyPem); guard();
    const teamKey = await deps.unlock(team, uid, mnemonic, { epoch }); guard();
    const wrappedKey = await deps.wrap(teamKey, profile.publicKeyPem); guard();
    const result = await deps.invite({ teamId: team.id, email: normalizedEmail, wrappedKey,
      expectedUid: uid, inviteeUid: profile.uid, expectedKeyEpoch: epoch,
      expectedKeyId: keyId, publicKeyFingerprint: fingerprint });
    guard();
    return result;
  } finally { stop(); }
}

export interface TeamInviteAcceptanceDeps extends Pick<TeamInvitationDeps, 'currentUid' | 'cryptoReady' | 'cacheGeneration' | 'subscribeContext'> {
  identity: typeof getOrCreateIdentity;
  unwrap: typeof unwrapTeamKeyWithPrivateKey;
  accept: typeof acceptInviteRemote;
  loadTeam: typeof loadTeamForRotationRecovery;
  cache: typeof cacheTeamKeyEpoch;
}
function acceptanceDefaults(): TeamInviteAcceptanceDeps {
  const context = defaults();
  return { currentUid: context.currentUid, cryptoReady: context.cryptoReady, cacheGeneration: context.cacheGeneration,
    subscribeContext: context.subscribeContext, identity: getOrCreateIdentity, unwrap: unwrapTeamKeyWithPrivateKey,
    accept: acceptInviteRemote, loadTeam: loadTeamForRotationRecovery, cache: cacheTeamKeyEpoch };
}

/** Never cache an invite's key under another epoch or after the vault/account changes. */
export async function acceptWithCurrentVault(uid: string, mnemonic: string[], invite: TeamInviteRecord,
  deps = acceptanceDefaults(), isCurrent: () => boolean = () => true) {
  const generation = deps.cacheGeneration(); let contextChanged = false;
  const stop = deps.subscribeContext(uid, () => { contextChanged = true; });
  const guard = () => {
    if (contextChanged || deps.currentUid() !== uid || !deps.cryptoReady() || deps.cacheGeneration() !== generation || !isCurrent()) {
      throw new Error('O acesso mudou durante a aceitação do convite.');
    }
  };
  try {
    guard();
    if (invite.uid !== uid || mnemonic.length !== 12) throw new Error('Convite indisponível.');
    const identity = await deps.identity(uid, mnemonic,guard); guard();
    const key = await deps.unwrap(invite.wrappedKey, identity.privateKey); guard();
    const result = await deps.accept(invite.id); guard();
    if (result.teamId !== invite.teamId) throw new Error('Não foi possível confirmar a equipa.');
    const team = await deps.loadTeam(result.teamId); guard();
    if (!team || team.id !== invite.teamId || !team.memberUids.includes(uid)) throw new Error('Equipa indisponível.');
    // A rotation or another invitation may have superseded this envelope after acceptance.
    // The membership listener can unlock the current epoch normally; this key stays uncached.
    const epoch = invite.keyEpoch ?? 1;
    if ((team.activeKeyEpoch ?? 1) === epoch && (team.activeKeyId ?? null) === (invite.keyId ?? null) &&
        JSON.stringify(team.wrappedKeys[uid]) === JSON.stringify(invite.wrappedKey)) {
      deps.cache(team.id, epoch, key);
    }
    return result;
  } finally { stop(); }
}
