'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const cp = require('node:child_process');

const contractFile = 'scripts/android/release-download.json';
const publicApk = 'frontend/public/downloads/mnemosyne-android.apk';
const distApk = 'frontend/dist/downloads/mnemosyne-android.apk';

const sourceFiles = [
  'frontend/index.html', 'frontend/package.json', 'frontend/package-lock.json',
  'frontend/tsconfig.json', 'frontend/tsconfig.app.json', 'frontend/tsconfig.node.json',
  'frontend/vite.config.ts', 'frontend/capacitor.config.ts',
  'frontend/android/build.gradle', 'frontend/android/settings.gradle', 'frontend/android/variables.gradle',
  'frontend/android/gradle.properties', 'frontend/android/gradlew', 'frontend/android/gradlew.bat',
  'frontend/android/capacitor.settings.gradle', 'frontend/android/app/build.gradle',
  'frontend/android/app/capacitor.build.gradle', 'frontend/android/app/proguard-rules.pro',
  'frontend/android/app/src/main/AndroidManifest.xml',
  'frontend/android/capacitor-cordova-android-plugins/build.gradle',
  'frontend/android/capacitor-cordova-android-plugins/cordova.variables.gradle',
];
const sourceDirectories = [
  'frontend/src', 'frontend/scripts', 'frontend/public', 'frontend/android/gradle/wrapper',
  'frontend/android/app/src/main/java', 'frontend/android/app/src/main/res',
  'frontend/android/capacitor-cordova-android-plugins/src',
];
const generatedPublicPaths = new Set([
  'frontend/public/downloads', 'frontend/public/desktop', 'frontend/public/version.json',
]);
const textFile = /\.(?:bat|cjs|css|gradle|html|java|js|json|md|mjs|pro|properties|sh|svg|ts|tsx|txt|webmanifest|xml)$/i;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function fail(reason) {
  throw new Error(reason);
}

function checkedPath(root, relative, allowMissingLeaf = false) {
  const parts = relative.split('/');
  let target = root;
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part);
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!stat && index === parts.length - 1 && allowMissingLeaf) return target;
    if (!stat) fail('android_release_input_missing');
    if (stat.isSymbolicLink()) fail('android_release_link_refused');
    if (index < parts.length - 1 && !stat.isDirectory()) fail('android_release_directory_required');
  }
  return target;
}

function fileContents(file) {
  if (!fs.lstatSync(file).isFile()) fail('android_release_regular_file_required');
  return fs.readFileSync(file);
}

function sourceFingerprint(root) {
  root = path.resolve(root);
  const inputs = new Map();
  function collect(relative) {
    if (generatedPublicPaths.has(relative)) return;
    const file = checkedPath(root, relative);
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) collect(relative + '/' + name);
      return;
    }
    const bytes = fileContents(file);
    // Preserve all input bytes while normalizing CRLF in text inputs.
    const content = textFile.test(relative) || relative.endsWith('/gradlew')
      ? Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : bytes;
    inputs.set(relative, digest(content));
  }
  for (const relative of [...sourceFiles, ...sourceDirectories]) collect(relative);
  return digest(JSON.stringify([...inputs].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)));
}

function approvedRelease(root) {
  const contract = JSON.parse(fileContents(checkedPath(root, contractFile)).toString('utf8'));
  const packageVersion = JSON.parse(fileContents(checkedPath(root, 'frontend/package.json')).toString('utf8')).version;
  if (contract.v !== 1 || contract.packageId !== 'com.mnemosyne.mobile' ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(contract.versionName) ||
      !Number.isInteger(contract.versionCode) || contract.versionCode < 1 || contract.versionCode > 2100000000 ||
      !Number.isSafeInteger(contract.bytes) || contract.bytes < 1 || contract.bytes > 256 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(contract.sha256) || !/^[a-f0-9]{64}$/.test(contract.sourceSha256)) {
    fail('android_release_contract_invalid');
  }
  if (contract.versionName !== packageVersion) fail('android_release_version_mismatch');
  if (contract.sourceSha256 !== sourceFingerprint(root)) fail('android_release_sources_changed');
  return contract;
}

function verifyFile(file, contract) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) fail('android_release_apk_missing');
  if (!stat.isFile() || stat.isSymbolicLink()) fail('android_release_regular_file_required');
  if (stat.size !== contract.bytes || digest(fs.readFileSync(file)) !== contract.sha256) {
    fail('android_release_apk_mismatch');
  }
}

function verify(root) {
  root = path.resolve(root);
  const contract = approvedRelease(root);
  verifyFile(checkedPath(root, publicApk, true), contract);
  verifyFile(checkedPath(root, distApk, true), contract);
  return { verified: true, versionName: contract.versionName, versionCode: contract.versionCode,
    sha256: contract.sha256, publicAndDistMatchApprovedApk: true };
}

function stage(root, source) {
  root = path.resolve(root);
  const contract = approvedRelease(root);
  if (!path.isAbsolute(source)) fail('android_release_apk_path_must_be_absolute');
  verifyFile(source, contract);

  const downloads = checkedPath(root, 'frontend/public/downloads', true);
  if (!fs.existsSync(downloads)) fs.mkdirSync(downloads);
  const destination = checkedPath(root, publicApk, true);
  if (fs.existsSync(destination)) {
    verifyFile(destination, contract);
  } else {
    const temporary = destination + '.staging-' + crypto.randomUUID();
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    try {
      verifyFile(temporary, contract);
      // Publish the complete file atomically and refuse a concurrent writer.
      fs.linkSync(temporary, destination);
    } finally {
      fs.unlinkSync(temporary);
    }
  }
  return { staged: true, versionName: contract.versionName, sha256: contract.sha256 };
}

function fetchApproved(root, assetId, options = {}) {
  approvedRelease(path.resolve(root));
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  if (!/^[1-9][0-9]{0,19}$/.test(assetId) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    fail('android_release_asset_selection_invalid');
  }
  const parent = fs.realpathSync(os.tmpdir());
  const folder = fs.mkdtempSync(path.join(parent, 'mnemosyne-android-asset-'));
  try {
    const source = path.join(folder, 'mnemosyne-android.apk');
    const descriptor = fs.openSync(source, 'wx');
    let result;
    try {
      result = (options.execute ?? cp.spawnSync)('gh', [
        'api', '--method', 'GET', '-H', 'Accept: application/octet-stream',
        'repos/' + repository + '/releases/assets/' + assetId,
      ], { stdio: ['ignore', descriptor, 'ignore'], timeout: 60000, windowsHide: true });
    } finally {
      fs.closeSync(descriptor);
    }
    if (result.error || result.status !== 0) fail('android_release_asset_download_failed');
    return stage(root, source);
  } finally {
    const actual = fs.realpathSync(folder);
    if (path.dirname(actual) !== parent || !path.basename(actual).startsWith('mnemosyne-android-asset-')) {
      fail('android_release_temporary_directory_invalid');
    }
    fs.rmSync(actual, { recursive: true, force: true });
  }
}

module.exports = { publicApk, distApk, sourceFiles, sourceDirectories, sourceFingerprint, verify, stage, fetchApproved };

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const args = process.argv.slice(2);
    let result;
    if (args.length === 1 && args[0] === '--verify-only') result = verify(root);
    else if (args.length === 1 && args[0] === '--source-sha256') result = { sourceSha256: sourceFingerprint(root) };
    else if (args.length === 2 && args[0] === '--stage') result = stage(root, args[1]);
    else if (args.length === 2 && args[0] === '--fetch') result = fetchApproved(root, args[1]);
    else fail('android_release_arguments_invalid');
    console.log(JSON.stringify(result));
  } catch (error) {
    const reason = /^[a-z_]+$/.test(error.message) ? error.message : 'android_release_inspection_failed';
    console.error(JSON.stringify({ verified: false, reason }));
    process.exitCode = 1;
  }
}
