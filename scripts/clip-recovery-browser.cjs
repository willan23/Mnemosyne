'use strict';
/** Real browser crypto/localStorage/Web Locks; synthetic local RPC only. No Firebase Auth or production calls. */
const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict'); const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..'); const frontend = path.join(root, 'frontend');
const {parseClippedMemoryInput, clippedMemoryRequestBytes} = require('../functions/lib/clippedMemoryContract');
let phase = 'runtime';
async function main() {
  if (process.versions.node.split('.')[0] !== '22') throw Error('node22_required');
  const {build} = require(path.join(frontend, 'node_modules/esbuild')); const {chromium} = require(path.join(frontend, 'node_modules/@playwright/test'));
  const source = `import * as clip from './src/services/clipCaptureService';
    import * as vault from './src/services/memoryCrypto';
    const words = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
    vault.setMemoryCryptoMnemonic(words);
    window.clipTest = {clip, vault, reset: () => vault.setMemoryCryptoMnemonic(words),
      fixture: uid => ({createEnabled: () => true, storage: localStorage, id: () => crypto.randomUUID(), exclusive: clip.withClipCaptureLock,
        prepare: vault.buildEncryptedMemoryFields, encryptJournal: vault.encryptMemoryFields, decryptJournal: vault.decryptMemoryEnvelope,
        mutation: {uid: () => uid, ready: vault.isMemoryCryptoReady, subscribe: vault.onMemoryCryptoChanged},
        call: async (mode, request) => {const response = await fetch('/rpc/' + uid + '/' + mode, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(request)}); if (!response.ok) throw Error('Synthetic RPC refusal'); return response.json();}})};`;
  phase = 'bundle';
  const bundled = await build({stdin: {contents: source, resolveDir: frontend, loader: 'ts'}, bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent',
    plugins: [{name: 'synthetic-firebase-app', setup(builder) {
      builder.onResolve({filter: /firebase$/}, args => path.resolve(args.resolveDir, args.path) === path.join(frontend, 'src/firebase') ? {path: 'stub', namespace: 'stub'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export const db = {}; export const auth = {currentUser: null}; export default {};', loader: 'js'}));
    }}]});
  const receipts = new Map(); const counts = {status: 0, create: 0, cancel: 0}; let loseAck = true; let externalRequests = 0; let browser;
  const server = http.createServer(async (request, response) => {
    if (request.url === '/bundle.js') {response.writeHead(200, {'Content-Type': 'application/javascript'}); response.end(bundled.outputFiles[0].text); return;}
    if (request.url === '/') {response.writeHead(200, {'Content-Type': 'text/html'}); response.end('<!doctype html><title>Synthetic clip recovery test</title><script src="/bundle.js"></script>'); return;}
    const match = /^\/rpc\/(alice|bob)\/(status|create|cancel)$/.exec(request.url || '');
    if (!match || request.method !== 'POST') {response.writeHead(404); response.end(); return;}
    try {
      let raw = ''; for await (const bytes of request) {raw += bytes; if (raw.length > 20000) throw Error();}
      const input = parseClippedMemoryInput(JSON.parse(raw)); const digest = createHash('sha256').update(clippedMemoryRequestBytes(input)).digest('hex');
      const key = `${match[1]}:${input.sessionId}`; const mode = match[2]; counts[mode]++;
      let outcome = receipts.get(key);
      if (outcome && outcome.digest !== digest) throw Error();
      if (!outcome) {
        outcome = {sessionId: input.sessionId, digest, status: mode === 'status' ? 'unknown' : mode === 'cancel' ? 'cancelled' : 'committed', createdAt: mode === 'status' ? null : 1000};
        if (mode !== 'status') receipts.set(key, outcome);
      }
      // Complete an unusable business reply after commit; TCP reset may be transparently retried by Chromium.
      if (mode === 'create' && loseAck) {loseAck = false; response.writeHead(200, {'Content-Type': 'application/json'}); response.end('{'); return;}
      response.writeHead(200, {'Content-Type': 'application/json'}); response.end(JSON.stringify(outcome));
    } catch {response.writeHead(400); response.end('{}');}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    phase = 'browser-launch'; browser = await chromium.launch({headless: true}); const context = await browser.newContext();
    await context.route('**/*', route => {if (route.request().url().startsWith(origin + '/')) return route.continue(); externalRequests++; return route.abort();});
    phase = 'page-init'; const first = await context.newPage(); await first.goto(origin); await first.waitForFunction(() => Boolean(window.clipTest));
    phase = 'lost-ack-journal';
    const staged = await first.evaluate(async () => {
      const api = window.clipTest; let failed = false; let prepared = false; let errorType = '';
      try {await api.clip.persistClippedMemory('alice', {title: 'Synthetic title', text: 'Synthetic captured content', url: 'https://example.test/'}, () => {prepared = true;}, api.fixture('alice'));} catch (error) {failed = true; errorType = error.name;}
      const raw = localStorage.getItem(api.clip.clipCaptureCheckpointKey('alice'));
      return {errorType, failed, prepared, persisted: Boolean(raw), encrypted: raw ? api.vault.isEncryptedMemoryEnvelope(JSON.parse(raw)) : false,
        plaintextAbsent: raw ? !raw.includes('Synthetic captured content') && !raw.includes('Synthetic title') : false};
    });
    if (!['failed','prepared','persisted','encrypted','plaintextAbsent'].every(key => staged[key] === true)) process.stderr.write(JSON.stringify({phase, flags: staged, rpcCounts: counts}) + '\n');
    assert.equal(['failed','prepared','persisted','encrypted','plaintextAbsent'].every(key => staged[key] === true), true);
    const second = await context.newPage(); await second.goto(origin); await second.waitForFunction(() => Boolean(window.clipTest));
    phase = 'invalid-checkpoint'; const beforeInvalid = {...counts};
    const invalid = await second.evaluate(async () => {
      const api = window.clipTest; const raw = localStorage.getItem(api.clip.clipCaptureCheckpointKey('alice')); localStorage.setItem(api.clip.clipCaptureCheckpointKey('bob'), raw);
      let ownerRefused = false; try {await api.clip.recoverPendingClipCapture('bob', api.fixture('bob'));} catch {ownerRefused = true;}
      localStorage.removeItem(api.clip.clipCaptureCheckpointKey('bob'));
      api.vault.setMemoryCryptoMnemonic(['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','zoo']);
      let keyRefused = false; try {await api.clip.recoverPendingClipCapture('alice', api.fixture('alice'));} catch {keyRefused = true;}
      api.reset(); return {ownerRefused, keyRefused};
    });
    assert.equal(invalid.ownerRefused && invalid.keyRefused, true); assert.equal(JSON.stringify(counts) === JSON.stringify(beforeInvalid), true);
    phase = 'cross-tab-recovery'; const recovered = await second.evaluate(async () => {const api = window.clipTest; const outcome = await api.clip.recoverPendingClipCapture('alice', api.fixture('alice')); return outcome.status === 'committed' && !api.clip.hasPendingClipCapture('alice');});
    assert.equal(recovered, true); assert.equal(counts.create, 1); assert.equal(receipts.size, 1);
    phase = 'cross-tab-lock'; await first.evaluate(() => {const api = window.clipTest; window.clipLockHolding = false; navigator.locks.request(api.clip.clipCaptureCheckpointKey('alice'), async () => {window.clipLockHolding = true; await new Promise(resolve => {window.clipLockRelease = resolve;});});});
    await first.waitForFunction(() => window.clipLockHolding === true); const beforeBusy = {...counts};
    const busy = await second.evaluate(async () => {const api = window.clipTest; try {await api.clip.persistClippedMemory('alice', {title: '', text: 'Synthetic next clip', url: ''}, undefined, api.fixture('alice')); return false;} catch (error) {return error.reason === 'busy' && !api.clip.hasPendingClipCapture('alice');}});
    assert.equal(busy, true); assert.equal(JSON.stringify(counts) === JSON.stringify(beforeBusy), true); await first.evaluate(() => window.clipLockRelease());
    assert.equal(externalRequests, 0);
    process.stdout.write(JSON.stringify({v: 1, browser: 'Chromium', realCrypto: true, realLocalStorage: true, realWebLocks: true, lostAckRecoveredInAnotherTab: true,
      transplantedOwnerRejected: true, wrongVaultRejected: true, concurrentTabRejectedBeforeNetwork: true, serverCreateCalls: counts.create, externalRequests, productionMutations: 0}) + '\n');
  } finally {if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
}
main().catch(error => {process.stderr.write(JSON.stringify({error: 'synthetic_browser_check_failed', phase, errorType: error?.name || 'Error'}) + '\n'); process.exitCode = 1;});
