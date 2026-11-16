import { describe, expect, it } from 'vitest';
import {
  API_KEY_SECRET_PREFIX,
  API_SCOPES,
  PUBLIC_MCP_URL,
  PUBLIC_MEMORIES_URL,
  buildMcpConfigJson,
  buildRestAuthHeader,
  formatApiKeyLastUsed,
  formatApiKeyPrefix,
  formatApiKeyScopes,
  formatApiKeyStatus,
  isApiScope,
  parseApiScopes,
} from './apiKeys';

describe('formatApiKeyPrefix', () => {
  it('appends an ellipsis to a live prefix', () => {
    expect(formatApiKeyPrefix('mne_live_abcd123')).toBe('mne_live_abcd123…');
  });

  it('falls back to the secret prefix when empty', () => {
    expect(formatApiKeyPrefix('')).toBe(`${API_KEY_SECRET_PREFIX}…`);
    expect(formatApiKeyPrefix('   ')).toBe(`${API_KEY_SECRET_PREFIX}…`);
  });

  it('does not double the ellipsis', () => {
    expect(formatApiKeyPrefix('mne_live_abcd…')).toBe('mne_live_abcd…');
    expect(formatApiKeyPrefix('mne_live_abcd...')).toBe('mne_live_abcd…');
  });
});

describe('formatApiKeyScopes', () => {
  it('maps known scopes to Portuguese labels', () => {
    expect(formatApiKeyScopes(['memories:read', 'memories:write'])).toBe('leitura, escrita');
    expect(formatApiKeyScopes(['memories:search'])).toBe('pesquisa');
    expect(formatApiKeyScopes([...API_SCOPES])).toBe('leitura, escrita, pesquisa');
  });

  it('returns an em dash for an empty list', () => {
    expect(formatApiKeyScopes([])).toBe('—');
  });

  it('keeps unknown scopes as-is', () => {
    expect(formatApiKeyScopes(['memories:read', 'admin:all'])).toBe('leitura, admin:all');
  });
});

describe('formatApiKeyLastUsed / status', () => {
  const now = Date.parse('2026-08-31T12:00:00Z');

  it('says never used when lastUsedAt is missing', () => {
    expect(formatApiKeyLastUsed(null, now)).toBe('nunca usada');
    expect(formatApiKeyLastUsed(0, now)).toBe('nunca usada');
  });

  it('formats recent relative times', () => {
    expect(formatApiKeyLastUsed(now - 30_000, now)).toBe('agora mesmo');
    expect(formatApiKeyLastUsed(now - 5 * 60_000, now)).toBe('há 5 min');
    expect(formatApiKeyLastUsed(now - 3 * 3_600_000, now)).toBe('há 3 h');
    expect(formatApiKeyLastUsed(now - 2 * 86_400_000, now)).toBe('há 2 d');
  });

  it('labels revoked vs active', () => {
    expect(formatApiKeyStatus(false)).toBe('ativa');
    expect(formatApiKeyStatus(true)).toBe('revogada');
  });
});

describe('scope helpers and snippets', () => {
  it('recognises only the three public scopes', () => {
    expect(isApiScope('memories:read')).toBe(true);
    expect(isApiScope('memories:admin')).toBe(false);
    expect(parseApiScopes(['memories:write', 'nope', 1])).toEqual(['memories:write']);
  });

  it('builds REST Bearer header and MCP JSON', () => {
    expect(buildRestAuthHeader()).toBe(`Authorization: Bearer ${API_KEY_SECRET_PREFIX}…`);
    expect(buildRestAuthHeader('mne_live_secret')).toBe('Authorization: Bearer mne_live_secret');
    expect(PUBLIC_MEMORIES_URL).toBe('https://mnemosyne-one.web.app/api/v1/memories');

    const mcp = JSON.parse(buildMcpConfigJson('mne_live_secret')) as {
      url: string;
      headers: { Authorization: string };
    };
    expect(mcp.url).toBe(PUBLIC_MCP_URL);
    expect(mcp.headers.Authorization).toBe('Bearer mne_live_secret');
  });
});
