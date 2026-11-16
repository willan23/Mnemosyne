'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RETIRED_PATHS = [
  'backend/main.py', 'backend/kg_engine.py', 'backend/models.py', 'backend/requirements.txt', 'backend/Dockerfile',
  'frontend/migrate-memories.js', 'frontend/src/services/nvidiaApiService.ts', 'functions/src/kg-extractor.ts',
];
const failure = () => new Error('runtime_entrypoints_unavailable');
function inspect(root) {
  if (!path.isAbsolute(root)) throw failure();
  const findings = [], sources = [];
  const packages = {};
  for (const relative of ['package.json', 'functions/package.json']) {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100_000) throw failure();
    const bytes = fs.readFileSync(file), value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.scripts || typeof value.scripts !== 'object' ||
      Array.isArray(value.scripts) || Object.values(value.scripts).some(command => typeof command !== 'string')) throw failure();
    packages[relative] = value;
    sources.push({ path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    for (const [name, command] of Object.entries(value.scripts)) {
      if (/\buvicorn\b|(?:^|\s)(?:cd|pushd)\s+["']?backend\b|\bfunctions:shell\b/i.test(command)) findings.push({ file: relative, script: name, reason: 'retired_runtime' });
      if (RETIRED_PATHS.some(relative => command.replaceAll('\\', '/').includes(relative))) findings.push({ file: relative, script: name, reason: 'retired_runtime_reference' });
      if (/\bfirebase(?:\.(?:cmd|exe|js))?\s|\bfirebase-tools(?:@\S+)?\s/i.test(command)) findings.push({ file: relative, script: name, reason: 'unreviewed_firebase_entrypoint' });
      // A function-only emulator inherits .firebaserc and may reach live services/secrets.
      if (/\bemulators:start\b/i.test(command)) findings.push({ file: relative, script: name, reason: 'unreviewed_emulator_entrypoint' });
    }
  }
  for (const name of ['backend', 'backend:install']) if (Object.hasOwn(packages['package.json'].scripts, name)) findings.push({ file: 'package.json', script: name, reason: 'retired_alias' });
  for (const name of ['serve', 'shell', 'start', 'logs']) if (Object.hasOwn(packages['functions/package.json'].scripts, name)) findings.push({ file: 'functions/package.json', script: name, reason: 'implicit_project_alias' });
  const expected = { 'package.json': { deploy: 'powershell -NoProfile -NonInteractive -File deploy.ps1', 'deploy:all': 'powershell -NoProfile -NonInteractive -File deploy.ps1' },
    'functions/package.json': { deploy: 'powershell -NoProfile -NonInteractive -File ../deploy.ps1' } };
  for (const [file, commands] of Object.entries(expected)) for (const [name, command] of Object.entries(commands)) {
    if (packages[file].scripts[name] !== command) findings.push({ file, script: name, reason: 'unreviewed_publication_entrypoint' });
  }
  for (const relative of RETIRED_PATHS) {
    try { fs.lstatSync(path.join(root, relative)); findings.push({ file: relative, reason: 'retired_runtime_present' }); }
    catch (error) { if (error.code !== 'ENOENT') throw failure(); }
  }
  return { v: 1, passed: findings.length === 0, findings, sources, retiredPaths: RETIRED_PATHS,
    scope: 'Declared npm entrypoints and eight retired runtime paths; not a sandbox for arbitrary manual commands', productionMutations: 0 };
}
function args(values) {
  if (!values.length) return {};
  if (values.length !== 2 || values[0] !== '--out' || !path.isAbsolute(values[1])) throw failure();
  return { out: values[1] };
}
function main() {
  if (process.versions.node.split('.')[0] !== '22') throw failure();
  const input = args(process.argv.slice(2)), report = inspect(path.resolve(__dirname, '..'));
  if (input.out) fs.writeFileSync(input.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify(report) + '\n');
  if (!report.passed) process.exitCode = 2;
}
module.exports = { inspect, args, RETIRED_PATHS };
if (require.main === module) { try { main(); } catch { process.stderr.write('{"error":"runtime_entrypoints_unavailable","productionMutations":0}\n'); process.exitCode = 1; } }
