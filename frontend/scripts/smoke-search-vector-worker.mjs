import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Synthetic data only. Serve the built worker in isolation from Firebase and app accounts.
const assets = new URL('../dist/assets/', import.meta.url);
const workerName = (await readdir(assets)).find((name) => /^incrementalSearchWorker-.*\.js$/.test(name));
assert.ok(workerName, 'Build the frontend before running the worker smoke test.');
const workerCode = await readFile(new URL(workerName, assets));
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/worker.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/worker.js' ? workerCode : '<!doctype html><title>Synthetic worker test</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) => {
      const embedding = Array(384).fill(0);
      embedding[index === 9_999 ? 0 : 1] = 1;
      return { id: String(index), embedding, embeddingModel: 'synthetic@1' };
    });
    const query = Array(384).fill(0);
    query[0] = 1;
    const worker = new Worker('/worker.js', { type: 'module' });
    const send = (request) => new Promise((resolve, reject) => {
      const started = performance.now();
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker timeout')); }, 30_000);
      worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('Worker failure')); };
      worker.onmessage = (event) => {
        clearTimeout(timer);
        resolve({ response: event.data, elapsedMs: Math.round(performance.now() - started) });
      };
      worker.postMessage(request);
    });
    try {
      const base = { query, embeddingModel: 'synthetic@1', floor: 0.38 };
      const initial = await send({ ...base, id: 1, changed: candidates, removed: [] });
      const reused = await send({ ...base, id: 2, changed: [], removed: [] });
      const removed = await send({ ...base, id: 3, changed: [], removed: ['9999'] });
      return { initial, reused, removed };
    } finally { worker.terminate(); }
  });
  assert.deepEqual(result.initial.response, { id: 1, ok: true, scores: [['9999', 1]] });
  assert.deepEqual(result.reused.response, { id: 2, ok: true, scores: [['9999', 1]] });
  assert.deepEqual(result.removed.response, { id: 3, ok: true, scores: [] });
  console.log(JSON.stringify({ browser: 'Chromium', candidates: 10_000, dimensions: 384,
    initialMs: result.initial.elapsedMs, reusedMs: result.reused.elapsedMs,
    removedMs: result.removed.elapsedMs, passed: true }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
