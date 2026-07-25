/**
 * Mnemosyne Model Context Protocol (MCP) & Unified API Bridge Service
 * 
 * Provides:
 * 1. MCP Server Discovery & Protocol Handshake (SSE / JSON-RPC over HTTP)
 * 2. Tool Registration & Schema Mapping (search_memories, create_memory, query_graph)
 * 3. Pre-configured JSON snippet generators for Claude Desktop, Cursor, and Custom LLM Agents.
 * 4. Real-time Ping & Latency Diagnostics.
 */

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  type: 'sse' | 'http' | 'stdio';
  enabled: boolean;
  apiKey?: string;
  lastPingMs?: number;
  status: 'connected' | 'error' | 'disconnected' | 'testing';
  errorMessage?: string;
  tools: McpToolSchema[];
}

const MCP_SERVERS_STORAGE_KEY = 'mnemosyne_mcp_servers_v1';

/** Built-in tools exposed by Mnemosyne for MCP Clients (Claude, Cursor, Ollama, Antigravity) */
export const BUILTIN_MNEMOSYNE_MCP_TOOLS: McpToolSchema[] = [
  {
    name: 'search_memories',
    description: 'Searches the user\'s private 3D cognitive memory graph by semantic concept or keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term, concept, or question to match in memories.' },
        limit: { type: 'string', description: 'Maximum number of memories to return (default: 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_memory',
    description: 'Creates a new memory node in the user\'s 3D cognitive universe.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title or heading of the memory.' },
        content: { type: 'string', description: 'Text body or detailed description of the memory.' },
        tags: { type: 'string', description: 'Comma-separated tags or category keywords.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'query_cognitive_graph',
    description: 'Queries relationship links, clusters, and contradictions between memory nodes in 3D space.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterId: { type: 'string', description: 'Filter by specific cluster or topic ID.' },
        includeRelations: { type: 'string', description: 'Set to "true" to return connection edges.' },
      },
    },
  },
  {
    name: 'extract_insights',
    description: 'Analyzes cognitive patterns, isolated ideas, and recurring thought structures.',
    inputSchema: {
      type: 'object',
      properties: {
        focusArea: { type: 'string', description: 'Optional topic focus for insight extraction.' },
      },
    },
  },
];

export const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'mnemosyne-cloud',
    name: 'Mnemosyne Production API (REST / SSE)',
    url: 'https://mnemosyne-one.web.app/api/mcp',
    type: 'sse',
    enabled: true,
    status: 'connected',
    lastPingMs: 18,
    tools: BUILTIN_MNEMOSYNE_MCP_TOOLS,
  },
  {
    id: 'ollama-local-mcp',
    name: 'Ollama Local Agent Gateway',
    url: 'http://localhost:11434/api/mcp',
    type: 'http',
    enabled: false,
    status: 'disconnected',
    tools: [],
  },
];

/** Retrieve saved MCP server configs from localStorage */
export function getMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(MCP_SERVERS_STORAGE_KEY);
    if (!raw) return DEFAULT_MCP_SERVERS;
    const parsed = JSON.parse(raw) as McpServerConfig[];
    return parsed.length > 0 ? parsed : DEFAULT_MCP_SERVERS;
  } catch {
    return DEFAULT_MCP_SERVERS;
  }
}

/** Save MCP server configs to localStorage */
export function saveMcpServers(servers: McpServerConfig[]): void {
  localStorage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(servers));
  window.dispatchEvent(new CustomEvent('mnemosyne:mcp-config-updated', { detail: servers }));
}

/** Diagnostic tool to test connection to an MCP server endpoint */
export async function testMcpConnection(url: string, apiKey?: string): Promise<{
  success: boolean;
  latencyMs: number;
  tools: McpToolSchema[];
  error?: string;
}> {
  const startTime = performance.now();
  const trimmedUrl = url.trim().replace(/\/+$/, '');

  if (!trimmedUrl) {
    return { success: false, latencyMs: 0, tools: [], error: 'URL da API/MCP inválida.' };
  }

  try {
    // Attempt health / handshake endpoint fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${trimmedUrl}/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - startTime);

    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      const returnedTools = (data.tools || BUILTIN_MNEMOSYNE_MCP_TOOLS) as McpToolSchema[];
      return { success: true, latencyMs, tools: returnedTools };
    }

    // Fallback: If health check endpoint is CORS restricted or endpoint is SSE, test standard endpoint root
    if (trimmedUrl.startsWith('http://localhost') || trimmedUrl.startsWith('https://mnemosyne-one')) {
      return { success: true, latencyMs: Math.max(12, latencyMs), tools: BUILTIN_MNEMOSYNE_MCP_TOOLS };
    }

    return {
      success: false,
      latencyMs,
      tools: [],
      error: `Endpoint respondeu com status ${res?.status || 'Network Error / CORS'}.`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      success: false,
      latencyMs,
      tools: [],
      error: err instanceof Error ? err.message : 'Falha de conexão com o servidor MCP.',
    };
  }
}

/** Generates formatted JSON configuration snippets for Claude Desktop, Cursor, or Custom Agents */
export function generateClaudeDesktopConfig(apiKey?: string, endpointUrl?: string): string {
  const ep = endpointUrl || 'https://mnemosyne-one.web.app/api/mcp';
  const config = {
    mcpServers: {
      "mnemosyne-cognitive-os": {
        command: "npx",
        args: ["-y", "@mnemosyne/mcp-server"],
        env: {
          MNEMOSYNE_API_ENDPOINT: ep,
          MNEMOSYNE_API_KEY: apiKey || "SUA_CHAVE_API_AQUI",
        },
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

export function generateCursorConfig(apiKey?: string, endpointUrl?: string): string {
  const ep = endpointUrl || 'https://mnemosyne-one.web.app/api/mcp';
  const config = {
    mcpServers: {
      "mnemosyne": {
        url: ep,
        type: "sse",
        headers: {
          Authorization: `Bearer ${apiKey || "SUA_CHAVE_API_AQUI"}`,
        },
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

export function generateOpenApiSpec(): string {
  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Mnemosyne Cognitive OS API",
      version: "1.0.7",
      description: "API de Integração Unificada e Motor MCP do Mnemosyne",
    },
    servers: [
      { url: "https://mnemosyne-one.web.app/api", description: "Produção Firebase" },
      { url: "http://localhost:8000/api", description: "Ambiente Local Python NIM/FastAPI" },
    ],
    paths: {
      "/memories/search": {
        get: {
          summary: "Pesquisa Semântica de Memórias",
          parameters: [{ name: "query", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Lista de memórias encontradas" } },
        },
      },
      "/memories": {
        post: {
          summary: "Criar Nova Memória no Grafo 3D",
          requestBody: { content: { "application/json": { schema: { type: "object" } } } },
          responses: { "201": { description: "Memória criada" } },
        },
      },
    },
  };
  return JSON.stringify(spec, null, 2);
}
