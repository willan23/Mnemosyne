'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { inspect: inspectDesktopContract } = require('./check-desktop-release-contract.cjs');

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const HOST = 'https://mnemosyne-one.web.app';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function ensure(condition, message) { if (!condition) throw new Error(message); }

function regularPath(root, file, required = false) {
  const relative = path.relative(root, file);
  ensure(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Artifact path escapes the checkout.');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    ensure(!stat.isSymbolicLink(), 'Artifact staging refuses links and reparse points.');
    ensure(current === file ? stat.isFile() : stat.isDirectory(), 'Artifact path is not a regular file/directory.');
  }
  if (required) ensure(fs.existsSync(file) && fs.statSync(file).isFile(), 'Required versioned artifact or signature is missing.');
}

function buildVerifier(root) {
  const manifest = path.join(root, 'scripts/desktop-artifact-verifier/Cargo.toml');
  const env = { ...process.env };
  // The verifier needs only the configured public key; keep signing credentials out of its process.
  for (const name of Object.keys(env)) if (/TAURI_SIGNING_PRIVATE_KEY|WINDOWS_CERTIFICATE/.test(name)) delete env[name];
  const build = spawnSync('cargo', ['build', '--locked', '--manifest-path', manifest], { cwd: root, env, encoding: 'utf8', timeout: 300000 });
  ensure(!build.error && build.status === 0, 'Could not build the locked desktop signature verifier.');
  return path.join(root, 'scripts/desktop-artifact-verifier/target/debug/mnemosyne-desktop-artifact-verifier' + (process.platform === 'win32' ? '.exe' : ''));
}

function verifyArtifact(binary, artifact, signature, key) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/TAURI_SIGNING_PRIVATE_KEY|WINDOWS_CERTIFICATE/.test(name)) delete env[name];
  const result = spawnSync(binary, [artifact.file, signature, key, artifact.version], { env, encoding: 'utf8', timeout: 60000, maxBuffer: 65536 });
  ensure(!result.error && result.status === 0, 'Desktop artifact signature, signed version or filename is invalid.');
  const report = JSON.parse(result.stdout);
  ensure(report.verified === true && /^[a-f0-9]{64}$/.test(report.sha256) && report.bytes > 0, 'Invalid verifier result.');
  return report;
}

function prepareReleaseInputs({ root, version, notes, skipCopy = false }) {
  root = fs.realpathSync(root);
  ensure(typeof version === 'string' && version.length <= 64 && VERSION.test(version), 'Expected a three component desktop version.');
  ensure(typeof notes === 'string' && Buffer.byteLength(notes, 'utf8') <= 65536, 'Release notes exceed the allowed size.');
  const configPath = path.join(root, 'frontend/src-tauri/tauri.conf.json');
  const config = readJson(configPath);
  ensure(config.version === version && config.productName === 'Mnemosyne', 'Tauri metadata differs from the release version/product.');
  ensure(readJson(path.join(root, 'frontend/package.json')).version === version, 'Frontend version differs from the release.');
  const cargo = fs.readFileSync(path.join(root, 'frontend/src-tauri/Cargo.toml'), 'utf8').split(/\r?\n\[/)[0];
  ensure(new RegExp('^version = "' + version.replaceAll('.', '\\.') + '"$', 'm').test(cargo), 'Rust application version differs from the release.');
  const downloads = fs.readFileSync(path.join(root, 'frontend/src/config/downloads.ts'), 'utf8');
  ensure(downloads.includes("export const DESKTOP_APP_VERSION = '" + version + "';"), 'Download version differs from the release.');
  const updater = config.plugins?.updater;
  ensure(updater?.requireSignedVersion === true && updater.allowDowngrades === false && typeof updater.pubkey === 'string', 'Updater must require a signed version and refuse downgrades.');
  const channel = inspectDesktopContract(root, { includeDist: true });
  ensure(channel.version === version && hash(configPath) === channel.configSha256, 'Desktop release configuration changed during preparation.');
  const definitions = [
    { name: `Mnemosyne_${version}_x64-setup.exe`, kind: 'nsis', aliases: ['mnemosyne-desktop-setup.exe', 'mnemosyne-desktop.exe'] },
    { name: `Mnemosyne_${version}_x64_en-US.msi`, kind: 'msi', aliases: ['mnemosyne-desktop.msi'] },
  ];
  const artifacts = definitions.map(row => {
    const file = path.join(root, skipCopy ? 'frontend/public/downloads' : `frontend/src-tauri/target/release/bundle/${row.kind}`, row.name);
    const signature = file + '.sig'; regularPath(root, file, true); regularPath(root, signature, true);
    ensure(fs.statSync(signature).size > 0 && fs.statSync(signature).size <= 8192, 'Missing or oversized signature.');
    return { ...row, file, signature, version };
  });
  return { root, version, notes, configPath, updater, artifacts, channel };
}

function stageReleaseLocked(options, verifier) {
  const { root, version, notes, configPath, updater, artifacts, channel } = prepareReleaseInputs(options);
  const binary = verifier || buildVerifier(root);
  for (const artifact of artifacts) {
    artifact.verified = verifyArtifact(binary, artifact, artifact.signature, updater.pubkey);
    artifact.signatureText = fs.readFileSync(artifact.signature, 'utf8').trim();
  }
  const destinations = ['frontend/public', 'frontend/dist'];
  // Immutable versioned paths: rebuilding different bytes requires a new version.
  for (const destination of destinations) for (const artifact of artifacts) {
    for (const name of [artifact.name, artifact.name + '.sig', ...artifact.aliases]) {
      const target = path.join(root, destination, 'downloads', name); regularPath(root, target);
      if (fs.existsSync(target) && name === artifact.name) ensure(hash(target) === artifact.verified.sha256, 'Existing versioned installer contains different bytes; bump the version.');
      if (fs.existsSync(target) && name === artifact.name + '.sig') ensure(fs.readFileSync(target, 'utf8').trim() === artifact.signatureText, 'Existing versioned signature differs; bump the version.');
    }
  }
  for (const destination of destinations) for (const relative of [channel.feedPath, channel.manifestPath]) regularPath(root, path.join(root, destination, relative.slice(1)));
  const temporary = fs.mkdtempSync(path.join(root, '.desktop-stage-'));
  const operations = [];
  try {
    for (const artifact of artifacts) {
      const staged = path.join(temporary, artifact.name); fs.copyFileSync(artifact.file, staged, fs.constants.COPYFILE_EXCL);
      fs.writeFileSync(staged + '.sig', artifact.signatureText, { flag: 'wx' });
      const report = verifyArtifact(binary, { ...artifact, file: staged }, staged + '.sig', updater.pubkey);
      ensure(report.sha256 === artifact.verified.sha256 && report.bytes === artifact.verified.bytes, 'Installer changed while staging.');
      for (const destination of destinations) {
        for (const name of [artifact.name, ...artifact.aliases]) operations.push({ source: staged, target: path.join(root, destination, 'downloads', name), sha256: report.sha256 });
        operations.push({ source: staged + '.sig', target: path.join(root, destination, 'downloads', artifact.name + '.sig'), sha256: hash(staged + '.sig') });
      }
    }
    const nsis = artifacts[0];
    const feed = { version, notes, pub_date: new Date().toISOString(), platforms: { 'windows-x86_64': { signature: nsis.signatureText, url: HOST + '/downloads/' + nsis.name } } };
    const manifest = { v: 1, version, keyEpoch: channel.keyEpoch, configSha256: channel.configSha256, channelSha256: channel.channelSha256, artifacts: artifacts.map(a => ({ name: a.name, bytes: a.verified.bytes, sha256: a.verified.sha256, signatureSha256: hash(path.join(temporary, a.name + '.sig')) })) };
    fs.writeFileSync(path.join(temporary, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(path.join(temporary, 'latest.json'), JSON.stringify(feed, null, 2) + '\n', { flag: 'wx' });
    function publish(source, target) {
      regularPath(root, target); fs.mkdirSync(path.dirname(target), { recursive: true });
      const pending = target + '.' + path.basename(temporary) + '.tmp';
      try { fs.copyFileSync(source, pending, fs.constants.COPYFILE_EXCL); ensure(hash(pending) === hash(source), 'Staged destination hash differs.'); fs.renameSync(pending, target); }
      finally { if (fs.existsSync(pending)) fs.unlinkSync(pending); }
    }
    for (const op of operations) publish(op.source, op.target);
    // All installer bytes in both trees precede either feed. No wildcard copy of old releases/APKs.
    for (const op of operations) ensure(hash(op.target) === op.sha256, 'Published installer hash differs.');
    const finalChannel = inspectDesktopContract(root, { includeDist: true });
    ensure(finalChannel.configSha256 === channel.configSha256 && finalChannel.channelSha256 === channel.channelSha256, 'Desktop release configuration changed during staging.');
    for (const destination of destinations) publish(path.join(temporary, 'release-manifest.json'), path.join(root, destination, channel.manifestPath.slice(1)));
    for (const destination of destinations) publish(path.join(temporary, 'latest.json'), path.join(root, destination, channel.feedPath.slice(1)));
    return { staged: true, version, keyEpoch: channel.keyEpoch, legacyFeedPreserved: true, artifacts: manifest.artifacts, updaterSignatureVerified: true, signedVersionVerified: true, feedWrittenLast: true, productionMutations: 0, deployed: false };
  } finally {
    ensure(path.dirname(temporary) === root && path.basename(temporary).startsWith('.desktop-stage-'), 'Unsafe temporary directory.');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function withReleaseLock(options, action) {
  const root = fs.realpathSync(options.root), lock = path.join(root, '.desktop-release.lock');
  try { fs.mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another desktop stage is active, or an interrupted stage requires inspection.');
    throw error;
  }
  try { return action({ ...options, root }); }
  finally { fs.rmdirSync(lock); }
}

function stageRelease(options, verifier) {
  return withReleaseLock(options, inputs => stageReleaseLocked(inputs, verifier));
}

function verifyRelease(options, verifier) {
  return withReleaseLock(options, inputs => {
    const { root, version, configPath, updater, artifacts, channel } = prepareReleaseInputs({ ...inputs, notes: 'Read-only verification', skipCopy: true });
    const binary = verifier || buildVerifier(root);
    for (const tree of ['public', 'dist']) {
      const base = path.join(root, 'frontend', tree), expected = [];
      for (const artifact of artifacts) {
        const file = path.join(base, 'downloads', artifact.name), signature = file + '.sig';
        regularPath(root, file, true); regularPath(root, signature, true);
        const report = verifyArtifact(binary, { ...artifact, file }, signature, updater.pubkey);
        expected.push({ name: artifact.name, bytes: report.bytes, sha256: report.sha256, signatureSha256: hash(signature) });
        for (const alias of artifact.aliases) { const target = path.join(base, 'downloads', alias); regularPath(root, target, true); ensure(hash(target) === report.sha256, 'Stable installer alias differs from the signed release.'); }
      }
      for (const relative of [channel.feedPath, channel.manifestPath]) regularPath(root, path.join(base, relative.slice(1)), true);
      const feed = readJson(path.join(base, channel.feedPath.slice(1))), manifest = readJson(path.join(base, channel.manifestPath.slice(1)));
      ensure(manifest.v === 1 && manifest.version === version && manifest.keyEpoch === channel.keyEpoch && manifest.configSha256 === hash(configPath) && manifest.channelSha256 === channel.channelSha256 && JSON.stringify(manifest.artifacts) === JSON.stringify(expected), 'Release manifest differs from current signed artifacts/configuration.');
      ensure(feed.version === version && typeof feed.notes === 'string' && Number.isFinite(Date.parse(feed.pub_date)) && feed.platforms?.['windows-x86_64']?.signature === fs.readFileSync(path.join(base, 'downloads', artifacts[0].name + '.sig'), 'utf8').trim() && feed.platforms['windows-x86_64'].url === HOST + '/downloads/' + artifacts[0].name, 'Updater feed differs from current signed artifacts.');
    }
    return { verified: true, version, keyEpoch: channel.keyEpoch, legacyFeedPreserved: true, trees: 2, signedArtifacts: 4, artifactMutations: 0, productionMutations: 0, deployed: false };
  });
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = { root: path.resolve(__dirname, '..'), notes: 'Mnemosyne Cognitive OS desktop update.' };
    while (args.length) {
      const name = args.shift();
      if (name === '--version') options.version = args.shift();
      else if (name === '--notes') options.notes = args.shift();
      else if (name === '--skip-copy') options.skipCopy = true;
      else if (name === '--verify-only') options.verifyOnly = true;
      else throw new Error('Unknown desktop staging argument.');
    }
    if (options.verifyOnly && !options.version) options.version = readJson(path.join(options.root, 'frontend/src-tauri/tauri.conf.json')).version;
    console.log(JSON.stringify(options.verifyOnly ? verifyRelease(options) : stageRelease(options)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { stageRelease, verifyRelease, verifyArtifact, buildVerifier };
