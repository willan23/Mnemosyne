'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { buildAiOperationalEvent, createAiOperation, recordAiCircuitEvent, observeAiHandler } = require('../lib/aiOperationalEvents');
const id = '11111111-1111-4111-8111-111111111111';
const base = { v: 1, component: 'mnemosyne-ai', event: 'outcome', operationId: id, kind: 'text', provider: 'openai',
  modelId: 'openai-mini', scopeKind: 'personal', at: 1800000000000, reason: 'success', httpStatus: 200, durationMs: 50 };
function fixture() { const events = []; let clock = 1800000000000; return { events, advance: value => { clock += value; },
  sink: { write: entry => events.push(entry), id: () => id, now: () => clock } }; }
test('AI operational events reject raw identifiers, payloads, exceptions, unbounded labels and prototype names', () => {
  assert.deepEqual(buildAiOperationalEvent(base), base);
  for (const key of ['uid', 'teamId', 'prompt', 'response', 'error', 'token', 'url', 'email', 'ip', 'authorization']) {
    assert.equal(buildAiOperationalEvent({ ...base, [key]: 'synthetic-sensitive-value' }), null);
  }
  for (const value of ['constructor', '__proto__', 'synthetic-secret', {}, undefined]) {
    for (const key of ['provider', 'modelId', 'scopeKind', 'reason', 'operationId']) assert.equal(buildAiOperationalEvent({ ...base, [key]: value }), null);
  }
  for (const data of [{ ...base, httpStatus: 503 }, { ...base, durationMs: -1 }, { ...base, durationMs: Infinity },
    { ...base, at: NaN }, { ...base, modelId: 'gpt-4o-mini' }, { ...base, modelId: 'unknown', provider: 'unknown' }, new Error('synthetic-sensitive-value')]) {
    assert.equal(buildAiOperationalEvent(data), null);
  }
});
test('reservations are server-derived, emitted once, and separated from provider attempts and final results', () => {
  const f = fixture(); const operation = createAiOperation('text', f.sink);
  operation.providerAttempt(); assert.equal(f.events.length, 0);
  operation.bind('openai-mini', 'team', 120); operation.reservation(64); operation.reservation(64);
  operation.providerAttempt(); operation.providerAttempt(); f.advance(200); operation.finish('access_changed'); operation.finish('success'); operation.ensureClosed();
  assert.equal(f.events.length, 3); assert.deepEqual(f.events.map(event => event.event), ['reservation', 'provider_attempt', 'outcome']);
  assert.equal(f.events[0].inputTokenUnitsReserved, 632); assert.equal(f.events[0].costUnitsReserved, 2); assert.equal(f.events[0].outputTokensReserved, 64);
  assert.equal(f.events[2].durationMs, 200); assert.equal(f.events[2].reason, 'access_changed'); assert.equal(f.events[2].httpStatus, 403);
  assert.ok(f.events.every(event => event.operationId === id));
  operation.bind('nvidia-llama', 'personal', 2); operation.reservation(64); assert.equal(f.events.length, 3);
});
test('refusals carry no claimed provider consumption, and image charges cannot become arbitrary cost or token amounts', () => {
  const f = fixture(); const denied = createAiOperation('text', f.sink); denied.finish('auth_required');
  assert.equal(f.events[0].modelId, 'unknown'); assert.equal(f.events[0].provider, 'unknown');
  assert.equal(f.events[0].costUnitsReserved, undefined);
  const image = createAiOperation('image', f.sink); image.bind('openai-image', 'personal', 50); image.reservation(1); assert.equal(f.events.length, 1);
  image.reservation(0); image.finish('success'); assert.equal(f.events[1].imagesReserved, 1); assert.equal(f.events[1].costUnitsReserved, 20);
  const raw = { ...f.events[1] }; delete raw.severity; delete raw.message;
  for (const [field, value] of [['costUnitsReserved', 100], ['inputTokenUnitsReserved', 0], ['outputTokensReserved', 1], ['policyVersion', 999]]) {
    assert.equal(buildAiOperationalEvent({ ...raw, [field]: value }), null);
  }
});
test('logging failure does not fail or repeat a charged operation and an unfinished operation closes with a fixed reason', () => {
  let writes = 0; const operation = createAiOperation('text', { id: () => id, now: () => 1800000000000,
    write: () => { writes++; throw Error('synthetic secret must not be logged'); } });
  assert.doesNotThrow(() => { operation.bind('openai-mini', 'personal', 10); operation.reservation(64); operation.providerAttempt(); operation.finish('success'); operation.ensureClosed(); });
  assert.equal(writes, 3);
  const f = fixture(); const unfinished = createAiOperation('text', f.sink); unfinished.ensureClosed(); unfinished.ensureClosed();
  assert.equal(f.events.length, 1); assert.equal(f.events[0].reason, 'handler_failed'); assert.equal(f.events[0].severity, 'ERROR');
});
test('circuit telemetry is bounded to approved channels and has no lease, account or raw error', () => {
  const f = fixture(); recordAiCircuitEvent('text_openai', 'circuit_opened', f.sink); recordAiCircuitEvent('image_nvidia', 'circuit_write_failed', f.sink);
  for (const channel of ['synthetic-secret', 'text_constructor', 'text_openai/secret']) recordAiCircuitEvent(channel, 'circuit_opened', f.sink);
  assert.equal(f.events.length, 2); assert.equal(f.events[0].severity, 'WARNING'); assert.equal(f.events[1].severity, 'ERROR');
  assert.ok(f.events.every(event => event.modelId === 'unknown' && event.scopeKind === 'unknown' && event.leaseId === undefined));
});

test('Gemini operations and circuits use the same bounded content-free telemetry schema', () => {
  for (const kind of ['text', 'image']) {
    const f = fixture(), operation = createAiOperation(kind, f.sink);
    operation.bind(kind === 'text' ? 'gemini-flash' : 'gemini-image', 'personal', 16);
    operation.reservation(kind === 'text' ? 64 : 0); operation.providerAttempt(); operation.finish('success');
    recordAiCircuitEvent(`${kind}_gemini`, 'circuit_opened', f.sink);
    assert.equal(f.events.length, 4); assert.ok(f.events.every(event => event.provider === 'gemini'));
    assert.deepEqual(f.events.map(event => event.event), ['reservation', 'provider_attempt', 'outcome', 'circuit_opened']);
    assert.ok(f.events.every(event => event.prompt === undefined && event.response === undefined && event.uid === undefined));
  }
});
test('handler observation preserves errors and excludes OPTIONS from operational metrics', async () => {
  const { logger } = require('firebase-functions/logger'); const original = logger.write; const events = [];
  try {
    logger.write = entry => events.push(entry);
    const error = Error('synthetic private handler failure'); const handler = observeAiHandler('text', async () => { throw error; });
    await assert.rejects(handler({ method: 'POST' }, {}), value => value === error);
    assert.equal(events.length, 1); assert.equal(events[0].reason, 'handler_failed'); assert.equal(JSON.stringify(events).includes(error.message), false);
    await assert.rejects(handler({ method: 'OPTIONS' }, {})); assert.equal(events.length, 1);
  } finally { logger.write = original; }
});
