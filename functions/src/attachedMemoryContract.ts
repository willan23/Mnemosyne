/** Pure shared contract. Plaintext memory fields and URLs are never accepted. */
import { attachmentActorIdValid, attachmentIdValid } from './attachmentEnvelope';
export interface AttachedMemoryInput {
  sessionId: string; teamId: string | null; keyEpoch: number | null; keyId: string | null;
  enc: { v: 1 | 2; iv: string; ct: string }; attachmentIds: string[]; metadata: Record<string, unknown>;
}
export function parseAttachedMemoryCommand(value:unknown):{actorUid:string;request:AttachedMemoryInput}{
  if(!object(value)||!exact(value,['actorUid','request'])||!attachmentActorIdValid(value.actorUid))throw new AttachedMemoryContractError();return{actorUid:value.actorUid,request:parseAttachedMemoryInput(value.request)};
}
export class AttachedMemoryContractError extends Error { constructor() { super('Invalid attached memory request'); } }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);
const boundedString = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit &&
  !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const stringFields = ['category', 'embeddingModel', 'semanticClusterId', 'celestialType', 'processingMethod', 'taxonomyLane', 'projectStatus',
  'generatedProvider', 'generatedModel', 'generatedImageProvider', 'generatedImageModel'];
export function canonicalAttachedMemoryJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAttachedMemoryJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalAttachedMemoryJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function parseMemoryCreationMetadata(data: unknown, sessionId: string, teamId: string | null, attachmentCount: number): Record<string, unknown> {
  if (!object(data) || !attachmentIdValid(sessionId) || !(teamId === null || attachmentActorIdValid(teamId)) || !Number.isSafeInteger(attachmentCount) || attachmentCount < 0 || attachmentCount > 20) throw new AttachedMemoryContractError();
  const allowed = [...stringFields, 'tags', 'embedding', 'position', 'importance', 'connections', 'parentId', 'learning', 'webResearch', 'nodes', 'links'];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new AttachedMemoryContractError();
  for (const key of stringFields) if (key in data && data[key] !== null && !boundedString(data[key], 256)) throw new AttachedMemoryContractError();
  if (data.tags != null && (!Array.isArray(data.tags) || data.tags.length > 50 || data.tags.some(tag => !boundedString(tag, 128)))) throw new AttachedMemoryContractError();
  if (data.embedding != null && (!Array.isArray(data.embedding) || data.embedding.length > 4096 || data.embedding.some(x => typeof x !== 'number' || !Number.isFinite(x)))) throw new AttachedMemoryContractError();
  if (data.position != null && (!Array.isArray(data.position) || data.position.length !== 3 || data.position.some(x => typeof x !== 'number' || !Number.isFinite(x)))) throw new AttachedMemoryContractError();
  if (data.importance != null && (typeof data.importance !== 'number' || !Number.isFinite(data.importance) || data.importance < 0 || data.importance > 1)) throw new AttachedMemoryContractError();
  if (data.connections != null && (!Array.isArray(data.connections) || data.connections.length > 20 || data.connections.some(id => !attachmentActorIdValid(id)) ||
      new Set(data.connections).size !== data.connections.length || data.connections.includes(sessionId))) throw new AttachedMemoryContractError();
  if (teamId !== null && Array.isArray(data.connections) && data.connections.length) throw new AttachedMemoryContractError();
  if (data.parentId != null && !attachmentActorIdValid(data.parentId)) throw new AttachedMemoryContractError();
  if (teamId !== null && data.parentId != null) throw new AttachedMemoryContractError();
  for (const key of ['nodes', 'links']) if (data[key] !== undefined && data[key] !== null && (!Array.isArray(data[key]) || data[key].length !== 0)) throw new AttachedMemoryContractError();
  if (data.webResearch != null) {
    const value = data.webResearch;
    if (!object(value) || !exact(value, ['mode', 'savedAt']) || !['public', 'contextual', 'private-local'].includes(value.mode as string) ||
        !Number.isSafeInteger(value.savedAt) || (value.savedAt as number) < 1) throw new AttachedMemoryContractError();
  }
  if (data.learning != null) {
    const value = data.learning;
    if (!object(value) || !exact(value, ['schemaVersion', 'source', 'modality', 'learnedAt', 'batchId', 'attachmentCount']) || value.schemaVersion !== 1 ||
        !boundedString(value.source, 64) || !['text', 'image', 'audio', 'video', 'document', 'mixed'].includes(value.modality as string) ||
        !Number.isSafeInteger(value.learnedAt) || (value.learnedAt as number) < 1 ||
        !(value.batchId === null || boundedString(value.batchId, 128)) || value.attachmentCount !== attachmentCount) throw new AttachedMemoryContractError();
  }
  return JSON.parse(canonicalAttachedMemoryJson(data)) as Record<string, unknown>;
}
export function parseAttachedMemoryInput(input: unknown): AttachedMemoryInput {
  if (!object(input) || !exact(input, ['sessionId', 'teamId', 'keyEpoch', 'keyId', 'enc', 'attachmentIds', 'metadata']) ||
      !attachmentIdValid(input.sessionId) || !(input.teamId === null || attachmentActorIdValid(input.teamId)) ||
      !object(input.enc) || !exact(input.enc, ['v', 'iv', 'ct']) || input.enc.v !== (input.teamId === null ? 1 : 2) ||
      typeof input.enc.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(input.enc.iv) || typeof input.enc.ct !== 'string' ||
      input.enc.ct.length < 24 || input.enc.ct.length > 400000 || input.enc.ct.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.enc.ct) ||
      !Array.isArray(input.attachmentIds) || input.attachmentIds.length > 20 ||
      input.attachmentIds.some(id => !attachmentIdValid(id)) || new Set(input.attachmentIds).size !== input.attachmentIds.length || !object(input.metadata)) throw new AttachedMemoryContractError();
  if (input.teamId === null ? input.keyEpoch !== null || input.keyId !== null :
      !Number.isSafeInteger(input.keyEpoch) || (input.keyEpoch as number) < 1 || !attachmentIdValid(input.keyId)) throw new AttachedMemoryContractError();
  const metadata = parseMemoryCreationMetadata(input.metadata, input.sessionId, input.teamId, input.attachmentIds.length);
  const result: AttachedMemoryInput = { sessionId: input.sessionId, teamId: input.teamId, keyEpoch: input.keyEpoch as number | null, keyId: input.keyId as string | null,
    enc: { v: input.enc.v as 1 | 2, iv: input.enc.iv, ct: input.enc.ct }, attachmentIds: [...input.attachmentIds].sort(),
    metadata };
  if (new TextEncoder().encode(canonicalAttachedMemoryJson(result)).length > 500000) throw new AttachedMemoryContractError(); return result;
}
