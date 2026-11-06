import type {SessionData} from '../hooks/useSessions';
import type {EncryptedPairingPayload,TrustedDevice} from './mobilePairing';
import {MOBILE_SYNC_WRITES_ENABLED} from '../config/releaseGates';
import {importPersonalMobileSync} from './mobileSyncImport';
import {queuePersonalSyncSnapshot,queuePersonalSyncDelta} from './mobileSyncOutbox';
export {buildMobileMemorySnapshot,buildMobileMemoryDelta,personalSyncSessions} from './mobileSyncBuilders';
const assertSyncWritesEnabled=()=>{if(!MOBILE_SYNC_WRITES_ENABLED)throw new Error('A sincronização está temporariamente em validação. Os envelopes existentes foram conservados.');};

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
    embeddingModel?: string;
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

export const queueMobileMemorySnapshot = async (uid: string, device: TrustedDevice, sessions: SessionData[]) => {
  assertSyncWritesEnabled(); if (device.ownerUid !== uid || device.status !== 'active') throw new Error('Dispositivo inválido ou revogado.');
  return queuePersonalSyncSnapshot(uid,device.deviceId,sessions);
};
export const queueDesktopMemoryDelta = async (uid: string, device: TrustedDevice, sessions: SessionData[]) => {
  assertSyncWritesEnabled(); if (device.ownerUid !== uid || device.status !== 'active') throw new Error('Dispositivo inválido ou revogado.');
  return queuePersonalSyncDelta(uid,device.deviceId,'desktop-to-mobile',sessions);
};
export const queueMobileMemoryDelta = async (uid: string, credential: {deviceId:string;privateKeyJwk:JsonWebKey}, sessions: SessionData[]) => {
  assertSyncWritesEnabled(); return queuePersonalSyncDelta(uid,credential.deviceId,'mobile-to-desktop',sessions,credential.privateKeyJwk);
};
/** Completion belongs to the atomic server import; callers cannot issue a separate ACK. */
export const markMobileSyncEnvelopePulled = async (ownerUid: string, envelopeId: string): Promise<void> => {
  assertSyncWritesEnabled(); void ownerUid; void envelopeId; throw new Error('A confirmação é feita automaticamente durante a importação.');
};
export const importQueuedMobileSyncEnvelopes = async (ownerUid: string, deviceId: string, privateKey: JsonWebKey) => {
  assertSyncWritesEnabled(); return importPersonalMobileSync(ownerUid,deviceId,'desktop-to-mobile',privateKey);
};
export const importQueuedDesktopSyncEnvelopes = async (ownerUid: string, deviceId: string, privateKey: JsonWebKey) => {
  assertSyncWritesEnabled(); return importPersonalMobileSync(ownerUid,deviceId,'mobile-to-desktop',privateKey);
};
/** Retention requires server proof of committed receipts and device coverage. Keep all artifacts until that rollout is validated. */
export const cleanupMobileSyncArtifacts = async (ownerUid: string, sessions: SessionData[], devices: TrustedDevice[] = [], olderThanMs = 30*24*60*60*1000): Promise<{deletedEnvelopes:number;deletedTombstones:number;retainedTombstones:number}> => {
  assertSyncWritesEnabled(); void ownerUid; void sessions; void devices; void olderThanMs; throw new Error('A retenção está em validação. Os envelopes e registos de eliminação foram conservados.');
};
