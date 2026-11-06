'use strict';

const REQUIRED = [
  [['uid', 'ASCENDING'], ['teamId', 'ASCENDING']],
  [['uid', 'ASCENDING'], ['teamId', 'ASCENDING'], ['timestamp', 'ASCENDING']],
  [['uid', 'ASCENDING'], ['teamId', 'ASCENDING'], ['timestamp', 'DESCENDING']],
];

function missingPersonalScopeIndexes(indexes) {
  const ready = indexes.filter(index => index.state === 'READY' && index.queryScope === 'COLLECTION')
    .filter(index => {
      const fields = (index.fields || []).filter(field => field.fieldPath !== '__name__');
      const name = (index.fields || []).find(field => field.fieldPath === '__name__');
      return !name || name.order === fields.at(-1)?.order;
    })
    .map(index => (index.fields || []).filter(field => field.fieldPath !== '__name__')
      .map(field => [field.fieldPath, field.order]));
  return REQUIRED.filter(required => !ready.some(fields => JSON.stringify(fields) === JSON.stringify(required)));
}

module.exports = { missingPersonalScopeIndexes };
