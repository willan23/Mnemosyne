'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { inspect } = require('./check-build-version-identity.cjs');

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'mnemosyne-build-identity-'));
  t.after(() => {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), parent);
    assert(path.basename(actual).startsWith('mnemosyne-build-identity-'));
    assert(!fs.lstatSync(root).isSymbolicLink());
    fs.rmSync(actual, { recursive: true, force: true });
  });
  const payload = { version: '1.0.8', buildId: 'synthetic-build', builtAt: '2026-10-24T00:00:00.000Z', channel: 'production', notes: '' };
  const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  const manifests = value => { const json = JSON.stringify(value, null, 2) + '\n'; write('frontend/public/version.json', json); write('frontend/dist/version.json', json); };
  write('frontend/package.json', JSON.stringify({ version: payload.version })); manifests(payload);
  write('frontend/dist/index.html', '<script type="module" crossorigin src="/assets/index-fixture.js"></script>');
  write('frontend/dist/assets/index-fixture.js', 'console.log(' + JSON.stringify(payload) + ');');
  return { root, payload, write, manifests };
}

test('accepts a coherent pair of manifests and the referenced production entry', t => {
  const { root } = fixture(t), result = inspect(root);
  assert.equal(result.consistent, true); assert.deepEqual(result.matchingEntries, ['/assets/index-fixture.js']);
  assert.equal(result.contentSignatureVerified, false);
});
test('rejects a post-build rewrite of only the public manifest', t => {
  const { root, payload, write } = fixture(t);
  write('frontend/public/version.json', JSON.stringify({ ...payload, buildId: 'other-build' }));
  assert.throws(() => inspect(root), /public_and_dist_version_differ/);
});
test('rejects two matching new manifests alongside an old entry bundle', t => {
  const { root, payload, manifests } = fixture(t); manifests({ ...payload, buildId: 'rewritten-build' });
  assert.throws(() => inspect(root), /manifest_identity_missing_from_entry_bundle/);
});
test('does not accept identity literals in an unreferenced stale asset', t => {
  const { root, payload, write } = fixture(t);
  write('frontend/dist/assets/stale.js', 'console.log(' + JSON.stringify(payload) + ');');
  write('frontend/dist/assets/index-fixture.js', 'console.log("old-entry");');
  assert.throws(() => inspect(root), /manifest_identity_missing_from_entry_bundle/);
});
test('requires the embedded timestamp as well as version and identity', t => {
  const { root, payload, manifests } = fixture(t); manifests({ ...payload, builtAt: '2026-10-24T01:00:00.000Z' });
  assert.throws(() => inspect(root), /manifest_identity_missing_from_entry_bundle/);
});
test('rejects a development build identity', t => {
  const { root, payload, manifests } = fixture(t); manifests({ ...payload, buildId: 'dev' });
  assert.throws(() => inspect(root), /production_build_identity_required/);
});
test('rejects a version different from the canonical package', t => {
  const { root, payload, manifests } = fixture(t); manifests({ ...payload, version: '2.0.0' });
  assert.throws(() => inspect(root), /package_version_mismatch/);
});
test('rejects unexpected public fields and malformed timestamps', t => {
  const { root, payload, manifests } = fixture(t); manifests({ ...payload, unexpected: 'synthetic' });
  assert.throws(() => inspect(root), /invalid_version_fields/);
  manifests({ ...payload, builtAt: '2026-02-30T00:00:00.000Z' });
  assert.throws(() => inspect(root), /invalid_build_timestamp/);
});
test('refuses traversal and remote or missing module entries', t => {
  const { root, write } = fixture(t);
  for (const src of ['/assets/../elsewhere.js', 'https://example.invalid/entry.js']) {
    write('frontend/dist/index.html', '<script type="module" src="' + src + '"></script>');
    assert.throws(() => inspect(root), /invalid_module_entry/);
  }
  write('frontend/dist/index.html', '<script src="/clip-ingress.js"></script>');
  assert.throws(() => inspect(root), /module_entry_required/);
});
