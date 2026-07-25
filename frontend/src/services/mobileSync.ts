import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { SessionData } from '../hooks/useSessions';
import type { EncryptedPairingPayload, TrustedDevice } from './mobilePairing';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface MobileSyncEnvelope {
  id: string;
  ownerUid: string;
  deviceId: string;
  direction: 'desktop-to-mobile' | 'mobile-to-desktop';
  payloadType: 'memory-snapshot' | 'memory-delta';
  status: 'queued' | 'pulled' | 'failed';
  senderPublicKeyJwk: JsonWebKey;
  encryptedPayload: EncryptedPairingPayload;
  memoryCount: number;
  tombstoneIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
  pulledAt?: number;
  expiresAt: number;
}

export interface MobileMemorySnapshot {
  version: 1;
  exportedAt: number;
  ownerUid: string;
  source: 'desktop' | 'mobile';
  memories: Array<{
    id: string;
    text: string;
    title?: string;
    timestamp: number;
    updatedAt: number;
    tags?: string[];
    category?: string;
    connections?: string[];
    semanticClusterId?: string;
    position?: [number, number, number];
    importance?: number;
    celestialType?: string;
    embedding?: number[];
    deletedAt?: number;
    deletedByDeviceId?: string;
  }>;
}

export interface MobileMemoryDelta {
  version: 1;
  exportedAt: number;
  ownerUid: string;
  source: 'desktop' | 'mobile';
  deviceId: string;
  since: number;
  cursor: number;
  changes: Array<{
    op: 'upsert' | 'delete';
    memory: MobileMemorySnapshot['memories'][number];
  }>;
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

const importEcdhPrivateKey = async (privateKeyJwk: JsonWebKey): Promise<CryptoKey> => (
  window.crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  )
);

const deriveSyncKey = async (privateKey: CryptoKey, peerPublicKeyJwk: JsonWebKey): Promise<CryptoKey> => {
  const peerPublicKey = await importEcdhPublicKey(peerPublicKeyJwk);
  return window.crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

const toSnapshotMemory = (session: SessionData): MobileMemorySnapshot['memories'][number] => ({
  id: session.id,
  text: session.text || '',
  title: session.title,
  timestamp: session.timestamp || Date.now(),
  updatedAt: session.updatedAt || session.timestamp || Date.now(),
  tags: session.tags,
  category: session.category,
  connections: session.connections,
  semanticClusterId: session.semanticClusterId,
  position: session.position,
  importance: session.importance,
  celestialType: session.celestialType,
  embedding: session.embedding?.length ? session.embedding : undefined,
  deletedAt: session.deletedAt,
  deletedByDeviceId: session.deletedByDeviceId,
});

const getSnapshotTombstoneIds = (snapshot: MobileMemorySnapshot): string[] => (
  snapshot.memories
    .filter((memory) => Boolean(memory.deletedAt))
    .map((memory) => memory.id)
);

const getDeltaTombstoneIds = (delta: MobileMemoryDelta): string[] => (
  delta.changes
    .filter((change) => change.op === 'delete')
    .map((change) => change.memory.id)
);

export const buildMobileMemorySnapshot = (
  ownerUid: string,
  sessions: SessionData[]
): MobileMemorySnapshot => ({
  version: 1,
  exportedAt: Date.now(),
  ownerUid,
  source: 'desktop',
  memories: sessions.map(toSnapshotMemory),
});

export const buildMobileMemoryDelta = (
  ownerUid: string,
  deviceId: string,
  source: 'desktop' | 'mobile',
  sessions: SessionData[],
  since = 0
): MobileMemoryDelta => {
  const changes = sessions
    .filter((session) => (session.updatedAt || session.timestamp || 0) > since)
    .map((session) => ({
      op: session.deletedAt ? 'delete' as const : 'upsert' as const,
      memory: toSnapshotMemory(session),
    }));
  const cursor = changes.reduce(
    (max, change) => Math.max(max, change.memory.updatedAt || change.memory.timestamp || 0),
    since
  );

  return {
    version: 1,
    exportedAt: Date.now(),
    ownerUid,
    source,
    deviceId,
    since,
    cursor,
    changes,
  };
};

export const queueMobileMemorySnapshot = async (
  ownerUid: string,
  device: TrustedDevice,
  sessions: SessionData[]
): Promise<string> => {
  if (device.ownerUid !== ownerUid || device.status !== 'active' || !device.publicKeyJwk) {
    throw new Error('Dispositivo confiável inválido ou revogado.');
  }

  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const sharedKey = await deriveSyncKey(keyPair.privateKey, device.publicKeyJwk);
  const senderPublicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const snapshot = buildMobileMemorySnapshot(ownerUid, sessions);
  const encryptedPayload = await encryptJson(snapshot, sharedKey);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const tombstoneIds = getSnapshotTombstoneIds(snapshot);

  const envelopeRef = await addDoc(collection(db, 'mobileSyncEnvelopes'), {
    ownerUid,
    deviceId: device.deviceId,
    direction: 'desktop-to-mobile',
    payloadType: 'memory-snapshot',
    status: 'queued',
    senderPublicKeyJwk,
    encryptedPayload,
    memoryCount: snapshot.memories.length,
    tombstoneIds,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt,
  });

  return envelopeRef.id;
};

export const queueDesktopMemoryDelta = async (
  ownerUid: string,
  device: TrustedDevice,
  sessions: SessionData[],
  since = 0
): Promise<string> => {
  if (device.ownerUid !== ownerUid || device.status !== 'active' || !device.publicKeyJwk) {
    throw new Error('Dispositivo confiável inválido ou revogado.');
  }

  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const sharedKey = await deriveSyncKey(keyPair.privateKey, device.publicKeyJwk);
  const senderPublicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const delta = buildMobileMemoryDelta(ownerUid, device.deviceId, 'desktop', sessions, since);
  const encryptedPayload = await encryptJson(delta, sharedKey);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const tombstoneIds = getDeltaTombstoneIds(delta);

  const envelopeRef = await addDoc(collection(db, 'mobileSyncEnvelopes'), {
    ownerUid,
    deviceId: device.deviceId,
    direction: 'desktop-to-mobile',
    payloadType: 'memory-delta',
    status: 'queued',
    senderPublicKeyJwk,
    encryptedPayload,
    memoryCount: delta.changes.length,
    tombstoneIds,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt,
  });

  return envelopeRef.id;
};

export const queueMobileMemoryDelta = async (
  ownerUid: string,
  credential: { deviceId: string; privateKeyJwk: JsonWebKey },
  sessions: SessionData[],
  since = 0
): Promise<string> => {
  const trustedDeviceSnapshot = await getDoc(doc(db, 'trustedDevices', credential.deviceId));
  if (!trustedDeviceSnapshot.exists()) {
    throw new Error('Este dispositivo ainda não está confiável no desktop.');
  }
  const trustedDevice = trustedDeviceSnapshot.data() as TrustedDevice;
  if (
    trustedDevice.ownerUid !== ownerUid ||
    trustedDevice.status !== 'active' ||
    !trustedDevice.desktopPublicKeyJwk
  ) {
    throw new Error('O desktop ainda não publicou uma chave de sync para este dispositivo.');
  }

  const mobilePrivateKey = await importEcdhPrivateKey(credential.privateKeyJwk);
  const sharedKey = await deriveSyncKey(mobilePrivateKey, trustedDevice.desktopPublicKeyJwk);
  const senderPublicKeyJwk = trustedDevice.publicKeyJwk;
  if (!senderPublicKeyJwk) {
    throw new Error('Chave pública mobile indisponível para este dispositivo.');
  }

  const delta = buildMobileMemoryDelta(ownerUid, credential.deviceId, 'mobile', sessions, since);
  const encryptedPayload = await encryptJson(delta, sharedKey);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const tombstoneIds = getDeltaTombstoneIds(delta);

  const envelopeRef = await addDoc(collection(db, 'mobileSyncEnvelopes'), {
    ownerUid,
    deviceId: credential.deviceId,
    direction: 'mobile-to-desktop',
    payloadType: 'memory-delta',
    status: 'queued',
    senderPublicKeyJwk,
    encryptedPayload,
    memoryCount: delta.changes.length,
    tombstoneIds,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt,
  });

  return envelopeRef.id;
};

export const decryptMobileMemorySnapshot = async (
  envelope: MobileSyncEnvelope,
  mobilePrivateKeyJwk: JsonWebKey
): Promise<MobileMemorySnapshot> => {
  const privateKey = await importEcdhPrivateKey(mobilePrivateKeyJwk);
  const sharedKey = await deriveSyncKey(privateKey, envelope.senderPublicKeyJwk);
  return decryptJson<MobileMemorySnapshot>(envelope.encryptedPayload, sharedKey);
};

export const decryptMobileMemoryDelta = async (
  envelope: MobileSyncEnvelope,
  recipientPrivateKeyJwk: JsonWebKey
): Promise<MobileMemoryDelta> => {
  const privateKey = await importEcdhPrivateKey(recipientPrivateKeyJwk);
  const sharedKey = await deriveSyncKey(privateKey, envelope.senderPublicKeyJwk);
  return decryptJson<MobileMemoryDelta>(envelope.encryptedPayload, sharedKey);
};

const applyIncomingMemories = async (
  ownerUid: string,
  deviceId: string,
  envelopeId: string,
  changes: MobileMemoryDelta['changes'] | Array<{ op: 'upsert'; memory: MobileMemorySnapshot['memories'][number] }>
): Promise<{ imported: number; conflicts: number }> => {
  let imported = 0;
  let conflicts = 0;
  const batch = writeBatch(db);
  const now = Date.now();

  for (const change of changes) {
    const memory = change.memory;
    const memoryRef = doc(db, 'sessions', memory.id);
    const existing = await getDoc(memoryRef);
    const incomingUpdatedAt = memory.updatedAt || memory.timestamp || now;
    const existingData = existing.exists() ? existing.data() : null;
    const existingUpdatedAt = Number(existingData?.updatedAt || existingData?.timestamp || 0);
    const hasTextConflict = Boolean(existingData && existingUpdatedAt > incomingUpdatedAt && existingData.text !== memory.text);

    if (change.op === 'delete') {
      if (!existing.exists() || existingUpdatedAt <= incomingUpdatedAt) {
        batch.set(memoryRef, {
          uid: ownerUid,
          text: existingData?.text || memory.text || '',
          title: existingData?.title || memory.title || null,
          timestamp: existingData?.timestamp || memory.timestamp || incomingUpdatedAt,
          updatedAt: incomingUpdatedAt,
          deletedAt: memory.deletedAt || incomingUpdatedAt,
          deletedByDeviceId: deviceId,
          syncedFromDeviceId: deviceId,
          syncedFromEnvelopeId: envelopeId,
          syncedAt: now,
        }, { merge: true });
        imported += 1;
      }
      continue;
    }

    if (hasTextConflict) {
      const conflictRef = doc(collection(db, 'sessions'));
      batch.set(conflictRef, {
        ...memory,
        uid: ownerUid,
        title: memory.title ? `${memory.title} (conflito de sync)` : 'Conflito de sync',
        tags: Array.from(new Set([...(memory.tags || []), 'sync-conflict'])),
        originalMemoryId: memory.id,
        conflictReason: 'local-newer-than-incoming',
        syncedFromDeviceId: deviceId,
        syncedFromEnvelopeId: envelopeId,
        syncedAt: now,
        updatedAt: now,
      });
      conflicts += 1;
      continue;
    }

    batch.set(memoryRef, {
      ...memory,
      uid: ownerUid,
      syncedFromDeviceId: deviceId,
      syncedFromEnvelopeId: envelopeId,
      syncedAt: now,
    }, { merge: true });
    imported += 1;
  }

  await batch.commit();
  return { imported, conflicts };
};

export const markMobileSyncEnvelopePulled = async (
  ownerUid: string,
  envelopeId: string
): Promise<void> => {
  const envelopeRef = doc(db, 'mobileSyncEnvelopes', envelopeId);
  const snapshot = await getDoc(envelopeRef);
  if (!snapshot.exists() || snapshot.data().ownerUid !== ownerUid) {
    throw new Error('Envelope de sync indisponível.');
  }

  await updateDoc(envelopeRef, {
    status: 'pulled',
    pulledAt: Date.now(),
    updatedAt: serverTimestamp(),
  });
};

export const importQueuedMobileSyncEnvelopes = async (
  ownerUid: string,
  deviceId: string,
  mobilePrivateKeyJwk: JsonWebKey
): Promise<{ importedMemories: number; pulledEnvelopes: number; conflicts: number }> => {
  const envelopesQuery = query(
    collection(db, 'mobileSyncEnvelopes'),
    where('ownerUid', '==', ownerUid),
    where('deviceId', '==', deviceId),
    where('direction', '==', 'desktop-to-mobile'),
    where('status', '==', 'queued')
  );
  const snapshot = await getDocs(envelopesQuery);
  let importedMemories = 0;
  let conflicts = 0;
  let pulledEnvelopes = 0;

  for (const envelopeDoc of snapshot.docs) {
    const envelope = {
      id: envelopeDoc.id,
      ...envelopeDoc.data(),
    } as MobileSyncEnvelope;

    if (envelope.expiresAt <= Date.now()) {
      await updateDoc(envelopeDoc.ref, {
        status: 'failed',
        error: 'expired',
        updatedAt: serverTimestamp(),
      });
      continue;
    }

    const payload = envelope.payloadType === 'memory-delta'
      ? await decryptMobileMemoryDelta(envelope, mobilePrivateKeyJwk)
      : await decryptMobileMemorySnapshot(envelope, mobilePrivateKeyJwk);
    if (payload.version !== 1 || payload.ownerUid !== ownerUid) {
      await updateDoc(envelopeDoc.ref, {
        status: 'failed',
        error: 'owner-mismatch',
        updatedAt: serverTimestamp(),
      });
      continue;
    }

    const changes = 'changes' in payload
      ? payload.changes
      : payload.memories.map((memory) => ({ op: 'upsert' as const, memory }));
    const result = await applyIncomingMemories(ownerUid, deviceId, envelope.id, changes);
    importedMemories += result.imported;
    conflicts += result.conflicts;

    await updateDoc(envelopeDoc.ref, {
      status: 'pulled',
      pulledAt: Date.now(),
      updatedAt: serverTimestamp(),
    });
    pulledEnvelopes += 1;
  }

  return { importedMemories, pulledEnvelopes, conflicts };
};

export const cleanupMobileSyncArtifacts = async (
  ownerUid: string,
  sessions: SessionData[],
  trustedDevices: TrustedDevice[] = [],
  olderThanMs = 30 * 24 * 60 * 60 * 1000
): Promise<{ deletedEnvelopes: number; deletedTombstones: number; retainedTombstones: number }> => {
  const cutoff = Date.now() - olderThanMs;
  const envelopesSnapshot = await getDocs(query(
    collection(db, 'mobileSyncEnvelopes'),
    where('ownerUid', '==', ownerUid)
  ));
  let deletedEnvelopes = 0;
  let deletedTombstones = 0;
  let retainedTombstones = 0;
  const activeDeviceIds = trustedDevices
    .filter((device) => device.status === 'active')
    .map((device) => device.deviceId);
  const pulledTombstonesByDevice = new Map<string, Set<string>>();

  for (const envelopeDoc of envelopesSnapshot.docs) {
    const envelope = envelopeDoc.data() as Partial<MobileSyncEnvelope>;
    if (
      envelope.status === 'pulled' &&
      envelope.direction === 'desktop-to-mobile' &&
      envelope.deviceId &&
      Array.isArray(envelope.tombstoneIds)
    ) {
      const ackedIds = pulledTombstonesByDevice.get(envelope.deviceId) || new Set<string>();
      envelope.tombstoneIds.forEach((memoryId) => ackedIds.add(memoryId));
      pulledTombstonesByDevice.set(envelope.deviceId, ackedIds);
    }

    const isTerminal = envelope.status === 'pulled' || envelope.status === 'failed';
    const staleByExpiry = typeof envelope.expiresAt === 'number' && envelope.expiresAt < cutoff;
    const staleByPulledAt = typeof envelope.pulledAt === 'number' && envelope.pulledAt < cutoff;
    if (isTerminal && (staleByExpiry || staleByPulledAt)) {
      await deleteDoc(envelopeDoc.ref);
      deletedEnvelopes += 1;
    }
  }

  const staleTombstones = sessions.filter((session) => (
    session.deletedAt &&
    session.deletedAt < cutoff &&
    !session.tags?.includes('sync-conflict')
  ));
  for (const tombstone of staleTombstones) {
    const ackedByAllActiveDevices = activeDeviceIds.every((deviceId) => (
      tombstone.deletedByDeviceId === deviceId ||
      Boolean(pulledTombstonesByDevice.get(deviceId)?.has(tombstone.id))
    ));
    if (activeDeviceIds.length > 0 && !ackedByAllActiveDevices) {
      retainedTombstones += 1;
      continue;
    }

    await deleteDoc(doc(db, 'sessions', tombstone.id));
    deletedTombstones += 1;
  }

  return { deletedEnvelopes, deletedTombstones, retainedTombstones };
};

export const importQueuedDesktopSyncEnvelopes = async (
  ownerUid: string,
  deviceId: string,
  desktopPrivateKeyJwk: JsonWebKey
): Promise<{ importedMemories: number; pulledEnvelopes: number; conflicts: number }> => {
  const envelopesQuery = query(
    collection(db, 'mobileSyncEnvelopes'),
    where('ownerUid', '==', ownerUid),
    where('deviceId', '==', deviceId),
    where('direction', '==', 'mobile-to-desktop'),
    where('status', '==', 'queued'),
    orderBy('expiresAt', 'asc')
  );
  const snapshot = await getDocs(envelopesQuery);
  let importedMemories = 0;
  let conflicts = 0;
  let pulledEnvelopes = 0;

  for (const envelopeDoc of snapshot.docs) {
    const envelope = {
      id: envelopeDoc.id,
      ...envelopeDoc.data(),
    } as MobileSyncEnvelope;

    if (envelope.expiresAt <= Date.now()) {
      await updateDoc(envelopeDoc.ref, {
        status: 'failed',
        error: 'expired',
        updatedAt: serverTimestamp(),
      });
      continue;
    }

    const delta = await decryptMobileMemoryDelta(envelope, desktopPrivateKeyJwk);
    if (delta.version !== 1 || delta.ownerUid !== ownerUid || delta.deviceId !== deviceId) {
      await updateDoc(envelopeDoc.ref, {
        status: 'failed',
        error: 'owner-mismatch',
        updatedAt: serverTimestamp(),
      });
      continue;
    }

    const result = await applyIncomingMemories(
      ownerUid,
      deviceId,
      envelope.id,
      delta.changes
    );
    importedMemories += result.imported;
    conflicts += result.conflicts;

    await updateDoc(envelopeDoc.ref, {
      status: 'pulled',
      pulledAt: Date.now(),
      updatedAt: serverTimestamp(),
    });
    pulledEnvelopes += 1;
  }

  return { importedMemories, pulledEnvelopes, conflicts };
};
