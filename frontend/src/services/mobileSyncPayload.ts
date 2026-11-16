import {parseSyncMetadata, SYNC_MEMORY_METADATA_FIELDS, syncIdValid, syncInteger} from '../../../functions/src/mobileSyncImportContract';
import type {MobileMemoryDelta, MobileMemorySnapshot, MobileSyncEnvelope} from './mobileSync';

export class MobileSyncImportError extends Error {
  constructor() {super('A sincronização aguarda confirmação. Conservámos os dados para poderes retomar depois de atualizar a conta, o cofre e o dispositivo.');}
}
export const invalidSync = () => new MobileSyncImportError();
export function syncRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalidSync();
  return value as Record<string, unknown>;
}
export function syncFields(data: Record<string, unknown>, fields: string[]) {
  if (Object.keys(data).some(key => !fields.includes(key))) throw invalidSync();
}
export const memoryMetadataFields:readonly string[] = SYNC_MEMORY_METADATA_FIELDS;
export const memoryMetadata = (memory: MobileMemorySnapshot['memories'][number]) => parseSyncMetadata(Object.fromEntries(memoryMetadataFields.filter(key => key in memory).map(key => [key, (memory as unknown as Record<string, unknown>)[key]])));
function parseMemory(value: unknown): MobileMemorySnapshot['memories'][number] {
  const data = syncRecord(value);
  syncFields(data, ['id','text','title','timestamp','updatedAt','deletedAt','deletedByDeviceId', ...memoryMetadataFields]);
  if (!syncIdValid(data.id) || typeof data.text !== 'string' || data.text.length > 100000 ||
    ('title' in data && (typeof data.title !== 'string' || data.title.length > 1000)) || !syncInteger(data.timestamp) || !syncInteger(data.updatedAt) ||
    ('deletedAt' in data && (!syncInteger(data.deletedAt) || data.deletedAt < 1 || data.deletedAt > data.updatedAt)) ||
    ('deletedByDeviceId' in data && !syncIdValid(data.deletedByDeviceId))) throw invalidSync();
  const metadata = parseSyncMetadata(Object.fromEntries(memoryMetadataFields.filter(key => key in data).map(key => [key, data[key]])));
  return {id: data.id, text: data.text, timestamp: data.timestamp, updatedAt: data.updatedAt,
    ...('title' in data ? {title: data.title as string} : {}), ...metadata,
    ...('deletedAt' in data ? {deletedAt: data.deletedAt as number} : {}), ...('deletedByDeviceId' in data ? {deletedByDeviceId: data.deletedByDeviceId as string} : {})};
}
/** Validate the entire decrypted payload before preparing the first mutation. No caller authority is spread into sessions. */
export function parseMobileSyncPayload(value: unknown, envelope: Pick<MobileSyncEnvelope,'ownerUid'|'deviceId'|'direction'|'payloadType'|'memoryCount'|'tombstoneIds'>): MobileMemoryDelta['changes'] {
  const data = syncRecord(value); const delta = envelope.payloadType === 'memory-delta';
  syncFields(data, delta ? ['version','exportedAt','ownerUid','source','deviceId','since','cursor','changes'] : ['version','exportedAt','ownerUid','source','memories']);
  const source = envelope.direction === 'desktop-to-mobile' ? 'desktop' : 'mobile';
  if (data.version !== 1 || data.ownerUid !== envelope.ownerUid || data.source !== source || !syncInteger(data.exportedAt) ||
    (!delta && source !== 'desktop')) throw invalidSync();
  const list = delta ? data.changes : data.memories;
  if (!Array.isArray(list) || list.length > 2500 || list.length !== envelope.memoryCount) throw invalidSync();
  const ids = new Set<string>();
  const changes = list.map(value => {
    let op: 'upsert' | 'delete'; let memory: MobileMemorySnapshot['memories'][number];
    if (delta) {
      const change = syncRecord(value); syncFields(change, ['op','memory']);
      if (!['upsert','delete'].includes(String(change.op))) throw invalidSync();
      op = change.op as 'upsert'|'delete'; memory = parseMemory(change.memory);
      if ((op === 'delete') !== (memory.deletedAt !== undefined)) throw invalidSync();
    } else {memory = parseMemory(value); op = memory.deletedAt === undefined ? 'upsert' : 'delete';}
    if (ids.has(memory.id)) throw invalidSync(); ids.add(memory.id); return {op, memory};
  });
  if (delta && (data.deviceId !== envelope.deviceId || !syncInteger(data.since) || !syncInteger(data.cursor) || data.cursor < data.since ||
    changes.some(change => change.memory.updatedAt <= Number(data.since)) ||
    data.cursor !== changes.reduce((max, change) => Math.max(max, change.memory.updatedAt), Number(data.since)))) throw invalidSync();
  const tombstones = changes.filter(change => change.op === 'delete').map(change => change.memory.id).sort();
  if (!Array.isArray(envelope.tombstoneIds) || envelope.tombstoneIds.some(id => !syncIdValid(id)) || new Set(envelope.tombstoneIds).size !== envelope.tombstoneIds.length ||
    JSON.stringify([...envelope.tombstoneIds].sort()) !== JSON.stringify(tombstones)) throw invalidSync();
  return changes;
}
