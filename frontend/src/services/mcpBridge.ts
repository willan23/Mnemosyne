/** Public MCP diagnostics for the read-only personal launch. */

export interface McpToolSchema {
  name: string;
  description: string;
}

const READ_ONLY_TOOLS: McpToolSchema[] = [
  { name: 'list_memories', description: 'List encrypted memory envelopes and metadata.' },
  { name: 'get_memory', description: 'Read an encrypted memory envelope by ID.' },
  { name: 'search_memories', description: 'Search permitted metadata or client-supplied embeddings.' },
];

export async function testMcpConnection(url: string, apiKey?: string): Promise<{
  success: boolean;
  latencyMs: number;
  tools: McpToolSchema[];
  error?: string;
}> {
  let endpoint: URL;
  try {
    endpoint = new URL(url);
    const local = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !local) throw new Error('HTTPS obrigatório.');
  } catch {
    return { success: false, latencyMs: 0, tools: [], error: 'URL MCP inválido ou sem HTTPS.' };
  }

  const started = performance.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      return { success: false, latencyMs, tools: [], error: `Endpoint respondeu HTTP ${response.status}.` };
    }
    const data: unknown = await response.json().catch(() => null);
    const reported = typeof data === 'object' && data !== null && 'tools' in data && Array.isArray(data.tools)
      ? data.tools : [];
    const names = new Set(reported.filter((item: unknown): item is string => typeof item === 'string'));
    const tools = READ_ONLY_TOOLS.filter((tool) => names.has(tool.name));
    if (!tools.length) {
      return {
        success: false, latencyMs, tools: [],
        error: 'O endpoint respondeu sem ferramentas acessíveis. Confirma a API key e os scopes.',
      };
    }
    return { success: true, latencyMs, tools };
  } catch {
    return {
      success: false,
      latencyMs: Math.round(performance.now() - started),
      tools: [],
      error: 'Não foi possível contactar o endpoint MCP.',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
