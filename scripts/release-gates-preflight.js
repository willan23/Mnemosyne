'use strict';
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const ts = require('../functions/node_modules/typescript');
const SOURCES = [
  ['frontend/src/config/releaseGates.ts', ['AGENT_MUTATION_WRITES_ENABLED', 'TEAM_WRITES_ENABLED', 'TEAM_HISTORY_REENCRYPTION_ENABLED', 'ATTACHMENT_WRITES_ENABLED', 'PERSONAL_MEMORY_CREATION_ENABLED', 'PERSONAL_REVISION_WRITES_ENABLED', 'COMMS_IDENTITY_ROLLOVERS_ENABLED', 'COMMS_IDENTITY_PUBLICATION_ENABLED', 'COMMS_CONTACT_WRITES_ENABLED', 'COMMS_DELIVERY_WRITES_ENABLED', 'COMMS_P2P_WRITES_ENABLED', 'ACCOUNT_DELETION_ENABLED', 'TEAM_DELETION_ENABLED', 'CLIP_CAPTURE_ENABLED', 'MOBILE_SYNC_WRITES_ENABLED', 'MOBILE_PAIRING_ENABLED', 'PERSONAL_CONNECTION_WRITES_ENABLED', 'OBSIDIAN_IMPORT_WRITES_ENABLED', 'CAPSULE_IMPORT_WRITES_ENABLED', 'DOCUMENT_IMPORT_WRITES_ENABLED', 'CAPSULE_PUBLICATION_ENABLED']],
  ['functions/src/teams.ts', ['TEAM_WRITES_ENABLED']], ['functions/src/teamDeletion.ts', ['TEAM_DELETION_ENABLED']],
  ['functions/src/accountDeletion.ts', ['ACCOUNT_DELETION_ENABLED']], ['functions/src/attachmentUploads.ts', ['ATTACHMENT_UPLOADS_ENABLED', 'ATTACHMENT_PURGES_ENABLED']],
  ['functions/src/attachmentMutations.ts', ['ATTACHMENT_ASSOCIATIONS_ENABLED']],
  ['functions/src/attachedMemoryCreation.ts', ['ATTACHED_MEMORY_CREATION_ENABLED', 'PERSONAL_MEMORY_CREATION_ENABLED']],
  ['functions/src/apiKeys.ts', ['API_MEMORY_WRITES_ENABLED']],
  ['functions/src/clippedMemoryCreation.ts', ['CLIP_CAPTURE_ENABLED']],
  ['functions/src/mobileSyncImport.ts', ['MOBILE_SYNC_IMPORT_ENABLED']],
  ['functions/src/personalConnections.ts', ['PERSONAL_CONNECTION_WRITES_ENABLED']],
  ['functions/src/obsidianImport.ts', ['OBSIDIAN_IMPORT_WRITES_ENABLED','CAPSULE_IMPORT_WRITES_ENABLED']],
  ['functions/src/personalRevisions.ts', ['PERSONAL_REVISION_WRITES_ENABLED']],
  ['functions/src/teamHistoryChanges.ts', ['TEAM_HISTORY_REENCRYPTION_ENABLED']],
  ['functions/src/commsIdentityRollovers.ts', ['COMMS_IDENTITY_ROLLOVERS_ENABLED']],
  ['functions/src/commsIdentityPublication.ts', ['COMMS_IDENTITY_PUBLICATION_ENABLED']],
  ['functions/src/mobilePairing.ts', ['MOBILE_PAIRING_ENABLED']],
  ['functions/src/publicCapsules.ts', ['CAPSULE_PUBLIC_ACCESS_ENABLED']],
  ['functions/src/capsulePublication.ts', ['CAPSULE_PUBLICATION_ENABLED']],
  ['functions/src/commsContacts.ts', ['COMMS_CONTACT_WRITES_ENABLED']],
  ['functions/src/commsDelivery.ts', ['COMMS_DELIVERY_WRITES_ENABLED']],
  ['functions/src/commsP2PSignaling.ts', ['COMMS_P2P_SIGNALING_ENABLED']],
  ['functions/src/commsP2PContent.ts', ['COMMS_P2P_CONTENT_ENABLED']],
  ['functions/src/commsP2PCleanup.ts', ['COMMS_P2P_CLEANUP_ENABLED']],
  ['functions/src/commsP2PLegacy.ts', ['COMMS_P2P_LEGACY_RECONCILIATION_ENABLED']],
  ['functions/src/documentImport.ts', ['DOCUMENT_IMPORT_WRITES_ENABLED']],
];
function inspect(root) {
  const report = {v: 1, generatedAt: new Date().toISOString(), mode: 'local-read-only', sourceGatesOpen: false,
    releaseComplete: false, productionMutations: 0, gates: [], sources: []};
  for (const [relative, names] of SOURCES) {
    const file = path.join(root, relative); const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw Error('gate_source_unavailable');
    const text = fs.readFileSync(file, 'utf8'); const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) throw Error('gate_source_invalid');
    report.sources.push({path: relative, sha256: crypto.createHash('sha256').update(text).digest('hex')});
    for (const name of names) {
      const declarations = source.statements.filter(statement => ts.isVariableStatement(statement) &&
        statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) && (statement.declarationList.flags & ts.NodeFlags.Const))
        .flatMap(statement => statement.declarationList.declarations).filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name);
      if (declarations.length !== 1 || ![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(declarations[0].initializer?.kind)) throw Error('gate_not_explicit_boolean');
      report.gates.push({source: relative, name, enabled: declarations[0].initializer.kind === ts.SyntaxKind.TrueKeyword});
    }
  }
  report.sourceGatesOpen = report.gates.every(gate => gate.enabled); return report;
}
function args(values) {
  const result = {};
  while (values.length) {const key = values.shift(); const value = values.shift();
    if (!['--out', '--baseline'].includes(key) || !value || result[key.slice(2)] || !path.isAbsolute(value)) throw Error('absolute_output_required'); result[key.slice(2)] = value;
  }
  if (!result.out) throw Error('absolute_output_required'); return result;
}
function main() {
  if (process.versions.node.split('.')[0] !== '22') throw Error('node22_required');
  const input = args(process.argv.slice(2)); const report = inspect(path.resolve(__dirname, '..'));
  if (input.baseline) {
    const prior = JSON.parse(fs.readFileSync(input.baseline, 'utf8').replace(/^\uFEFF/, ''));
    if (prior.v !== 1 || prior.sourceGatesOpen !== true || JSON.stringify(prior.sources) !== JSON.stringify(report.sources)) throw Error('gate_sources_changed');
  }
  fs.writeFileSync(input.out, JSON.stringify(report, null, 2) + '\n', {encoding: 'utf8', flag: 'wx'});
  process.stdout.write(JSON.stringify({output: input.out, sourceGatesOpen: report.sourceGatesOpen, checked: report.gates.length, productionMutations: 0}) + '\n');
  if (!report.sourceGatesOpen) process.exitCode = 2;
}
module.exports = {inspect, args, SOURCES};
if (require.main === module) {try {main();} catch {process.stderr.write('{"error":"release_gate_check_failed","releaseComplete":false}\n'); process.exitCode = 1;}}

