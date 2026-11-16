const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('Functions entrypoint loads in a fresh process and when Admin was initialized by an imported module', () => {
  for (const initializeFirst of [false, true]) {
    const child = spawnSync(process.execPath, ['-e', `${initializeFirst ? "require('firebase-admin').initializeApp();" : ''}
      const entry = require('./lib/index');
      if (typeof entry.deleteUserAccount !== 'function' || typeof entry.purgeUnreferencedAttachment !== 'function' || typeof entry.publishCommsIdentityKey !== 'function') process.exit(2);
      if (require('firebase-admin').apps.length !== 1) process.exit(3);`], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000,
      env: { ...process.env, GCLOUD_PROJECT: 'demo-mnemosyne-test', FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-mnemosyne-test' }) },
    });
    assert.equal(child.status, 0, child.stderr);
  }
});
