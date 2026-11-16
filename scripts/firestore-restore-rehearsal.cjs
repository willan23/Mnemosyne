'use strict';
// Operational rehearsal only. Never import into a database used by the application.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const PROJECT = 'mnemosyne-one';
const SOURCE = `projects/${PROJECT}/databases/(default)`;
const EXPORT_URI = 'gs://mnemosyne-one-firestore-backup-euw1/firestore/export-20260924T185215Z';
const RULES = "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} { allow read, write: if false; }\n  }\n}\n";
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

function makePlan(database) {
  assert.match(database, /^mnemosyne-restore-20\d{6}(?:-[a-z0-9]{1,12})?$/);
  return { version: 1, project: PROJECT, sourceDatabase: SOURCE, destination: `projects/${PROJECT}/databases/${database}`,
    database, edition: 'STANDARD', location: 'eur3', exportUri: EXPORT_URI, expectedDocuments: 359,
    clients: 'deny-all', indexes: 'copy-current-source-definitions', ttl: 'not-enabled',
    cleanup: 'delete-only-created-database-after-validation', affectsAuthOrStorageBytes: false };
}

function validateRequest(plan, service, resource, method, body) {
  assert.equal(digest(plan), digest(makePlan(plan.database)));
  assert(['GET', 'POST', 'DELETE'].includes(method));
  assert(!resource.includes('..') && !resource.includes('%') && !resource.includes('://'));
  if (method === 'GET') {
    assert(service === 'firestore' || service === 'rules');
    assert(resource.startsWith(`projects/${PROJECT}/`));
    return;
  }
  if (service === 'firestore') {
    if (resource === `projects/${PROJECT}/databases`) {
      assert.equal(method, 'POST');
      assert.deepEqual(body, { type: 'FIRESTORE_NATIVE', databaseEdition: 'STANDARD', locationId: 'eur3',
        deleteProtectionState: 'DELETE_PROTECTION_DISABLED' });
      return;
    }
    if (resource === plan.destination) { assert.equal(method, 'DELETE'); return; }
    assert(resource.startsWith(plan.destination + '/') || resource === plan.destination + ':importDocuments');
    if (resource.endsWith(':importDocuments')) { assert.equal(method, 'POST'); assert.deepEqual(body, { inputUriPrefix: EXPORT_URI }); }
    else assert(method === 'POST' && (resource.endsWith(':listCollectionIds') || resource.endsWith('/indexes')));
    return;
  }
  assert.equal(service, 'rules');
  assert.equal(method, 'POST');
  if (resource === `projects/${PROJECT}/rulesets`) {
    assert.deepEqual(body, { source: { files: [{ name: 'restore-deny-all.rules', content: RULES }] } });
  } else {
    assert.equal(resource, `projects/${PROJECT}/releases`);
    assert.equal(body.name, `projects/${PROJECT}/releases/cloud.firestore/${plan.database}`);
    assert.match(body.rulesetName, new RegExp(`^projects/${PROJECT}/rulesets/[a-zA-Z0-9-]+$`));
    assert.deepEqual(Object.keys(body).sort(), ['name', 'rulesetName']);
  }
}

async function main() {
  const [mode, database, directory, confirmation] = process.argv.slice(2);
  assert(['plan', 'execute', 'validate', 'cleanup'].includes(mode));
  const plan = makePlan(database);
  const planHash = digest(plan);
  assert(path.isAbsolute(directory));
  fs.mkdirSync(directory, { recursive: true });
  const save = (name, value) => {
    const filename = path.join(directory, name + '.json');
    if (fs.existsSync(filename)) {
      assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')), value, `Refusing to overwrite ${name}`);
      return;
    }
    fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  };
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name + '.json'), 'utf8').replace(/^\uFEFF/, ''));
  let token;
  function getToken() {
    if (!token) token = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '& gcloud.cmd auth print-access-token --project=mnemosyne-one --quiet'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    assert(token && !/\s/.test(token));
    return token;
  }
  const journal = [];
  async function request(service, resource, method = 'GET', body, query = {}, allow404 = false) {
    validateRequest(plan, service, resource, method, body);
    if (method !== 'GET' && !(method === 'POST' && resource.endsWith(':listCollectionIds'))) {
      assert(['execute', 'cleanup'].includes(mode));
      assert.equal(confirmation, planHash);
      if (resource === `projects/${PROJECT}/databases`) assert.deepEqual(query, { databaseId: plan.database });
      else assert.equal(Object.keys(query).length, 0);
      journal.push({ at: new Date().toISOString(), service, resource, method, bodyHash: digest(body ?? null) });
      fs.writeFileSync(path.join(directory, `mutation-journal-${mode}.json`), JSON.stringify(journal, null, 2) + '\n');
    }
    const base = service === 'firestore' ? 'https://firestore.googleapis.com/v1/' : 'https://firebaserules.googleapis.com/v1/';
    const url = new URL(base + resource);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    if (allow404 && response.status === 404) return null;
    assert(response.ok, `${service} ${method} ${resource}: HTTP ${response.status} ${data.error?.status ?? ''}`);
    return data;
  }
  async function poll(operation) {
    assert(operation.name.startsWith(plan.destination + '/operations/'));
    let result = operation;
    for (let attempt = 0; !result.done && attempt < 180; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      result = await request('firestore', operation.name);
    }
    assert(result.done && !result.error, 'Operation did not succeed');
    return result;
  }
  async function sourceState() {
    const database = await request('firestore', SOURCE);
    const release = await request('rules', `projects/${PROJECT}/releases/cloud.firestore`);
    const namedDefault = await request('rules', `projects/${PROJECT}/releases/cloud.firestore/(default)`, 'GET', undefined, {}, true);
    const result = await request('firestore', SOURCE + '/collectionGroups/-/indexes');
    assert(!result.nextPageToken, 'More than one source index page requires review');
    const indexes = result.indexes ?? [];
    assert(indexes.every(index => index.state === 'READY'));
    return { database, release, namedDefault, indexes };
  }
  if (mode === 'plan') {
    const state = await sourceState();
    assert.equal(state.database.locationId, plan.location);
    assert.equal(state.database.databaseEdition, plan.edition);
    assert.equal(await request('firestore', plan.destination, 'GET', undefined, {}, true), null, 'Destination already exists');
    const operations = await request('firestore', SOURCE + '/operations');
    const exported = operations.operations?.find(op => op.done && !op.error && op.metadata?.operationState === 'SUCCESSFUL'
      && op.metadata?.outputUriPrefix === EXPORT_URI);
    assert(exported && Number(exported.metadata.progressDocuments.completedWork) === plan.expectedDocuments);
    save('plan', { plan, planHash, at: new Date().toISOString(), estimatedImportWrites: plan.expectedDocuments,
      note: 'Named database is billed separately. Same project shares IAM, Auth and service accounts. No exact-time snapshot or decryption claim.' });
    save('source-before', state);
    save('source-export', exported);
    console.log(JSON.stringify({ mode, database, planHash, sourceDocuments: plan.expectedDocuments, indexes: state.indexes.length }));
    return;
  }
  assert.equal(confirmation, planHash);
  assert.deepEqual(read('plan').plan, plan);
  if (mode === 'execute') {
    assert.equal(await request('firestore', plan.destination, 'GET', undefined, {}, true), null, 'Refusing existing destination');
    const created = await poll(await request('firestore', `projects/${PROJECT}/databases`, 'POST', {
      type: 'FIRESTORE_NATIVE', databaseEdition: 'STANDARD', locationId: 'eur3', deleteProtectionState: 'DELETE_PROTECTION_DISABLED'
    }, { databaseId: database }));
    save('create-operation', created);
    const target = await request('firestore', plan.destination);
    assert.equal(target.name, plan.destination);
    assert.equal(target.locationId, plan.location);
    save('created-database', target);
    const rule = await request('rules', `projects/${PROJECT}/rulesets`, 'POST', { source: { files: [{ name: 'restore-deny-all.rules', content: RULES }] } });
    save('deny-ruleset', rule);
    const release = await request('rules', `projects/${PROJECT}/releases`, 'POST', {
      name: `projects/${PROJECT}/releases/cloud.firestore/${database}`, rulesetName: rule.name
    });
    save('deny-release', release);
    assert.equal((await request('rules', release.name)).rulesetName, rule.name);
    const root = await request('firestore', plan.destination + '/documents:listCollectionIds', 'POST', { pageSize: 100 });
    assert(!root.nextPageToken && !(root.collectionIds ?? []).length, 'New database is not empty');
    const indexes = [];
    for (const index of read('source-before').indexes) {
      const collection = index.name.split('/collectionGroups/')[1].split('/indexes/')[0];
      assert.match(collection, /^[a-zA-Z0-9_-]+$/);
      const fields = index.fields.map(field => ({ ...field }));
      const body = { queryScope: index.queryScope, fields };
      if (index.apiScope) body.apiScope = index.apiScope;
      indexes.push(await request('firestore', `${plan.destination}/collectionGroups/${collection}/indexes`, 'POST', body));
    }
    save('index-operations', indexes);
    const imported = await request('firestore', plan.destination + ':importDocuments', 'POST', { inputUriPrefix: EXPORT_URI });
    save('import-start', imported);
    console.log(JSON.stringify({ mode, database, operation: imported.name, clients: 'deny-all', indexesStarted: indexes.length }));
    return;
  }
  const target = await request('firestore', plan.destination);
  assert.equal(target.uid, read('created-database').uid, 'Destination identity changed');
  if (mode === 'cleanup') {
    const validated = read('validation');
    assert(validated.success && validated.databaseUid === target.uid && validated.totalDocuments === plan.expectedDocuments);
    const independent = read('independent-live-verification');
    assert(independent.success && independent.independentServerAggregation && independent.mutations === 0 &&
      independent.databaseUid === target.uid && independent.totalDocuments === plan.expectedDocuments);
    const operation = await poll(await request('firestore', plan.destination, 'DELETE'));
    save('delete-operation', operation);
    assert.equal(await request('firestore', plan.destination, 'GET', undefined, {}, true), null);
    const after = await sourceState();
    save('source-after-cleanup', after);
    assert.equal(after.database.uid, read('source-before').database.uid);
    assert.deepEqual(after.release, read('source-before').release);
    assert.deepEqual(after.namedDefault, read('source-before').namedDefault);
    save('cleanup', { at: new Date().toISOString(), database, databaseUid: target.uid, deleted: true,
      defaultDatabaseUidUnchanged: true, defaultRuleReleasesUnchanged: true, defaultDatabaseMutationsByExecutor: 0,
      denyAllRuleMetadataRetained: true });
    console.log(JSON.stringify({ mode, deleted: true, defaultDatabaseMutationsByExecutor: 0 }));
    return;
  }
  const imported = await poll(read('import-start'));
  save('import-completed', imported);
  assert.equal(imported.metadata.operationState, 'SUCCESSFUL');
  assert.equal(Number(imported.metadata.progressDocuments.completedWork), plan.expectedDocuments);
  let indexResult;
  for (let attempt = 0; attempt < 180; attempt++) {
    indexResult = await request('firestore', plan.destination + '/collectionGroups/-/indexes');
    assert(!indexResult.nextPageToken);
    assert.equal((indexResult.indexes ?? []).length, read('source-before').indexes.length);
    assert((indexResult.indexes ?? []).every(index => ['CREATING', 'READY'].includes(index.state)), 'Index requires operator review');
    if ((indexResult.indexes ?? []).every(index => index.state === 'READY')) break;
    if (attempt % 10 === 0) console.log(JSON.stringify({ mode, indexesReady: indexResult.indexes.filter(index => index.state === 'READY').length, indexesTotal: indexResult.indexes.length }));
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  assert((indexResult.indexes ?? []).every(index => index.state === 'READY'), 'Indexes are not ready; inspect before validating again');
  const release = await request('rules', read('deny-release').name);
  assert.equal(release.rulesetName, read('deny-ruleset').name);
  const ruleset = await request('rules', release.rulesetName);
  assert.deepEqual(ruleset.source.files, [{ name: 'restore-deny-all.rules', content: RULES }]);
  const groups = new Map();
  const records = [];
  let missingParents = 0;
  async function walk(parent, depth = 0) {
    assert(depth < 32 && records.length <= 400, 'Traversal bound exceeded');
    let pageToken;
    do {
      const result = await request('firestore', parent + ':listCollectionIds', 'POST', { pageSize: 100, ...(pageToken ? { pageToken } : {}) });
      for (const collection of result.collectionIds ?? []) {
        assert(!collection.includes('/') && !collection.includes('%') && !collection.includes('..'));
        let next;
        do {
          const listing = await request('firestore', `${parent}/${collection}`, 'GET', undefined,
            { pageSize: '100', showMissing: 'true', ...(next ? { pageToken: next } : {}) });
          for (const doc of listing.documents ?? []) {
            assert(doc.name.startsWith(plan.destination + '/documents/'));
            if (doc.createTime) {
              records.push({ pathHash: digest(doc.name.slice((plan.destination + '/documents/').length)), dataHash: digest(doc.fields ?? {}) });
              const old = groups.get(collection) ?? { total: 0, root: 0, nested: 0 };
              old.total++; old[depth ? 'nested' : 'root']++; groups.set(collection, old);
              // Read back a bounded set independently; values are hashed in memory only.
              if (records.length <= 12) {
                const sampled = await request('firestore', doc.name);
                assert.equal(digest(sampled.fields ?? {}), digest(doc.fields ?? {}));
              }
            } else missingParents++;
            await walk(doc.name, depth + 1);
          }
          next = listing.nextPageToken;
        } while (next);
      }
      pageToken = result.nextPageToken;
    } while (pageToken);
  }
  await walk(plan.destination + '/documents');
  assert.equal(records.length, plan.expectedDocuments);
  assert.equal(new Set(records.map(row => row.pathHash)).size, records.length);
  const normalizeIndex = index => ({ collection: index.name.split('/collectionGroups/')[1].split('/indexes/')[0], queryScope: index.queryScope, fields: index.fields });
  assert.deepEqual((indexResult.indexes ?? []).map(normalizeIndex).sort((a, b) => digest(a).localeCompare(digest(b))),
    read('source-before').indexes.map(normalizeIndex).sort((a, b) => digest(a).localeCompare(digest(b))));
  const anonymous = await fetch(`https://firestore.googleapis.com/v1/${plan.destination}/documents/restoreProbe/missing`, { signal: AbortSignal.timeout(30000) });
  const anonymousBody = await anonymous.json();
  assert.equal(anonymous.status, 403);
  assert.equal(anonymousBody.error?.status, 'PERMISSION_DENIED');
  const after = await sourceState();
  assert.deepEqual(after.release, read('source-before').release);
  assert.deepEqual(after.namedDefault, read('source-before').namedDefault);
  assert.equal(after.database.uid, read('source-before').database.uid);
  save('source-after-validation', after);
  save('restored-document-hashes', records.sort((a, b) => a.pathHash.localeCompare(b.pathHash)));
  save('restored-indexes', indexResult);
  const result = { success: true, at: new Date().toISOString(), database, databaseUid: target.uid,
    totalDocuments: records.length, collectionGroups: Object.fromEntries([...groups].sort()), missingParents,
    sampledReadbacks: Math.min(records.length, 12), manifestHash: digest(records), indexesReady: indexResult.indexes?.length ?? 0,
    anonymousReadDenied: true, denyAllRulesVerified: true, defaultDatabaseMutationsByExecutor: 0,
    sourceValuesCompared: false, decryptabilityTested: false, authRestored: false, storageBytesRestored: false,
    exactTimeSnapshot: false, limitations: 'Counts are compared to export metadata; fields are not compared to original export bytes. Same-project IAM is shared.' };
  save('validation', result);
  console.log(JSON.stringify({ mode, success: true, documents: records.length, collectionGroups: groups.size, indexesReady: result.indexesReady }));
}

module.exports = { makePlan, validateRequest, digest };
if (require.main === module) main().catch(error => {
  // Do not print API payloads, tokens, user data or error objects with request headers.
  console.error(`Restore rehearsal stopped: ${String(error.message).slice(0, 300)}`);
  process.exitCode = 1;
});
