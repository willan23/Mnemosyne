import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase';

export const API_SCOPES = ['memories:read', 'memories:write', 'memories:search'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const MAX_ACTIVE_API_KEYS = 10;
export const API_KEY_SECRET_PREFIX = 'mne_live_';
export const PUBLIC_API_BASE = 'https://mnemosyne-one.web.app/api/v1';
export const PUBLIC_MEMORIES_URL = `${PUBLIC_API_BASE}/memories`;
export const PUBLIC_MCP_URL = `${PUBLIC_API_BASE}/mcp`;

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'memories:read': 'leitura',
  'memories:write': 'escrita',
  'memories:search': 'pesquisa',
};

export interface ApiKeyListItem {
  id: string;
  keyPrefix: string;
  name: string;
  scopes: ApiScope[];
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
}

export interface CreatedApiKey extends ApiKeyListItem {
  secret: string;
}

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

export function formatApiKeyPrefix(keyPrefix: string): string {
  const trimmed = keyPrefix.trim();
  if (!trimmed) return `${API_KEY_SECRET_PREFIX}…`;
  if (trimmed.endsWith('…') || trimmed.endsWith('...')) return trimmed.replace(/\.{3}$/, '…');
  return `${trimmed}…`;
}

export function formatApiKeyScopes(scopes: readonly string[]): string {
  if (!scopes.length) return '—';
  return scopes
    .map((scope) => (isApiScope(scope) ? API_SCOPE_LABELS[scope] : scope))
    .join(', ');
}

export function formatApiKeyLastUsed(lastUsedAt: number | null, now = Date.now()): string {
  if (lastUsedAt == null || lastUsedAt <= 0) return 'nunca usada';
  const diff = now - lastUsedAt;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  if (hours < 24) return `há ${hours} h`;
  if (days < 7) return `há ${days} d`;
  return new Date(lastUsedAt).toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatApiKeyStatus(revoked: boolean): string {
  return revoked ? 'revogada' : 'ativa';
}

export function buildRestAuthHeader(secret = `${API_KEY_SECRET_PREFIX}…`): string {
  return `Authorization: Bearer ${secret}`;
}

export function buildRestSnippet(secret = `${API_KEY_SECRET_PREFIX}…`): string {
  return [
    `curl ${PUBLIC_MEMORIES_URL} \\`,
    `  -H "${buildRestAuthHeader(secret)}"`,
  ].join('\n');
}

export function buildMcpConfigJson(secret = `${API_KEY_SECRET_PREFIX}…`): string {
  return JSON.stringify(
    {
      url: PUBLIC_MCP_URL,
      headers: { Authorization: `Bearer ${secret}` },
    },
    null,
    2,
  );
}

export function parseApiScopes(raw: unknown): ApiScope[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isApiScope);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function parseListItem(value: unknown): ApiKeyListItem | null {
  const data = asRecord(value);
  const id = typeof data.id === 'string' ? data.id : '';
  if (!id) return null;
  return {
    id,
    keyPrefix: typeof data.keyPrefix === 'string' ? data.keyPrefix : API_KEY_SECRET_PREFIX,
    name: typeof data.name === 'string' ? data.name : '',
    scopes: parseApiScopes(data.scopes),
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    lastUsedAt: typeof data.lastUsedAt === 'number' ? data.lastUsedAt : null,
    revoked: data.revoked === true,
  };
}

function parseCreatedKey(value: unknown): CreatedApiKey {
  const item = parseListItem(value);
  const secret = typeof asRecord(value).secret === 'string' ? String(asRecord(value).secret) : '';
  if (!item || !secret) {
    throw new Error('Resposta inválida ao criar a API key.');
  }
  return { ...item, secret };
}

export function apiKeyErrorMessage(error: unknown, fallback: string): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: string }).code || '')
    : '';
  if (code.includes('unauthenticated')) return 'Inicia sessão para gerir API keys.';
  if (code.includes('resource-exhausted')) {
    return `Máximo de ${MAX_ACTIVE_API_KEYS} chaves ativas. Revoga uma antes de criar outra.`;
  }
  if (code.includes('not-found')) return 'API key não encontrada.';
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function apiFunctions() {
  return getFunctions(app, 'europe-west1');
}

export async function createApiKey(name: string, scopes?: ApiScope[]): Promise<CreatedApiKey> {
  const callable = httpsCallable(apiFunctions(), 'createApiKey');
  const payload: { name: string; scopes?: ApiScope[] } = { name: name.trim() };
  if (scopes && scopes.length > 0) payload.scopes = scopes;
  const result = await callable(payload);
  return parseCreatedKey(result.data);
}

export async function listApiKeys(): Promise<ApiKeyListItem[]> {
  const callable = httpsCallable(apiFunctions(), 'listApiKeys');
  const result = await callable();
  const keys = asRecord(result.data).keys;
  if (!Array.isArray(keys)) return [];
  return keys.map(parseListItem).filter((item): item is ApiKeyListItem => item !== null);
}

export async function revokeApiKey(keyId: string): Promise<void> {
  const callable = httpsCallable(apiFunctions(), 'revokeApiKey');
  await callable({ keyId });
}
