const assert = require('node:assert/strict');
const test = require('node:test');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const { createAttachmentObjectStore } = require('../lib/attachmentUploads');
const { MAX_ATTACHMENT_HEADER_BYTES } = require('../lib/attachmentEnvelope');
test('GCS adapter pins source/destination generations, uses the copy API metadata contract and validates publication on retry', async () => {
  let destination; let copies = 0; let copyFailure = false; const removed = [];
  const sourceMeta = { generation: '100', size: '500', contentType: 'application/octet-stream' };
  const bucketMeta = { location: 'EUROPE-WEST1', iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } };
  const bucket = { getMetadata: async () => [bucketMeta], file: (path, options = {}) => ({ name: path,
    getMetadata: async () => [path.startsWith('encrypted/') ? destination : sourceMeta],
    generateSignedPostPolicyV4: async config => {
      assert.deepEqual(config, { expires: 121000, fields: { 'Content-Type': 'application/octet-stream' }, conditions: [['content-length-range', 500, 500]] });
      return [{ url: 'synthetic', fields: {} }];
    },
    download: async range => { assert.equal(options.generation, '100'); assert.deepEqual(range, { start: 0, end: MAX_ATTACHMENT_HEADER_BYTES + 11 }); return [new Uint8Array([1])]; },
    copy: async (target, config) => {
      copies++; assert.equal(options.generation, '100'); assert.equal(target.name, 'encrypted/synthetic');
      assert.deepEqual(config, { preconditionOpts: { ifGenerationMatch: 0 }, contentType: 'application/octet-stream',
        contentDisposition: 'attachment; filename="attachment.bin"', cacheControl: 'private, no-store', metadata: { format: 'mnemosyne-attachment-v1', headerDigest: 'synthetic-digest' } });
      if (copyFailure) throw Object.assign(Error('synthetic precondition'), { code: 412 });
      destination = { ...config, generation: '200', size: '500' }; return [];
    }, delete: async config => { removed.push({ path, generation: options.generation, config }); },
  }) };
  const store = createAttachmentObjectStore(bucket);
  await store.signPost('quarantine/alice/synthetic', 500, 121000);
  bucketMeta.versioning = { enabled: true }; await assert.rejects(store.signPost('quarantine/alice/synthetic', 500, 121000)); delete bucketMeta.versioning;
  const inspected = await store.inspect('quarantine/alice/synthetic'); assert.equal(inspected.generation, '100'); assert.equal(inspected.size, 500);
  assert.equal(await store.promote('quarantine/alice/synthetic', '100', 'encrypted/synthetic', 'synthetic-digest', 500), '200');
  copyFailure = true; assert.equal(await store.promote('quarantine/alice/synthetic', '100', 'encrypted/synthetic', 'synthetic-digest', 500), '200');
  destination.metadata.firebaseStorageDownloadTokens = 'synthetic-unwanted-token'; await assert.rejects(store.promote('quarantine/alice/synthetic', '100', 'encrypted/synthetic', 'synthetic-digest', 500));
  await store.removeQuarantine('quarantine/alice/synthetic', '100'); await store.removeExpiredPath('quarantine/alice/synthetic');
  assert.deepEqual(removed, [{ path: 'quarantine/alice/synthetic', generation: '100', config: { ignoreNotFound: true, ifGenerationMatch: '100' } },
    { path: 'quarantine/alice/synthetic', generation: undefined, config: { ifGenerationMatch: '100' } }]); assert.equal(copies, 3);
});

test('GCS absence confirmation accepts only 404 and preserves quota on live objects or provider failure', async () => {
  let result = 'present';
  const store = createAttachmentObjectStore({ file: () => ({ getMetadata: async () => {
    if (result !== 'present') throw Object.assign(Error('synthetic'), { code: result });
    return [{ generation: '200' }];
  } }) });
  await assert.rejects(store.assertPathAbsent('encrypted/synthetic'));
  result = 503; await assert.rejects(store.assertPathAbsent('encrypted/synthetic'));
  result = 404; await store.assertPathAbsent('encrypted/synthetic');
});
