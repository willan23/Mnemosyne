'use strict';
// Independent read-only verification: server-side counts do not reuse traversal results.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
async function main() {
  const directory = process.argv[2];
  assert(path.isAbsolute(directory));
  const evidence = JSON.parse(fs.readFileSync(path.join(directory, 'validation.json'), 'utf8'));
  const created = JSON.parse(fs.readFileSync(path.join(directory, 'created-database.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8')).plan;
  assert.equal(plan.project, 'mnemosyne-one');
  assert.match(evidence.database, /^mnemosyne-restore-20\d{6}(?:-[a-z0-9]{1,12})?$/);
  assert.equal(plan.destination, `projects/mnemosyne-one/databases/${evidence.database}`);
  assert.equal(evidence.databaseUid, created.uid);
  assert(evidence.success && evidence.totalDocuments === 359);
  const token = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '& gcloud.cmd auth print-access-token --project=mnemosyne-one --quiet'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert(token && !/\s/.test(token));
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const meta = await fetch('https://firestore.googleapis.com/v1/' + plan.destination, { headers });
  assert(meta.ok);
  assert.equal((await meta.json()).uid, created.uid);
  const counts = {};
  for (const [collection, expected] of Object.entries(evidence.collectionGroups)) {
    assert.match(collection, /^[a-zA-Z0-9_-]+$/);
    const response = await fetch(`https://firestore.googleapis.com/v1/${plan.destination}/documents:runAggregationQuery`, {
      method: 'POST', headers, body: JSON.stringify({ structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId: collection, allDescendants: true }] },
        aggregations: [{ alias: 'total', count: {} }]
      } }), signal: AbortSignal.timeout(60000)
    });
    assert(response.ok, `Aggregate HTTP ${response.status}`);
    const rows = await response.json();
    const result = rows.find(row => row.result?.aggregateFields?.total);
    const count = Number(result?.result.aggregateFields.total.integerValue);
    assert(Number.isSafeInteger(count) && count === expected.total);
    counts[collection] = count;
  }
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 359);
  const result = { at: new Date().toISOString(), success: true, database: evidence.database, databaseUid: created.uid,
    independentServerAggregation: true, counts, totalDocuments: 359, mutations: 0,
    sourceValuesCompared: false, note: 'Independent counts in restored database; not comparison to original export fields or decryption.' };
  fs.writeFileSync(path.join(directory, 'independent-live-verification.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ success: true, independentCollectionCounts: Object.keys(counts).length, documents: 359, mutations: 0 }));
}
main().catch(error => { console.error(`Independent restore verification stopped: ${String(error.message).slice(0, 200)}`); process.exitCode = 1; });
