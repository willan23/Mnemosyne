const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const script = path.resolve(__dirname, '../../scripts/count-launch-data.js');
test('aggregate inventory CLI refuses ambiguous or implicit projects before opening a client', () => {
  for (const args of [[], ['--project=bad'], ['--project=demo-mnemosyne-rules', '--apply'],
    ['--project=demo-mnemosyne-rules', '--project=other-project']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 2); assert.match(result.stderr, /Nenhum acesso foi feito/);
    assert.equal(result.stdout, '');
  }
});
test('aggregate inventory CLI help works without credentials or an implicit project', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0); assert.match(result.stdout, /--project=<id>/); assert.equal(result.stderr, '');
});
