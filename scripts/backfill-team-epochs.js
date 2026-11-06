'use strict';

const args = process.argv.slice(2);
const usage = 'node scripts/backfill-team-epochs.js --project=<id> [--require-complete | --apply --expected=<dry-run-eligible> --backup-uri=<gs://export>]';
if (args.includes('--help')) {
  console.log(usage);
  process.exit(0);
}

const known = /^(--project=|--expected=|--backup-uri=|--apply$|--require-complete$)/;
const option = prefix => args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
const projectId = option('--project=');
const expected = option('--expected=');
const backup = option('--backup-uri=');
const apply = args.includes('--apply');
const requireComplete = args.includes('--require-complete');
if (args.some(arg => !known.test(arg)) || new Set(args.map(arg => arg.split('=')[0])).size !== args.length ||
    !projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || (apply && requireComplete) ||
    (!apply && (expected !== undefined || backup !== undefined)) ||
    (apply && (!/^(0|[1-9][0-9]*)$/.test(expected || '') || !Number.isSafeInteger(Number(expected)) ||
      !/^gs:\/\/[a-z0-9][a-z0-9._-]+\/[^\s]+$/.test(backup || '')))) {
  console.error(usage);
  process.exit(2);
}

const admin = require('../functions/node_modules/firebase-admin');
const app = admin.initializeApp({ projectId });
const { migrateLegacyTeamEpochs } = require('../functions/lib/teamEpochMigration');
const db = app.firestore();
const report = (mode, result) => console.log(JSON.stringify({ projectId, mode, ...result }));

async function main() {
  const before = await migrateLegacyTeamEpochs(db);
  report('dry-run', before);
  if (requireComplete && (before.eligible || before.failed)) throw new Error('cutover-incomplete');
  if (!apply) return;
  if (before.failed || before.eligible !== Number(expected)) throw new Error('preflight-incomplete');

  const written = await migrateLegacyTeamEpochs(db, { apply: true });
  report('apply', written);
  const after = await migrateLegacyTeamEpochs(db);
  report('verification', after);
  if (written.failed || written.migrated !== Number(expected) || after.eligible || after.failed) {
    throw new Error('cutover-incomplete');
  }
}

main().catch(() => {
  // Avoid exposing private document paths and wraps in operational logs.
  console.error('Migração de épocas por concluir. Revê o inventário antes de prosseguir.');
  process.exitCode = 1;
}).finally(() => app.delete());
