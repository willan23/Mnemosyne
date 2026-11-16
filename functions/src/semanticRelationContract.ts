import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
import {canonicalSyncState,syncHashValid,syncIdValid,syncInteger} from './mobileSyncImportContract';
import {teamRevisionRecord,teamRevisionTime} from './teamRevisionContract';
import {semanticClusterGraphProjection} from './semanticClusterContract';
import {embeddingSpaceOf} from './sharedEmbeddingSpace';
import type {SemanticRelationProposal} from './semanticRelationsGraph';

export const SEMANTIC_RELATION_MAX_CANDIDATES=20_000,SEMANTIC_RELATION_MAX_BYTES=6_000_000;
export type SemanticRelationCall='prepare-candidates'|'prepare-review'|'apply'|'status'|'cancel';
export interface SemanticRelationDependency{sessionId:string;stateHash:string;revision:number}
export interface SemanticRelationCandidates{kind:'candidates';ownerUid:string;dependencies:SemanticRelationDependency[]}
export interface SemanticRelationCandidateTarget{views:Array<{sessionId:string;viewHash:string}>}
export interface SemanticRelationReviewTarget{sourceId:string;targetId:string;sourceViewDigest:string;targetViewDigest:string;suggestionViewDigest:string}
export interface SemanticRelationReviewBase{kind:'review';ownerUid:string;sourceId:string;targetId:string;sourceHash:string;targetHash:string;suggestionHash:string;counterpartHash:string;sourceRevision:number;targetRevision:number}
export interface SemanticRelationSuggestionRequest{kind:'suggest';operationId:string;ownerUid:string;sourceId:string;dependencies:SemanticRelationDependency[];proposals:SemanticRelationProposal[]}
export interface SemanticRelationReviewRequest{kind:'review';operationId:string;baseline:SemanticRelationReviewBase;decision:'accepted'|'rejected'}
export type SemanticRelationRequest=SemanticRelationSuggestionRequest|SemanticRelationReviewRequest;
export interface SemanticRelationOutcome{operationId:string;kind:'suggest'|'review';digest:string;status:'unknown'|'committed'|'cancelled'|'revoked';changes:number|null;createdAt:number|null}
const fail=()=>Error('Invalid scoped relation metadata request');
const bounded=<T>(value:T)=>{if(new TextEncoder().encode(canonicalSyncState(value)).length>SEMANTIC_RELATION_MAX_BYTES)throw fail();return value;};
export function semanticRelationProjection(id:string,row:Record<string,unknown>){
  const scope=semanticClusterGraphProjection(id,row),revision=teamRevisionTime(row.updatedAt??row.timestamp);
  let vector:unknown=row.embedding;if(typeof vector==='string'){try{vector=JSON.parse(vector);}catch{throw fail();}}
  if(scope.teamId!==null||scope.sharedWithIds.length||revision===null||!Array.isArray(vector)||!vector.length||vector.length>2048||!vector.every(value=>typeof value==='number'&&Number.isFinite(value))||row.embeddingModel!=null&&(typeof row.embeddingModel!=='string'||!row.embeddingModel.trim()||row.embeddingModel.length>128))throw fail();
  return {sessionId:id,uid:scope.uid,teamId:null,revision,connections:scope.connections,embedding:vector as number[],embeddingModel:embeddingSpaceOf(row.embeddingModel)};
}
export function parseSemanticRelationCandidateTarget(value:unknown):SemanticRelationCandidateTarget{
  const row=teamRevisionRecord(value,['views']);if(!Array.isArray(row.views)||!row.views.length||row.views.length>SEMANTIC_RELATION_MAX_CANDIDATES)throw fail();
  const views=row.views.map(value=>{const row=teamRevisionRecord(value,['sessionId','viewHash']);if(!syncIdValid(row.sessionId)||!syncHashValid(row.viewHash))throw fail();return{sessionId:row.sessionId,viewHash:row.viewHash};});if(new Set(views.map(row=>row.sessionId)).size!==views.length)throw fail();return bounded({views});
}
export function parseSemanticRelationCandidates(value:unknown):SemanticRelationCandidates{
  const row=teamRevisionRecord(value,['kind','ownerUid','dependencies']);if(row.kind!=='candidates'||!attachmentActorIdValid(row.ownerUid)||!Array.isArray(row.dependencies)||!row.dependencies.length||row.dependencies.length>SEMANTIC_RELATION_MAX_CANDIDATES)throw fail();
  const dependencies=row.dependencies.map(value=>{const row=teamRevisionRecord(value,['sessionId','stateHash','revision']);if(!syncIdValid(row.sessionId)||!syncHashValid(row.stateHash)||!syncInteger(row.revision))throw fail();return{sessionId:row.sessionId,stateHash:row.stateHash,revision:row.revision};});if(new Set(dependencies.map(row=>row.sessionId)).size!==dependencies.length)throw fail();return bounded({kind:'candidates',ownerUid:row.ownerUid,dependencies});
}
export function parseSemanticRelationReviewTarget(value:unknown):SemanticRelationReviewTarget{
  const row=teamRevisionRecord(value,['sourceId','targetId','sourceViewDigest','targetViewDigest','suggestionViewDigest']);if(!syncIdValid(row.sourceId)||!syncIdValid(row.targetId)||row.sourceId===row.targetId||!['sourceViewDigest','targetViewDigest','suggestionViewDigest'].every(key=>syncHashValid(row[key])))throw fail();return{sourceId:row.sourceId,targetId:row.targetId,sourceViewDigest:row.sourceViewDigest as string,targetViewDigest:row.targetViewDigest as string,suggestionViewDigest:row.suggestionViewDigest as string};
}
export function parseSemanticRelationReviewBase(value:unknown):SemanticRelationReviewBase{
  const row=teamRevisionRecord(value,['kind','ownerUid','sourceId','targetId','sourceHash','targetHash','suggestionHash','counterpartHash','sourceRevision','targetRevision']);if(row.kind!=='review'||!attachmentActorIdValid(row.ownerUid)||!syncIdValid(row.sourceId)||!syncIdValid(row.targetId)||row.sourceId===row.targetId||!['sourceHash','targetHash','suggestionHash','counterpartHash'].every(key=>syncHashValid(row[key]))||!syncInteger(row.sourceRevision)||!syncInteger(row.targetRevision))throw fail();
  return{kind:'review',ownerUid:row.ownerUid,sourceId:row.sourceId,targetId:row.targetId,sourceHash:row.sourceHash as string,targetHash:row.targetHash as string,suggestionHash:row.suggestionHash as string,counterpartHash:row.counterpartHash as string,sourceRevision:row.sourceRevision,targetRevision:row.targetRevision};
}
export function parseSemanticRelationProposal(value:unknown):SemanticRelationProposal{
  const row=teamRevisionRecord(value,['sourceId','targetId','score','embeddingModel','algorithmVersion','evidence','sourceUpdatedAt','targetUpdatedAt']);if(!syncIdValid(row.sourceId)||!syncIdValid(row.targetId)||row.sourceId===row.targetId||typeof row.score!=='number'||!Number.isFinite(row.score)||row.score<.75||row.score>1||typeof row.embeddingModel!=='string'||!row.embeddingModel.trim()||row.embeddingModel.length>128||row.algorithmVersion!=='cosine-v1'||row.evidence!=='whole-memory-vector'||!syncInteger(row.sourceUpdatedAt)||!syncInteger(row.targetUpdatedAt))throw fail();
  return{sourceId:row.sourceId,targetId:row.targetId,score:row.score,embeddingModel:row.embeddingModel,algorithmVersion:'cosine-v1',evidence:'whole-memory-vector',sourceUpdatedAt:row.sourceUpdatedAt,targetUpdatedAt:row.targetUpdatedAt};
}
export function parseSemanticRelationRequest(value:unknown):SemanticRelationRequest{
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail();const kind=(value as {kind:unknown}).kind;
  if(kind==='review'){const row=teamRevisionRecord(value,['kind','operationId','baseline','decision']);if(!attachmentIdValid(row.operationId)||!['accepted','rejected'].includes(row.decision as string))throw fail();return bounded({kind,operationId:row.operationId,baseline:parseSemanticRelationReviewBase(row.baseline),decision:row.decision as 'accepted'|'rejected'});}
  const row=teamRevisionRecord(value,['kind','operationId','ownerUid','sourceId','dependencies','proposals']);if(kind!=='suggest'||!attachmentIdValid(row.operationId)||!syncIdValid(row.sourceId)||!Array.isArray(row.proposals)||row.proposals.length>7)throw fail();const prepared=parseSemanticRelationCandidates({kind:'candidates',ownerUid:row.ownerUid,dependencies:row.dependencies});if(prepared.dependencies.length>8||!prepared.dependencies.some(dependency=>dependency.sessionId===row.sourceId))throw fail();
  const ids=new Set(prepared.dependencies.map(row=>row.sessionId)),proposals=row.proposals.map(parseSemanticRelationProposal);if(new Set(proposals.map(row=>row.targetId)).size!==proposals.length||proposals.some(proposal=>proposal.sourceId!==row.sourceId||!ids.has(proposal.targetId))||ids.size!==new Set([row.sourceId,...proposals.map(row=>row.targetId)]).size)throw fail();
  return bounded({kind:'suggest',operationId:row.operationId,ownerUid:prepared.ownerUid,sourceId:row.sourceId,dependencies:prepared.dependencies,proposals});
}
export const semanticRelationRequestBytes=(value:SemanticRelationRequest)=>canonicalSyncState(parseSemanticRelationRequest(value));
export function parseSemanticRelationCommand(mode:SemanticRelationCall,value:unknown){const row=teamRevisionRecord(value,['actorUid','request']);if(!attachmentActorIdValid(row.actorUid))throw fail();return{actorUid:row.actorUid,request:mode==='prepare-candidates'?parseSemanticRelationCandidateTarget(row.request):mode==='prepare-review'?parseSemanticRelationReviewTarget(row.request):['apply','status','cancel'].includes(mode)?parseSemanticRelationRequest(row.request):(()=>{throw fail();})()};}
