import QRCode from 'qrcode';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type MobilePairingStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

export interface MobilePairingPayload {
  version: 1;
  pairingId: string;
  ownerUid: string;
  desktopPublicKeyJwk: JsonWebKey;
  expiresAt: number;
}

export interface MobilePairingInvite {
  pairingId: string;
  pairingUri: string;
  qrDataUrl: string;
  expiresAt: number;
  privateKey: CryptoKey;
}

export interface EncryptedPairingPayload {
  iv: string;
  data: string;
}

export interface MobilePairingRecord {
  pairingId: string;
  ownerUid: string;
  status: MobilePairingStatus;
  expiresAt: number;
  mobileDeviceId?: string;
  mobileDeviceName?: string;
  mobilePublicKeyJwk?: JsonWebKey;
  encryptedHandshake?: EncryptedPairingPayload;
}

export interface TrustedDevice {
  deviceId: string;
  ownerUid: string;
  name: string;
  status: 'active' | 'revoked';
  pairedAt: number;
  revokedAt?: number;
  pairingId?: string;
  publicKeyJwk?: JsonWebKey;
  desktopPublicKeyJwk?: JsonWebKey;
}

const bytesToBase64Url = (bytes: Uint8Array): string => (
  window.btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
);

const base64UrlToBytes = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => (
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
);

const randomId = (): string => {
  const bytes = new Uint8Array(18);
  window.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

const encodePayload = (payload: MobilePairingPayload): string => (
  bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)))
);

const encryptJson = async (value: unknown, key: CryptoKey): Promise<EncryptedPairingPayload> => {
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(iv);
  const cipherBytes = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(JSON.stringify(value))
  );

  return {
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(cipherBytes)),
  };
};

const decryptJson = async <T>(payload: EncryptedPairingPayload, key: CryptoKey): Promise<T> => {
  const iv = base64UrlToBytes(payload.iv);
  const data = base64UrlToBytes(payload.data);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(data)
  );
  return JSON.parse(textDecoder.decode(plaintext)) as T;
};

const importEcdhPublicKey = async (publicKeyJwk: JsonWebKey): Promise<CryptoKey> => (
  window.crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  )
);

const derivePairingKey = async (privateKey: CryptoKey, peerPublicKeyJwk: JsonWebKey): Promise<CryptoKey> => {
  const peerPublicKey = await importEcdhPublicKey(peerPublicKeyJwk);
  return window.crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const createMobilePairingInvite = async (
  ownerUid: string,
  desktopDeviceName = navigator.userAgent.slice(0, 120)
): Promise<MobilePairingInvite> => {
  const pairingId = randomId();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const desktopPublicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const payload: MobilePairingPayload = {
    version: 1,
    pairingId,
    ownerUid,
    desktopPublicKeyJwk,
    expiresAt,
  };
  const pairingUri = `mnemosyne://pair?payload=${encodePayload(payload)}`;

  await setDoc(doc(db, 'devicePairings', pairingId), {
    version: 1,
    pairingId,
    ownerUid,
    status: 'pending',
    desktopDeviceName,
    desktopPublicKeyJwk,
    createdAt: serverTimestamp(),
    expiresAt,
  });

  const qrDataUrl = await QRCode.toDataURL(pairingUri, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 260,
    color: {
      dark: '#0f172a',
      light: '#f8fafc',
    },
  });

  return {
    pairingId,
    pairingUri,
    qrDataUrl,
    expiresAt,
    privateKey: keyPair.privateKey,
  };
};

export const cancelMobilePairingInvite = async (pairingId: string): Promise<void> => {
  await updateDoc(doc(db, 'devicePairings', pairingId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const parseMobilePairingUri = (pairingUri: string): MobilePairingPayload => {
  const url = new URL(pairingUri);
  const payload = url.searchParams.get('payload');
  if (url.protocol !== 'mnemosyne:' || url.hostname !== 'pair' || !payload) {
    throw new Error('Convite de pareamento inválido.');
  }

  const parsed = JSON.parse(textDecoder.decode(base64UrlToBytes(payload))) as MobilePairingPayload;
  if (parsed.version !== 1 || !parsed.pairingId || !parsed.ownerUid || !parsed.desktopPublicKeyJwk) {
    throw new Error('Payload de pareamento incompleto.');
  }
  if (parsed.expiresAt <= Date.now()) {
    throw new Error('Convite de pareamento expirado.');
  }
  return parsed;
};

export const acceptMobilePairingInvite = async (
  pairingUri: string,
  mobileDeviceName = navigator.userAgent.slice(0, 120)
): Promise<{ deviceId: string; pairingId: string; mobilePrivateKeyJwk: JsonWebKey }> => {
  const payload = parseMobilePairingUri(pairingUri);
  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const sharedKey = await derivePairingKey(keyPair.privateKey, payload.desktopPublicKeyJwk);
  const mobilePublicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const mobilePrivateKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const mobileDeviceId = randomId();
  const acceptedAt = Date.now();
  const encryptedHandshake = await encryptJson({
    version: 1,
    pairingId: payload.pairingId,
    ownerUid: payload.ownerUid,
    mobileDeviceId,
    mobileDeviceName,
    acceptedAt,
  }, sharedKey);

  await updateDoc(doc(db, 'devicePairings', payload.pairingId), {
    status: 'accepted',
    mobileDeviceId,
    mobileDeviceName,
    mobilePublicKeyJwk,
    encryptedHandshake,
    acceptedAt,
    updatedAt: serverTimestamp(),
  });

  return { deviceId: mobileDeviceId, pairingId: payload.pairingId, mobilePrivateKeyJwk };
};

export const trustAcceptedMobilePairing = async (
  ownerUid: string,
  desktopPrivateKey: CryptoKey,
  record: MobilePairingRecord,
  desktopSyncPublicKeyJwk?: JsonWebKey
): Promise<TrustedDevice> => {
  if (record.status !== 'accepted' || !record.mobilePublicKeyJwk || !record.encryptedHandshake) {
    throw new Error('O convite ainda não foi aceite pelo mobile.');
  }

  const sharedKey = await derivePairingKey(desktopPrivateKey, record.mobilePublicKeyJwk);
  const handshake = await decryptJson<{
    version: 1;
    pairingId: string;
    ownerUid: string;
    mobileDeviceId: string;
    mobileDeviceName: string;
    acceptedAt: number;
  }>(record.encryptedHandshake, sharedKey);

  if (
    handshake.version !== 1 ||
    handshake.pairingId !== record.pairingId ||
    handshake.ownerUid !== ownerUid ||
    handshake.mobileDeviceId !== record.mobileDeviceId
  ) {
    throw new Error('Handshake de pareamento inconsistente.');
  }

  const trustedDevice: TrustedDevice = {
    deviceId: handshake.mobileDeviceId,
    ownerUid,
    name: handshake.mobileDeviceName || record.mobileDeviceName || 'Mobile',
    status: 'active',
    pairedAt: handshake.acceptedAt,
    pairingId: record.pairingId,
    publicKeyJwk: record.mobilePublicKeyJwk,
    desktopPublicKeyJwk: desktopSyncPublicKeyJwk,
  };

  await setDoc(doc(db, 'trustedDevices', trustedDevice.deviceId), {
    ...trustedDevice,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return trustedDevice;
};

export const watchMobilePairingInvite = (
  pairingId: string,
  onChange: (record: MobilePairingRecord | null) => void
): Unsubscribe => (
  onSnapshot(doc(db, 'devicePairings', pairingId), (snapshot) => {
    onChange(snapshot.exists() ? snapshot.data() as MobilePairingRecord : null);
  })
);

export const watchTrustedDevices = (
  ownerUid: string,
  onChange: (devices: TrustedDevice[]) => void
): Unsubscribe => (
  onSnapshot(query(collection(db, 'trustedDevices'), where('ownerUid', '==', ownerUid)), (snapshot) => {
    const devices = snapshot.docs
      .map((trustedDoc) => trustedDoc.data() as TrustedDevice)
      .sort((a, b) => b.pairedAt - a.pairedAt);
    onChange(devices);
  })
);

export const revokeTrustedDevice = async (deviceId: string): Promise<void> => {
  await updateDoc(doc(db, 'trustedDevices', deviceId), {
    status: 'revoked',
    revokedAt: Date.now(),
    updatedAt: serverTimestamp(),
  });
};
