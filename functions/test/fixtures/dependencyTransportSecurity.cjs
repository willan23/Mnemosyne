'use strict';
// Synthetic malformed HTTP against isolated loopback servers. No Firebase/provider access.
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
async function bodyParserProbe() {
  const express = require('express'), app = express();
  app.use(express.json());
  app.post('/', (req, res) => res.json({ accepted: req.body?.synthetic === true }));
  const server = http.createServer(app), origin = await listen(server);
  const post = (bytes, encoding, tail) => new Promise((resolve, reject) => {
    const req = http.request(origin, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Encoding': encoding, 'Content-Length': bytes.length + (tail?.length || 0),
    } }, res => { const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString() })); res.on('error', reject); });
    req.on('error', reject);
    if (tail) { req.write(bytes); setTimeout(() => req.end(tail), 30); } else req.end(bytes);
  });
  try {
    for (const [encoding, compress] of [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]]) {
      const valid = compress(Buffer.from('{"synthetic":true}'));
      // Deliver the trailing bytes after the decoder may already have completed its body.
      // The regression is an uncaught error after the response, not a particular status.
      await post(valid, encoding, Buffer.from([0x07, 0x00, 0x00, 0x00])).catch(() => null);
      await wait(150);
      const healthy = await post(valid, encoding);
      assert.equal(healthy.status, 200); assert.equal(JSON.parse(healthy.body).accepted, true);
    }
    return { survivedMalformedBody: true, subsequentRequestPassed: true,
      encodings: ['gzip', 'deflate', 'br'], version: require('body-parser/package.json').version, loopbackOnly: true };
  } finally { await close(server); }
}
async function undiciProbe(mode) {
  const fetch = mode === 'provider-transport'
    ? url => require('../../lib/providerTransport').fetchProviderResponse(url, { method: 'GET' }, 2000, 1024)
    : mode === 'node-fetch' ? globalThis.fetch : require('undici').fetch;
  const server = http.createServer((req, res) => {
    if (req.url === '/malformed') {
      res.writeHead(200, { 'Content-Encoding': 'gzip, gzip, gzip, gzip, gzip, gzip', 'Content-Length': '100' });
      res.flushHeaders(); const socket = res.socket;
      setTimeout(() => socket.end(), 30); return;
    }
    res.setHeader('Content-Type', 'application/json'); res.end('{"healthy":true}');
  });
  const origin = await listen(server);
  try {
    let refused = false;
    try { const response = await fetch(origin + '/malformed'); await response.text(); } catch { refused = true; }
    assert(refused); await wait(150);
    const response = await fetch(origin + '/health'); assert.equal(response.status, 200);
    assert.equal((await response.json()).healthy, true);
    return { excessiveContentEncodingsRefused: true, survivedEarlyClose: true, subsequentRequestPassed: true,
      version: mode === 'node-fetch' ? process.versions.undici : require('undici/package.json').version,
      actualBoundedProviderTransport: mode === 'provider-transport', loopbackOnly: true };
  } finally { await close(server); }
}
const mode = process.argv[2];
assert(['body-parser', 'undici', 'provider-transport', 'node-fetch'].includes(mode));
(mode === 'body-parser' ? bodyParserProbe() : undiciProbe(mode)).then(result => {
  process.stdout.write(JSON.stringify({ mode, ...result }) + '\n');
}, error => { process.stderr.write(JSON.stringify({ mode, probeFailed: true, type: error?.name }) + '\n'); process.exitCode = 1; });
