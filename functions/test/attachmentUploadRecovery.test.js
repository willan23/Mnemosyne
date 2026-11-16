const assert = require('node:assert/strict'); const test = require('node:test');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const { inspectAttachmentUpload, cancelPendingAttachmentUpload, getAttachmentUploadStatus, cancelUnconfirmedAttachmentUpload } = require('../lib/attachmentUploadRecovery');
const header = { v: 1, id: '11111111-1111-4111-8111-111111111111', uid: 'alice', scope: { kind: 'personal', uid: 'alice' }, category: 'document',
  plainBytes: 10, metadataBytes: 20, cipherBytes: 50, iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } };
test('recovery rejects foreign caller, extra plaintext fields, malformed scopes and IDs before accessing Firestore', async () => {
  let touched = false; const deps = { now: () => 1000, firestore: { runTransaction: () => { touched = true; throw Error('must not access'); } } };
  for (const operation of [inspectAttachmentUpload, cancelPendingAttachmentUpload]) {
    await assert.rejects(operation('bob', { header }, deps), { code: 'permission-denied' });
    for (const input of [{ header, name: 'synthetic plaintext' }, { header: { ...header, id: '../bad' } }, { header: { ...header, scope: { kind: 'personal', uid: 'bob' } } }]) {
      await assert.rejects(operation('alice', input, deps), { code: 'invalid-argument' });
    }
  }
  assert.equal(touched, false);
});
test('recovery callables reject missing auth before any rate writes or service access', async () => {
  for (const callable of [getAttachmentUploadStatus, cancelUnconfirmedAttachmentUpload]) await assert.rejects(callable.run({ header }, {}), { code: 'unauthenticated' });
});
