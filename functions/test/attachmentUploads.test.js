const test = require('node:test'); const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT = 'demo-mnemosyne-test'; process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-mnemosyne-test' });
const { beginAttachmentUpload, completeAttachmentUpload, purgeUnreferencedAttachment } = require('../lib/attachmentUploads');
test('new attachment callables are closed before any storage, signing or quota operation', async () => {
  await assert.rejects(beginAttachmentUpload.run({}, { auth: { uid: 'alice' } }), { code: 'failed-precondition' });
  await assert.rejects(completeAttachmentUpload.run({ id: 'synthetic' }, { auth: { uid: 'alice' } }), { code: 'failed-precondition' });
  await assert.rejects(beginAttachmentUpload.run({}, {}), { code: 'unauthenticated' });
  await assert.rejects(purgeUnreferencedAttachment.run({ id: 'synthetic' }, { auth: { uid: 'alice' } }), { code: 'failed-precondition' });
});
