import type { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { clearIdentityVault, getOrCreateIdentity, sha256Hex } from '../utils/crypto';

export type CommsIdentity = Awaited<ReturnType<typeof getOrCreateIdentity>>;

const publicLabelForUser = (user: User): string =>
  user.displayName || user.email?.split('@')[0] || `mnemosyne-${user.uid.slice(0, 8)}`;

export async function publishCommsIdentity(user: User, mnemonic: string[] | null): Promise<CommsIdentity> {
  if (!mnemonic || mnemonic.length !== 12) {
    throw new Error('Desbloqueia primeiro a mnemónica para publicar a identidade de Comms.');
  }

  const identity = await getOrCreateIdentity(user.uid, mnemonic);
  const emailHash = user.email ? await sha256Hex(user.email) : null;

  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    publicKeyPem: identity.pemPublic,
    publicKeyUpdatedAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(doc(db, 'publicProfiles', user.uid), {
    uid: user.uid,
    displayName: publicLabelForUser(user),
    emailHash,
    publicKeyPem: identity.pemPublic,
    publicKeyUpdatedAt: serverTimestamp(),
  }, { merge: true });

  return identity;
}

export async function resetAndPublishCommsIdentity(user: User, mnemonic: string[] | null): Promise<CommsIdentity> {
  clearIdentityVault(user.uid);
  return publishCommsIdentity(user, mnemonic);
}
