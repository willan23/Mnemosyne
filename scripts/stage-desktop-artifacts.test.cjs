'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { stageRelease, verifyRelease, buildVerifier } = require('./stage-desktop-artifacts.cjs');
const actualRoot = path.resolve(__dirname, '..');
const verifier = buildVerifier(actualRoot);
const version = '1.0.9';
const names = [`Mnemosyne_${version}_x64-setup.exe`, `Mnemosyne_${version}_x64_en-US.msi`];
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

// Disposable Ed25519 key exists only in memory. Real minisign-verify checks every fixture.
function signer() {
  const pair = crypto.generateKeyPairSync('ed25519'), id = crypto.randomBytes(8);
  const raw = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return {
    key: Buffer.from('untrusted comment: synthetic test public key\n' + Buffer.concat([Buffer.from('Ed'), id, raw]).toString('base64')).toString('base64'),
    sign(data, filename, signedVersion = version, extra = '') {
      const comment = `timestamp:1792480000\tfile:${filename}` + (signedVersion === null ? '' : `\tversion:${signedVersion}`) + extra;
      const signature = crypto.sign(null, crypto.createHash('blake2b512').update(data).digest(), pair.privateKey);
      const global = crypto.sign(null, Buffer.concat([signature, Buffer.from(comment)]), pair.privateKey);
      return Buffer.from('untrusted comment: synthetic test signature\n' + Buffer.concat([Buffer.from('ED'), id, signature]).toString('base64') + '\ntrusted comment: ' + comment + '\n' + global.toString('base64')).toString('base64');
    },
  };
}
function fixture(work) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'mnemosyne-artifact-test-'));
  try {
    const key = signer();
    function put(relative, data) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; }
    const config = JSON.parse(fs.readFileSync(path.join(actualRoot, 'frontend/src-tauri/tauri.conf.json')));
    // The fixture signs its own pinned version, independent of the real release under development.
    config.version = version;
    config.plugins.updater.pubkey = key.key;
    put('frontend/src-tauri/tauri.conf.json', JSON.stringify(config));
    put('frontend/package.json', JSON.stringify({ version }));
    put('frontend/package-lock.json', JSON.stringify({ version, packages: { '': { version } } }));
    put('frontend/src-tauri/Cargo.toml', `[package]\nname = "synthetic"\nversion = "${version}"\n`);
    put('frontend/src-tauri/Cargo.lock', `[[package]]\nname = "mnemosyne"\nversion = "${version}"\n`);
    put('frontend/src/config/downloads.ts', `export const DESKTOP_APP_VERSION = '${version}';\n`);
    const legacy = JSON.stringify({ version: '1.0.8', preserve: true });
    const channel = JSON.parse(fs.readFileSync(path.join(actualRoot, 'frontend/src/config/desktopReleaseChannel.json')));
    channel.publicKeySha256 = sha(Buffer.from(key.key)); channel.legacyFeedSha256 = sha(Buffer.from(legacy));
    put('frontend/src/config/desktopReleaseChannel.json', JSON.stringify(channel));
    const files = names.map((name, index) => {
      const data = Buffer.from('Synthetic installer bytes; never execute. ' + index);
      const file = put(`frontend/src-tauri/target/release/bundle/${index === 0 ? 'nsis' : 'msi'}/${name}`, data);
      fs.writeFileSync(file + '.sig', key.sign(data, name));
      return file;
    });
    for (const tree of ['public', 'dist']) {
      put(`frontend/${tree}/desktop/latest.json`, legacy);
      put(`frontend/${tree}/desktop/v2/latest.json`, JSON.stringify({ version: 'previous', preserve: true }));
    }
    put('frontend/public/downloads/legacy-unrelated.exe', 'old unrelated artifact');
    put('frontend/public/downloads/mnemosyne-android.apk', 'synthetic unrelated APK');
    return work({ root, put, key, files, options: { root, version, notes: 'Synthetic release' } });
  } finally {
    assert.equal(path.dirname(path.resolve(root)), parent); assert(path.basename(root).startsWith('mnemosyne-artifact-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function outputs(root) {
  const result = {};
  function walk(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) result[path.relative(root, file)] = sha(fs.readFileSync(file));
    }
  }
  walk(path.join(root, 'frontend/public')); walk(path.join(root, 'frontend/dist'));
  return result;
}

test('valid signed NSIS/MSI stage exact bytes, aliases, signatures and feed in both trees', () => fixture(({ root, options, files }) => {
  const notes = 'Correção 🧠\n"; $(SYNTHETIC_INPUT_EXECUTED)';
  const result = stageRelease({ ...options, notes }, verifier);
  assert(result.staged && result.updaterSignatureVerified && result.signedVersionVerified && result.feedWrittenLast);
  assert.equal(result.deployed, false);
  for (const tree of ['public', 'dist']) {
    const base = path.join(root, 'frontend', tree);
    const feed = JSON.parse(fs.readFileSync(path.join(base, 'desktop/v2/latest.json')));
    const manifest = JSON.parse(fs.readFileSync(path.join(base, 'desktop/v2/release-manifest.json')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, 'desktop/latest.json'))), { version: '1.0.8', preserve: true });
    assert.equal(feed.version, version); assert.equal(feed.notes, notes);
    assert.equal(feed.platforms['windows-x86_64'].url, 'https://mnemosyne-one.web.app/downloads/' + names[0]);
    assert.equal(feed.platforms['windows-x86_64'].signature, fs.readFileSync(files[0] + '.sig', 'utf8'));
    for (let index = 0; index < 2; index++) {
      const expected = fs.readFileSync(files[index]);
      assert.deepEqual(fs.readFileSync(path.join(base, 'downloads', names[index])), expected);
      assert.equal(manifest.artifacts[index].sha256, sha(expected));
    }
    for (const name of ['mnemosyne-desktop.exe', 'mnemosyne-desktop-setup.exe']) assert.deepEqual(fs.readFileSync(path.join(base, 'downloads', name)), fs.readFileSync(files[0]));
    assert.deepEqual(fs.readFileSync(path.join(base, 'downloads/mnemosyne-desktop.msi')), fs.readFileSync(files[1]));
  }
  assert(!fs.existsSync(path.join(root, 'frontend/dist/downloads/legacy-unrelated.exe')));
  assert(!fs.existsSync(path.join(root, 'frontend/dist/downloads/mnemosyne-android.apk')));
  assert(!fs.readdirSync(root).some(name => name.startsWith('.desktop-')));
}));

const refusals = [
  ['changed NSIS bytes', ({ files }) => fs.appendFileSync(files[0], 'tampered')],
  ['changed MSI bytes', ({ files }) => fs.appendFileSync(files[1], 'tampered')],
  ['missing NSIS signature', ({ files }) => fs.unlinkSync(files[0] + '.sig')],
  ['missing MSI signature', ({ files }) => fs.unlinkSync(files[1] + '.sig')],
  ['older signed version', ({ files, key }) => fs.writeFileSync(files[0] + '.sig', key.sign(fs.readFileSync(files[0]), names[0], '1.0.7'))],
  ['no signed version', ({ files, key }) => fs.writeFileSync(files[0] + '.sig', key.sign(fs.readFileSync(files[0]), names[0], null))],
  ['duplicate signed versions', ({ files, key }) => fs.writeFileSync(files[0] + '.sig', key.sign(fs.readFileSync(files[0]), names[0], version, '\tversion:1.0.7'))],
  ['another signed filename', ({ files, key }) => fs.writeFileSync(files[0] + '.sig', key.sign(fs.readFileSync(files[0]), 'another.exe'))],
  ['another signing key', ({ files }) => fs.writeFileSync(files[0] + '.sig', signer().sign(fs.readFileSync(files[0]), names[0]))],
  ['tampered trusted version', ({ files }) => { const old = fs.readFileSync(files[0] + '.sig', 'utf8'); fs.writeFileSync(files[0] + '.sig', Buffer.from(Buffer.from(old, 'base64').toString().replace('version:' + version, 'version:9.9.9')).toString('base64')); }],
  ['unrelated MSI fallback', ({ files }) => fs.renameSync(files[1], path.join(path.dirname(files[1]), 'Mnemosyne_1.0.7_x64_en-US.msi'))],
  ['frontend version mismatch', ({ put }) => put('frontend/package.json', JSON.stringify({ version: '1.0.7' }))],
  ['Rust version mismatch', ({ put }) => put('frontend/src-tauri/Cargo.toml', '[package]\nversion = "1.0.7"\n')],
  ['download version mismatch', ({ put }) => put('frontend/src/config/downloads.ts', "export const DESKTOP_APP_VERSION = '1.0.7';")],
  ['versioned destination conflict', ({ put }) => put('frontend/dist/downloads/' + names[0], 'different bytes under the same version')],
  ['changed legacy public feed', ({ put }) => put('frontend/public/desktop/latest.json', 'changed legacy feed')],
  ['changed legacy dist feed', ({ put }) => put('frontend/dist/desktop/latest.json', 'changed legacy feed')],
];
for (const [name, mutate] of refusals) test('refuses ' + name + ' without changing public/dist outputs', () => fixture(context => {
  mutate(context); const before = outputs(context.root);
  assert.throws(() => stageRelease(context.options, verifier)); assert.deepEqual(outputs(context.root), before);
  assert(!fs.readdirSync(context.root).some(name => name.startsWith('.desktop-')));
}));

test('a stale public signature is never reused for a new native build', () => fixture(({ root, options, put, files }) => {
  put('frontend/public/downloads/' + names[0] + '.sig', 'stale signature');
  const before = outputs(root); assert.throws(() => stageRelease(options, verifier), /Existing versioned signature differs/);
  assert.deepEqual(outputs(root), before); assert(fs.existsSync(files[0]));
}));
test('SkipCopy revalidates staged public bytes and signatures before rebuilding dist', () => fixture(({ root, options, files }) => {
  stageRelease(options, verifier);
  fs.unlinkSync(files[0]); fs.unlinkSync(files[1]);
  assert(stageRelease({ ...options, skipCopy: true }, verifier).staged);
  const staged = path.join(root, 'frontend/public/downloads', names[0]); fs.appendFileSync(staged, 'tampered');
  const before = outputs(root); assert.throws(() => stageRelease({ ...options, skipCopy: true }, verifier)); assert.deepEqual(outputs(root), before);
}));
test('changed source between verification and copy never reaches either feed', () => fixture(({ root, options, files }) => {
  const original = fs.copyFileSync, before = outputs(root); let changed = false;
  fs.copyFileSync = (source, ...args) => { if (source === files[0] && !changed) { changed = true; fs.appendFileSync(source, 'changed during staging'); } return original(source, ...args); };
  try { assert.throws(() => stageRelease(options, verifier), /signature|changed/); } finally { fs.copyFileSync = original; }
  assert(changed); assert.deepEqual(outputs(root), before);
}));
test('a destination I/O failure leaves both previous feeds intact', () => fixture(({ root, options }) => {
  const original = fs.renameSync, feeds = ['public', 'dist'].map(tree => path.join(root, `frontend/${tree}/desktop/v2/latest.json`));
  const before = feeds.map(file => fs.readFileSync(file, 'utf8'));
  fs.renameSync = (source, target) => { if (target.endsWith('mnemosyne-desktop.msi')) throw new Error('Synthetic destination failure'); return original(source, target); };
  try { assert.throws(() => stageRelease(options, verifier), /Synthetic destination failure/); } finally { fs.renameSync = original; }
  assert.deepEqual(feeds.map(file => fs.readFileSync(file, 'utf8')), before);
  assert(!fs.readdirSync(root).some(name => name.startsWith('.desktop-')));
}));

test('a configuration change during copying preserves both old and new channel feeds', () => fixture(({ root, options, files }) => {
  const original = fs.copyFileSync, feeds = ['public', 'dist'].flatMap(tree => ['desktop/latest.json', 'desktop/v2/latest.json'].map(name => path.join(root, 'frontend', tree, name)));
  const before = feeds.map(file => fs.readFileSync(file, 'utf8')); let changed = false;
  fs.copyFileSync = (source, ...args) => {
    if (source === files[0] && !changed) { changed = true; const file = path.join(root, 'frontend/src-tauri/tauri.conf.json'), config = JSON.parse(fs.readFileSync(file)); config.app.windows[0].title = 'Synthetic changed title'; fs.writeFileSync(file, JSON.stringify(config)); }
    return original(source, ...args);
  };
  try { assert.throws(() => stageRelease(options, verifier), /configuration changed during staging/); } finally { fs.copyFileSync = original; }
  assert(changed); assert.deepEqual(feeds.map(file => fs.readFileSync(file, 'utf8')), before);
}));
test('an active or interrupted staging lock refuses a second writer', () => fixture(({ root, options }) => {
  const lock = path.join(root, '.desktop-release.lock'); fs.mkdirSync(lock); const before = outputs(root);
  assert.throws(() => stageRelease(options, verifier), /Another desktop stage/); assert.deepEqual(outputs(root), before); assert(fs.existsSync(lock));
}));
test('a linked output directory is refused before copies', () => fixture(({ root, options }) => {
  const folder = path.join(root, 'frontend/public/downloads'), target = path.join(root, 'synthetic-link-target');
  fs.renameSync(folder, target); fs.symlinkSync(target, folder, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => stageRelease(options, verifier), /links and reparse points/);
  assert.equal(fs.readdirSync(target).length, 2);
}));
test('deployment verification reads both trees without changing any artifact', () => fixture(({ root, options }) => {
  stageRelease(options, verifier); const before = outputs(root);
  const result = verifyRelease(options, verifier); assert(result.verified && result.trees === 2 && result.signedArtifacts === 4 && result.artifactMutations === 0);
  assert.deepEqual(outputs(root), before);
}));
for (const [name, change] of [
  ['dist installer', ({ root }) => fs.appendFileSync(path.join(root, 'frontend/dist/downloads', names[0]), 'tampered')],
  ['stable MSI alias', ({ root }) => fs.appendFileSync(path.join(root, 'frontend/public/downloads/mnemosyne-desktop.msi'), 'tampered')],
  ['feed URL', ({ root }) => { const file = path.join(root, 'frontend/dist/desktop/v2/latest.json'), feed = JSON.parse(fs.readFileSync(file)); feed.platforms['windows-x86_64'].url = 'https://example.invalid/other'; fs.writeFileSync(file, JSON.stringify(feed)); }],
  ['manifest digest', ({ root }) => { const file = path.join(root, 'frontend/public/desktop/v2/release-manifest.json'), manifest = JSON.parse(fs.readFileSync(file)); manifest.artifacts[0].sha256 = '0'.repeat(64); fs.writeFileSync(file, JSON.stringify(manifest)); }],
]) test('deployment verification refuses an altered ' + name, () => fixture(context => {
  stageRelease(context.options, verifier); change(context); const before = outputs(context.root);
  assert.throws(() => verifyRelease(context.options, verifier)); assert.deepEqual(outputs(context.root), before);
}));
test('desktop workflow uploads an exact verified list and requires verifier tests', () => {
  const yaml = require('../frontend/node_modules/js-yaml');
  for (const file of ['.github/workflows/desktop-release.yml', '.github/workflows/ci.yml']) {
    const workflow = yaml.load(fs.readFileSync(path.join(actualRoot, file), 'utf8'));
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps || []);
    for (const fragment of ['node --test scripts/stage-desktop-artifacts.test.cjs', 'cargo test --locked --manifest-path scripts/desktop-artifact-verifier/Cargo.toml', 'cargo audit --file scripts/desktop-artifact-verifier/Cargo.lock']) {
      const row = steps.find(step => step.run === fragment); assert(row); assert(!row.if); assert(!row['continue-on-error']);
    }
    if (file.includes('desktop-release')) {
      const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
      assert.equal(upload.with['if-no-files-found'], 'error'); assert(!upload.with.path.includes('*')); assert.equal(upload.with.path.trim().split('\n').length, 9);
    }
  }
});
