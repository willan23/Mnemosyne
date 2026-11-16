'use strict';

/** Read-only inventory. Run only after choosing an explicit Firebase project. */
const { classifySessionExposure } = require('./session-exposure');

function isSupportedEnvelope(enc) {
  return enc && typeof enc === 'object' && !Array.isArray(enc) &&
    Object.keys(enc).sort().join(',') === 'ct,iv,v' &&
    enc.v === 1 && typeof enc.iv === 'string' && enc.iv.length > 0 &&
    typeof enc.ct === 'string' && enc.ct.length > 0;
}

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/audit-session-exposure.js --project=<firebase-project-id>');
  process.exit(0);
}

const projectArg = process.argv.find((arg) => arg.startsWith('--project='));
const projectId = projectArg?.slice('--project='.length);
if (!projectId || !/^[a-z][a-z0-9-]{5,29}$/.test(projectId)) {
  console.error('Passa --project=<firebase-project-id> explicitamente. Nenhum acesso foi feito.');
  process.exit(2);
}

const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId });

async function main() {
  const db = admin.firestore();
  const totals = { scanned: 0 };
  const ownersWithPlaintext = new Set();
  const ownersWithAttachments = new Set();
  const ownersWithCiphertext = new Set();
  let cursor;
  while (true) {
    let query = db.collection('sessions')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const snapshot of page.docs) {
      totals.scanned += 1;
      const data = snapshot.data();
      if (data.enc != null && !isSupportedEnvelope(data.enc)) {
        totals.unsupportedEnc = (totals.unsupportedEnc || 0) + 1;
      }
      if (data.timestamp == null) totals.missingTimestamp = (totals.missingTimestamp || 0) + 1;
      const flags = classifySessionExposure(data);
      if (typeof data.uid === 'string' && data.uid) {
        if (flags.plaintextText || flags.plaintextTitle) ownersWithPlaintext.add(data.uid);
        if (flags.attachmentsPresent) ownersWithAttachments.add(data.uid);
        const enc = data.enc;
        if (enc && enc.v === 1 && typeof enc.iv === 'string' && enc.iv &&
            typeof enc.ct === 'string' && enc.ct) ownersWithCiphertext.add(data.uid);
      }
      for (const [name, present] of Object.entries(flags)) {
        if (present) totals[name] = (totals[name] || 0) + 1;
      }
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < 200) break;
  }

  async function summarizeNested(parent, name) {
    const summary = { scanned: 0 };
    let nestedCursor;
    while (true) {
      let nestedQuery = db.collectionGroup(name)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(200);
      if (nestedCursor) nestedQuery = nestedQuery.startAfter(nestedCursor);
      const page = await nestedQuery.get();
      if (page.empty) break;
      for (const snapshot of page.docs) {
        const segments = snapshot.ref.path.split('/');
        if (segments.length !== 4 || segments[0] !== parent || segments[2] !== name) continue;
        summary.scanned += 1;
        const data = snapshot.data();
        if (data.enc != null && !isSupportedEnvelope(data.enc)) {
          summary.unsupportedEnc = (summary.unsupportedEnc || 0) + 1;
        }
        if (parent === 'users') {
          if (data.uid == null) summary.missingUid = (summary.missingUid || 0) + 1;
          else if (data.uid !== segments[1]) summary.mismatchedUid = (summary.mismatchedUid || 0) + 1;
          if (data.timestamp == null) summary.missingTimestamp = (summary.missingTimestamp || 0) + 1;
        }
        const flags = classifySessionExposure(data);
        for (const key of ['missingEnc', 'plaintextText', 'plaintextTitle',
          'attachmentsPresent', 'inlineAttachment', 'tokenizedAttachment']) {
          if (flags[key]) summary[key] = (summary[key] || 0) + 1;
        }
      }
      nestedCursor = page.docs[page.docs.length - 1];
      if (page.size < 200) break;
    }
    return summary;
  }

  const nestedMemories = await summarizeNested('users', 'memories');
  const historicalVersions = await summarizeNested('sessions', 'versions');
  console.log(JSON.stringify({
    projectId,
    ...totals,
    ownersWithPlaintext: ownersWithPlaintext.size,
    ownersWithAttachments: ownersWithAttachments.size,
    ownersWithPlaintextAndCiphertext: [...ownersWithPlaintext]
      .filter((uid) => ownersWithCiphertext.has(uid)).length,
    nestedMemories,
    historicalVersions,
  }, null, 2));
}

main().catch(() => {
  console.error('Inventário falhou. Confirma credenciais, permissões de leitura e projeto; nenhum dado foi alterado.');
  process.exitCode = 1;
});
