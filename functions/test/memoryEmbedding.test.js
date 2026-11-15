'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmbedding, rankByCosine, toPublicMemory, parseCreateMemoryBody } = require('../lib/memoryPublic');

test('malformed embedding coordinates never shift the remaining dimensions', () => {
  for (const value of [[1, null, 0], [1, NaN, 0], [1, Infinity, 0], [1, '0', 0], '[1,null,0]', '[1,"0",0]']) {
    assert.deepEqual(parseEmbedding(value), []);
  }
  assert.deepEqual(parseEmbedding([0, -1, 0.25]), [0, -1, 0.25]);
  assert.deepEqual(parseEmbedding('[0,-1,0.25]'), [0, -1, 0.25]);
});

test('cosine search excludes a corrupt vector that would shrink into a perfect match', () => {
  const query = [1, ...Array(7).fill(0)];
  const rows = [
    { id: 'valid', data: { embedding: [0.8, 0.6, ...Array(6).fill(0)] } },
    { id: 'shifted', data: { embedding: [1, null, ...Array(7).fill(0)] } },
    { id: 'legacy-shifted', data: { embedding: JSON.stringify([1, null, ...Array(7).fill(0)]) } },
  ];
  assert.deepEqual(rankByCosine(rows, query, 20).map(row => row.id), ['valid']);
});

test('public projections omit the entire corrupt embedding and its model marker', () => {
  const memory = toPublicMemory('synthetic', { embedding: [1, null, 0], embeddingModel: 'synthetic@1', text: 'private' }, { includeEmbedding: true });
  assert.equal('embedding' in memory, false);
  assert.equal('embeddingModel' in memory, false);
  assert.equal('text' in memory, false);
});

test('encrypted creation preserves valid dimensions and omits corrupt optional metadata', () => {
  const enc = { v: 1, iv: 'synthetic-iv', ct: 'synthetic-ct' };
  const valid = [1, ...Array(7).fill(0)];
  const parsed = parseCreateMemoryBody({ enc, embedding: valid, embeddingModel: 'synthetic@1' });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.input.embedding, valid);
  const corrupt = parseCreateMemoryBody({ enc, embedding: [1, null, ...Array(7).fill(0)], embeddingModel: 'synthetic@1' });
  assert.equal(corrupt.ok, true);
  assert.deepEqual(corrupt.input.enc, enc);
  assert.equal('embedding' in corrupt.input, false);
  assert.equal('embeddingModel' in corrupt.input, false);
});
