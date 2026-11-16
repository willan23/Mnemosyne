'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const mode of ['body-parser', 'undici', 'provider-transport']) {
  test(`${mode} survives malformed compressed HTTP in a separate process and handles the next request`, () => {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/dependencyTransportSecurity.cjs'), mode], {
      encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 128000,
    });
    assert.equal(child.status, 0, `${mode} child did not survive the malformed HTTP fixture`);
    assert.equal(child.signal, null);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.mode, mode); assert.equal(result.subsequentRequestPassed, true); assert.equal(result.loopbackOnly, true);
    if (mode === 'body-parser') { assert.equal(result.survivedMalformedBody, true); assert.deepEqual(result.encodings, ['gzip', 'deflate', 'br']); }
    else { assert.equal(result.excessiveContentEncodingsRefused, true); assert.equal(result.survivedEarlyClose, true); }
    if (mode === 'provider-transport') {
      assert.equal(result.actualBoundedProviderTransport, true);
      assert.equal(require('../lib/providerTransport').providerHttp.fetch, require('undici').fetch);
    }
  });
}
