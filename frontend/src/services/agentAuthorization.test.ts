import { expect, it, vi } from 'vitest';
import { parseAgentAuthorizationParams, validateAgentCallback } from './agentAuthorization';
vi.mock('../firebase', () => ({ default: {}, auth: {} }));
const request = { response_type: 'code', client_id: 'synthetic-client', redirect_uri: 'https://client.example/callback?label=a%20b',
  scope: 'memories:read', state: 'synthetic-state-0123456789', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256' };
const params = new URLSearchParams(request).toString();
it('rejects missing, duplicate and unknown authorization parameters', () => {
  expect(parseAgentAuthorizationParams(params)).toEqual(request);
  expect(parseAgentAuthorizationParams(params + '&client_id=other')).toBeNull();
  expect(parseAgentAuthorizationParams(params + '&unexpected=x')).toBeNull();
  expect(parseAgentAuthorizationParams('client_id=only')).toBeNull();
  expect(parseAgentAuthorizationParams(params + '&vault=team%3Acrew')).toEqual({ ...request, vault: 'team:crew' });
  for (const suffix of ['&vault=', '&vault=*', '&vault=team%3A', '&vault=team%3A..%2Fcrew', '&vault=personal&vault=team%3Acrew']) expect(parseAgentAuthorizationParams(params + suffix)).toBeNull();
});
it('validates exact callback destination, state, issuer and one response before navigating', () => {
  const url = new URL(request.redirect_uri);
  url.searchParams.set('state', request.state);
  url.searchParams.set('iss', 'https://mnemosyne-one.web.app');
  url.searchParams.set('code', 'mne_code_' + 'B'.repeat(43));
  expect(validateAgentCallback(url.toString(), request, request.redirect_uri)).toBe(url.toString());
  for (const [field, value] of [['state', 'wrong'], ['iss', 'https://attacker.example'], ['code', 'bad'], ['error', 'access_denied']]) {
    const changed = new URL(url); changed.searchParams.set(field, value);
    expect(() => validateAgentCallback(changed.toString(), request, request.redirect_uri)).toThrow();
  }
  for (const changed of [url.toString().replace('client.example', 'attacker.example'), url.toString() + '&state=second', url.toString() + '&extra=x']) {
    expect(() => validateAgentCallback(changed, request, request.redirect_uri)).toThrow();
  }
  url.searchParams.delete('code'); url.searchParams.set('error', 'access_denied');
  expect(validateAgentCallback(url.toString(), request, request.redirect_uri)).toBe(url.toString());
});

it('requires the distinct team code prefix and cannot exchange personal and team callback authority', () => {
  const team = { ...request, vault: 'team:crew' }, url = new URL(request.redirect_uri);
  url.searchParams.set('state', request.state); url.searchParams.set('iss', 'https://mnemosyne-one.web.app');
  url.searchParams.set('code', 'mne_vault_code_' + 'B'.repeat(43));
  expect(validateAgentCallback(url.toString(), team, request.redirect_uri)).toBe(url.toString());
  expect(() => validateAgentCallback(url.toString(), request, request.redirect_uri)).toThrow();
  url.searchParams.set('code', 'mne_code_' + 'B'.repeat(43));
  expect(() => validateAgentCallback(url.toString(), team, request.redirect_uri)).toThrow();
});
