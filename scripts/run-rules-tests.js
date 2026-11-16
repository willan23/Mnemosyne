'use strict';

/**
 * Runs Firestore + Storage rules tests against the Firebase emulators.
 *
 * Requires Node 22 and JDK 21+. Firebase CLI is pinned for local/CI parity.
 * First run downloads the pinned CLI and emulator binaries.
 *
 *   node scripts/run-rules-tests.js
 *   npm run test:firestore-rules
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkJavaVersion } = require('./preflight-java');
const { checkNodeVersion } = require('./preflight-node');

try {
  checkNodeVersion();
  checkJavaVersion();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const result = spawnSync(
  'npx --yes firebase-tools@15.34.0 emulators:exec --only firestore,storage --project demo-mnemosyne-rules "npm --prefix functions run build && npm --prefix functions run test:rules && npm --prefix frontend run test:rules"',
  {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      FIREBASE_EMULATORS_SKIP_UPDATE_CHECK: '1',
    },
  },
);

process.exit(result.status === null ? 1 : result.status);
