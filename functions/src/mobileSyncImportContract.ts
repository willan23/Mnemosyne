/** Shared pure contract: client preparation and server admission use the same canonical state. */
export const MOBILE_SYNC_BATCH_SIZE = 10;
export const MAX_SYNC_CONNECTIONS = 2500;
export interface SyncCipher {v: 1; iv: string; ct: string}
export interface SyncImportChange {
  sessionId: string; expectedStateHash: string | null;
  action: 'create' | 'tombstone' | 'update' | 'delete' | 'conflict' | 'skip';
  incomingRevision: number; timestamp: number; enc?: SyncCipher; metadata?: Record<string, unknown>;
}
export interface SyncImportBatch {
  envelopeId: string; deviceId: string; direction: 'desktop-to-mobile' | 'mobile-to-desktop';
  payloadDigest: string; cursor: number; changes: SyncImportChange[];
}
export interface SyncImportStatus {
  envelopeId: string; payloadDigest: string; cursor: number; memoryCount: number;
  imported: number; conflicts: number; status: 'unknown' | 'pending' | 'complete';
}
export interface SyncImportPreparationInput extends Omit<SyncImportBatch, 'changes'> {sessionIds: string[]}
export interface SyncImportTarget {sessionId: string; exists: boolean; stateHash: string|null; metadataHash: string|null; revision: number|null; timestamp: number|null; deleted: boolean; enc: SyncCipher|null}
export interface SyncImportPreparation {status: SyncImportStatus; targets: SyncImportTarget[]}
const invalid = () => new Error('Invalid encrypted sync request');
export const syncIdValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') && value !== '.' && value !== '..';
export const syncHashValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const syncInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function only(data: Record<string, unknown>, fields: string[]) {
  if (Object.keys(data).some(key => !fields.includes(key))) throw invalid();
}
export function parseSyncCipher(value: unknown): SyncCipher {
  const data = record(value); only(data, ['v','iv','ct']);
  if (data.v !== 1 || typeof data.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(data.iv) || typeof data.ct !== 'string' || data.ct.length < 24 || data.ct.length > 1_000_000 || data.ct.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.ct)) throw invalid();
  return {v: 1, iv: data.iv, ct: data.ct};
}
export const SYNC_MEMORY_METADATA_FIELDS = ['tags','category','connections','semanticClusterId','position','importance','celestialType','embedding','embeddingModel'] as const;
export function parseSyncMetadata(value: unknown): Record<string, unknown> {
  const data = record(value);
  only(data, [...SYNC_MEMORY_METADATA_FIELDS]);
  for (const key of ['category','semanticClusterId','celestialType','embeddingModel']) if (key in data && (typeof data[key] !== 'string' || (data[key] as string).length > 200)) throw invalid();
  for (const key of ['tags','connections']) if (key in data && (!Array.isArray(data[key]) || (data[key] as unknown[]).length > (key === 'connections' ? MAX_SYNC_CONNECTIONS : 100) || (data[key] as unknown[]).some(item => typeof item !== 'string' || item.length > (key === 'connections' ? 128 : 200) || (key === 'connections' && !syncIdValid(item))))) throw invalid();
  if ('importance' in data && (typeof data.importance !== 'number' || !Number.isFinite(data.importance) || data.importance < 0 || data.importance > 1)) throw invalid();
  if ('position' in data && (!Array.isArray(data.position) || data.position.length !== 3 || data.position.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1_000_000))) throw invalid();
  if ('embedding' in data && (!Array.isArray(data.embedding) || data.embedding.length > 4096 || data.embedding.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1_000_000) || !('embeddingModel' in data))) throw invalid();
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}
/** Comparison view only: null/absent optional values and empty vectors match client views. Never projects unrelated authority, attachments or content. */
export function normalizedSyncMetadata(value: unknown): Record<string, unknown> {
  const data = record(value);
  const selected = Object.fromEntries(SYNC_MEMORY_METADATA_FIELDS.filter(key => data[key] != null).map(key => [key,data[key]]));
  // A model label without a nonempty vector does not describe an embedding in the client view.
  if (!('embedding' in selected) || (Array.isArray(selected.embedding) && selected.embedding.length === 0)) {delete selected.embedding;delete selected.embeddingModel;}
  return parseSyncMetadata({tags:[],connections:[],...selected});
}
export function parseSyncImportStatusInput(value: unknown): Omit<SyncImportBatch, 'cursor' | 'changes'> {
  const data = record(value); only(data, ['envelopeId','deviceId','direction','payloadDigest']);
  if (!syncIdValid(data.envelopeId) || !syncIdValid(data.deviceId) || !['desktop-to-mobile','mobile-to-desktop'].includes(String(data.direction)) || !syncHashValid(data.payloadDigest)) throw invalid();
  return {envelopeId: data.envelopeId, deviceId: data.deviceId, direction: data.direction as SyncImportBatch['direction'], payloadDigest: data.payloadDigest};
}
export function parseSyncImportBatch(value: unknown): SyncImportBatch {
  const data = record(value); only(data, ['envelopeId','deviceId','direction','payloadDigest','cursor','changes']);
  const input = parseSyncImportStatusInput(Object.fromEntries(['envelopeId','deviceId','direction','payloadDigest'].map(key => [key, data[key]])));
  if (!syncInteger(data.cursor) || !Array.isArray(data.changes) || data.changes.length > MOBILE_SYNC_BATCH_SIZE) throw invalid();
  const ids = new Set<string>();
  const changes = data.changes.map(value => {
    const change = record(value); only(change, ['sessionId','expectedStateHash','action','incomingRevision','timestamp','enc','metadata']);
    if (!syncIdValid(change.sessionId) || ids.has(change.sessionId) || !(change.expectedStateHash === null || syncHashValid(change.expectedStateHash)) || !['create','tombstone','update','delete','conflict','skip'].includes(String(change.action)) || !syncInteger(change.incomingRevision) || !syncInteger(change.timestamp)) throw invalid();
    ids.add(change.sessionId);
    const result: SyncImportChange = {sessionId: change.sessionId, expectedStateHash: change.expectedStateHash as string | null, action: change.action as SyncImportChange['action'], incomingRevision: change.incomingRevision, timestamp: change.timestamp};
    if (['create','tombstone','update','conflict'].includes(result.action)) {
      result.enc = parseSyncCipher(change.enc); result.metadata = parseSyncMetadata(change.metadata);
      if (['create','tombstone'].includes(result.action) !== (result.expectedStateHash === null)) throw invalid();
    } else if (result.expectedStateHash === null || 'enc' in change || 'metadata' in change) throw invalid();
    return result;
  });
  const result = {...input, cursor: data.cursor, changes};
  if (JSON.stringify(result).length > 8_000_000) throw invalid();
  return result;
}
export function parseSyncImportPreparation(value: unknown): SyncImportPreparationInput {
  const data = record(value); only(data, ['envelopeId','deviceId','direction','payloadDigest','cursor','sessionIds']);
  const input = parseSyncImportStatusInput(Object.fromEntries(['envelopeId','deviceId','direction','payloadDigest'].map(key => [key, data[key]])));
  if (!syncInteger(data.cursor) || !Array.isArray(data.sessionIds) || data.sessionIds.length > MOBILE_SYNC_BATCH_SIZE || data.sessionIds.some(id => !syncIdValid(id)) || new Set(data.sessionIds).size !== data.sessionIds.length) throw invalid();
  return {...input, cursor: data.cursor, sessionIds: [...data.sessionIds] as string[]};
}
/** Tagged types prevent collisions between an SDK timestamp/reference and a similarly shaped map. */
export function canonicalSyncState(value: unknown): string {
  function normalize(value: unknown): unknown {
    if (value === null) return ['null'];
    if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
    if (typeof value === 'number') {if (!Number.isFinite(value)) throw invalid(); return ['number', Object.is(value, -0) ? '-0' : String(value)];}
    if (Array.isArray(value)) return ['array', value.map(normalize)];
    if (!value || typeof value !== 'object') throw invalid();
    const data = value as Record<string, unknown>;
    if (typeof data.toMillis === 'function' && typeof data.seconds === 'number' && typeof data.nanoseconds === 'number') return ['timestamp', data.seconds, data.nanoseconds];
    if (typeof data.isEqual === 'function' && typeof data.latitude === 'number' && typeof data.longitude === 'number') return ['geopoint', data.latitude, data.longitude];
    if (typeof data.path === 'string' && typeof data.id === 'string' && data.firestore && typeof data.withConverter === 'function') {
      const store = data.firestore as {projectId?: unknown; databaseId?: unknown; _databaseId?: {projectId?: unknown; database?: unknown}};
      const project = store.projectId ?? store._databaseId?.projectId;
      const database = store.databaseId ?? store._databaseId?.database;
      if (typeof project !== 'string' || !project || typeof database !== 'string' || !database) throw invalid();
      return ['reference', project, database, data.path];
    }
    if (value instanceof Uint8Array) return ['bytes', Array.from(value)];
    if (typeof data.toUint8Array === 'function') return ['bytes', Array.from((data.toUint8Array as () => Uint8Array)())];
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw invalid();
    return ['map', Object.keys(data).sort().map(key => [key, normalize(data[key])])];
  }
  return JSON.stringify(normalize(value));
}
