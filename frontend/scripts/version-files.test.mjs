import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeVersionFile } from './versionFiles.ts';

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'mnemosyne-version-'));
  t.after(() => {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), parent);
    assert(path.basename(actual).startsWith('mnemosyne-version-'));
    assert(!fs.lstatSync(root).isSymbolicLink());
    fs.rmSync(actual, { recursive: true, force: true });
  });
  return { root, target: path.join(root, 'version.json') };
}

test('writes complete UTF-8 metadata into a new directory', t => {
  const { root } = fixture(t), target = path.join(root, 'nested', 'version.json'), json = '{"notes":"versão sintética"}\n';
  writeVersionFile(target, json);
  assert.equal(fs.readFileSync(target, 'utf8'), json);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['version.json']);
});

test('does not reopen unchanged metadata for writing when writes are unavailable', t => {
  const { target } = fixture(t), json = '{"buildId":"synthetic"}\n'; fs.writeFileSync(target, json);
  const writes = t.mock.method(fs, 'writeFileSync', () => { throw Object.assign(new Error('Synthetic locked writer'), { code: 'UNKNOWN' }); });
  writeVersionFile(target, json); assert.equal(writes.mock.calls.length, 0); assert.equal(fs.readFileSync(target, 'utf8'), json);
});

test('replaces an existing manifest without opening the destination for truncation', t => {
  const { root, target } = fixture(t); fs.writeFileSync(target, 'old');
  const original = fs.openSync;
  t.mock.method(fs, 'openSync', (file, flags, ...rest) => {
    if (file === target && String(flags).includes('w')) throw new Error('Destination opened for truncation');
    return original(file, flags, ...rest);
  });
  writeVersionFile(target, 'new'); assert.equal(fs.readFileSync(target, 'utf8'), 'new'); assert.deepEqual(fs.readdirSync(root), ['version.json']);
});

test('propagates a temporary-file write failure, preserves the old bytes and cleans its own temporary file', t => {
  const { root, target } = fixture(t); fs.writeFileSync(target, 'old');
  const failure = Object.assign(new Error('Synthetic write failure'), { code: 'EIO' });
  t.mock.method(fs, 'writeFileSync', () => { throw failure; });
  assert.throws(() => writeVersionFile(target, 'new'), error => error === failure);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old'); assert.deepEqual(fs.readdirSync(root), ['version.json']);
});

test('propagates a replacement failure, preserves the old bytes and cleans its own temporary file', t => {
  const { root, target } = fixture(t); fs.writeFileSync(target, 'old');
  const failure = Object.assign(new Error('Synthetic replacement failure'), { code: 'EBUSY' });
  t.mock.method(fs, 'renameSync', () => { throw failure; });
  assert.throws(() => writeVersionFile(target, 'new'), error => error === failure);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old'); assert.deepEqual(fs.readdirSync(root), ['version.json']);
});
