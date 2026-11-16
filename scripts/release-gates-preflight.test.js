'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const {spawnSync} = require('node:child_process');
const {inspect, args, SOURCES} = require('./release-gates-preflight');

test('agent proposals require client confirmation admission and the server proposal gate', () => {
  const root = fixture();
  try {
    for (const [relative, name] of [['frontend/src/config/releaseGates.ts', 'AGENT_MUTATION_WRITES_ENABLED'], ['functions/src/apiKeys.ts', 'API_MEMORY_WRITES_ENABLED']]) {
      const file = path.join(root, relative), before = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, before.replace(name + ' = true', name + ' = false'));
      const report = inspect(root); assert.equal(report.sourceGatesOpen, false);
      assert.equal(report.gates.find(row => row.source === relative && row.name === name).enabled, false);
      fs.writeFileSync(file, before);
    }
  } finally { cleanup(root); }
});
function cleanup(root) {
  const absolute = path.resolve(root);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('mnemosyne-deploy-test-')) throw Error('Unsafe fixture cleanup');
  fs.rmSync(absolute, {recursive: true, force: true});
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemosyne-deploy-test-'));
  for (const [relative, names] of SOURCES) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), {recursive: true});
    fs.writeFileSync(path.join(root, relative), names.map(name => `export const ${name} = true;`).join('\n'));
  }
  return root;
}
test('gate preflight parses exported constant literals and keeps full release completion unproven', () => {
  const root = fixture();
  try {
    const report = inspect(root); assert.equal(report.sourceGatesOpen, true); assert.equal(report.gates.length, 49);
    assert.equal(report.releaseComplete, false); assert.equal(report.productionMutations, 0); assert.equal(report.sources.length, 26);
    const [relative, names] = SOURCES[0]; const file = path.join(root, relative);
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, `// export const ${names[0]} = true;\n` + original.replace(`${names[0]} = true`, `${names[0]} = false`));
    assert.equal(inspect(root).sourceGatesOpen, false);
    for (const change of [original.replace(`const ${names[0]}`, `let ${names[0]}`), original.replace(`${names[0]} = true`, `${names[0]} = getConfig()`),
      original + `\nexport const ${names[0]} = true;`]) {fs.writeFileSync(file, change); assert.throws(() => inspect(root));}
  } finally {cleanup(root);}
});

test('complete rollout also requires attachment association, initial attached-memory creation and scoped API writes', () => {
  const root = fixture();
  try {
    for (const name of ['ATTACHMENT_ASSOCIATIONS_ENABLED','ATTACHED_MEMORY_CREATION_ENABLED','PERSONAL_MEMORY_CREATION_ENABLED','PERSONAL_REVISION_WRITES_ENABLED','COMMS_IDENTITY_ROLLOVERS_ENABLED','COMMS_IDENTITY_PUBLICATION_ENABLED','MOBILE_PAIRING_ENABLED','COMMS_CONTACT_WRITES_ENABLED','COMMS_DELIVERY_WRITES_ENABLED','COMMS_P2P_WRITES_ENABLED','COMMS_P2P_SIGNALING_ENABLED','COMMS_P2P_CONTENT_ENABLED','COMMS_P2P_CLEANUP_ENABLED','COMMS_P2P_LEGACY_RECONCILIATION_ENABLED','API_MEMORY_WRITES_ENABLED','MOBILE_SYNC_WRITES_ENABLED','MOBILE_SYNC_IMPORT_ENABLED','PERSONAL_CONNECTION_WRITES_ENABLED','OBSIDIAN_IMPORT_WRITES_ENABLED','CAPSULE_IMPORT_WRITES_ENABLED','DOCUMENT_IMPORT_WRITES_ENABLED']) {
      const [relative] = SOURCES.find(([_path, names]) => names.includes(name)); const file = path.join(root, relative); const before = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, before.replace(`${name} = true`, `${name} = false`));
      const report = inspect(root); assert.equal(report.sourceGatesOpen, false); assert.equal(report.gates.find(row => row.name === name).enabled, false);
      fs.writeFileSync(file, before);
    }
  } finally {cleanup(root);}
});
test('team history maintenance requires its separate server gate as well as frontend admission',()=>{const root=fixture();try{const relative='functions/src/teamHistoryChanges.ts',file=path.join(root,relative);assert.ok(fs.existsSync(file));fs.writeFileSync(file,'export const TEAM_HISTORY_REENCRYPTION_ENABLED = false;');const report=inspect(root);assert.equal(report.sourceGatesOpen,false);assert.equal(report.gates.find(row=>row.source===relative&&row.name==='TEAM_HISTORY_REENCRYPTION_ENABLED').enabled,false);}finally{cleanup(root);}});

test('identity publication requires both frontend intent and server admission',()=>{const root=fixture();try{for(const relative of ['frontend/src/config/releaseGates.ts','functions/src/commsIdentityPublication.ts']){const file=path.join(root,relative),before=fs.readFileSync(file,'utf8');fs.writeFileSync(file,before.replace('COMMS_IDENTITY_PUBLICATION_ENABLED = true','COMMS_IDENTITY_PUBLICATION_ENABLED = false'));const report=inspect(root);assert.equal(report.sourceGatesOpen,false);assert.equal(report.gates.find(row=>row.source===relative&&row.name==='COMMS_IDENTITY_PUBLICATION_ENABLED').enabled,false);fs.writeFileSync(file,before);}}finally{cleanup(root);}});
test('local CLI reflects source gates, rejects stale baselines and preserves earlier output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemosyne-deploy-test-')); const output = path.join(root, 'report.json');
  try {
    for (const values of [[], ['--out', 'relative.json'], ['--out', output, '--out', output], ['--unknown', output]]) assert.throws(() => args(values));
    const run = spawnSync(process.execPath, [path.join(__dirname, 'release-gates-preflight.js'), '--out', output], {encoding: 'utf8'});
    const source = inspect(path.resolve(__dirname, '..'));
    assert.equal(run.status, source.sourceGatesOpen ? 0 : 2); const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(report.sourceGatesOpen, source.sourceGatesOpen); assert.deepEqual(report.sources, source.sources);
    const prior = fs.readFileSync(output, 'utf8');
    const again = spawnSync(process.execPath, [path.join(__dirname, 'release-gates-preflight.js'), '--out', output], {encoding: 'utf8'});
    assert.equal(again.status, 1); assert.equal(fs.readFileSync(output, 'utf8'), prior);
    const baseline = path.join(root, 'baseline.json'); fs.writeFileSync(baseline, JSON.stringify({...report, sourceGatesOpen: true,
      sources: report.sources.map(row => ({...row, sha256: '0'.repeat(64)}))}));
    const target = path.join(root, 'stale.json');
    const stale = spawnSync(process.execPath, [path.join(__dirname, 'release-gates-preflight.js'), '--out', target, '--baseline', baseline], {encoding: 'utf8'});
    assert.equal(stale.status, 1); assert.equal(fs.existsSync(target), false);
  } finally {cleanup(root);}
});
test('PowerShell pipeline stops on every failure, binds every publish project, and records partial publication honestly', {skip: process.platform !== 'win32'}, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'deploy-pipeline.test.ps1')], {encoding: 'utf8', timeout: 60000});
  assert.equal(result.status, 0, 'PowerShell sequence assertions must pass');
  assert.ok(result.stdout.includes('DEPLOY_SEQUENCE_ASSERTIONS_PASSED'));
});




test('device enrollment requires both frontend recovery admission and the server gate',()=>{const root=fixture();try{for(const relative of ['frontend/src/config/releaseGates.ts','functions/src/mobilePairing.ts']){const file=path.join(root,relative),before=fs.readFileSync(file,'utf8');fs.writeFileSync(file,before.replace('MOBILE_PAIRING_ENABLED = true','MOBILE_PAIRING_ENABLED = false'));const report=inspect(root);assert.equal(report.sourceGatesOpen,false);assert.equal(report.gates.find(row=>row.source===relative&&row.name==='MOBILE_PAIRING_ENABLED').enabled,false);fs.writeFileSync(file,before);}}finally{cleanup(root);}});
