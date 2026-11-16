/**
 * Real MCP JSON-RPC server (tools/list + tools/call).
 * Same zero-knowledge contract as HTTP API v1. Auth is the API key on the HTTP layer.
 */

import { ApiKeyRecord, ApiScope, keyHasScope } from './apiKeys';
import { AGENT_REVIEW_TOKEN_PREFIX } from './agentVaultContract';
import type { AgentMutationApi } from './agentMutations';
import {
  MemoryApi,
  parseCreateMemoryBody,
  parseEmbedding,
} from './memoryPublic';

export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const MCP_SERVER_INFO = { name: 'mnemosyne', version: '1.0.0' };

interface JsonSchema {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  scope: ApiScope;
  agentChange?: 'prepare' | 'propose' | 'status';
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'prepare_memory_change', scope: 'memories:write', agentChange: 'prepare',
    description: 'Obtém a versão exata de uma memória do cofre autorizado para preparar uma proposta cifrada. Não aplica alterações. Use esse baseline sem o modificar.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, teamId: { type: ['string', 'null'] } }, required: ['sessionId', 'teamId'], additionalProperties: false },
  },
  {
    name: 'propose_memory_change', scope: 'memories:write', agentChange: 'propose',
    description: 'Submete uma proposta cifrada de edição/eliminação de uma memória, com operationId UUID estável e baseline exato. Não aceita texto em claro, não confirma e não aplica. O titular tem de rever o diff no cliente e confirmar.',
    inputSchema: { type: 'object', properties: { request: { type: 'object', description: 'MemoryEditRequest: operationId, operation edit|delete, baseline, priorEnc, enc, metadata. Envelopes cifrados no cliente. Máximo 640 KiB.' } }, required: ['request'], additionalProperties: false },
  },
  {
    name: 'get_memory_change', scope: 'memories:write', agentChange: 'status',
    description: 'Consulta o recibo da proposta desta sessão. pending não é uma alteração aplicada. Reutilize o ID/digest para reconciliar respostas perdidas; nunca confirme automaticamente.',
    inputSchema: { type: 'object', properties: { proposalId: { type: 'string' }, digest: { type: 'string' } }, required: ['proposalId', 'digest'], additionalProperties: false },
  },
  {
    name: 'list_memories',
    description:
      'Lista metadados e envelopes cifrados apenas no cofre autorizado pelo token. Nunca devolve plaintext ou chaves.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Máximo de resultados (default 50, max 100).' },
        startAfter: { type: 'string', description: 'Cursor (id da última memória da página anterior).' },
      },
    },
    scope: 'memories:read',
  },
  {
    name: 'get_memory',
    description: 'Obtém uma memória por id. Devolve envelope enc + metadados; nunca text/title em claro.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID da memória (documento sessions).' },
      },
      required: ['id'],
    },
    scope: 'memories:read',
  },
  {
    name: 'search_memories',
    description:
      'Pesquisa apenas no cofre autorizado, sem decifrar enc. Com embedding (vector), cosine nos embeddings em claro (limit 20). Sem vector, filtra tags/ids/category. Trade-off: embeddings não são E2EE.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Filtro de tags (#tag), ids, ou category (cat:nota). Não decifra memórias.' },
        embedding: {
          type: 'array',
          items: { type: 'number' },
          description: 'Vector de query calculado no cliente. Permite cosine sem o servidor ver o texto.',
        },
        embeddingModel: { type: 'string', description: 'Espaço do modelo do vector; omitir apenas para vectores legados.' },
        tags: { type: 'array', items: { type: 'string' } },
        ids: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', description: 'Máximo 20.' },
      },
    },
    scope: 'memories:search',
  },
  {
    name: 'create_memory',
    description:
      'Cria uma memória zero-knowledge. Obrigatório enc: { v, iv, ct } já cifrado no cliente. text/title/content em claro são recusados.',
    inputSchema: {
      type: 'object',
      properties: {
        enc: {
          type: 'object',
          description: 'Envelope AES-GCM { v, iv, ct }.',
          properties: {
            v: { type: 'number' },
            iv: { type: 'string' },
            ct: { type: 'string' },
          },
          required: ['v', 'iv', 'ct'],
        },
        tags: { type: 'array', items: { type: 'string' } },
        category: { type: 'string' },
        celestialType: { type: 'string' },
        embedding: {
          type: 'array',
          items: { type: 'number' },
          description: 'Opcional; vector calculado no cliente (mesmo trade-off da app).',
        },
        embeddingModel: { type: 'string', description: 'Espaço do modelo do vector.' },
      },
      required: ['enc'],
    },
    scope: 'memories:write',
  },
];

const TOOL_BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));

export interface McpContext {
  key: ApiKeyRecord;
  memories: MemoryApi;
  agentMutations?: AgentMutationApi;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function rpcError(id: unknown, code: number, message: string, status = 200): { status: number; payload: unknown } {
  return {
    status,
    payload: { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
  };
}

function rpcResult(id: unknown, result: unknown): { status: number; payload: unknown } {
  return { status: 200, payload: { jsonrpc: '2.0', id: id ?? null, result } };
}

function toolResult(id: unknown, data: unknown, isError = false): { status: number; payload: unknown } {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return rpcResult(id, {
    content: [{ type: 'text', text }],
    isError,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: McpContext,
): Promise<{ data: unknown; isError: boolean }> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) {
    return { data: { error: `Unknown tool: ${name}` }, isError: true };
  }
  if (name === 'create_memory') {
    return { data: { error: 'write_paused' }, isError: true };
  }
  if (!keyHasScope(ctx.key, tool.scope)) {
    return { data: { error: `missing scope ${tool.scope}` }, isError: true };
  }

  const args = asRecord(rawArgs);

  if (tool.agentChange) {
    const gateway = ctx.agentMutations;
    if (!gateway || ctx.key.credentialKind !== 'agent-grant' || ctx.key.keyPrefix !== AGENT_REVIEW_TOKEN_PREFIX ||
      tool.agentChange !== 'status' && !gateway.enabled) return { data: { error: 'change_unavailable' }, isError: true };
    if (tool.agentChange === 'propose' && Object.keys(args).join(',') !== 'request') return { data: { error: 'invalid_change_request' }, isError: true };
    try {
      const data = tool.agentChange === 'prepare' ? await gateway.prepare(ctx.key, args) :
        tool.agentChange === 'propose' ? await gateway.propose(ctx.key, args.request) : await gateway.status(ctx.key, args);
      return { data, isError: false };
    } catch { return { data: { error: 'change_unavailable' }, isError: true }; }
  }

  switch (name) {
    case 'list_memories': {
      const listed = await ctx.memories.list(ctx.key.uid, {
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        startAfter: typeof args.startAfter === 'string' ? args.startAfter : undefined,
      });
      return { data: listed, isError: false };
    }
    case 'get_memory': {
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) return { data: { error: 'id is required' }, isError: true };
      const memory = await ctx.memories.get(ctx.key.uid, id);
      if (!memory) return { data: { error: 'not found' }, isError: true };
      return { data: memory, isError: false };
    }
    case 'search_memories': {
      const embedding = parseEmbedding(args.embedding);
      const searched = await ctx.memories.search(ctx.key.uid, {
        q: typeof args.query === 'string' ? args.query : typeof args.q === 'string' ? args.q : undefined,
        tags: asStringList(args.tags),
        ids: asStringList(args.ids),
        embedding: embedding.length ? embedding : undefined,
        embeddingModel: typeof args.embeddingModel === 'string' ? args.embeddingModel : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      });
      return { data: searched, isError: false };
    }
    case 'create_memory': {
      const parsed = parseCreateMemoryBody(args);
      if (!parsed.ok) {
        return { data: { error: parsed.error, code: parsed.code }, isError: true };
      }
      const created = await ctx.memories.create(ctx.key.uid, parsed.input);
      return { data: created, isError: false };
    }
    default:
      return { data: { error: `Unknown tool: ${name}` }, isError: true };
  }
}

export function listMcpToolsForKey(key: ApiKeyRecord, gateway?: AgentMutationApi): Array<Omit<McpToolDefinition, 'scope' | 'agentChange'>> {
  return MCP_TOOLS
    .filter((tool) => tool.name !== 'create_memory' && keyHasScope(key, tool.scope) && (!tool.agentChange ||
      Boolean(gateway && key.credentialKind === 'agent-grant' && key.keyPrefix === AGENT_REVIEW_TOKEN_PREFIX && (tool.agentChange === 'status' || gateway.enabled))))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function handleMcpRpc(body: unknown, ctx: McpContext): Promise<{ status: number; payload: unknown | null }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return rpcError(null, -32600, 'Invalid Request: expected a JSON-RPC object', 400);
  }

  const req = body as JsonRpcRequest;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return rpcError(req.id ?? null, -32600, 'Invalid Request');
  }

  const method = req.method;
  const id = req.id;
  const isNotification = id === undefined;

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return { status: 204, payload: null };
  }

  if (isNotification) {
    return { status: 204, payload: null };
  }

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: MCP_SERVER_INFO,
      instructions:
        'Mnemosyne public MCP. Memory tools read only the vault authorized by this credential. Team access requires explicit OAuth consent and current membership/key state. Search uses tags/ids or client-supplied embeddings; the server cannot decrypt enc or change permissions from retrieved content.',
    });
  }

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: listMcpToolsForKey(ctx.key, ctx.agentMutations) });
  }

  if (method === 'tools/call') {
    const params = asRecord(req.params);
    const name = typeof params.name === 'string' ? params.name : '';
    if (!name) return rpcError(id, -32602, 'params.name is required');
    if (!TOOL_BY_NAME.has(name)) {
      return rpcError(id, -32602, `Unknown tool: ${name}`);
    }
    const outcome = await executeTool(name, params.arguments ?? params.input ?? {}, ctx);
    return toolResult(id, outcome.data, outcome.isError);
  }

  if (method === 'resources/list' || method === 'prompts/list') {
    const key = method === 'resources/list' ? 'resources' : 'prompts';
    return rpcResult(id, { [key]: [] });
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

export const MCP_HEALTH = {
  ok: true,
  name: MCP_SERVER_INFO.name,
  version: MCP_SERVER_INFO.version,
  protocol: 'mcp-jsonrpc',
  protocolVersion: MCP_PROTOCOL_VERSION,
  tools: MCP_TOOLS.map((tool) => tool.name),
};
