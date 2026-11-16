'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const space=require('../lib/sharedEmbeddingSpace'),publication=require('../lib/embeddingIndexContract'),profiles=require('../../frontend/src/services/embeddingProfiles.json');
const {buildSemanticRelationProposalsForSource}=require('../lib/semanticRelationsGraph');
test('new memory embeddings use the exact reviewed multilingual weights and publication space',()=>{
 const profile=profiles[space.CURRENT_EMBEDDING_PROFILE];assert(profile);assert.equal(space.CURRENT_EMBEDDING_MODEL,profile.modelId);
 assert.equal(space.CURRENT_EMBEDDING_SPACE,`${profile.modelId}@${profile.revision}:${profile.dtype}:${profile.pooling}:norm`);
 assert.equal(space.CURRENT_EMBEDDING_SPACE,publication.EMBEDDING_INDEX_TARGET_SPACE);assert.equal(profile.dimensions,publication.EMBEDDING_INDEX_DIMENSIONS);
 assert.notEqual(space.CURRENT_EMBEDDING_SPACE,space.LEGACY_EMBEDDING_SPACE);
});
test('an absent historical marker never changes meaning when the default model changes',()=>{
 for(const marker of [undefined,null,'','  ']){assert.equal(space.embeddingSpaceOf(marker),space.LEGACY_EMBEDDING_SPACE);assert(space.sameEmbeddingSpace(marker,space.LEGACY_EMBEDDING_SPACE));assert(!space.sameEmbeddingSpace(marker,space.CURRENT_EMBEDDING_SPACE));}
 assert.equal(space.embeddingSpaceOf('unknown@1'),'unknown@1');assert(!space.sameEmbeddingSpace('unknown@1',space.CURRENT_EMBEDDING_SPACE));
});
test('inferred relations retain both historical and multilingual groups without comparing them',()=>{
 const rows=[{id:'old-a',embedding:[1,0],connections:[],updatedAt:1},{id:'old-b',embedding:[1,0],connections:[],updatedAt:1},
  {id:'new-a',embedding:[1,0],embeddingModel:space.CURRENT_EMBEDDING_SPACE,connections:[],updatedAt:1},{id:'new-b',embedding:[1,0],embeddingModel:space.CURRENT_EMBEDDING_SPACE,connections:[],updatedAt:1}];
 const before=JSON.stringify(rows);
 assert.deepEqual(buildSemanticRelationProposalsForSource(rows[0],rows).map(r=>[r.targetId,r.embeddingModel]),[['old-b',space.LEGACY_EMBEDDING_SPACE]]);
 assert.deepEqual(buildSemanticRelationProposalsForSource(rows[2],rows).map(r=>[r.targetId,r.embeddingModel]),[['new-b',space.CURRENT_EMBEDDING_SPACE]]);
 assert.equal(JSON.stringify(rows),before);
});
