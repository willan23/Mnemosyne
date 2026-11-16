'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPublicAddress, validateExternalUrl, safeFetchExternalUrl } = require('../lib/safeExternalFetch');

test('SSRF guard rejects private network and unsafe schemes', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '2001:0db8::1', '2001:0000::1', '2002::1', '3fff::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  for (const url of ['http://example.com/', 'https://localhost/', 'https://metadata.google.internal/', 'https://example.com:8443/', 'https://user:pass@example.com/']) {
    assert.throws(() => validateExternalUrl(url), /não permitida/);
  }
});

test('redirects are validated again and DNS rebinding cannot reach private IP', async () => {
  let calls = 0;
  const resolver = async () => [{ address: ++calls === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }];
  const requestPage = async () => ({ status: 302, location: 'https://example.com/next', url: 'https://example.com/', contentType: '', body: '' });
  await assert.rejects(safeFetchExternalUrl('https://example.com/', { resolver, requestPage }), /Destino de rede/);
  assert.equal(calls, 2);
});
