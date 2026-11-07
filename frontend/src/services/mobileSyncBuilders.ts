import type {SessionData} from '../hooks/useSessions';
import type {MobileMemoryDelta,MobileMemorySnapshot} from './mobileSync';
import {MemoryCryptoLockedError} from './memoryCrypto';

/** Impede sync com conteúdo bloqueado: enviaria placeholders e corromperia o outro lado. */
const assertSessionsSyncable = (sessions: readonly SessionData[]): void => {
  if (sessions.some((session) => session.encLocked)) {
    throw new MemoryCryptoLockedError();
  }
};

/** This channel carries personal memories; team/shared content uses its own key and authority. */
export const personalSyncSessions = (ownerUid: string, sessions: readonly SessionData[]): SessionData[] => sessions.filter(session =>
  session.uid === ownerUid && session.teamId == null && !session.teamScopeAmbiguous &&
  (session.sharedWithIds == null || (Array.isArray(session.sharedWithIds) && session.sharedWithIds.length === 0)));

const toSnapshotMemory = (session: SessionData): MobileMemorySnapshot['memories'][number] => ({
  id: session.id,
  text: session.text || '',
  title: session.title,
  timestamp: session.timestamp,
  updatedAt: session.updatedAt ?? session.timestamp,
  tags: session.tags,
  category: session.category,
  connections: session.connections,
  semanticClusterId: session.semanticClusterId,
  position: session.position,
  importance: session.importance,
  celestialType: session.celestialType,
  embedding: session.embedding?.length ? session.embedding : undefined,
  embeddingModel: session.embedding?.length ? session.embeddingModel : undefined,
  deletedAt: session.deletedAt,
  deletedByDeviceId: session.deletedByDeviceId,
});

export const buildMobileMemorySnapshot = (
  ownerUid: string,
  sessions: readonly SessionData[]
): MobileMemorySnapshot => {
  sessions = personalSyncSessions(ownerUid, sessions);
  assertSessionsSyncable(sessions);
  return {
    version: 1,
    exportedAt: Date.now(),
    ownerUid,
    source: 'desktop',
    memories: sessions.map(toSnapshotMemory),
  };
};

export const buildMobileMemoryDelta = (
  ownerUid: string,
  deviceId: string,
  source: 'desktop' | 'mobile',
  sessions: readonly SessionData[],
  since = 0
): MobileMemoryDelta => {
  sessions = personalSyncSessions(ownerUid, sessions);
  assertSessionsSyncable(sessions);
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

