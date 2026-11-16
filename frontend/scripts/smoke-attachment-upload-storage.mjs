import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { chromium } from '@playwright/test';
const source = await readFile(new URL('../src/services/attachmentUploadJournalStore.ts', import.meta.url), 'utf8');
const moduleCode = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/store.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/store.js' ? moduleCode : '<!doctype html><title>Synthetic encrypted upload storage test</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
try {
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const { attachmentUploadJournalStore: store } = await import('/store.js');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: crypto.getRandomValues(new Uint8Array(12)) }, key, new TextEncoder().encode('Synthetic file only'));
    const envelope = { v: 1, iv: 'synthetic-iv', ct: 'synthetic-checkpoint-cipher' };
    await Promise.all([store.put('alice', 'first', { envelope, bytes }), store.put('alice', 'second', { envelope, bytes }), store.put('bob', 'first', { envelope, bytes })]);
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const { attachmentUploadJournalStore: store } = await import('/store.js');
    const restored = await store.get('alice', 'first'); const before = await store.ids('alice', 1); const next = await store.ids('alice', 1, before[0]);
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { const request = originalPut.apply(this, args); request.addEventListener('success', () => this.transaction.abort()); return request; };
    let rejected = false; try { await store.put('alice', 'first', { envelope: { ...restored.envelope, ct: 'must-not-commit' }, bytes: null }); } catch { rejected = true; }
    IDBObjectStore.prototype.put = originalPut;
    const afterAbort = await store.get('alice', 'first');
    await store.put('alice', 'first', { envelope: restored.envelope, bytes: null });
    return { byteLength: restored.bytes.byteLength, listBounded: before.length === 1 && next.length === 1 && next[0] !== before[0], rejected,
      oldSurvivedAbort: afterAbort.envelope.ct === restored.envelope.ct && afterAbort.bytes.byteLength === restored.bytes.byteLength };
  });
  await page.reload();
  const cleanup = await page.evaluate(async () => {
    const { attachmentUploadJournalStore: store } = await import('/store.js'); const ready = await store.get('alice', 'first');
    await store.remove('alice', 'first'); return { readyOnly: ready.bytes === null && Boolean(ready.envelope.ct),
      removed: await store.get('alice', 'first') === undefined, otherFile: Boolean(await store.get('alice', 'second')), otherAccount: Boolean(await store.get('bob', 'first')) };
  });
  assert.ok(result.byteLength > 16); assert.ok(result.listBounded && result.rejected && result.oldSurvivedAbort);
  assert.ok(cleanup.readyOnly && cleanup.removed && cleanup.otherFile && cleanup.otherAccount);
  const rangeCleanup = await page.evaluate(async () => {
    const { clearAttachmentUploadCheckpoints, attachmentUploadJournalStore: store } = await import('/store.js');
    await clearAttachmentUploadCheckpoints('alice');
    return (await store.ids('alice', 50)).length === 0 && Boolean(await store.get('bob', 'first'));
  });
  assert.ok(rangeCleanup);
  console.log(JSON.stringify({ browser: 'Chromium', persistedAfterReload: true, atomicAbort: true, readyReleasesLocalBytes: true, accountIsolation: true, accountRangeCleanup: true, passed: true }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
