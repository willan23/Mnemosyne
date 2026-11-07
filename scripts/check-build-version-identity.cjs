'use strict';
const fs = require('node:fs'), path = require('node:path');

const fail = reason => { throw new Error(reason); };
function inspect(root) {
  root = path.resolve(root);
  function read(relative) {
    const target = path.resolve(root, relative), inside = path.relative(root, target);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) fail('invalid_build_path');
    let current = root;
    for (const part of inside.split(path.sep)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) fail('symlink_in_build_path');
    }
    if (!fs.statSync(target).isFile()) fail('build_file_required');
    return fs.readFileSync(target, 'utf8');
  }
  const canonical = JSON.parse(read('frontend/package.json')).version;
  const source = read('frontend/public/version.json'), published = read('frontend/dist/version.json');
  if (source !== published) fail('public_and_dist_version_differ');
  const version = JSON.parse(published);
  if (!version || typeof version !== 'object' || Array.isArray(version) ||
      Object.keys(version).sort().join(',') !== 'buildId,builtAt,channel,notes,version') fail('invalid_version_fields');
  if (typeof canonical !== 'string' || !canonical || canonical.length > 256 || version.version !== canonical) fail('package_version_mismatch');
  if (typeof version.buildId !== 'string' || version.buildId === 'dev' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version.buildId)) fail('production_build_identity_required');
  if (typeof version.builtAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(version.builtAt) ||
      !Number.isFinite(Date.parse(version.builtAt)) || new Date(version.builtAt).toISOString() !== version.builtAt) fail('invalid_build_timestamp');
  if (typeof version.channel !== 'string' || !version.channel || typeof version.notes !== 'string') fail('invalid_version_fields');
  const html = read('frontend/dist/index.html'), entries = [];
  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag[0])) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1];
    if (!src || !/^\/assets\/[A-Za-z0-9._/-]+\.js$/.test(src) || src.split('/').includes('..')) fail('invalid_module_entry');
    entries.push({ path: src, text: read('frontend/dist' + src) });
  }
  if (!entries.length) fail('module_entry_required');
  // Check the actual entry referenced by index.html, not a stale unreferenced asset.
  const literals = [version.version, version.buildId, version.builtAt].map(value => JSON.stringify(value));
  const matching = entries.filter(entry => literals.every(literal => entry.text.includes(literal)));
  if (!matching.length) fail('manifest_identity_missing_from_entry_bundle');
  return { v: 1, consistent: true, version: canonical, moduleEntries: entries.length,
    matchingEntries: matching.map(entry => entry.path), publicAndDistByteIdentical: true,
    contentSignatureVerified: false, productionMutations: 0 };
}

module.exports = { inspect };
if (require.main === module) {
  try {
    if (process.argv.length !== 2) fail('unexpected_arguments');
    console.log(JSON.stringify(inspect(path.resolve(__dirname, '..'))));
  } catch (error) {
    const reason = /^[a-z_]+$/.test(error.message) ? error.message : 'build_version_inspection_failed';
    console.error(JSON.stringify({ consistent: false, reason })); process.exitCode = 1;
  }
}
