'use strict';

// Aggregate-only preflight for operator read-only inventories. No document bodies or Auth users are fetched.
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('node scripts/count-launch-data.js --project=<id>'); process.exit(0); }
const projectId = args.length === 1 && args[0].startsWith('--project=') ? args[0].slice('--project='.length) : '';
if (!/^[a-z][a-z0-9-]{5,29}$/.test(projectId)) { console.error('Projeto explícito obrigatório. Nenhum acesso foi feito.'); process.exit(2); }
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId });
const db = admin.firestore();
async function main() {
  const counts = {};
  for (const name of ['sessions', 'attachmentUploads', 'teamInvites', 'teamInviteInbox', 'teams']) {
    counts[name] = (await db.collection(name).count().get()).data().count;
  }
  for (const name of ['versions', 'memories', 'keyEpochs']) {
    counts[`${name}Group`] = (await db.collectionGroup(name).count().get()).data().count;
  }
  const { v1 } = require('../functions/node_modules/@google-cloud/firestore');
  const { missingPersonalScopeIndexes } = require('./personal-scope-indexes');
  const client = new v1.FirestoreAdminClient({ projectId });
  let indexes;
  try {
    const [actual] = await client.listIndexes({ parent: `projects/${projectId}/databases/(default)/collectionGroups/sessions` });
    indexes = { requiredPersonalScope: 3, missingOrNotReady: missingPersonalScopeIndexes(actual).length,
      observed: actual.length,
      states: actual.reduce((counts, index) => { const key = String(index.state); counts[key] = (counts[key] || 0) + 1; return counts; }, {}),
      scopes: actual.reduce((counts, index) => { const key = String(index.queryScope); counts[key] = (counts[key] || 0) + 1; return counts; }, {}) };
  } finally { await client.close(); }
  console.log(JSON.stringify({ v: 1, projectId, mode: 'aggregate-only', counts, indexes }, null, 2));
}
main().catch(error => {
  const safeCodes = { 7: 'permission-denied', 9: 'failed-precondition', 16: 'unauthenticated', 4: 'deadline-exceeded', 14: 'unavailable' };
  console.error(JSON.stringify({ mode: 'aggregate-only', complete: false, reason: safeCodes[error?.code] || 'read-failed' }));
  process.exitCode = 1;
}).finally(async () => { try { await admin.app().delete(); } catch { process.exitCode = 1; } });
