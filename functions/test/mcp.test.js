process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: 'demo-mnemosyne-test',
});

const assert = require('node:assert/strict');
const test = require('node:test');
const { handleMcpRpc, listMcpToolsForKey, MCP_TOOLS } = require('../lib/mcpServer.js');
const { publicApiHandler } = require('../lib/publicApi.js');

const ENC = { v: 1, iv: 'iv', ct: 'ct' };

const ownerKey = {
  id: 'b'.repeat(64),
  uid: 'owner-1',
  name: 'mcp',
  scopes: ['memories:read', 'memories:write', 'memories:search'],
  createdAt: 1,
  lastUsedAt: null,
  revoked: false,
  keyPrefix: 'mne_live_mcp',
};

function mockMemories() {
  const store = new Map([
    ['mem-1', {
      id: 'mem-1',
      timestamp: 100,
      updatedAt: 100,
      tags: ['work'],
      category: 'nota',
      celestialType: 'star',
      encrypted: true,
      enc: ENC,
      embedding: [1, 0],
    }],
  ]);
  return {
    store,
    async list(uid) {
      assert.equal(uid, 'owner-1');
      return { memories: [...store.values()].map(({ embedding, ...rest }) => rest), nextStartAfter: null };
    },
    async get(uid, id) {
      assert.equal(uid, 'owner-1');
      return store.get(id) || null;
    },
    async create(uid, input) {
      assert.equal(uid, 'owner-1');
      const created = {
        id: 'mem-new',
        timestamp: 200,
        updatedAt: 200,
        tags: input.tags || [],
        category: input.category || null,
        celestialType: null,
        encrypted: true,
        enc: input.enc,
      };
      store.set(created.id, created);
      return created;
    },
    async search(uid, opts) {
      assert.equal(uid, 'owner-1');
      const results = [...store.values()].filter((item) => {
        if (opts.ids && opts.ids.length) return opts.ids.includes(item.id);
        if (opts.tags && opts.tags.length) {
          return opts.tags.some((tag) => (item.tags || []).includes(tag));
        }
        if (opts.q) return (item.tags || []).some((tag) => opts.q.includes(tag));
        return true;
      });
      return { results, mode: opts.embedding ? 'cosine' : 'tags_ids', tradeoff: 'documented' };
    },
  };
}

test('tools/list only announces implemented tools', async () => {
  const rpc = await handleMcpRpc(
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { key: ownerKey, memories: mockMemories() },
  );
  const names = rpc.payload.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['get_memory', 'list_memories', 'search_memories']);
  assert.equal(names.length, MCP_TOOLS.filter(tool => tool.name !== 'create_memory' && !tool.agentChange).length);
  assert.equal(names.includes('extract_insights'), false);
  assert.equal(names.includes('query_cognitive_graph'), false);
});

test('listMcpToolsForKey hides tools without scope', () => {
  const listed = listMcpToolsForKey({ ...ownerKey, scopes: ['memories:read'] });
  assert.deepEqual(listed.map((t) => t.name).sort(), ['get_memory', 'list_memories']);
});

test('tools/call list_memories happy path with mocked store', async () => {
  const rpc = await handleMcpRpc(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_memories', arguments: { limit: 10 } } },
    { key: ownerKey, memories: mockMemories() },
  );
  assert.equal(rpc.status, 200);
  assert.equal(rpc.payload.result.isError, false);
  const body = JSON.parse(rpc.payload.result.content[0].text);
  assert.equal(body.memories.length, 1);
  assert.equal(body.memories[0].id, 'mem-1');
  assert.equal(body.memories[0].encrypted, true);
  assert.equal('text' in body.memories[0], false);
  assert.deepEqual(body.memories[0].enc, ENC);
});

test('tools/call get_memory happy path', async () => {
  const rpc = await handleMcpRpc(
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_memory', arguments: { id: 'mem-1' } } },
    { key: ownerKey, memories: mockMemories() },
  );
  const body = JSON.parse(rpc.payload.result.content[0].text);
  assert.equal(body.id, 'mem-1');
  assert.equal(body.encrypted, true);
});

test('tools/call create_memory is blocked even with a legacy write scope', async () => {
  const memories = mockMemories();
  const rpc = await handleMcpRpc(
    {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'create_memory', arguments: { enc: ENC, tags: ['zk'] } },
    },
    { key: ownerKey, memories },
  );
  assert.equal(rpc.payload.result.isError, true);
  const body = JSON.parse(rpc.payload.result.content[0].text);
  assert.equal(body.error, 'write_paused');
  assert.equal(memories.store.has('mem-new'), false);
});

test('tools/call create_memory refuses plaintext', async () => {
  const memories = mockMemories();
  const rpc = await handleMcpRpc(
    {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'create_memory', arguments: { text: 'nope' } },
    },
    { key: ownerKey, memories },
  );
  assert.equal(rpc.payload.result.isError, true);
  assert.equal(memories.store.has('mem-new'), false);
});

test('tools/call unknown tool is a JSON-RPC error, not advertised', async () => {
  const rpc = await handleMcpRpc(
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'extract_insights', arguments: {} } },
    { key: ownerKey, memories: mockMemories() },
  );
  assert.equal(rpc.payload.error.code, -32602);
});

test('HTTP POST /api/v1/mcp tools/call list_memories happy path', async () => {
  const memories = mockMemories();
  const res = {
    statusCode: 200,
    payload: undefined,
    headers: {},
    set(field, value) { this.headers[field] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
    send(body) { this.payload = body; return this; },
  };
  await publicApiHandler({
    method: 'POST',
    originalUrl: '/api/v1/mcp',
    headers: { authorization: 'Bearer mne_live_fake' },
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_memories', arguments: {} },
    },
    query: {},
  }, res, {
    verifyApiKey: async () => ownerKey,
    consumeRateLimit: async () => ({ allowed: true, remaining: 5, retryAfterMs: 0, key: 'k' }),
    touchLastUsed: async () => {},
    memories,
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload.result.content[0].text);
  assert.equal(body.memories[0].id, 'mem-1');
  assert.equal(body.memories[0].encrypted, true);
});
