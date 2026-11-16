process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: 'demo-mnemosyne-test',
});

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseCreateMemoryBody,
  PLAINTEXT_REFUSED_MESSAGE,
  toPublicMemory,
  cosineSimilarity,
  filterMemoriesByTagsIds,
  rankByCosine,
} = require('../lib/memoryPublic.js');
const { publicApiHandler } = require('../lib/publicApi.js');

const ENC = { v: 1, iv: 'iv-value', ct: 'ct-value' };

function createRes() {
  return {
    statusCode: 200,
    payload: undefined,
    headers: {},
    set(field, value) {
      this.headers[field] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
    send(body) {
      this.payload = body;
      return this;
    },
  };
}

function mockKey(overrides = {}) {
  return {
    id: 'a'.repeat(64),
    uid: 'user-1',
    name: 'test',
    scopes: ['memories:read', 'memories:write', 'memories:search'],
    createdAt: 1,
    lastUsedAt: null,
    revoked: false,
    keyPrefix: 'mne_live_abcd',
    ...overrides,
  };
}

function mockDeps(overrides = {}) {
  const created = [];
  return {
    verifyApiKey: async () => mockKey(),
    consumeRateLimit: async () => ({ allowed: true, remaining: 10, retryAfterMs: 0, key: 'k' }),
    touchLastUsed: async () => {},
    memories: {
      list: async () => ({ memories: [], nextStartAfter: null }),
      get: async () => null,
      create: async (_uid, input) => {
        created.push(input);
        return { id: 'new-1', encrypted: true, enc: input.enc, timestamp: 1, updatedAt: 1, tags: [], category: null, celestialType: null };
      },
      search: async () => ({ results: [], mode: 'tags_ids', tradeoff: 'x' }),
    },
    created,
    ...overrides,
  };
}

test('parseCreateMemoryBody refuses plaintext text', () => {
  const refused = parseCreateMemoryBody({ text: 'segredo em claro', enc: ENC });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'plaintext_refused');
  assert.equal(refused.error, PLAINTEXT_REFUSED_MESSAGE);
});

test('agent session endpoint returns no-store tokens and refuses recursive delegation', async () => {
  let issued = 0;
  const deps = mockDeps({ issueAgentSession: async (_key, scopes) => {
    issued++;
    assert.deepEqual(scopes, ['memories:read']);
    return { access_token: 'synthetic', expires_in: 900 };
  } });
  const req = { method: 'POST', url: '/api/v1/agent/session', headers: { authorization: 'Bearer mne_live_synthetic' }, body: { scopes: ['memories:read'] } };
  const res = createRes();
  await publicApiHandler(req, res, deps);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  const nested = createRes();
  await publicApiHandler({ ...req, headers: { authorization: 'Bearer mne_agent_synthetic' } }, nested, deps);
  assert.equal(nested.statusCode, 403);
  assert.equal(issued, 1);
});

test('parseCreateMemoryBody refuses title/content without storing', () => {
  assert.equal(parseCreateMemoryBody({ title: 'Hello', enc: ENC }).code, 'plaintext_refused');
  assert.equal(parseCreateMemoryBody({ content: 'body', tags: ['a'] }).code, 'plaintext_refused');
});

test('parseCreateMemoryBody accepts enc-only envelope', () => {
  const parsed = parseCreateMemoryBody({ enc: ENC, tags: ['ideia'], category: 'nota' });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.input.enc, ENC);
  assert.deepEqual(parsed.input.tags, ['ideia']);
});

test('parseCreateMemoryBody refuses unsupported or empty ciphertext envelopes', () => {
  for (const enc of [
    { v: 2, iv: 'iv', ct: 'ct' },
    { v: 1, iv: '', ct: 'ct' },
    { v: 1, iv: 'iv', ct: '' },
  ]) {
    assert.equal(parseCreateMemoryBody({ enc }).ok, false);
    assert.equal(toPublicMemory('sample', { enc }).encrypted, false);
  }
});

test('toPublicMemory strips plaintext text/title even on legacy docs', () => {
  const publicMemory = toPublicMemory('abc', {
    text: 'SHOULD NEVER LEAK',
    title: 'also secret',
    timestamp: 10,
    tags: ['x'],
    category: 'nota',
    celestialType: 'star',
  });
  assert.equal(publicMemory.encrypted, false);
  assert.equal('text' in publicMemory, false);
  assert.equal('title' in publicMemory, false);
  assert.equal(JSON.stringify(publicMemory).includes('SHOULD NEVER LEAK'), false);
  assert.equal(publicMemory.tags[0], 'x');
});

test('toPublicMemory returns enc and encrypted true', () => {
  const publicMemory = toPublicMemory('abc', { enc: ENC, timestamp: 1 });
  assert.equal(publicMemory.encrypted, true);
  assert.deepEqual(publicMemory.enc, ENC);
});

test('cosineSimilarity ranks parallel vectors higher', () => {
  assert.ok(cosineSimilarity([1, 0], [1, 0]) > cosineSimilarity([1, 0], [0, 1]));
});

test('filterMemoriesByTagsIds matches tags and ids without reading enc', () => {
  const docs = [
    { id: 'a', data: { tags: ['work'], enc: ENC } },
    { id: 'b', data: { tags: ['home'], enc: ENC } },
  ];
  const tagged = filterMemoriesByTagsIds(docs, { q: '#work' });
  assert.deepEqual(tagged.map((d) => d.id), ['a']);
  const byId = filterMemoriesByTagsIds(docs, { ids: ['b'] });
  assert.deepEqual(byId.map((d) => d.id), ['b']);
});

test('rankByCosine uses embeddings not ciphertext', () => {
  const ranked = rankByCosine([
    { id: 'near', data: { embedding: [1, 0], enc: { v: 1, iv: 'x', ct: 'secret-ct' } } },
    { id: 'far', data: { embedding: [0, 1], enc: ENC } },
  ], [1, 0], 20);
  assert.equal(ranked[0].id, 'near');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('rankByCosine excludes vectors from another embedding space', () => {
  const ranked = rankByCosine([
    { id: 'legacy', data: { embedding: [1, 0] } },
    { id: 'future', data: { embedding: [1, 0], embeddingModel: 'future-model@revision-1' } },
  ], [1, 0], 20);
  assert.deepEqual(ranked.map((item) => item.id), ['legacy']);
  assert.deepEqual(rankByCosine([
    { id: 'legacy', data: { embedding: [1, 0] } },
    { id: 'future', data: { embedding: [1, 0], embeddingModel: 'future-model@revision-1' } },
  ], [1, 0], 20, 'future-model@revision-1').map((item) => item.id), ['future']);
});

test('POST /api/v1/memories with plaintext is blocked during personal launch', async () => {
  const deps = mockDeps();
  const res = createRes();
  await publicApiHandler({
    method: 'POST',
    originalUrl: '/api/v1/memories',
    headers: { authorization: 'Bearer mne_live_fake' },
    body: { text: 'plaintext memory' },
    query: {},
  }, res, deps);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error, 'write_paused');
  assert.equal(deps.created.length, 0);
});

test('POST /api/v1/memories without write scope remains blocked', async () => {
  const deps = mockDeps({
    verifyApiKey: async () => mockKey({ scopes: ['memories:read'] }),
  });
  const res = createRes();
  await publicApiHandler({
    method: 'POST',
    originalUrl: '/api/v1/memories',
    headers: { authorization: 'Bearer mne_live_fake' },
    body: { enc: ENC },
    query: {},
  }, res, deps);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error, 'write_paused');
  assert.equal(deps.created.length, 0);
});

test('GET /api/v1/memories without read scope returns 403', async () => {
  const deps = mockDeps({
    verifyApiKey: async () => mockKey({ scopes: ['memories:write'] }),
  });
  const res = createRes();
  await publicApiHandler({
    method: 'GET',
    originalUrl: '/api/v1/memories',
    headers: { authorization: 'Bearer mne_live_fake' },
    body: {},
    query: {},
  }, res, deps);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.scope, 'memories:read');
});

test('API failures do not log query text or bearer credentials', async () => {
  const secret = 'synthetic private query';
  const bearer = 'synthetic-bearer-secret';
  const messages = [];
  const originalError = console.error;
  console.error = (...parts) => { messages.push(parts); };
  try {
    const deps = mockDeps({
      memories: {
        search: async () => { throw new Error(`${secret} ${bearer}`); },
      },
    });
    const res = createRes();
    await publicApiHandler({
      method: 'GET',
      originalUrl: '/api/v1/search',
      headers: { authorization: `Bearer ${bearer}` },
      body: {},
      query: { q: secret },
    }, res, deps);
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.stringify(messages).includes(secret), false);
    assert.equal(JSON.stringify(messages).includes(bearer), false);
    assert.deepEqual(messages, [['publicApiHandler failed']]);
  } finally {
    console.error = originalError;
  }
});

test('API suppresses a revoked in-flight result with a fixed account error', async () => {
  const { AccountUnavailableError } = require('../lib/accountAccess');
  const deps = mockDeps({ memories: { search: async () => { throw new AccountUnavailableError(); } } });
  const res = createRes();
  await publicApiHandler({ method: 'GET', originalUrl: '/api/v1/search', headers: { authorization: 'Bearer mne_live_fake' }, body: {}, query: {} }, res, deps);
  assert.equal(res.statusCode, 403); assert.deepEqual(res.payload, { error: 'account_unavailable', detail: 'Account unavailable.' });
});

test('POST /api/v1/memories with enc is blocked even for a legacy write-scoped key', async () => {
  const deps = mockDeps();
  const res = createRes();
  await publicApiHandler({
    method: 'POST',
    originalUrl: '/api/v1/memories',
    headers: { authorization: 'Bearer mne_live_fake' },
    body: { enc: ENC, tags: ['zk'] },
    query: {},
  }, res, deps);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error, 'write_paused');
  assert.equal(deps.created.length, 0);
});
