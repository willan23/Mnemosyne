const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyAttachmentList, referenceScopeMatches, inventoryAttachmentReferencesPage } = require('../lib/attachmentReferenceInventory');
const id = '12121212-1212-4212-8212-121212121212';
test('attachment inventory never treats a URL as ownership proof and returns only opaque valid identifiers', () => {
  const result = classifyAttachmentList([{ url: `mnemosyne-attachment:v1:${id}` }, { url: `mnemosyne-attachment:v1:${id}` },
    { url: 'https://example.invalid/private?token=synthetic-secret', name: 'synthetic-name' },
    { url: 'data:synthetic-private' }, { url: 'mnemosyne-attachment:v1:../private' }, { url: 123 }]);
  assert.deepEqual(result.ids, [id]); assert.equal(result.count, 6);
  for (const reason of ['duplicateObject', 'legacyReference', 'tokenizedReference', 'inlineReference', 'invalidOpaqueId', 'malformedEntry']) {
    assert.ok(result.reasons.includes(reason));
  }
  const output = JSON.stringify(result);
  for (const secret of ['synthetic-secret', 'synthetic-name', 'example.invalid', 'synthetic-private']) assert.equal(output.includes(secret), false);
});
test('attachment inventory reports oversized and malformed lists without truncating into a clean result', () => {
  assert.deepEqual(classifyAttachmentList(undefined), { reasons: [], ids: [], count: 0 });
  assert.deepEqual(classifyAttachmentList({ private: 'synthetic' }).reasons, ['malformedList']);
  const over = classifyAttachmentList(Array.from({ length: 201 }, () => ({ url: `mnemosyne-attachment:v1:${id}` })));
  assert.equal(over.count, 201); assert.deepEqual(over.reasons, ['oversizedList']); assert.deepEqual(over.ids, []);
  const inline = classifyAttachmentList([{ url: `data:${'A'.repeat(20_000)}` }]);
  assert.ok(inline.reasons.includes('malformedEntry')); assert.ok(inline.reasons.includes('inlineReference'));
});
test('reference inventory validates uploader scope independently from the author of a team note', () => {
  const personal = { uid: 'alice', header: { scope: { kind: 'personal', uid: 'alice' } } };
  assert.equal(referenceScopeMatches(personal, { uid: 'alice', teamId: null }, { teamId: null }, true), true);
  assert.equal(referenceScopeMatches(personal, { uid: 'bob', teamId: null }, { teamId: null }, true), false);
  assert.equal(referenceScopeMatches(personal, { uid: 'alice', teamId: null }, { teamId: 'foreign' }, true), false);
  const team = { uid: 'alice', header: { scope: { kind: 'team', teamId: 'crew' } } };
  assert.equal(referenceScopeMatches(team, { uid: 'bob', teamId: 'crew' }, { teamId: 'crew' }, true), true);
  assert.equal(referenceScopeMatches(team, { uid: 'bob', teamId: 'crew' }, { teamId: 'other' }, true), false);
});
test('inventory rejects a cursor outside its collection before any reads', async () => {
  const input = { source: 'versions', afterPath: null, limit: 25 };
  for (const extra of [{ source: 'users' }, { afterPath: 'sessions/a' }, { afterPath: 'sessions/a/versions' },
    { afterPath: 'sessions//versions/b' }, { limit: 0 }, { limit: 101 }]) {
    await assert.rejects(inventoryAttachmentReferencesPage({ ...input, ...extra }, {}), { code: 'invalid-argument' });
  }
});
