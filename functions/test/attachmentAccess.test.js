const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: 'demo-mnemosyne-test',
});

const {
  parseStorageObjectPathFromUrl,
  ownerUidFromAttachmentPath,
  sessionAllowsAttachmentRead,
  mintAttachmentReadForUid,
  ATTACHMENT_READ_TTL_MS,
} = require('../lib/attachmentAccess.js');

test('parses firebase download URL object path', () => {
  const url =
    'https://firebasestorage.googleapis.com/v0/b/mnemosyne-one.appspot.com/o/attachments%2Fuid123%2Ffile.pdf?alt=media&token=abc';
  assert.equal(parseStorageObjectPathFromUrl(url), 'attachments/uid123/file.pdf');
  assert.equal(ownerUidFromAttachmentPath('attachments/uid123/file.pdf'), 'uid123');
});

test('rejects data urls and invalid paths', () => {
  assert.equal(parseStorageObjectPathFromUrl('data:image/png;base64,aaa'), null);
  assert.equal(ownerUidFromAttachmentPath('public/file.pdf'), null);
});

test('signed attachment access uses current team membership over author or share', () => {
  const teamSession = { uid: 'alice', teamId: 'crew', sharedWithIds: ['alice'] };
  assert.equal(sessionAllowsAttachmentRead(teamSession, 'alice', ['bob']), false);
  assert.equal(sessionAllowsAttachmentRead(teamSession, 'bob', ['bob']), true);
  assert.equal(sessionAllowsAttachmentRead(teamSession, 'alice', undefined), false);
  assert.equal(sessionAllowsAttachmentRead({ uid: 'alice', sharedWithIds: ['bob'] }, 'bob'), true);
  assert.equal(sessionAllowsAttachmentRead({ uid: 'alice', teamId: false }, 'alice'), false);
  assert.equal(sessionAllowsAttachmentRead({ uid: 'alice', deletedAt: 2 }, 'alice'), false);
});

test('attachment URLs bind the expected bucket and reject foreign hosts, protocols, path traversal and malformed encoding', () => {
  const base = 'https://firebasestorage.googleapis.com/v0/b/synthetic.appspot.com/o/';
  assert.equal(parseStorageObjectPathFromUrl(base + encodeURIComponent('attachments/alice/pasta/a b.pdf'), 'synthetic.appspot.com'), 'attachments/alice/pasta/a b.pdf');
  for (const url of [base + 'attachments%2Falice%2F..%2Fa', base + 'attachments%2Falice%2Fa%5Cb', base + '%invalid',
    base.replace('https:', 'http:') + 'attachments%2Falice%2Fa', base.replace('firebasestorage.googleapis.com', 'attacker.example') + 'attachments%2Falice%2Fa',
    base + 'attachments%2Falice%2Fa#fragment']) assert.equal(parseStorageObjectPathFromUrl(url, 'synthetic.appspot.com'), null);
  assert.equal(parseStorageObjectPathFromUrl(base + 'attachments%2Falice%2Fa', 'other-bucket'), null);
  for (const path of ['attachments/alice/', 'attachments/alice/../secret', 'attachments/alice/a\n', 'attachments/alice//a', 'attachments/alice/a\\b']) {
    assert.equal(ownerUidFromAttachmentPath(path), null);
  }
});

test('mint requires session scope even for uploader, charges rate once, forces bounded download and rechecks authorization after signing', async () => {
  const calls = []; const path = 'attachments/alice/synthetic.html';
  const deps = { bucket: 'synthetic.appspot.com', now: () => 1000,
    consumeRate: async uid => { calls.push(['rate', uid]); return true; },
    authorize: async (...args) => { calls.push(['authorize', ...args]); }, exists: async p => { calls.push(['exists', p]); return true; },
    sign: async (p, options) => { calls.push(['sign', p]); assert.deepEqual(options, { action: 'read', version: 'v4', expires: 1000 + ATTACHMENT_READ_TTL_MS,
      responseDisposition: 'attachment; filename="attachment"', responseType: 'application/octet-stream' }); return 'synthetic-signed-url'; } };
  await assert.rejects(mintAttachmentReadForUid({ objectPath: path }, 'alice', deps), { code: 'permission-denied' });
  assert.equal(calls.length, 0);
  const result = await mintAttachmentReadForUid({ objectPath: path, sessionId: 'note' }, 'alice', deps);
  assert.equal(result.expiresAt, 121000); assert.equal(result.objectPath, path);
  assert.deepEqual(calls.map(item => item[0]), ['rate', 'authorize', 'exists', 'sign', 'authorize']);
  let checks = 0;
  await assert.rejects(mintAttachmentReadForUid({ objectPath: path, sessionId: 'note' }, 'alice', { ...deps,
    authorize: async () => { if (++checks === 2) throw new (require('firebase-functions/v1').https.HttpsError)('permission-denied', 'Attachment access denied'); } }), { code: 'permission-denied' });
  await assert.rejects(mintAttachmentReadForUid({ objectPath: path, sessionId: 'note' }, 'alice', { ...deps, consumeRate: async () => false }), { code: 'resource-exhausted' });
  await assert.rejects(mintAttachmentReadForUid({ objectPath: path, sessionId: 'note' }, 'alice', { ...deps, exists: async () => false }), { code: 'permission-denied' });
  const error = await mintAttachmentReadForUid({ objectPath: path, sessionId: 'note' }, 'alice', { ...deps, sign: async () => { throw Error('synthetic-sensitive-error'); } }).catch(error => error);
  assert.equal(error.code, 'unavailable'); assert.equal(error.message.includes('synthetic-sensitive-error'), false);
});
