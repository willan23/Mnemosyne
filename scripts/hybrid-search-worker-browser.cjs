'use strict';
// Actual production Worker, actual client, synthetic data, local HTTP only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const { build } = require(path.join(root, 'frontend/node_modules/esbuild'));
const { chromium } = require(path.join(root, 'frontend/node_modules/playwright'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  const assets = path.join(root, 'frontend/dist/assets');
  const names = fs.readdirSync(assets).filter(name => /^hybridSearchWorker-[\w-]+\.js$/.test(name));
  assert.equal(names.length, 1, 'Build the frontend before running the Worker probe');
  const workerBytes = fs.readFileSync(path.join(assets, names[0]));
  assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage|importScripts)\s*[.(]/.test(workerBytes.toString('utf8')));
  const bundle = await build({ stdin: { contents: "export {HybridSearchClient} from './hybridSearchClient'; export {HybridSearchCorpus,HYBRID_CORPUS_JOURNAL_LIMITS} from './hybridSearchCorpus';",
    resolveDir: path.join(root, 'frontend/src/services'), loader: 'ts' }, bundle: true,
    platform: 'browser', format: 'esm', target: 'es2022', write: false, logLevel: 'silent' });
  const clientBytes = bundle.outputFiles[0].contents;
  const server = http.createServer((req, res) => {
    if (!['/', '/client.js', '/hybridSearchWorker.ts', '/idle-worker.js'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'text/javascript');
    res.end(req.url === '/' ? '<!doctype html><title>Local synthetic Worker validation</title>' :
      req.url === '/client.js' ? clientBytes : req.url === '/idle-worker.js' ? 'self.onmessage=()=>{};' : workerBytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const forbiddenRequests = [];
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      forbiddenRequests.push(new URL(route.request().url()).origin); return route.abort();
    });
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const { HybridSearchClient, HybridSearchCorpus, HYBRID_CORPUS_JOURNAL_LIMITS } = await import('/client.js');
      const check = (condition, code) => { if (!condition) throw Error(code); };
      const NativeWorker = window.Worker;
      const messages = [];
      let created = 0, terminated = 0, idleNext = false;
      class MeasuredWorker extends NativeWorker {
        constructor(url, options) { super(idleNext ? '/idle-worker.js' : url, options); created++; idleNext = false; }
        postMessage(value) {
          if (value.type === 'prepare') {
            const serialized = JSON.stringify(value);
            messages.push({ type: value.type, changed: value.changed.length, removed: value.removed.length,
              order: value.order?.length ?? null,
              forbiddenSentinel: /LOCKED-SENTINEL|DELETED-SENTINEL|OWNER-SENTINEL|CIPHER-SENTINEL/.test(serialized),
              privateFields: value.changed.some(row => ['uid', 'teamId', 'enc', 'embedding', 'semanticScore', 'attachments'].some(key => key in row)) });
          }
          return super.postMessage(value);
        }
        terminate() { terminated++; super.terminate(); }
      }
      window.Worker = MeasuredWorker;
      const client = new HybridSearchClient(), signal = () => new AbortController().signal;
      const stamp = Date.parse('2026-10-10T00:00:00Z');
      const corpus = Array.from({ length: 10_000 }, (_, i) => ({ id: 'synthetic-' + i, uid: 'OWNER-SENTINEL',
        title: 'Synthetic archive ' + i, text: (i % 2 ? 'Synthetic orchard with fruit research. ' : 'Synthetic lunar mission with orbital research. ').repeat(6),
        tags: [i % 7 ? 'home' : 'work'], category: i % 3 ? 'task' : 'note', timestamp: stamp + i,
        nodes: [{ id: 'entity', type: 'city', label: i % 5 ? 'Lisboa' : 'Porto' }], enc: { ct: 'CIPHER-SENTINEL' } }));
      corpus.push({ id: 'locked', text: 'LOCKED-SENTINEL', encLocked: true }, { id: 'deleted', text: 'DELETED-SENTINEL', deletedAt: 1 });
      const filters = { dateRange: 'all', tags: [] };
      const times = {};
      let ticks = 0, last = performance.now(), maxHeartbeatGapMs = 0;
      const heartbeat = setInterval(() => { const now = performance.now(); maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - last); last = now; ticks++; }, 10);
      const timed = async (name, operation) => { const start = performance.now(); const value = await operation(); times[name] = Math.round((performance.now() - start) * 100) / 100; return value; };
      try {
        const initial = await timed('initialIndex', () => client.prepare({ memories: corpus, query: 'lunar', filters }, signal()));
        check(initial.stats.normalized === 10_000 && initial.candidateIds.length === 10_000 && initial.hits.length === 500, 'initial');
        const reused = await timed('reusedQuery', () => client.prepare({ memories: corpus, query: 'galactic', filters }, signal()));
        check(reused.stats.normalized === 0 && reused.hits.length === 0, 'reuse');
        const semantic = await timed('fusedRanking', () => client.rank(reused, new Map([['synthetic-9499', .91]]), signal()));
        check(semantic.length === 1 && semantic[0].id === 'synthetic-9499' && semantic[0].matchKind === 'semantic', 'semantic');
        let staleRejected = false;
        try { await client.rank(initial, new Map(), signal()); } catch { staleRejected = true; }
        check(staleRejected, 'lease');
        const updatedCorpus = corpus.map(row => row.id === 'synthetic-0' ? { ...row, text: 'Unique synthetic quasar update.' } : row);
        const updated = await timed('oneDocumentUpdate', () => client.prepare({ memories: updatedCorpus, query: 'quasar', filters }, signal()));
        check(updated.stats.normalized === 1 && updated.hits[0]?.id === 'synthetic-0', 'update');
        const removedCorpus = updatedCorpus.filter(row => row.id !== 'synthetic-0');
        const removed = await timed('oneDocumentRemoval', () => client.prepare({ memories: removedCorpus, query: 'quasar', filters }, signal()));
        check(removed.stats.removed === 1 && removed.stats.normalized === 0 && removed.hits.length === 0, 'remove');
        const scoped = await timed('structuredQuery', () => client.prepare({ memories: removedCorpus,
          query: 'entity:"Porto" after:2026-10-01 before:2026-11-01 galactic', filters: { ...filters, tags: ['work'], category: 'note' } }, signal()));
        const expected = removedCorpus.filter(row => !row.encLocked && !row.deletedAt && row.tags?.includes('work') && row.category === 'note' && row.nodes?.[0]?.label === 'Porto').map(row => row.id);
        check(JSON.stringify(scoped.candidateIds) === JSON.stringify(expected) && scoped.stats.normalized === 0, 'structured');
        check(messages.every(row => !row.forbiddenSentinel && !row.privateFields), 'private_projection');
        check(messages[0].changed === 10_000 && messages[1].changed === 0 && messages[1].order === null && messages[2].changed === 1 && messages[3].removed === 1, 'delta_transport');
        client.dispose();
        // A real unresponsive Worker makes cancellation deterministic without racing a fast CPU.
        idleNext = true;
        const controller = new AbortController(), pending = client.prepare({ memories: corpus, query: 'lunar', filters }, controller.signal);
        const rejected = pending.then(() => false, () => true); controller.abort();
        check(await rejected, 'abort');
        const rebuilt = await timed('afterAbortRebuild', () => client.prepare({ memories: corpus, query: 'lunar', filters }, signal()));
        check(rebuilt.stats.normalized === 10_000 && rebuilt.hits.length === 500, 'rebuild');
        client.dispose();
        check(created === 3 && terminated === 3 && ticks > 0, 'lifecycle');
        const feed = new HybridSearchCorpus(), deltaClient = new HybridSearchClient();
        let propertyReads = 0;
        const observed = corpus.map(row => new Proxy(row, { get(target, key, receiver) { propertyReads++; return Reflect.get(target, key, receiver); } }));
        feed.update(observed, []);
        const deltaInitial = await timed('deltaInitialIndex', () => deltaClient.prepare({ corpus: feed.capture(), query: 'lunar', filters }, signal()));
        check(deltaInitial.stats.normalized === 10_000 && deltaInitial.candidateIds[0] === 'synthetic-9999', 'delta_initial');
        propertyReads = 0;
        const deltaReused = await timed('deltaReusedQuery', () => deltaClient.prepare({ corpus: feed.capture(), query: 'galactic', filters }, signal()));
        check(deltaReused.stats.normalized === 0 && propertyReads === 0, 'delta_query_no_source_scan');
        const edit = { ...corpus[0], text: 'Unique synthetic quasar update.', timestamp: stamp + 20_000 };
        feed.update([edit], []);
        const deltaUpdated = await timed('deltaOneDocumentUpdate', () => deltaClient.prepare({ corpus: feed.capture(), query: 'quasar', filters }, signal()));
        check(deltaUpdated.stats.changed === 1 && deltaUpdated.hits[0]?.id === 'synthetic-0' && deltaUpdated.candidateIds[0] === 'synthetic-0' && propertyReads === 0, 'delta_update_no_source_scan');
        feed.update([], ['synthetic-1']);
        const deltaRemoved = await timed('deltaOneDocumentRemoval', () => deltaClient.prepare({ corpus: feed.capture(), query: 'quasar', filters }, signal()));
        check(deltaRemoved.stats.removed === 1 && deltaRemoved.stats.changed === 0 && !deltaRemoved.candidateIds.includes('synthetic-1') && propertyReads === 0, 'delta_remove_no_source_scan');
        feed.update([], ['synthetic-2']);
        for (let n = 0; n < HYBRID_CORPUS_JOURNAL_LIMITS.batches; n++) feed.update([{ ...edit, text: edit.text + n }], []);
        const deltaRebuilt = await timed('deltaJournalEvictionRebuild', () => deltaClient.prepare({ corpus: feed.capture(), query: 'quasar', filters }, signal()));
        check(deltaRebuilt.stats.changed === 9_998 && !deltaRebuilt.candidateIds.includes('synthetic-1') && !deltaRebuilt.candidateIds.includes('synthetic-2'), 'delta_journal_rebuild');
        feed.clear(); let revokedLeaseRefused = false, retiredWriteRefused = false;
        try { await deltaClient.rank(deltaRebuilt, new Map(), signal()); } catch { revokedLeaseRefused = true; }
        try { feed.update([edit], []); } catch { retiredWriteRefused = true; }
        check(revokedLeaseRefused && retiredWriteRefused, 'delta_scope_clear'); deltaClient.dispose();
        check(created === 5 && terminated === 5 && messages.every(row => !row.forbiddenSentinel && !row.privateFields), 'delta_lifecycle_and_projection');
        return { records: 10_000, initialNormalized: initial.stats.normalized, reusedNormalized: reused.stats.normalized,
          updateNormalized: updated.stats.normalized, removalNormalized: removed.stats.normalized, structuredCandidates: scoped.candidateIds.length,
          semanticFusionVerified: true, staleLeaseRejected: true, lockedAndDeletedExcluded: true, privateProjectionVerified: true,
          abortRebuildVerified: true, workersCreated: created, workersTerminated: terminated,
          deltaCorpus: { initialChanged: deltaInitial.stats.changed, reusedChanged: deltaReused.stats.changed,
            unitUpdateChanged: deltaUpdated.stats.changed, unitRemovalChanged: deltaRemoved.stats.changed,
            unitRemovalRemoved: deltaRemoved.stats.removed, unchangedSourcePropertyReadsForQueryUpdateAndRemoval: 0,
            timestampOrderUpdatedInWorker: true, journalEvictionRebuildDocuments: deltaRebuilt.stats.changed,
            journalEvictionRebuildVerified: true, clearedScopeLeaseRefused: revokedLeaseRefused, retiredScopeWriteRefused: retiredWriteRefused },
          heartbeatTicks: ticks, maxHeartbeatGapMs: Math.round(maxHeartbeatGapMs * 100) / 100, roundTripMs: times };
      } finally { clearInterval(heartbeat); client.dispose(); window.Worker = NativeWorker; }
    });
    assert.equal(forbiddenRequests.length, 0);
    console.log(JSON.stringify({ v: 1, result, compiledWorker: { file: names[0], bytes: workerBytes.length, sha256: hash(workerBytes) },
      sources: ['hybridSearchClient.ts', 'hybridSearchCorpus.ts', 'hybridSearchIndex.ts', 'hybridSearchProtocol.ts', 'hybridSearchWorker.ts', 'structuredMemorySearch.ts'].map(name => {
        const file = path.join(root, 'frontend/src/services', name); return { path: file, sha256: hash(fs.readFileSync(file)) };
      }), externalRequests: 0, persistenceCalls: 0, realModelInference: false, applicationAuthOrDevicePilot: false,
      deadlineMs: 30_000, machineSpecificTimingIsNotAnSLO: true }, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
