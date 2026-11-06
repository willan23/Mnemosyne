const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const { parseLegacyStorageReference, createLegacyAttachmentReconciler, reconcileLegacyAttachmentReferencesPage } = require('../lib/legacyAttachmentReconciliation');
const bucket = 'synthetic-legacy-bucket';
const objectPath = 'attachments/alice/synthetic-file';
const firebaseUrl = (name = objectPath, query = 'token=synthetic-token') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(name)}?alt=media&${query}`;
const object = (name = objectPath) => ({ name, size: '12', generation: '100', metadata: { firebaseStorageDownloadTokens: 'synthetic-token' } });
const context = (data, source = 'sessions', documentPath = 'sessions/synthetic') => ({ source, path: documentPath, data });

test('legacy mapping recognizes exact bucket formats without URL requests or returning a query/token', () => {
  const parsed = parseLegacyStorageReference(firebaseUrl(), bucket);
  assert.equal(parsed.kind, 'storage'); assert.equal(parsed.path, objectPath); assert.equal(parsed.readerSupported, true);
  assert.equal(parsed.tokenState, 'one'); assert.match(parsed.digest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(parsed).includes('synthetic-token'), false);
  for (const url of [`https://storage.googleapis.com/${bucket}/${objectPath}`, `https://${bucket}.storage.googleapis.com/${objectPath}`,
    `https://storage.googleapis.com/download/storage/v1/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`]) {
    const result = parseLegacyStorageReference(url, bucket); assert.equal(result.kind, 'storage'); assert.equal(result.path, objectPath);
    assert.equal(result.readerSupported, false); assert.equal(result.tokenState, 'not-applicable');
  }
  assert.equal(parseLegacyStorageReference(firebaseUrl().replace(bucket, 'other-bucket'), bucket).kind, 'foreign-bucket');
  assert.equal(parseLegacyStorageReference('https://example.invalid/private?token=synthetic-token', bucket).kind, 'external');
  assert.equal(parseLegacyStorageReference('data:synthetic-private-content', bucket).kind, 'inline');
  assert.equal(parseLegacyStorageReference('mnemosyne-attachment:v999:bad', bucket).kind, 'malformed');
  for (const url of [firebaseUrl().replace('https:', 'http:'), firebaseUrl() + '#fragment', firebaseUrl('attachments/alice/../secret'),
    firebaseUrl().replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com:444'), 'not-a-url', null]) {
    assert.equal(parseLegacyStorageReference(url, bucket).kind, 'malformed');
  }
});

test('legacy reconciliation separates object presence and token metadata matching, missing tokens and ambiguous duplicate parameters', () => {
  const collector = createLegacyAttachmentReconciler(bucket, [object(), object('attachments/alice/unobserved')]);
  collector.observe(context({ uid: 'alice', teamId: null, attachments: [
    { url: firebaseUrl() }, { url: firebaseUrl(objectPath, 'token=wrong-token') }, { url: firebaseUrl(objectPath, '') },
    { url: firebaseUrl(objectPath, 'token=synthetic-token&token=synthetic-token') }, { url: firebaseUrl('attachments/alice/absent') },
  ] }));
  const result = collector.summary(); const counts = result.sources.sessions.references;
  assert.equal(counts.storage, 5); assert.equal(counts.matchedObject, 4); assert.equal(counts.missingObject, 1);
  for (const key of ['tokenMatchesMetadata', 'tokenDiffersFromMetadata', 'tokenAbsent', 'tokenAmbiguous']) assert.equal(counts[key], 1);
  assert.equal(result.objects.referenced, 1); assert.equal(result.objects.notObservedInKnownReferences, 1);
  assert.equal(result.objects.notObservedBytes, '12'); assert.equal(result.deletionAuthorized, false);
  for (const value of ['alice', objectPath, 'synthetic-token', 'wrong-token', 'https://', bucket]) assert.equal(JSON.stringify(result).includes(value), false);
});

test('legacy author comparison never adopts a path owner or parent UID for an unbound historical/nested document', () => {
  const collector = createLegacyAttachmentReconciler(bucket, [object()]);
  collector.observe(context({ uid: 'alice', attachments: [{ url: firebaseUrl() }] }));
  collector.observe(context({ uid: 'bob', teamId: 'crew', attachments: [{ url: firebaseUrl() }] }));
  collector.observe({ source: 'versions', path: 'sessions/synthetic/versions/old', data: { teamId: null, attachments: [{ url: firebaseUrl() }] }, parent: { uid: 'alice', teamId: null } });
  collector.observe(context({ uid: 'bob', teamId: null, attachments: [{ url: firebaseUrl() }] }, 'memories', 'users/alice/memories/old'));
  const result = collector.summary();
  assert.equal(result.sources.sessions.references.pathUidMatchesAuthor, 1); assert.equal(result.sources.sessions.references.pathUidDiffersFromAuthor, 1);
  assert.equal(result.sources.sessions.reasons.missingPersonalScope, 1);
  assert.equal(result.sources.versions.references.pathUidOrAuthorUnavailable, 1); assert.equal(result.sources.versions.reasons.historyAuthorMismatch, 1);
  assert.equal(result.sources.memories.reasons.legacyOwnerMismatch, 1);
  assert.equal(result.objects.referencedByMultipleAuthorUids, 1); assert.equal(result.objects.withAmbiguousAuthorContext, 1);
  assert.equal(result.deletionAuthorized, false);
});

test('legacy reconciliation refuses duplicate live object names and preserves uncertain mapping rather than certifying orphan deletion', () => {
  for (const objects of [[object(), { ...object(), generation: '101' }], [{ ...object(), size: 'bad' }], [{ ...object(), generation: '0' }],
    [object('encrypted/synthetic')], Array.from({ length: 10001 }, () => object())]) assert.throws(() => createLegacyAttachmentReconciler(bucket, objects), { code: 'failed-precondition' });
  const collector = createLegacyAttachmentReconciler(bucket, [object()]);
  collector.observe(context({ uid: 'alice', teamId: null, attachments: Array.from({ length: 201 }, () => ({ url: firebaseUrl() })) }));
  collector.observe(context({ uid: 'alice', teamId: null, attachments: { url: firebaseUrl() } }));
  collector.observe(context({ uid: 'alice', teamId: null, attachments: [{ url: 'https://example.invalid/alias' }] }));
  const result = collector.summary(); assert.equal(result.mappingCoverageComplete, false);
  assert.equal(result.sources.sessions.reasons.oversizedList, 1); assert.equal(result.sources.sessions.reasons.malformedList, 1);
  assert.equal(result.sources.sessions.references.total, 202); assert.equal(result.deletionAuthorized, false);
});

test('legacy reconciliation reports malformed/absent token metadata independently from an existing object', () => {
  for (const [metadata, expected] of [[undefined, 'tokenMetadataAbsent'], [{ firebaseStorageDownloadTokens: ['bad-type'] }, 'tokenMetadataMalformed']]) {
    const collector = createLegacyAttachmentReconciler(bucket, [{ ...object(), metadata }]);
    collector.observe(context({ uid: 'alice', teamId: null, attachments: [{ url: firebaseUrl() }] }));
    assert.equal(collector.summary().sources.sessions.references[expected], 1);
  }
});

test('legacy reconciliation guards cursors before reads and CLI refuses apply/ambiguous context before credentials', async () => {
  const input = { source: 'versions', afterPath: null, limit: 25 };
  for (const extra of [{ source: 'users' }, { afterPath: 'sessions/a' }, { afterPath: 'sessions//versions/b' }, { afterPath: 'sessions/a/versions' }, { limit: 0 }])
    await assert.rejects(reconcileLegacyAttachmentReferencesPage({ ...input, ...extra }, {}, {}), { code: 'invalid-argument' });
  const cli = path.resolve(__dirname, '../../scripts/reconcile-legacy-attachments.js');
  for (const args of [[], ['--project=synthetic-project'], ['--project=synthetic-project', '--bucket=synthetic-bucket', '--apply'],
    ['--project=synthetic-project', '--bucket=synthetic-bucket', '--page-size='], ['--project=synthetic-project', '--project=other-project', '--bucket=synthetic-bucket']]) {
    const child = spawnSync(process.execPath, [cli, ...args], { env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: 'synthetic-does-not-exist' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 2); assert.match(child.stderr, /Nenhum acesso foi feito/);
  }
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 10000 }); assert.equal(help.status, 0);
});
