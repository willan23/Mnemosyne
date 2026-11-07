const assert = require('node:assert/strict'); const test = require('node:test');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const {parseClippedMemoryInput, clippedMemoryRequestBytes} = require('../lib/clippedMemoryContract');
const {createClippedMemory, getClippedMemoryStatus, cancelClippedMemory, executeClippedMemory} = require('../lib/clippedMemoryCreation');
const request = {sessionId: '11111111-1111-4111-8111-111111111111', enc: {v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(32)}};
test('clip contract accepts only bounded personal ciphertext with canonical field order, never owner, plaintext, team or metadata', () => {
  assert.deepEqual(parseClippedMemoryInput(request), request);
  assert.equal(clippedMemoryRequestBytes(parseClippedMemoryInput({enc: {ct: request.enc.ct, iv: request.enc.iv, v: 1}, sessionId: request.sessionId})), clippedMemoryRequestBytes(request));
  for (const value of [null, [], {...request, uid: 'alice'}, {...request, text: 'synthetic'}, {...request, title: 'synthetic'},
    {...request, teamId: 'crew'}, {...request, metadata: {}}, {...request, sessionId: 'a/b'}, {...request, enc: {...request.enc, v: 2}},
    {...request, enc: {...request.enc, iv: 'bad'}}, {...request, enc: {...request.enc, ct: 'B'.repeat(16388)}}, {...request, enc: {...request.enc, ct: '*'.repeat(32)}},
    {...request, enc: {...request.enc, extra: 'synthetic'}}]) assert.throws(() => parseClippedMemoryInput(value));
});
test('clip callable rejects unauthenticated and malformed requests before rate/database reads and never initializes secrets', async () => {
  const deps = {firestore: {runTransaction: () => {throw new Error('Unexpected transaction');}}, now: () => 1000};
  for (const handler of [createClippedMemory, getClippedMemoryStatus, cancelClippedMemory]) {
    await assert.rejects(handler.run(request, {}), {code: 'unauthenticated'});
    await assert.rejects(handler.run({...request, prompt: 'synthetic'}, {auth: {uid: 'alice'}}), {code: 'invalid-argument'});
    assert.deepEqual(handler.__endpoint.secretEnvironmentVariables || [], []);
  }
  await assert.rejects(createClippedMemory.run(request, {auth: {uid: 'alice'}}), {code: 'failed-precondition'});
  await assert.rejects(executeClippedMemory('a/b', request, 'create', deps), {code: 'unauthenticated'});
  await assert.rejects(executeClippedMemory('alice', {...request, enc: {}}, 'status', deps), {code: 'invalid-argument'});
});
