import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebase';
import { withAgentAccount } from './agentAccount';
import { agentCodePrefix, agentVaultSelector, parseAgentVaultSelector } from '../../../functions/src/agentVaultContract';

export interface AgentAuthorizationRequest {
  response_type: string; client_id: string; redirect_uri: string; scope: string;
  state: string; code_challenge: string; code_challenge_method: string;
  vault?: string;
}
export interface AgentConsentPreview {
  clientName: string; redirectUri: string; scopes: string[]; consentDigest: string; denialUrl: string;
  vault?: string; vaultName?: string | null;
}
const fields = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method'] as const;
export function parseAgentAuthorizationParams(search: string): AgentAuthorizationRequest | null {
  const params = new URLSearchParams(search);
  if (fields.some(field => params.getAll(field).length !== 1) || params.getAll('vault').length > 1 ||
    [...params.keys()].some(field => field !== 'vault' && !fields.includes(field as typeof fields[number]))) return null;
  try {
    const request = Object.fromEntries(fields.map(field => [field, params.get(field)!])) as unknown as AgentAuthorizationRequest;
    if (params.has('vault')) request.vault = agentVaultSelector(parseAgentVaultSelector(params.get('vault')));
    return request;
  } catch { return null; }
}
export async function previewAgentAuthorization(request: AgentAuthorizationRequest, uid: string): Promise<AgentConsentPreview> {
  const command = { ...request, expectedUid: uid };
  return withAgentAccount(uid, async guard => {
    guard();
    const data = (await httpsCallable<typeof command, AgentConsentPreview>(getFunctions(app, 'europe-west1'), 'previewAgentAuthorization')(command)).data;
    guard();
    const vault = agentVaultSelector(parseAgentVaultSelector(command.vault));
    if (!data || (data.vault === undefined ? vault !== 'personal' : data.vault !== vault) ||
      data.vaultName !== undefined && data.vaultName !== null && (typeof data.vaultName !== 'string' || data.vaultName.length > 200)) throw new Error('Invalid agent vault preview');
    return { ...data, vault, vaultName: data.vaultName ?? null };
  });
}
export async function authorizeAgentClient(request: AgentAuthorizationRequest, uid: string, consentDigest: string) {
  const command = { ...request, expectedUid: uid, confirmed: true as const, consentDigest };
  return withAgentAccount(uid, async guard => {
    guard();
    const response = await httpsCallable<typeof command, { redirectUrl: string }>(getFunctions(app, 'europe-west1'), 'authorizeAgentClient')(command);
    guard(); return response.data.redirectUrl;
  });
}
/** Only a callback matching the server preview and the original state may navigate. */
export function validateAgentCallback(raw: string, request: AgentAuthorizationRequest, destination: string): string {
  const callback = new URL(raw);
  const original = new URL(destination);
  const codePattern = new RegExp(`^${agentCodePrefix(parseAgentVaultSelector(request.vault), request.scope.split(' '))}[A-Za-z0-9_-]{43}$`);
  if (callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== request.state ||
      callback.searchParams.getAll('iss').length !== 1 || callback.searchParams.get('iss') !== 'https://mnemosyne-one.web.app' ||
      !(callback.searchParams.has('code') !== callback.searchParams.has('error')) ||
      (callback.searchParams.has('code') && (callback.searchParams.getAll('code').length !== 1 || !codePattern.test(callback.searchParams.get('code')!))) ||
      (callback.searchParams.has('error') && (callback.searchParams.getAll('error').length !== 1 || callback.searchParams.get('error') !== 'access_denied'))) throw new Error('Invalid callback');
  for (const field of ['code', 'error', 'state', 'iss']) callback.searchParams.delete(field);
  original.search = original.searchParams.toString();
  if (callback.toString() !== original.toString() || callback.protocol !== 'https:') throw new Error('Invalid callback');
  return raw;
}
export function navigateAgentCallback(raw: string, request: AgentAuthorizationRequest, destination: string) {
  window.location.replace(validateAgentCallback(raw, request, destination));
}
export interface AgentGrant { id: string; clientId: string; name: string; scopes: string[]; createdAt: number; vault?: string; vaultName?: string | null }
export async function listAgentGrants(uid: string): Promise<AgentGrant[]> {
  return withAgentAccount(uid, async guard => {
    guard();
    return (await httpsCallable<{ expectedUid: string }, { grants: AgentGrant[] }>(getFunctions(app, 'europe-west1'), 'listAgentGrants')({ expectedUid: uid })).data.grants;
  });
}
export async function revokeAgentGrant(grantId: string, uid: string) {
  return withAgentAccount(uid, async guard => {
    guard(); await httpsCallable(getFunctions(app, 'europe-west1'), 'revokeAgentGrant')({ grantId, expectedUid: uid }); guard();
  });
}
