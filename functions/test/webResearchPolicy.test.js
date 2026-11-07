const assert = require('node:assert/strict');
const test = require('node:test');
const { parseResearchModeAndContext, searchPublicWeb } = require('../lib/webApi.js');

test('private-local research drops client-supplied memory context', () => {
  assert.deepEqual(parseResearchModeAndContext('private-local', ['synthetic private memory']), {
    mode: 'private-local', context: [],
  });
  assert.deepEqual(parseResearchModeAndContext('public', ['synthetic private memory']), {
    mode: 'public', context: [],
  });
});

test('contextual research accepts bounded context and rejects invalid modes', () => {
  assert.deepEqual(parseResearchModeAndContext('contextual', ['  synthetic context  ']), {
    mode: 'contextual', context: ['synthetic context'],
  });
  assert.equal(parseResearchModeAndContext('unknown', []), null);
  assert.equal(parseResearchModeAndContext('contextual', ['x'.repeat(2001)]), null);
});

test('provider failure logs only a fixed provider ID and continues search', async () => {
  const secret = 'synthetic private search query';
  const messages = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => { messages.push(parts); };
  try {
    const results = await searchPublicWeb(secret, 2, [
      { id: 'duckduckgo', search: async () => { throw new Error(`https://example.test/?q=${secret}`); } },
      { id: 'wikipedia', search: async () => [{ title: 'Synthetic result', url: 'https://example.com/article', snippet: 'Safe' }] },
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Synthetic result');
    assert.equal(JSON.stringify(messages).includes(secret), false);
    assert.deepEqual(messages, [['Search provider failed', { provider: 'duckduckgo' }]]);
  } finally {
    console.warn = originalWarn;
  }
});
