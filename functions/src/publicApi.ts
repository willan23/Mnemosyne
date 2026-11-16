/**
 * Public HTTP API v1 + MCP endpoint.
 * Auth: Bearer mne_live_… (hashed API key). Never returns memory plaintext.
 */

import * as functions from 'firebase-functions/v1';
import { AccountUnavailableError } from './accountAccess';
import {
  ApiKeyRecord,
  ApiScope,
  extractBearerToken,
  keyHasScope,
  touchApiKeyLastUsed,
} from './apiKeys';
import { AGENT_TOKEN_PREFIX, issueAgentSession, verifyGatewayBearer } from './agentSessions';
import { redeemAgentAuthorizationCode } from './agentOAuth';
import { createFirestoreMemoryApi } from './memoriesStore';
import { createTeamAgentMemoryApi } from './agentVaultMemories';
import { agentVaultAdmissionBytes, parseAgentVaultAdmission } from './agentVaultContract';
import { createAgentMutationApi, type AgentMutationApi } from './agentMutations';
import {
  clampLimit,
  MemoryApi,
  parseEmbedding,
} from './memoryPublic';
import { handleMcpRpc, listMcpToolsForKey, MCP_HEALTH } from './mcpServer';
import { extraCorsOriginsFromEnv, isAllowedOrigin } from './origins';
import { clientKeyFromRequest, consumeServerRateLimit, RATE_LIMITS, RateLimitDecision } from './rateLimit';

export interface PublicApiDeps {
  verifyApiKey: (secret: string) => Promise<ApiKeyRecord | null>;
  consumeRateLimit: (clientKey: string) => Promise<RateLimitDecision>;
  memories: MemoryApi;
  memoriesForTeamGrant?: (key: ApiKeyRecord) => MemoryApi;
  agentMutations?: AgentMutationApi;
  touchLastUsed: (key: ApiKeyRecord) => Promise<void>;
  issueAgentSession?: typeof issueAgentSession;
  redeemAgentAuthorizationCode?: typeof redeemAgentAuthorizationCode;
  consumeTokenRateLimit?: (clientKey: string) => Promise<RateLimitDecision>;
}

const defaultDeps = (): PublicApiDeps => ({
  verifyApiKey: verifyGatewayBearer,
  issueAgentSession,
  redeemAgentAuthorizationCode,
  consumeTokenRateLimit: key => consumeServerRateLimit(key, { bucket: 'agent-token', max: 30, windowMs: 60_000 }),
  consumeRateLimit: (clientKey) => consumeServerRateLimit(clientKey, RATE_LIMITS.publicApi),
  memories: createFirestoreMemoryApi(),
  memoriesForTeamGrant: key => createTeamAgentMemoryApi(key),
  agentMutations: createAgentMutationApi(),
  touchLastUsed: (key) => key.credentialKind === 'agent-grant' ? Promise.resolve() : touchApiKeyLastUsed(key.id, key.lastUsedAt),
});

const CORS_HEADERS = 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version';

export function applyPublicApiCors(
  req: { headers?: Record<string, unknown> },
  res: { set: (field: string, value: string) => unknown },
): { allowed: boolean; origin: string } {
  const origin = String(req.headers?.origin || req.headers?.Origin || '');
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', CORS_HEADERS);
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Expose-Headers', 'X-RateLimit-Remaining, Retry-After');
  res.set('Access-Control-Max-Age', '86400');
  if (!origin) return { allowed: true, origin: '' };
  if (!isAllowedOrigin(origin, extraCorsOriginsFromEnv())) {
    return { allowed: false, origin };
  }
  res.set('Access-Control-Allow-Origin', origin);
  return { allowed: true, origin };
}

export function requestPath(req: {
  url?: string;
  path?: string;
  originalUrl?: string;
  headers?: Record<string, unknown>;
}): string {
  const headerPath = req.headers?.['x-forwarded-uri'] || req.headers?.['x-original-url'];
  const raw = String(req.originalUrl || req.url || req.path || headerPath || '/');
  let path = raw.split('?')[0] || '/';
  path = path.replace(/^\/publicApi(?=\/|$)/, '') || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

function queryValue(query: Record<string, unknown> | undefined, name: string): string {
  const value = query?.[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function parseCsv(value: string): string[] {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function parseQueryEmbedding(raw: string): number[] {
  if (!raw.trim()) return [];
  if (raw.trim().startsWith('[')) return parseEmbedding(raw);
  return parseEmbedding(raw.split(',').map((part) => Number(part.trim())));
}

export function isMcpPath(path: string): boolean {
  return path === '/mcp' || path === '/api/mcp' || path === '/api/v1/mcp';
}

function scopeDenied(res: functions.Response, scope: ApiScope): void {
  res.status(403).json({
    error: 'forbidden',
    detail: `API key missing scope ${scope}`,
    scope,
  });
}

export async function publicApiHandler(
  req: functions.Request,
  res: functions.Response,
  deps: PublicApiDeps = defaultDeps(),
): Promise<void> {
  const cors = applyPublicApiCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(cors.allowed ? 204 : 403).send('');
    return;
  }
  if (!cors.allowed) {
    res.status(403).json({ error: 'origin_not_allowed', detail: 'CORS origin is not on the product allowlist.' });
    return;
  }

  const path = requestPath(req);

  if (path === '/api/v1/oauth/token') {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    if (!deps.redeemAgentAuthorizationCode || !deps.consumeTokenRateLimit) {
      res.status(503).json({ error: 'temporarily_unavailable' }); return;
    }
    try {
      const rate = await deps.consumeTokenRateLimit(clientKeyFromRequest(req));
      if (!rate.allowed) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))));
        res.status(429).json({ error: 'temporarily_unavailable' }); return;
      }
      const issued = await deps.redeemAgentAuthorizationCode(req.body);
      res.status(200).json(issued);
    } catch { res.status(400).json({ error: 'invalid_grant' }); }
    return;
  }

  if (req.method === 'GET' && isMcpPath(path) && !extractBearerToken(req)) {
    res.status(200).json({ ok: true, name: MCP_HEALTH.name, version: MCP_HEALTH.version });
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'unauthenticated',
      detail: 'Authorization: Bearer mne_live_… is required.',
    });
    return;
  }

  const key = await deps.verifyApiKey(token);
  if (!key) {
    res.status(401).json({ error: 'unauthenticated', detail: 'Invalid or revoked API key.' });
    return;
  }
  let vault;
  try {
    vault = parseAgentVaultAdmission(key.vault, true);
    if (vault.kind === 'team' && key.credentialKind !== 'agent-grant') throw new AccountUnavailableError();
  } catch {
    res.status(403).json({ error: 'account_unavailable', detail: 'Account unavailable.' }); return;
  }
  // Capture immutable authority before awaiting a read. Revalidate before exposing its result.
  const authority = (value: ApiKeyRecord) => JSON.stringify([value.id, value.uid, value.keyPrefix,
    value.credentialKind ?? null, [...value.scopes].sort(), agentVaultAdmissionBytes(parseAgentVaultAdmission(value.vault, true))]);
  const expectedAuthority = authority(key);
  const revalidate = async () => {
    try {
      const current = await deps.verifyApiKey(token);
      if (!current || authority(current) !== expectedAuthority) throw new AccountUnavailableError();
    } catch { throw new AccountUnavailableError(); }
  };

  const rate = await deps.consumeRateLimit(`apikey:${key.id}`);
  res.set('X-RateLimit-Remaining', String(rate.remaining));
  if (!rate.allowed) {
    const retrySec = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    res.set('Retry-After', String(retrySec));
    res.status(429).json({
      error: 'rate_limited',
      detail: 'Rate limit exceeded for this API key.',
      retry_after_ms: rate.retryAfterMs,
    });
    return;
  }

  void deps.touchLastUsed(key);

  try {
    if (path === '/api/v1/agent/session' && req.method === 'POST') {
      res.set('Cache-Control', 'no-store');
      res.set('Pragma', 'no-cache');
      if (token.startsWith(AGENT_TOKEN_PREFIX) || key.credentialKind === 'agent-grant') {
        res.status(403).json({ error: 'delegation_not_allowed' });
        return;
      }
      if (!deps.issueAgentSession) { res.status(503).json({ error: 'unavailable' }); return; }
      try {
        const issued = await deps.issueAgentSession(key, req.body?.scopes);
        res.status(200).json(issued);
      } catch {
        res.status(403).json({ error: 'agent_session_denied' });
      }
      return;
    }
    if (['/api/v1/agent/changes/prepare', '/api/v1/agent/changes/propose', '/api/v1/agent/changes/status'].includes(path)) {
      res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache');
      if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
      if (!keyHasScope(key, 'memories:write')) return scopeDenied(res, 'memories:write');
      if (!deps.agentMutations) { res.status(503).json({ error: 'change_unavailable' }); return; }
      try {
        const mode = path.slice(path.lastIndexOf('/') + 1);
        if (mode !== 'status' && !deps.agentMutations.enabled) { res.status(503).json({ error: 'change_unavailable' }); return; }
        const result = mode === 'prepare' ? await deps.agentMutations.prepare(key, req.body) :
          mode === 'propose' ? await deps.agentMutations.propose(key, req.body) : await deps.agentMutations.status(key, req.body);
        if (mode !== 'propose') await revalidate();
        res.status(mode === 'propose' ? 202 : 200).json(result);
      } catch (error) {
        const code = error instanceof functions.https.HttpsError ? error.code : '';
        res.status(error instanceof AccountUnavailableError || code === 'permission-denied' || code === 'unauthenticated' ? 403 :
          code === 'invalid-argument' ? 400 : code === 'resource-exhausted' ? 429 : code === 'aborted' || code === 'already-exists' || code === 'failed-precondition' ? 409 : 500)
          .json({ error: 'change_unavailable' });
      }
      return;
    }
    const backend = vault.kind === 'team' ? deps.memoriesForTeamGrant?.(key) : deps.memories;
    if (!backend) throw new AccountUnavailableError();
    const read = async <T>(operation: () => Promise<T>): Promise<T> => {
      const result = await operation();
      await revalidate();
      return result;
    };
    const memories: MemoryApi = {
      list: (uid, opts) => read(() => backend.list(uid, opts)), get: (uid, id) => read(() => backend.get(uid, id)),
      search: (uid, opts) => read(() => backend.search(uid, opts)), create: (uid, input) => backend.create(uid, input),
    };
    const agentMutations = deps.agentMutations ? { ...deps.agentMutations,
      prepare: async (current: ApiKeyRecord, value: unknown) => { const result = await deps.agentMutations!.prepare(current, value); await revalidate(); return result; },
      status: async (current: ApiKeyRecord, value: unknown) => { const result = await deps.agentMutations!.status(current, value); await revalidate(); return result; },
    } : undefined;
    if (isMcpPath(path)) {
      if (req.method === 'GET') {
        res.status(200).json({
          ...MCP_HEALTH,
          tools: listMcpToolsForKey(key, agentMutations).map((tool) => tool.name),
        });
        return;
      }
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'method_not_allowed' });
        return;
      }
      const rpc = await handleMcpRpc(req.body, { key, memories, agentMutations });
      if (rpc.status === 204) {
        res.status(204).send('');
        return;
      }
      res.status(rpc.status).json(rpc.payload);
      return;
    }

    if (path === '/api/v1/memories' && req.method === 'GET') {
      if (!keyHasScope(key, 'memories:read')) return scopeDenied(res, 'memories:read');
      const listed = await memories.list(key.uid, {
        limit: clampLimit(queryValue(req.query as Record<string, unknown>, 'limit'), 50, 100),
        startAfter: queryValue(req.query as Record<string, unknown>, 'startAfter') || undefined,
      });
      res.status(200).json(listed);
      return;
    }

    const memoryIdMatch = /^\/api\/v1\/memories\/([^/]+)$/.exec(path);
    if (memoryIdMatch && req.method === 'GET') {
      if (!keyHasScope(key, 'memories:read')) return scopeDenied(res, 'memories:read');
      const id = decodeURIComponent(memoryIdMatch[1]);
      const memory = await memories.get(key.uid, id);
      if (!memory) {
        res.status(404).json({ error: 'not_found', detail: 'Memory not found.' });
        return;
      }
      res.status(200).json(memory);
      return;
    }

    if (path === '/api/v1/memories' && req.method === 'POST') {
      res.status(403).json({ error: 'write_paused', detail: 'Direct memory writes are retired; use a reviewed proposal.' });
      return;
    }

    if (path === '/api/v1/search' && req.method === 'GET') {
      if (!keyHasScope(key, 'memories:search')) return scopeDenied(res, 'memories:search');
      const q = queryValue(req.query as Record<string, unknown>, 'q');
      const embedding = parseQueryEmbedding(queryValue(req.query as Record<string, unknown>, 'embedding'));
      const searched = await memories.search(key.uid, {
        q,
        tags: parseCsv(queryValue(req.query as Record<string, unknown>, 'tags')),
        ids: parseCsv(queryValue(req.query as Record<string, unknown>, 'ids')),
        embedding: embedding.length ? embedding : undefined,
        embeddingModel: queryValue(req.query as Record<string, unknown>, 'embeddingModel'),
        limit: clampLimit(queryValue(req.query as Record<string, unknown>, 'limit'), 20, 20),
      });
      res.status(200).json(searched);
      return;
    }

    res.status(404).json({ error: 'not_found', detail: `No route for ${req.method} ${path}` });
  } catch (error) {
    if (error instanceof AccountUnavailableError) {
      res.status(403).json({ error: 'account_unavailable', detail: 'Account unavailable.' });
      return;
    }
    // Errors from upstream services may contain bearer tokens or query text.
    console.error('publicApiHandler failed');
    res.status(500).json({ error: 'internal', detail: 'Internal error' });
  }
}

export const publicApi = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https
  .onRequest(publicApiHandler);
