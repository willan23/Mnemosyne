'use strict';

// Read-only. Do not add --apply: repairing a legacy URL is not proof of ownership or encryption.
const args = process.argv.slice(2);
const usage = 'node scripts/audit-attachment-references.js --project=<id> [--page-size=<1..100>] [--require-clean]';
if (args.includes('--help')) { console.log(usage); process.exit(0); }
const value = prefix => args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
const projectId = value('--project='); const pageSizeRaw = value('--page-size=') ?? '100';
if (args.some(arg => !/^(--project=|--page-size=|--require-clean$)/.test(arg)) ||
    new Set(args.map(arg => arg.split('=')[0])).size !== args.length || !projectId || !/^[a-z][a-z0-9-]{5,29}$/.test(projectId) ||
    !/^[1-9][0-9]*$/.test(pageSizeRaw) || Number(pageSizeRaw) > 100) {
  console.error(`Argumentos inválidos. Nenhum acesso foi feito. Uso: ${usage}`); process.exit(2);
}
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId });
const { inventoryAttachmentReferencesPage, ATTACHMENT_INVENTORY_REASONS } = require('../functions/lib/attachmentReferenceInventory');
const db = admin.firestore();
async function main() {
  const sources = {}; let affectedDocuments = 0;
  for (const source of ['sessions', 'versions', 'memories', 'attachmentUploads']) {
    const summary = { scanned: 0, affectedDocuments: 0, references: 0, canonicalReferences: 0,
      reasons: Object.fromEntries(ATTACHMENT_INVENTORY_REASONS.map(reason => [reason, 0])), uploadStates: {} };
    let afterPath = null;
    while (true) {
      const page = await inventoryAttachmentReferencesPage({ source, afterPath, limit: Number(pageSizeRaw) }, db);
      for (const field of ['scanned', 'affectedDocuments', 'references', 'canonicalReferences']) summary[field] += page[field];
      for (const [reason, count] of Object.entries(page.reasons)) summary.reasons[reason] += count;
      for (const [state, count] of Object.entries(page.uploadStates)) summary.uploadStates[state] = (summary.uploadStates[state] || 0) + count;
      if (page.exhausted) break;
      afterPath = page.nextAfterPath;
    }
    sources[source] = summary; affectedDocuments += summary.affectedDocuments;
  }
  console.log(JSON.stringify({ v: 1, projectId, mode: 'read-only', affectedDocuments, sources }, null, 2));
  if (args.includes('--require-clean') && affectedDocuments > 0) process.exitCode = 1;
}
main().catch(() => {
  // SDK exceptions may contain object paths or document IDs. No partial scan is reported as a completed audit.
  console.error('Inventário não concluído. Rever credenciais/permissões e repetir; nenhum dado foi alterado.');
  process.exitCode = 1;
}).finally(async () => { try { await admin.app().delete(); } catch { process.exitCode = 1; } });
