'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makePlan, validateRequest, digest } = require('./firestore-restore-rehearsal.cjs');
const plan = makePlan('mnemosyne-restore-20261018');
test('destination cannot be default, a production name or an injected resource', () => {
  for (const name of ['(default)', 'production', 'mnemosyne-restore-20261018/../(default)', 'mnemosyne-restore-20261018?database=(default)'])
    assert.throws(() => makePlan(name));
});
test('all production document, configuration and import mutations are refused', () => {
  for (const resource of [plan.sourceDatabase, plan.sourceDatabase + ':importDocuments',
    plan.sourceDatabase + '/documents/a/b', plan.sourceDatabase + '/collectionGroups/a/indexes'])
    for (const method of ['POST', 'DELETE']) assert.throws(() => validateRequest(plan, 'firestore', resource, method, {}));
});
test('import destination and source are both bound; document writes are not supported', () => {
  validateRequest(plan, 'firestore', plan.destination + ':importDocuments', 'POST', { inputUriPrefix: plan.exportUri });
  assert.throws(() => validateRequest(plan, 'firestore', plan.destination + ':importDocuments', 'POST', { inputUriPrefix: 'gs://other' }));
  assert.throws(() => validateRequest(plan, 'firestore', plan.destination + '/documents/users/alice', 'POST', {}));
  assert.throws(() => validateRequest(plan, 'firestore', plan.destination + '/documents/users/alice', 'DELETE'));
});
test('rules releases cannot replace default or another database release', () => {
  for (const name of ['cloud.firestore', 'cloud.firestore/(default)', 'cloud.firestore/other'])
    assert.throws(() => validateRequest(plan, 'rules', 'projects/mnemosyne-one/releases', 'POST',
      { name: 'projects/mnemosyne-one/releases/' + name, rulesetName: 'projects/mnemosyne-one/rulesets/abc' }));
});
test('modified plans and unknown services cannot admit mutations', () => {
  assert.throws(() => validateRequest({ ...plan, destination: plan.sourceDatabase }, 'firestore', plan.sourceDatabase, 'DELETE'));
  assert.throws(() => validateRequest(plan, 'storage', plan.destination, 'DELETE'));
  assert.equal(digest(plan), digest(makePlan(plan.database)));
});
