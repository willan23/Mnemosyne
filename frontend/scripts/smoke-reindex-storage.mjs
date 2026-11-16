import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { chromium } from '@playwright/test';

// Exercise the actual adapter in Chromium, transpiling only its TypeScript types.
const source = await readFile(new URL('../src/services/embeddingReindexStore.ts', import.meta.url), 'utf8');
const moduleCode = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/store.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/store.js' ? moduleCode : '<!doctype html><title>Reindex storage test</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.evaluate(async () => {
    const { embeddingReindexStore: store } = await import('/store.js');
    const envelope = { v: 1, iv: 'synthetic-iv', ct: 'synthetic-ciphertext' };
    await Promise.all([
      store.put(['alice', 'candidate', 'a'], envelope),
      store.put(['alice', 'candidate', 'b'], envelope),
      store.put(['alice', 'other', 'a'], envelope),
      store.put(['bob', 'candidate', 'a'], envelope),
    ]);
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const { embeddingReindexStore: store, clearEmbeddingReindexCheckpoints: clear } = await import('/store.js');
    const resumed = await store.get(['alice', 'candidate', 'a']);
    await clear('alice', 'candidate');
    const removed = await Promise.all(['a', 'b'].map(id => store.get(['alice', 'candidate', id])));
    const otherProfile = await store.get(['alice', 'other', 'a']);
    await clear('alice');
    const removedAccount = await store.get(['alice', 'other', 'a']);
    const otherUser = await store.get(['bob', 'candidate', 'a']);
    await store.remove(['bob', 'candidate', 'a']);
    const removedSingle = await store.get(['bob', 'candidate', 'a']);
    return { resumed, removed, otherProfile, removedAccount, otherUser, removedSingle };
  });
  assert.equal(result.resumed.ct, 'synthetic-ciphertext');
  assert.ok(result.removed.every(item => item === undefined));
  assert.equal(result.otherProfile.ct, 'synthetic-ciphertext');
  assert.equal(result.removedAccount, undefined);
  assert.equal(result.otherUser.ct, 'synthetic-ciphertext');
  assert.equal(result.removedSingle, undefined);
  console.log(JSON.stringify({ browser: 'Chromium', persistedAfterReload: true,
    profileCleanup: true, accountIsolation: true, passed: true }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
