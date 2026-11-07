const assert = require('node:assert/strict'); const test = require('node:test');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const { parseAttachedMemoryInput, parseAttachedMemoryCommand, canonicalAttachedMemoryJson } = require('../lib/attachedMemoryContract');
const { createAttachedMemory, createPersonalMemory,createTeamMemory, getAttachedMemoryCreationStatus,cancelAttachedMemoryCreation,executeAttachedMemoryCall, executeCreateAttachedMemory, inspectOrCancelAttachedMemory } = require('../lib/attachedMemoryCreation');
const sessionId = '11111111-1111-4111-8111-111111111111'; const id = '22222222-2222-4222-8222-222222222222';
const request = { sessionId, teamId: null, keyEpoch: null, keyId: null, enc: { v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(32) },
  attachmentIds: [id], metadata: { tags: ['synthetic'], connections: [], position: [0, 1, 2], importance: 0.5 } };
test('attached memory contract binds exactly scoped ciphertext, IDs and bounded metadata with canonical key order', () => {
  const parsed = parseAttachedMemoryInput(request);
  assert.equal(canonicalAttachedMemoryJson(parsed), canonicalAttachedMemoryJson(parseAttachedMemoryInput({ metadata: { importance: 0.5, position: [0, 1, 2], connections: [], tags: ['synthetic'] },
    attachmentIds: [id], enc: { ct: request.enc.ct, iv: request.enc.iv, v: 1 }, keyId: null, keyEpoch: null, teamId: null, sessionId })));
  for (const value of [{ ...request, text: 'synthetic plaintext' }, { ...request, metadata: { ...request.metadata, title: 'synthetic plaintext' } },
    { ...request, attachmentIds: [id, id] }, { ...request, keyEpoch: 1 }, { ...request, teamId: 'crew' },
    { ...request, enc: { ...request.enc, iv: 'bad' } }, { ...request, metadata: { embedding: [Infinity] } }, { ...request, metadata: { connections: [sessionId] } },
    { ...request, metadata: { links: [{ text: 'synthetic' }] } }, { ...request, metadata: { learning: { schemaVersion: 1 } } }]) assert.throws(() => parseAttachedMemoryInput(value));
  assert.throws(() => parseAttachedMemoryInput({ ...request, teamId: 'crew', keyEpoch: 2, keyId: id, enc: { ...request.enc, v: 2 }, metadata: { parentId: 'personal-note' } }));
  assert.equal(parseAttachedMemoryInput({ ...request, teamId: 'crew', keyEpoch: 2, keyId: id, enc: { ...request.enc, v: 2 } }).enc.v, 2);
  assert.equal(parseAttachedMemoryInput({ ...request, attachmentIds: [] }).attachmentIds.length, 0);
  assert.equal(parseAttachedMemoryInput({ ...request, attachmentIds: [], teamId: 'crew', keyEpoch: 2, keyId: id, enc: { ...request.enc, v: 2 } }).teamId,'crew');
});
test('creation callable closes before rate or database access; malformed status/cancel requests fail before a transaction', async () => {
  await assert.rejects(createAttachedMemory.run({actorUid:'alice',request}, { auth: { uid: 'alice' } }), { code: 'failed-precondition' });
  await assert.rejects(createPersonalMemory.run({actorUid:'alice',request:{ ...request, attachmentIds: [] }}, { auth: { uid: 'alice' } }), { code: 'failed-precondition' });
  await assert.rejects(createTeamMemory.run({actorUid:'alice',request:{...request,teamId:'crew',keyEpoch:2,keyId:id,enc:{...request.enc,v:2},attachmentIds:[]}}, {auth:{uid:'alice'}}),{code:'failed-precondition'});
  await assert.rejects(createPersonalMemory.run({ ...request, attachmentIds: [] }, {}), { code: 'unauthenticated' });
  const deps = { firestore: { runTransaction: () => { throw Error('Unexpected database access'); } }, now: () => 1, teamWritesEnabled: true };
  await assert.rejects(executeCreateAttachedMemory('alice', { ...request, prompt: 'synthetic' }, deps), { code: 'invalid-argument' });
  await assert.rejects(inspectOrCancelAttachedMemory('alice', { ...request, teamId: 'crew' }, true, deps), { code: 'invalid-argument' });
});
test('web research metadata keeps only a bounded mode and server-comparable time, without plaintext query or sources',()=>{
  for(const mode of ['public','contextual','private-local']){
    const metadata={webResearch:{mode,savedAt:1900000000000},connections:[]};assert.deepEqual(parseAttachedMemoryInput({...request,attachmentIds:[],metadata}).metadata,metadata);
  }
  for(const webResearch of [{mode:'unknown',savedAt:1},{mode:'public',savedAt:0},{mode:'public',savedAt:1.5},{mode:'public',savedAt:1,query:'Synthetic private query'},
    {mode:'public',savedAt:1,sources:['https://example.org/']},'invalid'])assert.throws(()=>parseAttachedMemoryInput({...request,attachmentIds:[],metadata:{webResearch}}));
});
test('all creation and recovery commands bind captured actor before gates, rate or database; old request bytes remain unchanged',async()=>{
  const wrapped={actorUid:'alice',request};assert.equal(canonicalAttachedMemoryJson(parseAttachedMemoryCommand(wrapped).request),canonicalAttachedMemoryJson(request));
  for(const [mode,callable]of [['attached-create',createAttachedMemory],['personal-create',createPersonalMemory],['team-create',createTeamMemory],['status',getAttachedMemoryCreationStatus],['cancel',cancelAttachedMemoryCreation]]){
    const command={actorUid:'alice',request:mode==='personal-create'?{...request,attachmentIds:[]}:mode==='team-create'?{...request,teamId:'crew',keyEpoch:2,keyId:id,enc:{...request.enc,v:2},attachmentIds:[]}:request};const deps={firestore:{doc:()=>{throw Error('Unexpected database access');},runTransaction:()=>{throw Error('Unexpected transaction');}},now:()=>1,teamWritesEnabled:true};
    await assert.rejects(executeAttachedMemoryCall('bob',mode,command,deps),{code:'permission-denied'});await assert.rejects(callable.run(command,{auth:{uid:'bob'}}),{code:'permission-denied'});await assert.rejects(executeAttachedMemoryCall('alice',mode,command.request,deps),{code:'invalid-argument'});await assert.rejects(callable.run(command.request,{auth:{uid:'alice'}}),{code:'invalid-argument'});
  }
});
