const { test } = require('node:test');
const assert = require('node:assert/strict');
const { missingPersonalScopeIndexes } = require('../../scripts/personal-scope-indexes');
const config = require('../../firestore.indexes.json');

test('cutover requires live READY indexes for all personal query orderings', () => {
  const indexes = config.indexes.filter(index => index.collectionGroup === 'sessions')
    .map(index => ({ ...index, state: 'READY', fields: [...index.fields, { fieldPath: '__name__', order: index.fields.at(-1).order }] }));
  assert.deepEqual(missingPersonalScopeIndexes(indexes), []);
  assert.equal(missingPersonalScopeIndexes([]).length, 3);
  assert.equal(missingPersonalScopeIndexes(indexes.map(index => ({ ...index, state: 'CREATING' }))).length, 3);
  assert.equal(missingPersonalScopeIndexes(indexes.map(index => ({ ...index, queryScope: 'COLLECTION_GROUP' }))).length, 3);
  assert.equal(missingPersonalScopeIndexes(indexes.map(index => ({ ...index,
    fields: index.fields.map(field => field.fieldPath === '__name__' ? { ...field, order: 'WRONG' } : field),
  }))).length, 3);
});
