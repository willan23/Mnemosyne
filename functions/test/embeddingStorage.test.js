'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readStoredEmbedding, serializeStoredEmbedding, storedEmbeddingMetadata, MAX_STORED_EMBEDDING_DIMENSIONS } = require('../lib/embeddingStorage');
const { normalizedSyncMetadata, parseSyncMetadata } = require('../lib/mobileSyncImportContract');
const { sessionEventKinds } = require('../lib/memoryLedger');
const { parseEmbedding, toPublicMemory, rankByCosine } = require('../lib/memoryPublic');
const { semanticRelationProjection } = require('../lib/semanticRelationContract');

test('JSON storage round-trips finite doubles, extreme values and signed zero exactly', () => {
  const vector = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, Math.PI, 1 / 3];
  const encoded = serializeStoredEmbedding(vector), decoded = JSON.parse(encoded);
  assert.equal(typeof encoded, 'string');
  assert(decoded.every((value, index) => Object.is(value, vector[index])));
  assert.deepEqual(readStoredEmbedding(encoded), vector);
});

test('storage round-trips deterministic IEEE values up to the admitted dimensional bound', () => {
  const bytes = Buffer.alloc(8), vector = [];
  let seed = 1234567;
  while (vector.length < MAX_STORED_EMBEDDING_DIMENSIONS) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes.writeUInt32LE(seed, 0);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes.writeUInt32LE(seed, 4);
    const value = bytes.readDoubleLE(); if (Number.isFinite(value)) vector.push(value);
  }
  const decoded = readStoredEmbedding(serializeStoredEmbedding(vector));
  assert.equal(decoded.length, vector.length);
  assert(decoded.every((value, index) => Object.is(value, vector[index])));
});

test('invalid or oversized storage is rejected as a whole, including sparse coordinates', () => {
  const sparse = [1, 0, 0]; delete sparse[1];
  for (const value of [null, {}, '[1,null,0]', '"[1,0]"', '[1e999]', [1, NaN, 0], [1, Infinity], [1, '0'], sparse, Array(4097).fill(0), ' '.repeat(150001)]) {
    assert.equal(readStoredEmbedding(value), null);
    assert.throws(() => serializeStoredEmbedding(value), { message: 'Invalid embedding storage value' });
  }
  assert.deepEqual(readStoredEmbedding([]), []);
  assert.equal(serializeStoredEmbedding([]), '[]');
});

test('metadata conversion preserves unrelated fields and never mutates request arrays or null markers', () => {
  const vector = [1, 0], enc = { v: 1, iv: 'synthetic', ct: 'synthetic' }, metadata = Object.freeze({ embedding: Object.freeze(vector), embeddingModel: 'space', enc });
  const stored = storedEmbeddingMetadata(metadata);
  assert.equal(stored.embedding, '[1,0]'); assert.equal(stored.embeddingModel, 'space'); assert.equal(stored.enc, enc);
  assert.equal(metadata.embedding, vector); assert.deepEqual(vector, [1, 0]);
  assert.deepEqual(storedEmbeddingMetadata({ embedding: null }), { embedding: null });
  assert.deepEqual(storedEmbeddingMetadata({ tags: ['tag'] }), { tags: ['tag'] });
});

test('sync comparison normalizes stored strings while the incoming RPC contract remains numeric', () => {
  const metadata = { embedding: [1, 0], embeddingModel: 'space', tags: [], connections: [] };
  assert.deepEqual(normalizedSyncMetadata(storedEmbeddingMetadata(metadata)), normalizedSyncMetadata(metadata));
  assert.deepEqual(normalizedSyncMetadata({ embedding: '[]', embeddingModel: 'space' }), { tags: [], connections: [] });
  assert.throws(() => normalizedSyncMetadata({ embedding: '[1,null]', embeddingModel: 'space' }));
  assert.throws(() => parseSyncMetadata({ embedding: '[1,0]', embeddingModel: 'space' }));
});

test('public projection and cosine ranking preserve numeric vectors from mixed storage', () => {
  const a = { embedding: '[1,0]', embeddingModel: 'space' }, b = { embedding: [0, 1], embeddingModel: 'space' };
  assert.deepEqual(parseEmbedding(a.embedding), [1, 0]);
  assert.deepEqual(toPublicMemory('a', a, { includeEmbedding: true }).embedding, [1, 0]);
  assert.deepEqual(rankByCosine([{ id: 'b', data: b }, { id: 'a', data: a }], [1, 0], 2, 'space').map(row => row.id), ['a', 'b']);
});

test('ledger reports semantic index changes without inventing an index event for re-encoding alone', () => {
  const before = { embedding: [1, 0], embeddingModel: 'space' };
  assert.deepEqual(sessionEventKinds(undefined, storedEmbeddingMetadata(before)), ['write', 'index']);
  assert.deepEqual(sessionEventKinds(before, storedEmbeddingMetadata(before)), ['update']);
  assert.deepEqual(sessionEventKinds(before, { embedding: '[0,1]', embeddingModel: 'space' }), ['update', 'index']);
  assert.deepEqual(sessionEventKinds(before, { embedding: '[1,null]', embeddingModel: 'space' }), ['update']);
});

test('relation projection accepts stored strings while keeping scope and dimensional checks', () => {
  const row = { uid: 'alice', teamId: null, connections: [], embedding: '[1,0]', updatedAt: 2 };
  assert.deepEqual(semanticRelationProjection('note', row).embedding, [1, 0]);
  assert.throws(() => semanticRelationProjection('note', { ...row, teamId: 'team' }));
  assert.throws(() => semanticRelationProjection('note', { ...row, embedding: '[1,null]' }));
});
