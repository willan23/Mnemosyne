import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// No application, credentials or vault data. Downloads public model files in a fresh browser.
const assets = new URL('../dist/assets/', import.meta.url);
const names = await readdir(assets);
const workerName = names.find(name => /^embeddingWorker-.*\.js$/.test(name));
assert.ok(workerName, 'Build the frontend first.');
const allowedAssets = new Set(names);
const server = createServer(async (request, response) => {
  try {
    const name = request.url?.startsWith('/assets/') ? request.url.slice(8) : '';
    if (allowedAssets.has(name)) {
      response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      response.end(await readFile(new URL(name, assets)));
    } else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Synthetic embedding worker test</title>');
    } else { response.writeHead(404); response.end(); }
  } catch { response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const externalMethods = [];
  const failedRequests = [];
  page.on('request', request => {
    if (request.url().startsWith('https://')) externalMethods.push(request.method());
  });
  page.on('requestfailed', request => failedRequests.push({
    host: new URL(request.url()).hostname, failure: request.failure()?.errorText,
  }));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async workerName => {
    const worker = new Worker(`/assets/${workerName}`, { type: 'module' });
    let nextId = 0;
    const send = command => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => reject(new Error('Model worker timeout')), 180_000);
      worker.onerror = () => { clearTimeout(timer); reject(new Error('Model worker error')); };
      worker.onmessage = event => {
        if (event.data.id !== id) return;
        clearTimeout(timer);
        if (!event.data.ok) reject(new Error(event.data.error));
        else resolve(event.data);
      };
      worker.postMessage({ ...command, id, profile: 'multilingualCandidate' });
    });
    try {
      const started = performance.now();
      await send({ type: 'initialize' });
      const loadMs = Math.round(performance.now() - started);
      const vectors = [];
      const inferenceStart = performance.now();
      for (const text of ['O comboio parte às oito da manhã.', 'The train leaves at eight in the morning.', 'Tomato seeds need moisture.']) {
        const response = await send({ type: 'embed', text });
        vectors.push(response.embedding);
      }
      const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
      return { loadMs, inferenceMs: Math.round(performance.now() - inferenceStart),
        dimensions: vectors.map(vector => vector.length), finite: vectors.every(vector => vector.every(Number.isFinite)),
        norms: vectors.map(vector => Math.sqrt(dot(vector, vector))),
        related: dot(vectors[0], vectors[1]), unrelated: dot(vectors[0], vectors[2]) };
    } finally { worker.terminate(); }
  }, workerName).catch(error => {
    console.error(JSON.stringify({ failedRequests }));
    throw error;
  });
  assert.deepEqual(result.dimensions, [384, 384, 384]);
  assert.equal(result.finite, true);
  assert.ok(result.norms.every(norm => Math.abs(norm - 1) < 0.001));
  assert.ok(result.related > result.unrelated);
  assert.ok(externalMethods.every(method => method === 'GET'));
  console.log(JSON.stringify({ browser: 'Chromium', profile: 'multilingualCandidate', ...result,
    externalRequests: externalMethods.length, passed: true }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
