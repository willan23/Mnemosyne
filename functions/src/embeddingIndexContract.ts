import {attachmentActorIdValid, attachmentIdValid} from './attachmentEnvelope';
import {canonicalSyncState, syncHashValid, syncIdValid, syncInteger} from './mobileSyncImportContract';
import {teamRevisionRecord} from './teamRevisionContract';

// Server admission is intentionally narrower than discovery of local experimental profiles.
export const EMBEDDING_INDEX_TARGET_SPACE = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2@2c4055b12046f11709e9df2c122e59ffbdc2f900:q8:mean:norm';
export const EMBEDDING_INDEX_DIMENSIONS = 384;
export interface EmbeddingIndexTarget {sessionId: string; viewDigest: string}
export interface EmbeddingIndexBaseline {
  sessionId: string; ownerUid: string; stateHash: string; stateDigest: string; contentDigest: string; revision: number;
}
export type EmbeddingIndexChange = {kind: 'publish'; space: string; vector: number[]} | {kind: 'rollback'; versionId: string};
export interface EmbeddingIndexRequest {operationId: string; baseline: EmbeddingIndexBaseline; change: EmbeddingIndexChange}
export interface EmbeddingIndexOutcome {
  operationId: string; sessionId: string; digest: string; status: 'unknown'|'committed'|'cancelled'|'revoked';
  revision: number|null; versionId: string|null; createdAt: number|null;
}
export type EmbeddingIndexCall = 'prepare'|'apply'|'status'|'cancel';
const fail = () => Error('Invalid embedding index request');
export function parseEmbeddingIndexTarget(value: unknown): EmbeddingIndexTarget {
  const row=teamRevisionRecord(value,['sessionId','viewDigest']);
  if(!syncIdValid(row.sessionId)||!syncHashValid(row.viewDigest))throw fail();
  return {sessionId:row.sessionId,viewDigest:row.viewDigest};
}
export function parseEmbeddingIndexBaseline(value: unknown): EmbeddingIndexBaseline {
  const row=teamRevisionRecord(value,['sessionId','ownerUid','stateHash','stateDigest','contentDigest','revision']);
  if(!syncIdValid(row.sessionId)||!attachmentActorIdValid(row.ownerUid)||!syncHashValid(row.stateHash)||
    !syncHashValid(row.stateDigest)||!syncHashValid(row.contentDigest)||!syncInteger(row.revision))throw fail();
  return {sessionId:row.sessionId,ownerUid:row.ownerUid,stateHash:row.stateHash,stateDigest:row.stateDigest,contentDigest:row.contentDigest,revision:row.revision};
}
export function parseEmbeddingIndexChange(value: unknown): EmbeddingIndexChange {
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail();
  if((value as {kind?:unknown}).kind==='rollback'){
    const row=teamRevisionRecord(value,['kind','versionId']);
    if(typeof row.versionId!=='string'||!/^embedding-index-[a-f0-9-]{36}$/.test(row.versionId)||!attachmentIdValid(row.versionId.slice(16)))throw fail();
    return {kind:'rollback',versionId:row.versionId};
  }
  const row=teamRevisionRecord(value,['kind','space','vector']);
  if(row.kind!=='publish'||row.space!==EMBEDDING_INDEX_TARGET_SPACE||!Array.isArray(row.vector)||
    row.vector.length!==EMBEDDING_INDEX_DIMENSIONS||!row.vector.every(x=>typeof x==='number'&&Number.isFinite(x)))throw fail();
  const norm=Math.sqrt(row.vector.reduce((sum,x)=>sum+x*x,0));
  if(!Number.isFinite(norm)||Math.abs(norm-1)>.005)throw fail();
  return {kind:'publish',space:row.space,vector:[...row.vector]};
}
export function parseEmbeddingIndexRequest(value: unknown): EmbeddingIndexRequest {
  const row=teamRevisionRecord(value,['operationId','baseline','change']);if(!attachmentIdValid(row.operationId))throw fail();
  return {operationId:row.operationId,baseline:parseEmbeddingIndexBaseline(row.baseline),change:parseEmbeddingIndexChange(row.change)};
}
export const embeddingIndexRequestBytes = (input: EmbeddingIndexRequest) => canonicalSyncState(parseEmbeddingIndexRequest(input));
export function parseEmbeddingIndexCommand(mode: EmbeddingIndexCall, value: unknown) {
  const row=teamRevisionRecord(value,['actorUid','request']);
  if(!attachmentActorIdValid(row.actorUid)||!['prepare','apply','status','cancel'].includes(mode))throw fail();
  return {actorUid:row.actorUid,request:mode==='prepare'?parseEmbeddingIndexTarget(row.request):parseEmbeddingIndexRequest(row.request)};
}
