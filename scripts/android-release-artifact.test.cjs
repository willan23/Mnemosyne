'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { publicApk, distApk, sourceFiles, sourceDirectories, sourceFingerprint, verify, stage, fetchApproved } =
  require('./android-release-artifact.cjs');

const apk = Buffer.from('approved synthetic Android package bytes');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'mnemosyne-android-release-test-'));
  t.after(() => {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), parent);
    assert(path.basename(actual).startsWith('mnemosyne-android-release-test-'));
    fs.rmSync(actual, { recursive: true, force: true });
  });
  function write(relative, bytes) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return file;
  }
  const json = (relative, data) => write(relative, JSON.stringify(data));
  for (const name of sourceFiles) write(name, 'synthetic source\r\n');
  for (const name of sourceDirectories) write(name + '/fixture.txt', 'synthetic input\r\n');
  json('frontend/package.json', { version: '1.0.9' });
  const contract = { v: 1, packageId: 'com.mnemosyne.mobile', versionName: '1.0.9', versionCode: 9,
    bytes: apk.length, sha256: sha256(apk), sourceSha256: sourceFingerprint(root) };
  const saveContract = () => json('scripts/android/release-download.json', contract);
  saveContract();
  return { root, write, json, contract, saveContract };
}

test('approved public and dist bytes remain bound to application and native inputs', t => {
  const f = fixture(t);
  f.write(publicApk, apk);
  f.write(distApk, apk);
  assert.deepEqual(verify(f.root), { verified: true, versionName: '1.0.9', versionCode: 9,
    sha256: sha256(apk), publicAndDistMatchApprovedApk: true });
  f.write('frontend/src/fixture.txt', 'changed application source');
  assert.throws(() => verify(f.root), /sources_changed/);
});

test('fingerprints normalize text line endings and omit generated release metadata', t => {
  const f = fixture(t);
  const before = sourceFingerprint(f.root);
  f.write('frontend/src/fixture.txt', 'synthetic input\n');
  f.json('frontend/public/version.json', { buildId: 'another-build' });
  f.write('frontend/public/desktop/v2/latest.json', 'independently staged desktop feed');
  f.write('frontend/public/downloads/unrelated.exe', 'binary');
  assert.equal(sourceFingerprint(f.root), before);
  f.write('frontend/android/app/src/main/java/fixture.txt', 'different native source');
  assert.notEqual(sourceFingerprint(f.root), before);
  f.write('frontend/src/fixture.txt', Buffer.from([0xff]));
  const invalidUtf8 = sourceFingerprint(f.root);
  f.write('frontend/src/fixture.txt', Buffer.from([0xfe]));
  assert.notEqual(sourceFingerprint(f.root), invalidUtf8);
});

test('missing and substituted APKs fail even when the release version is unchanged', t => {
  const f = fixture(t);
  assert.throws(() => verify(f.root), /missing/);
  f.write(publicApk, apk);
  f.write(distApk, Buffer.from(apk).fill(88));
  assert.throws(() => verify(f.root), /apk_mismatch/);
  f.write(distApk, apk);
  f.write(publicApk, 'older Android package');
  assert.throws(() => verify(f.root), /apk_mismatch/);
});

test('staging on a clean checkout publishes only the approved file and preserves existing files', t => {
  const f = fixture(t);
  const source = f.write('approved.apk', apk);
  assert(stage(f.root, source).staged);
  assert.deepEqual(fs.readFileSync(path.join(f.root, publicApk)), apk);
  assert(stage(f.root, source).staged);
  f.write(distApk, apk);
  assert(verify(f.root).verified);
  f.write(publicApk, 'existing unapproved file');
  assert.throws(() => stage(f.root, source), /apk_mismatch/);
  assert.equal(fs.readFileSync(path.join(f.root, publicApk), 'utf8'), 'existing unapproved file');
  assert.throws(() => stage(f.root, 'relative.apk'), /must_be_absolute/);
});

test('a concurrent staging writer cannot be overwritten', t => {
  const f = fixture(t);
  const source = f.write('approved.apk', apk);
  const link = fs.linkSync;
  fs.linkSync = (from, target) => {
    fs.writeFileSync(target, 'concurrent write', { flag: 'wx' });
    const error = new Error('fixture collision');
    error.code = 'EEXIST';
    throw error;
  };
  try {
    assert.throws(() => stage(f.root, source), /collision/);
  } finally {
    fs.linkSync = link;
  }
  assert.equal(fs.readFileSync(path.join(f.root, publicApk), 'utf8'), 'concurrent write');
  assert.deepEqual(fs.readdirSync(path.dirname(path.join(f.root, publicApk))), ['mnemosyne-android.apk']);
});

test('version and contract changes cannot approve a previous release implicitly', t => {
  const f = fixture(t);
  const source = f.write('approved.apk', apk);
  f.json('frontend/package.json', { version: '1.0.10' });
  assert.throws(() => stage(f.root, source), /version_mismatch/);
  f.json('frontend/package.json', { version: '1.0.9' });
  for (const [field, value] of [['versionCode', 0], ['bytes', -1], ['sha256', 'bad'], ['sourceSha256', 'bad']]) {
    const old = f.contract[field];
    f.contract[field] = value;
    f.saveContract();
    assert.throws(() => stage(f.root, source), /contract_invalid/);
    f.contract[field] = old;
  }
});

test('source and download directory links are refused', t => {
  const f = fixture(t);
  const source = f.write('approved.apk', apk);
  fs.mkdirSync(path.join(f.root, 'frontend/public/downloads'));
  fs.renameSync(path.join(f.root, 'frontend/public/downloads'), path.join(f.root, 'actual-downloads'));
  fs.symlinkSync(path.join(f.root, 'actual-downloads'), path.join(f.root, 'frontend/public/downloads'), 'junction');
  assert.throws(() => stage(f.root, source), /link_refused/);
});

test('release retrieval uses the selected repository asset and validates the downloaded bytes', t => {
  const f = fixture(t);
  const calls = [];
  const execute = (tool, args, options) => {
    calls.push({ tool, args, timeout: options.timeout, windowsHide: options.windowsHide });
    fs.writeSync(options.stdio[1], apk);
    return { status: 0 };
  };
  assert(fetchApproved(f.root, '12345', { repository: 'owner/repository', execute }).staged);
  assert.deepEqual(calls, [{
    tool: 'gh', args: ['api', '--method', 'GET', '-H', 'Accept: application/octet-stream',
      'repos/owner/repository/releases/assets/12345'], timeout: 60000, windowsHide: true,
  }]);
  f.write(distApk, apk);
  assert(verify(f.root).verified);
});

test('invalid selections, download failures and tampered bytes stop before staging', t => {
  const f = fixture(t);
  let called = false;
  const untouched = () => { called = true; throw new Error('must not be called'); };
  for (const [id, repository] of [['0', 'owner/repo'], ['12;exec', 'owner/repo'], ['1', '../other/repo']]) {
    assert.throws(() => fetchApproved(f.root, id, { repository, execute: untouched }), /selection_invalid/);
  }
  assert.equal(called, false);
  assert.throws(() => fetchApproved(f.root, '1', { repository: 'owner/repo', execute: () => ({ status: 1 }) }), /download_failed/);
  assert.throws(() => fetchApproved(f.root, '1', { repository: 'owner/repo', execute: (tool, args, options) => {
    fs.writeSync(options.stdio[1], 'tampered');
    return { status: 0 };
  } }), /apk_mismatch/);
  assert(!fs.existsSync(path.join(f.root, publicApk)));
});

test('CLI errors never echo a supplied path or command', () => {
  const marker = 'SYNTHETIC_PRIVATE_ARGUMENT_318';
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, 'android-release-artifact.cjs'), '--bad', marker],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 1);
  assert(!result.stderr.includes(marker));
  assert.match(result.stderr, /arguments_invalid/);
});
