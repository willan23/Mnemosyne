'use strict';

/**
 * Manual, restartable migration for the future teamId == null personal query.
 * Dry-run by default. Run only after a recoverable Firestore export.
 */
const { classifySessionExposure, needsPersonalScopeBackfill, hasValidSessionUid } = require('./session-exposure');

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/backfill-personal-scope.js --project=<id> [--require-complete | --apply --expected=<dry-run-count> --backup-uri=<gs://export>]');
  process.exit(0);
}

const argValue = (prefix) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
const projectId = argValue('--project=');
const apply = args.includes('--apply');
const requireComplete = args.includes('--require-complete');
const expectedRaw = argValue('--expected=');
const backupUri = argValue('--backup-uri=');
if (args.some(arg => !/^(--project=|--expected=|--backup-uri=|--apply$|--require-complete$)/.test(arg)) ||
    new Set(args.map(arg => arg.split('=')[0])).size !== args.length ||
    (!apply && (expectedRaw !== undefined || backupUri !== undefined))) {
  console.error('Argumentos inválidos. Nenhum acesso foi feito.'); process.exit(2);
}
if (apply && requireComplete) {
  console.error('--require-complete é apenas de leitura; não combinar com --apply.');
  process.exit(2);
}

if (!projectId || !/^[a-z][a-z0-9-]{5,29}$/.test(projectId)) {
  console.error('Passa --project=<firebase-project-id> explicitamente. Nenhum acesso foi feito.');
  process.exit(2);
}
if (apply && (
  expectedRaw === undefined || !/^(0|[1-9][0-9]*)$/.test(expectedRaw) || !Number.isSafeInteger(Number(expectedRaw)) ||
  !backupUri || !/^gs:\/\/[a-z0-9][a-z0-9._-]+\/.+/.test(backupUri)
)) {
  console.error('Para --apply exige --expected=<contagem dry-run> e --backup-uri=<gs://export> de um backup recuperável. Nenhum acesso foi feito.');
  process.exit(2);
}

const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

async function eachSession(callback) {
  let cursor;
  while (true) {
    let query = db.collection('sessions')
      .orderBy(admin.firestore.FieldPath.documentId())
      .select('uid', 'teamId')
      .limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const snapshot of page.docs) await callback(snapshot);
    cursor = page.docs[page.docs.length - 1];
    if (page.size < 200) break;
  }
}

async function main() {
  let scanned = 0;
  let candidates = 0;
  let invalidTeamScope = 0;
  let invalidUid = 0;
  await eachSession((snapshot) => {
    scanned += 1;
    const data = snapshot.data();
    if (needsPersonalScopeBackfill(data)) candidates += 1;
    if (classifySessionExposure(data).invalidTeamScope) invalidTeamScope += 1;
    if (!hasValidSessionUid(data)) invalidUid += 1;
  });
  if (!apply) {
    console.log(JSON.stringify({ projectId, mode: 'dry-run', scanned, candidates, invalidTeamScope, invalidUid }, null, 2));
    if (requireComplete && (candidates > 0 || invalidTeamScope > 0 || invalidUid > 0)) {
      throw new Error('Corte bloqueado: concluir backfill e resolver âmbitos inválidos antes de publicar.');
    }
    if (requireComplete) {
      const { v1 } = require('../functions/node_modules/@google-cloud/firestore');
      const { missingPersonalScopeIndexes } = require('./personal-scope-indexes');
      const client = new v1.FirestoreAdminClient({ projectId });
      try {
        const [indexes] = await client.listIndexes({ parent: `projects/${projectId}/databases/(default)/collectionGroups/sessions` });
        const missing = missingPersonalScopeIndexes(indexes);
        if (missing.length) throw new Error(`Corte bloqueado: ${missing.length} índices pessoais ausentes ou não READY. Publicar índices separadamente e aguardar.`);
        console.log('Personal scope indexes: READY.');
      } finally { await client.close(); }
    }
    return;
  }

  if (invalidTeamScope > 0) {
    throw new Error('Há documentos com teamId inválido. Revê-os antes de aplicar a migração.');
  }
  if (invalidUid > 0) throw new Error('Há documentos com uid inválido. Rever ownership antes de aplicar a migração.');
  if (candidates !== Number(expectedRaw)) {
    throw new Error('A contagem mudou desde o dry-run. Reconta antes de aplicar.');
  }

  let updated = 0;
  let skippedSinceScan = 0;
  await eachSession(async (snapshot) => {
    if (!needsPersonalScopeBackfill(snapshot.data())) return;
    const didUpdate = await db.runTransaction(async (tx) => {
      const [fresh] = await tx.getAll(snapshot.ref, { fieldMask: ['uid', 'teamId'] });
      if (!fresh.exists || !needsPersonalScopeBackfill(fresh.data())) return false;
      tx.update(snapshot.ref, { teamId: null });
      return true;
    });
    if (didUpdate) updated += 1;
    else skippedSinceScan += 1;
  });
  console.log(JSON.stringify({ projectId, mode: 'apply', scanned, candidates, invalidTeamScope, invalidUid, updated, skippedSinceScan }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : '';
  const safe = [
    'Corte bloqueado: concluir backfill e resolver âmbitos inválidos antes de publicar.',
    'Há documentos com teamId inválido. Revê-os antes de aplicar a migração.',
    'Há documentos com uid inválido. Rever ownership antes de aplicar a migração.',
    'A contagem mudou desde o dry-run. Reconta antes de aplicar.',
  ].includes(message) || /^Corte bloqueado: [0-9]+ índices pessoais ausentes ou não READY\. Publicar índices separadamente e aguardar\.$/.test(message);
  console.error(safe ? message : 'Migração não concluída. Rever credenciais/permissões e repetir; o corte permanece bloqueado.');
  process.exitCode = 1;
}).finally(async () => { try { await admin.app().delete(); } catch { process.exitCode = 1; } });
