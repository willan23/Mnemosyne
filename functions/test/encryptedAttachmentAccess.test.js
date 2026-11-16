const assert = require('node:assert/strict');
const test = require('node:test');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const { mintEncryptedAttachmentReadForUid } = require('../lib/encryptedAttachmentAccess');
const id = '11111111-1111-4111-8111-111111111111';
const record = { uid: 'alice', bucket: 'synthetic-private', digest: 'synthetic-digest', bytes: 500, storageGeneration: '200',
  header: { scope: { kind: 'personal', uid: 'alice' } } };
test('encrypted read requires exact session input, rate allowance and authorization before and after signing', async () => {
  const calls = []; const deps = { now: () => 1000, consumeRate: async () => { calls.push('rate'); return true; },
    authorize: async () => { calls.push('authorize'); return record; }, sign: async (value, expiry) => { calls.push('sign'); assert.equal(value, record); assert.equal(expiry, 121000); return 'synthetic'; } };
  for (const input of [{ id }, { id, sessionId: 'note', bucket: 'untrusted' }, { id: '../path', sessionId: 'note' }]) {
    await assert.rejects(mintEncryptedAttachmentReadForUid(input, 'alice', deps));
  }
  assert.equal(calls.length, 0);
  const reply = await mintEncryptedAttachmentReadForUid({ id, sessionId: 'note' }, 'alice', deps);
  assert.deepEqual(calls, ['rate', 'authorize', 'sign', 'authorize']); assert.equal(reply.generation, '200'); assert.equal(reply.expiresAt, 121000);
  await assert.rejects(mintEncryptedAttachmentReadForUid({ id, sessionId: 'note' }, 'alice', { ...deps, consumeRate: async () => false }), { code: 'resource-exhausted' });
});
test('late revocation, changed generation and expired signing never return a URL; provider errors stay fixed', async () => {
  let checks = 0; let now = 1000;
  const deps = { now: () => now, consumeRate: async () => true, authorize: async () => record, sign: async () => 'synthetic' };
  await assert.rejects(mintEncryptedAttachmentReadForUid({ id, sessionId: 'note' }, 'alice', { ...deps,
    authorize: async () => (++checks === 1 ? record : { ...record, storageGeneration: '201' }) }), { code: 'permission-denied' });
  await assert.rejects(mintEncryptedAttachmentReadForUid({ id, sessionId: 'note' }, 'alice', { ...deps,
    sign: async () => { now += 120001; return 'synthetic'; } }), { code: 'permission-denied' });
  const error = await mintEncryptedAttachmentReadForUid({ id, sessionId: 'note' }, 'alice', { ...deps,
    sign: async () => { throw Error('synthetic-sensitive-provider-error'); } }).catch(error => error);
  assert.equal(error.code, 'unavailable'); assert.equal(error.message, 'Attachment read unavailable');
});
