import { afterEach, describe, expect, it, vi } from 'vitest';
import { testMcpConnection } from './mcpBridge';

describe('MCP connection diagnostics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not report a connection when the endpoint cannot be reached', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await testMcpConnection('https://example.com/api/v1/mcp', 'synthetic-key');
    expect(result.success).toBe(false);
    expect(result.tools).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports only read-only tools returned by the authenticated endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tools: ['list_memories', 'create_memory', 'get_memory'] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await testMcpConnection('https://example.com/api/v1/mcp', 'synthetic-key');
    expect(result.success).toBe(true);
    expect(result.tools.map((tool) => tool.name)).toEqual(['list_memories', 'get_memory']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/api/v1/mcp');
  });

  it('does not send a key over plain HTTP or invent tools from a bare health response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const insecure = await testMcpConnection('http://example.com/api/v1/mcp', 'synthetic-key');
    expect(insecure.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    const bare = await testMcpConnection('https://example.com/api/v1/mcp', 'synthetic-key');
    expect(bare.success).toBe(false);
    expect(bare.tools).toEqual([]);
  });
});
