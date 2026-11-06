'use strict';

// Explicit project; read-only by default. Aggregate output contains no UIDs, wraps or document IDs.
const args = process.argv.slice(2);
const usage = 'node scripts/backfill-team-invite-inbox.js --project=<id> [--require-complete | --apply --expected=<dry-run-changes> --backup-uri=<gs://export>]';
if (args.includes('--help')) { console.log(usage); process.exit(0); }
const known = /^(--project=|--expected=|--backup-uri=|--apply$|--require-complete$)/;
const option = prefix => args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
const projectId = option('--project='); const apply = args.includes('--apply'); const requireComplete = args.includes('--require-complete');
const expected = option('--expected='); const backup = option('--backup-uri=');
if (args.some(arg => !known.test(arg)) || new Set(args.map(arg => arg.split('=')[0])).size !== args.length ||
    !projectId || !/^[a-z][a-z0-9-]{5,29}$/.test(projectId) || (apply && requireComplete) ||
    (!apply && (expected !== undefined || backup !== undefined)) ||
    (apply && (!/^(0|[1-9][0-9]*)$/.test(expected || '') || !Number.isSafeInteger(Number(expected)) ||
      !/^gs:\/\/[a-z0-9][a-z0-9._-]+\/.+/.test(backup || '')))) {
  console.error(`Argumentos inválidos. Nenhum acesso foi feito. Uso: ${usage}`); process.exit(2);
}

const admin = require('../functions/node_modules/firebase-admin');
const { migrateTeamInviteInboxPage } = require('../functions/lib/teamInviteInboxMigration');
admin.initializeApp({ projectId });
const db = admin.firestore();
const auth = { getUser: uid => admin.auth().getUser(uid) };
async function scan(write) {
  const total = { scanned: 0, reasons: { valid: 0, inactive: 0, reissue: 0, unavailable: 0, malformed: 0, conflict: 0 },
    created: 0, removed: 0, changesNeeded: 0, unresolved: 0 };
  for (const collection of ['teamInvites', 'teamInviteInbox']) {
    let afterId = null;
    while (true) {
      const page = await migrateTeamInviteInboxPage({ collection, afterId, limit: 100, apply: write, now: Date.now() }, db, auth);
      for (const field of ['scanned', 'created', 'removed', 'changesNeeded', 'unresolved']) total[field] += page[field];
      for (const reason of Object.keys(total.reasons)) total.reasons[reason] += page.reasons[reason];
      if (page.exhausted) break;
      afterId = page.nextAfterId;
    }
  }
  return total;
}
async function main() {
  const before = await scan(false);
  console.log(JSON.stringify({ projectId, mode: 'dry-run', ...before }));
  if (!apply) {
    if (requireComplete && (before.changesNeeded || before.unresolved)) throw new Error('cutover-incomplete');
    return;
  }
  if (before.changesNeeded !== Number(expected) || before.unresolved) throw new Error('preflight-incomplete');
  const written = await scan(true);
  console.log(JSON.stringify({ projectId, mode: 'apply', ...written }));
  const after = await scan(false);
  console.log(JSON.stringify({ projectId, mode: 'verification', ...after }));
  if (after.changesNeeded || after.unresolved) throw new Error('cutover-incomplete');
}
main().catch(() => {
  // SDK errors can include private resource paths. Detailed diagnosis belongs in a controlled operator session.
  console.error('Migração não concluída. Rever o inventário e executar novamente; o corte permanece bloqueado.');
  process.exitCode = 1;
}).finally(() => admin.app().delete());
