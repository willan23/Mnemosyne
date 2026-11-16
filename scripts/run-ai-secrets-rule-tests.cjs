'use strict';
const path = require('node:path'); const {spawnSync} = require('node:child_process');
if (process.versions.node.split('.')[0] !== '22' || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    process.env.GCLOUD_PROJECT !== 'demo-mnemosyne-rules') {
  process.stderr.write('Run this check in Node 22 with the demo-mnemosyne-rules Firestore/Storage emulators.\n'); process.exit(2);
}
const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=secret-bindings|ai-monitoring|ai-cost HTTP|HTTP account guards|account deletion leases',
  'functions/test/rules.test.js'], {cwd: path.resolve(__dirname, '..'), stdio: 'inherit'});
process.exitCode = result.status ?? 1;
