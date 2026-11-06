import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Real panel, crypto, IndexedDB, model Workers and ranking. Firebase is replaced by
// an inert export; this synthetic page never loads the app or an authenticated vault.
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { EmbeddingReindexPanel } from '/src/components/EmbeddingReindexPanel.tsx';
import { setMemoryCryptoMnemonic } from '/src/services/memoryCrypto.ts';
import { legacyEmbeddingService } from '/src/services/embeddingService.ts';
import { readEmbeddingSelection } from '/src/services/embeddingSelection.ts';
import { searchSelectedEmbeddingProfile } from '/src/services/selectedEmbeddingSearch.ts';
import { IncrementalSearchClient } from '/src/services/incrementalSearchClient.ts';
import { embeddingProfileSpace } from '/src/services/embeddingProfile.ts';
import { embeddingReindexStore } from '/src/services/embeddingReindexStore.ts';
import { useUniverseStore } from '/src/store/universeStore.ts';
useUniverseStore.getState().setLanguage('en');
setMemoryCryptoMnemonic(['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident']);
const memories = [
  { id: 'train', text: 'O comboio parte às oito da manhã.' },
  { id: 'plants', text: 'Tomato seeds need moisture.' },
].map(memory => ({ ...memory, uid: 'synthetic', timestamp: 1, updatedAt: 1 }));
for (const memory of memories) memory.embedding = await legacyEmbeddingService.getEmbedding(memory.text);
const original = JSON.stringify(memories);
const index = new IncrementalSearchClient();
window.synthetic = {
  selection: () => readEmbeddingSelection('synthetic'),
  originalsUnchanged: () => original === JSON.stringify(memories),
  checkpoint: () => embeddingReindexStore.get(['synthetic', embeddingProfileSpace('multilingualCandidate'), 'train']),
  search: async () => {
    const text = 'When does the train leave?';
    const signal = new AbortController().signal;
    const selected = readEmbeddingSelection('synthetic');
    const scores = await searchSelectedEmbeddingProfile('synthetic', selected, memories, text, signal,
      (request, signal) => index.rank(request, signal));
    return [...scores].sort((a,b) => b[1] - a[1]);
  },
};
createRoot(document.getElementById('root')).render(React.createElement(EmbeddingReindexPanel, { uid: 'synthetic', sessions: memories }));
`;
const server = await createServer({
  configFile: false, envFile: false, root: fileURLToPath(new URL('../', import.meta.url)),
  esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'synthetic-reindex-harness', enforce: 'pre',
    resolveId(source) {
      if (source === '../firebase' || source === '/src/firebase.ts' || source.replaceAll('\\', '/').endsWith('/src/firebase.ts')) return '\0synthetic-firebase';
      if (source === '/harness.js') return '\0synthetic-harness';
    },
    load(id) {
      if (id === '\0synthetic-firebase') return 'export const db = {};';
      if (id === '\0synthetic-harness') return harness;
    },
    transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/firebase.ts')) throw new Error('Real Firebase module prohibited in synthetic test');
    },
    configureServer(server) { server.middlewares.use((request, response, next) => {
      if (request.url === '/lifecycle') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><div id="root"></div><script type="module" src="/harness.js"></script>');
      } else next();
    }); },
  }], optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const blocked = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const modelHost = url.hostname === 'huggingface.co' || url.hostname.endsWith('.huggingface.co') ||
      url.hostname.endsWith('.hf.co') || url.hostname === 'cdn.jsdelivr.net';
    if (url.hostname === '127.0.0.1' || (modelHost && request.method() === 'GET')) await route.continue();
    else { blocked.push(url.hostname); await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => console.error(error.message));
  page.setDefaultTimeout(180_000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/lifecycle`);
  await page.getByRole('button', { name: 'Prepare / resume', exact: true }).waitFor();
  const baseline = await page.evaluate(() => window.synthetic.search());
  await page.getByRole('button', { name: 'Prepare / resume', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Preparation finished.' }).waitFor();
  const envelope = await page.evaluate(() => window.synthetic.checkpoint());
  assert.equal(typeof envelope.ct, 'string');
  assert.ok(!JSON.stringify(envelope).includes('comboio'));
  await page.getByRole('button', { name: 'Activate on this device', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Multilingual search activated' }).waitFor();
  const selected = await page.evaluate(() => window.synthetic.search());
  assert.equal(selected[0]?.[0], 'train');
  await page.getByRole('button', { name: 'Use stored vectors', exact: true }).click();
  assert.equal(await page.evaluate(() => window.synthetic.selection()), null);
  assert.deepEqual(await page.evaluate(() => window.synthetic.search()), baseline);
  assert.equal(await page.evaluate(() => window.synthetic.originalsUnchanged()), true);
  await page.getByRole('button', { name: 'Discard local preparation', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Local preparation discarded.' }).waitFor();
  assert.equal(await page.evaluate(() => window.synthetic.checkpoint()), undefined);
  assert.deepEqual(blocked, []);
  console.log(JSON.stringify({ browser: 'Chromium', memories: 2, preparation: true, activation: true,
    selectedTopHit: selected[0][0], rollbackMatchesBaseline: true, discarded: true, passed: true }));
} finally { await browser?.close(); await server.close(); }
