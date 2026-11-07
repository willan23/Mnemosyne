'use strict';

// Metadata only; no --apply, body download, signed URL request or destructive operation.
const args = process.argv.slice(2);
const usage = 'node scripts/reconcile-legacy-attachments.js --project=<id> --bucket=<legacy-bucket> [--page-size=<1..100>]';
if (args.includes('--help')) { console.log(usage); process.exit(0); }
const value = prefix => args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
const projectId = value('--project='); const bucketName = value('--bucket='); const pageSize = value('--page-size=') ?? '100';
if (args.some(arg => !/^(--project=|--bucket=|--page-size=)/.test(arg)) || new Set(args.map(arg => arg.split('=')[0])).size !== args.length ||
    !/^[a-z][a-z0-9-]{5,29}$/.test(projectId || '') || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucketName || '') ||
    !/^[1-9][0-9]*$/.test(pageSize) || Number(pageSize) > 100 || process.env.FIRESTORE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  console.error(`Argumentos/contexto inválidos. Nenhum acesso foi feito. Uso: ${usage}`); process.exit(2);
}
const admin = require('../functions/node_modules/firebase-admin');
const { GoogleAuth } = require('../functions/node_modules/google-auth-library');
const { Storage } = require('../functions/node_modules/@google-cloud/storage');
admin.initializeApp({ projectId });
const { createLegacyAttachmentReconciler, reconcileLegacyAttachmentReferencesPage } = require('../functions/lib/legacyAttachmentReconciliation');
async function main() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform.read-only'] }); const client = await auth.getClient();
  const project = (await client.request({ url: `https://cloudresourcemanager.googleapis.com/v3/projects/${projectId}`,
    params: { fields: 'name,projectId,state' }, timeout: 20000, retry: false })).data;
  if (project.projectId !== projectId || project.state !== 'ACTIVE' || !/^projects\/[0-9]+$/.test(project.name)) throw Error('binding');
  const bucket = new Storage({ projectId, retryOptions: { autoRetry: false } }).bucket(bucketName);
  const [metadata] = await bucket.getMetadata();
  if (metadata.name !== bucketName || String(metadata.projectNumber) !== project.name.slice('projects/'.length)) throw Error('binding');
  const objects = []; let after; let exhausted = false; const seen = new Set();
  for (let page = 0; page < 100; page++) {
    // With fields, this SDK returns plain resources, not File instances. No custom metadata except download-token entries.
    const [entries, next] = await bucket.getFiles({ prefix: 'attachments/', maxResults: 100, autoPaginate: false, pageToken: after, versions: false,
      fields: 'items(name,size,generation,metadata/firebaseStorageDownloadTokens),nextPageToken' });
    objects.push(...entries);
    if (!next?.pageToken) { exhausted = true; break; }
    if (seen.has(next.pageToken)) throw Error('cursor'); seen.add(next.pageToken); after = next.pageToken;
  }
  if (!exhausted) throw Error('cap');
  const collector = createLegacyAttachmentReconciler(bucketName, objects); const db = admin.firestore();
  for (const source of ['sessions', 'versions', 'memories']) {
    let cursor = null; let complete = false;
    for (let page = 0; page < 1000; page++) {
      const result = await reconcileLegacyAttachmentReferencesPage({ source, afterPath: cursor, limit: Number(pageSize) }, db, collector);
      if (result.exhausted) { complete = true; break; }
      if (!result.nextAfterPath || result.nextAfterPath === cursor) throw Error('cursor'); cursor = result.nextAfterPath;
    }
    if (!complete) throw Error('cap');
  }
  console.log(JSON.stringify({ v: 1, verifiedAtUtc: new Date().toISOString(), projectId, bucket: bucketName, bindingVerified: true,
    mode: 'read-only-reconciliation', complete: true, productionMutations: 0, ...collector.summary(),
    consistency: 'Independent metadata passes, known reference fields only; no global snapshot, body download, Auth check, effective token access probe or deletion authority.' }, null, 2));
}
main().catch(() => { console.error('Reconciliação não concluída. Rever contexto/permissões e repetir; nenhum dado foi alterado.'); process.exitCode = 1; })
  .finally(async () => { try { await admin.app().delete(); } catch { process.exitCode = 1; } });
