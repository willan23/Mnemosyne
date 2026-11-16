'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkNodeVersion } = require('../../scripts/preflight-node');

test('emulator runtime preflight accepts the declared Node 22 major across patch versions', () => {
  for (const version of ['22.0.0', '22.23.3', 'v22.23.3']) assert.equal(checkNodeVersion(version), 22);
});

test('emulator runtime preflight refuses other majors and unrecognized version output', () => {
  for (const version of ['18.20.0', '20.19.0', '24.11.1', '222.0.0', '22', '22.23', '22.23.3-preview', '', null, 22]) {
    assert.throws(() => checkNodeVersion(version), /exigem Node 22/);
  }
});
