'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { javaMajor, checkJavaVersion } = require('./preflight-java');

test('lê versões JDK e recusa Java anterior ao 21', () => {
  assert.equal(javaMajor('openjdk version "21.0.5" 2026-01-01'), 21);
  assert.equal(javaMajor('java version "22"'), 22);
  assert.throws(() => checkJavaVersion(() => ({ status: 0, stderr: 'openjdk version "17.0.20"' })), /JDK 21/);
  assert.equal(checkJavaVersion(() => ({ status: 0, stderr: 'openjdk version "21.0.5"' })), 21);
});
