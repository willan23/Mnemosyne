import { decryptTextAesGcm, deriveAesKeyFromMnemonic, encryptTextAesGcm } from '../utils/crypto';

export interface DesktopSyncIdentity {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

const desktopSyncVaultKey = (uid: string): string => `mnemosyne_desktop_sync_identity_${uid}`;
const identityCache = new Map<string, DesktopSyncIdentity>();

const importEcdhPublicKey = async (publicKeyJwk: JsonWebKey): Promise<CryptoKey> => (
  window.crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  )
);

const importEcdhPrivateKey = async (privateKeyJwk: JsonWebKey): Promise<CryptoKey> => (
  window.crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  )
);

export const getOrCreateDesktopSyncIdentity = async (
  uid: string,
  mnemonic: string[] | null
): Promise<DesktopSyncIdentity> => {
  if (!mnemonic || mnemonic.length !== 12) {
    throw new Error('Desbloqueia primeiro a mnemónica para usar a identidade de sync do desktop.');
  }

  const cacheKey = `${uid}:${mnemonic.join(' ')}`;
  const cached = identityCache.get(cacheKey);
  if (cached) return cached;

  const vaultKey = await deriveAesKeyFromMnemonic(mnemonic, `mnemosyne:desktop-sync:${uid}`);
  const storedVault = localStorage.getItem(desktopSyncVaultKey(uid));
  if (storedVault) {
    const encrypted = JSON.parse(storedVault) as { iv: string; data: string };
    const identityJson = JSON.parse(await decryptTextAesGcm(encrypted, vaultKey)) as {
      publicKeyJwk: JsonWebKey;
      privateKeyJwk: JsonWebKey;
    };
    const identity: DesktopSyncIdentity = {
      publicKey: await importEcdhPublicKey(identityJson.publicKeyJwk),
      privateKey: await importEcdhPrivateKey(identityJson.privateKeyJwk),
      publicKeyJwk: identityJson.publicKeyJwk,
      privateKeyJwk: identityJson.privateKeyJwk,
    };
    identityCache.set(cacheKey, identity);
    return identity;
  }

  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const identity: DesktopSyncIdentity = {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyJwk: await window.crypto.subtle.exportKey('jwk', keyPair.publicKey),
    privateKeyJwk: await window.crypto.subtle.exportKey('jwk', keyPair.privateKey),
  };
  const encryptedVault = await encryptTextAesGcm(JSON.stringify({
    publicKeyJwk: identity.publicKeyJwk,
    privateKeyJwk: identity.privateKeyJwk,
  }), vaultKey);
  localStorage.setItem(desktopSyncVaultKey(uid), JSON.stringify(encryptedVault));
  identityCache.set(cacheKey, identity);
  return identity;
};
