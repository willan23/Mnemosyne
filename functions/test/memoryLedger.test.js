const assert = require('node:assert/strict');
const test = require('node:test');
const { sessionEventKinds, relationEventKinds, recordMemoryEvents } = require('../lib/memoryLedger');

test('ledger distinguishes persisted write/update/delete and embedding replacement', () => {
  const original = { uid: 'alice', enc: { ct: 'secret' }, embedding: [1, 0], embeddingModel: 'v1' };
  assert.deepEqual(sessionEventKinds(undefined, original), ['write', 'index']);
  assert.deepEqual(sessionEventKinds(original, { ...original }), []);
  assert.deepEqual(sessionEventKinds(original, { ...original, embeddingModel: 'v2' }), ['update', 'index']);
  assert.deepEqual(sessionEventKinds(original, { ...original, deletedAt: 1 }), ['delete']);
  assert.deepEqual(sessionEventKinds({ ...original, deletedAt: 1 }, undefined), ['delete']);
  assert.deepEqual(sessionEventKinds(original, { ...original, enc: { ct: 'new' } }), ['update']);
});

test('ledger does not invent acceptance or rejection without a suggestion transition', () => {
  assert.deepEqual(relationEventKinds(undefined, { status: 'suggested' }), ['relation-suggested']);
  assert.deepEqual(relationEventKinds({ status: 'suggested' }, { status: 'accepted' }), ['relation-accepted']);
  assert.deepEqual(relationEventKinds({ status: 'suggested' }, { status: 'rejected' }), ['relation-rejected']);
  assert.deepEqual(relationEventKinds(undefined, { status: 'accepted' }), []);
  assert.deepEqual(relationEventKinds({ status: 'accepted' }, undefined), []);
});

test('ledger deduplicates delivery, allowlists metadata and suppresses deleted accounts', async () => {
  const events = new Map();
  let profile = {};
  let deleted = false; const marker = {};
  const user = { collection: () => ({ doc: id => id }) };
  const db = {
    doc: path => path === 'users/alice' ? user : marker,
    collection: () => ({ doc: () => user }),
    runTransaction: fn => fn({
      get: async () => ({ exists: profile !== null, data: () => profile }),
      getAll: async (...refs) => refs.map(ref => ref === user ? { exists: profile !== null, data: () => profile } :
        ref === marker ? { exists: deleted, data: () => ({}) } : { exists: events.has(ref) }),
      create: (ref, value) => events.set(ref, value),
    }),
  };
  const input = { eventId: 'delivery-1', occurredAt: '2026-09-26T10:00:00Z', memoryId: 'm1',
    kinds: ['write', 'index'], text: 'must never persist', embedding: [1, 2], enc: { ct: 'secret' } };
  await recordMemoryEvents(db, 'alice', input);
  await recordMemoryEvents(db, 'alice', input);
  assert.equal(events.size, 2);
  for (const event of events.values()) {
    assert.deepEqual(Object.keys(event).sort(), ['schemaVersion', 'kind', 'memoryId', 'occurredAt', 'recordedAt', 'source'].sort());
  }
  profile = { deletionState: 'deleting' };
  await recordMemoryEvents(db, 'alice', { ...input, eventId: 'delivery-2' });
  profile = null;
  await recordMemoryEvents(db, 'alice', { ...input, eventId: 'delivery-3' });
  profile = {}; deleted = true;
  await recordMemoryEvents(db, 'alice', { ...input, eventId: 'delivery-4' });
  assert.equal(events.size, 2);
});

test('write and retrieval timestamps survive the runtime-wrapped Admin namespace', async () => {
  const Module = require('node:module');
  const admin = require('firebase-admin');
  const { FieldValue } = require('firebase-admin/firestore');
  const filename = require.resolve('../lib/memoryLedger');
  const load = Module._load;
  const wrapped = (...args) => admin.firestore(...args);
  assert.equal(wrapped.FieldValue, undefined);
  let ledger;
  try {
    delete require.cache[filename];
    Module._load = function (name, parent, ...args) {
      if (name === 'firebase-admin' && parent?.filename === filename) return { ...admin, firestore: wrapped };
      return load.call(this, name, parent, ...args);
    };
    ledger = require('../lib/memoryLedger');
  } finally {
    Module._load = load;
    delete require.cache[filename];
  }
  const events = new Map(), marker = {};
  const user = { collection: () => ({ doc: id => id }) };
  const db = {
    doc: path => path === 'users/alice' ? user : marker,
    collection: () => ({ doc: () => user }),
    runTransaction: fn => fn({
      get: async () => ({ exists: true, data: () => ({}) }),
      getAll: async (...refs) => refs.map(ref => ref === user ? { exists: true, data: () => ({}) } :
        ref === marker ? { exists: false } : { exists: events.has(ref) }),
      create: (ref, row) => events.set(ref, row),
    }),
  };
  const input = { eventId: 'synthetic-delivery', occurredAt: '2026-11-05T00:00:00Z', memoryId: 'synthetic-memory', kinds: ['write'] };
  await ledger.recordMemoryEvents(db, 'alice', input);
  await ledger.recordMemoryEvents(db, 'alice', input);
  assert.equal(events.size, 1);
  await ledger.recordMemoryRetrieval(db, 'alice', 'get', 1);
  assert.equal(events.size, 2);
  for (const row of events.values()) assert(row.recordedAt instanceof FieldValue && row.recordedAt.isEqual(FieldValue.serverTimestamp()));
});
