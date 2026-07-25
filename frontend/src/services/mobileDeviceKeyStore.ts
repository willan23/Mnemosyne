import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

export interface MobileSyncCredential {
  ownerUid: string;
  deviceId: string;
  pairingId: string;
  deviceName: string;
  privateKeyJwk: JsonWebKey;
  savedAt: number;
}

const STORAGE_PREFIX = 'mnemosyne_mobile_sync_';
const keyForOwner = (ownerUid: string): string => `credential_${ownerUid}`;

let storageReady: Promise<void> | null = null;

const ensureStorageReady = async (): Promise<void> => {
  if (!storageReady) {
    storageReady = (async () => {
      await SecureStorage.setKeyPrefix(STORAGE_PREFIX);
      if (Capacitor.getPlatform() === 'ios') {
        await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
      }
    })();
  }
  return storageReady;
};

export const isNativeSecureStorage = (): boolean => Capacitor.isNativePlatform();

export const saveMobileSyncCredential = async (credential: MobileSyncCredential): Promise<void> => {
  await ensureStorageReady();
  await SecureStorage.set(keyForOwner(credential.ownerUid), credential as unknown as Record<string, unknown>);
};

export const loadMobileSyncCredential = async (ownerUid: string): Promise<MobileSyncCredential | null> => {
  await ensureStorageReady();
  const value = await SecureStorage.get(keyForOwner(ownerUid));
  if (!value || typeof value !== 'object' || value instanceof Date || Array.isArray(value)) return null;

  const credential = value as Partial<MobileSyncCredential>;
  if (
    typeof credential.ownerUid !== 'string' ||
    typeof credential.deviceId !== 'string' ||
    typeof credential.pairingId !== 'string' ||
    typeof credential.deviceName !== 'string' ||
    typeof credential.savedAt !== 'number' ||
    !credential.privateKeyJwk
  ) {
    return null;
  }

  return credential as MobileSyncCredential;
};

export const removeMobileSyncCredential = async (ownerUid: string): Promise<void> => {
  await ensureStorageReady();
  await SecureStorage.remove(keyForOwner(ownerUid));
};
