const assert = require('node:assert/strict'); const test = require('node:test');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const { parseAttachmentMutationInput, attachmentSessionStateBytes, attachmentSessionRevision } = require('../lib/attachmentMutationContract');
const { mutateSessionAttachments } = require('../lib/attachmentMutations');
const id = '11111111-1111-4111-8111-111111111111'; const other = '22222222-2222-4222-8222-222222222222';
const input = { operationId: id, sessionId: 'note', action: 'add', ids: [other, id], expectedRevision: 1, expectedStateDigest: 'a'.repeat(64) };
test('mutation contract is strict and canonical across key/id order, and binds attachments even when revision is unchanged', () => {
  const reordered = { expectedStateDigest: input.expectedStateDigest, ids: [...input.ids].reverse(), sessionId: 'note', operationId: id, expectedRevision: 1, action: 'add' };
  assert.equal(JSON.stringify(parseAttachmentMutationInput(input)), JSON.stringify(parseAttachmentMutationInput(reordered)));
  for (const changed of [{ ...input, ids: [id, id] }, { ...input, ids: [] }, { ...input, text: 'synthetic plaintext' }, { ...input, sessionId: '../bad' }, { ...input, action: 'replace' }]) assert.throws(() => parseAttachmentMutationInput(changed));
  const data = { uid: 'alice', teamId: null, text: '', title: null, enc: { v: 1, iv: 'synthetic', ct: 'synthetic-cipher' }, updatedAt: 1,
    attachments: [{ name: 'Anexo cifrado', url: `mnemosyne-attachment:v1:${id}`, type: 'document' }] };
  const bytes = attachmentSessionStateBytes('note', data);
  assert.equal(Buffer.from(bytes).equals(Buffer.from(attachmentSessionStateBytes('note', { ...data, attachments: [{ type: 'document', url: data.attachments[0].url, name: 'Anexo cifrado' }] }))), true);
  for (const changed of [{ ...data, attachments: [] }, { ...data, teamId: 'crew' }, { ...data, enc: { ...data.enc, ct: 'other-synthetic-cipher' } }]) assert.equal(Buffer.from(bytes).equals(Buffer.from(attachmentSessionStateBytes('note', changed))), false);
  assert.equal(attachmentSessionRevision({ updatedAt: { toMillis: () => 1 } }), 1);
  assert.throws(() => attachmentSessionStateBytes('note', { ...data, text: 'synthetic plaintext' }));
});
test('mutation callable is closed before data validation, rate writes or Firestore access', async () => {
  await assert.rejects(mutateSessionAttachments.run(input, { auth: { uid: 'alice' } }), { code: 'failed-precondition' });
});
