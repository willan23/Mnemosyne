/**
 * P2 · Vault de equipa E2EE (cliente).
 *
 * A teamKey é AES-GCM-256 gerada no owner. O servidor só guarda blobs
 * wrapped com RSA-OAEP (a mesma chave pública de Comms em publicProfiles).
 *
 * Memórias de equipa (`sessions.teamId`):
 *   - Schema idêntico às memórias pessoais: `enc: { v: 1, iv, ct }`
 *   - `text: ''` e `title: null` em claro
 *   - A chave é a teamKey, NÃO a mnemónica pessoal
 *   - Quem lê com memoryCrypto (chave pessoal) vê o placeholder de locked —
 *     é preciso unwrap da teamKey e `decryptTeamMemoryEnvelope`
 *
 * MVP: wrap RSA-OAEP da teamKey (raw 32 bytes em base64). Sem chave pública
 * RSA no perfil do convite, o convite é recusado.
 */

import {
  decryptTextAesGcm,
  encryptTextAesGcm,
  exportPublicKey,
  generateRSAKeyPair,
  importPublicKey,
  rsaDecrypt,
  rsaEncrypt,
} from '../utils/crypto';

export const TEAM_KEY_ALG = 'RSA-OAEP' as const;
export const TEAM_KEY_WRAP_VERSION = 1 as const;
export const TEAM_ENC_VERSION = 2 as const;
export const MAX_TEAM_MEMBERS = 10;

export interface WrappedTeamKeyEnvelope {
  v: typeof TEAM_KEY_WRAP_VERSION;
  alg: typeof TEAM_KEY_ALG;
  ct: string;
}

export interface LegacyTeamMemoryEnvelope {
  v: 1;
  iv: string;
  ct: string;
}

export interface TeamMemoryEnvelopeV2 {
  v: typeof TEAM_ENC_VERSION;
  iv: string;
  ct: string;
}

export type TeamMemoryEnvelope = LegacyTeamMemoryEnvelope | TeamMemoryEnvelopeV2;

export interface TeamMemoryContext {
  teamId: string;
  keyEpoch: number;
  keyId: string;
}

export interface TeamMemoryFields {
  text: '';
  title: null;
  enc: TeamMemoryEnvelopeV2;
  teamId: string;
  keyEpoch: number;
  keyId: string;
}

const FORBIDDEN_WRAP_KEYS = ['teamKey', 'key', 'plaintext', 'raw', 'secret', 'mnemonic', 'privateKey'];

const teamKeyCache = new Map<string, Map<number, CryptoKey>>();
let teamKeyCacheGeneration = 0;
const TEAM_KEY_EVENT = 'mnemosyne:team-key-changed';

function emitTeamKeyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TEAM_KEY_EVENT));
  }
}

export function notifyTeamKeysUpdated(): void {
  emitTeamKeyChanged();
}

export function onTeamKeyChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(TEAM_KEY_EVENT, callback);
  return () => window.removeEventListener(TEAM_KEY_EVENT, callback);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function isWrappedTeamKeyEnvelope(value: unknown): value is WrappedTeamKeyEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.some((key) => FORBIDDEN_WRAP_KEYS.includes(key))) return false;
  if (keys.some((key) => !['v', 'alg', 'ct'].includes(key))) return false;
  return rec.v === TEAM_KEY_WRAP_VERSION
    && rec.alg === TEAM_KEY_ALG
    && typeof rec.ct === 'string'
    && rec.ct.trim().length >= 16;
}

export function wrappedTeamKeyLeaksPlaintext(
  envelope: WrappedTeamKeyEnvelope,
  plaintext: string,
): boolean {
  if (!plaintext) return false;
  return JSON.stringify(envelope).includes(plaintext);
}

export function cacheTeamKey(teamId: string, key: CryptoKey, notify = true): void {
  cacheTeamKeyEpoch(teamId, 1, key, notify);
}

export function cacheTeamKeyEpoch(teamId: string, epoch: number, key: CryptoKey, notify = true): void {
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error('Época de chave inválida.');
  const epochs = teamKeyCache.get(teamId) ?? new Map<number, CryptoKey>();
  epochs.set(epoch, key);
  teamKeyCache.set(teamId, epochs);
  if (notify) emitTeamKeyChanged();
}

export function getCachedTeamKey(teamId: string, epoch = 1): CryptoKey | null {
  return teamKeyCache.get(teamId)?.get(epoch) ?? null;
}

export function getTeamKeyCacheGeneration(): number {
  return teamKeyCacheGeneration;
}

export function clearTeamKeyCache(teamId?: string, notify = true): void {
  teamKeyCacheGeneration += 1;
  if (teamId) teamKeyCache.delete(teamId);
  else teamKeyCache.clear();
  if (notify) emitTeamKeyChanged();
}

export async function generateTeamKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/** PEM is case-sensitive; normalize line endings only, never the Base64 letters. */
export async function fingerprintTeamPublicKey(pem: string): Promise<string> {
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(pem.trim().replace(/\r\n/g, '\n')));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function exportTeamKeyPlaintext(teamKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await window.crypto.subtle.exportKey('raw', teamKey));
  return bytesToBase64(raw);
}

export async function importTeamKeyPlaintext(plaintext: string): Promise<CryptoKey> {
  const raw = base64ToBytes(plaintext);
  const copy = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return window.crypto.subtle.importKey(
    'raw',
    copy,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapTeamKeyForPublicPem(
  teamKey: CryptoKey,
  publicKeyPem: string,
): Promise<WrappedTeamKeyEnvelope> {
  const plaintext = await exportTeamKeyPlaintext(teamKey);
  const publicKey = await importPublicKey(publicKeyPem);
  const ct = await rsaEncrypt(plaintext, publicKey);
  const envelope: WrappedTeamKeyEnvelope = {
    v: TEAM_KEY_WRAP_VERSION,
    alg: TEAM_KEY_ALG,
    ct,
  };
  if (wrappedTeamKeyLeaksPlaintext(envelope, plaintext)) {
    throw new Error('Falha a embrulhar a teamKey: o envelope não pode conter a chave em claro.');
  }
  return envelope;
}

export async function unwrapTeamKeyWithPrivateKey(
  envelope: WrappedTeamKeyEnvelope,
  privateKey: CryptoKey,
): Promise<CryptoKey> {
  if (!isWrappedTeamKeyEnvelope(envelope)) {
    throw new Error('Envelope da teamKey inválido.');
  }
  const plaintext = await rsaDecrypt(envelope.ct, privateKey);
  return importTeamKeyPlaintext(plaintext);
}

export async function wrapTeamKeyForIdentity(
  teamKey: CryptoKey,
  identity: { publicKey: CryptoKey },
): Promise<WrappedTeamKeyEnvelope> {
  const pem = await exportPublicKey(identity.publicKey);
  return wrapTeamKeyForPublicPem(teamKey, pem);
}

function memoryPayload(fields: { text: string; title?: string | null }): string {
  const payload = {
    text: fields.text ?? '',
    title: fields.title?.trim() ? fields.title : null,
  };
  return JSON.stringify(payload);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function contextAad(context: TeamMemoryContext): ArrayBuffer {
  if (!context.teamId.trim() || !Number.isSafeInteger(context.keyEpoch) || context.keyEpoch < 1 ||
      !context.keyId.trim()) throw new Error('Contexto de chave de equipa inválido.');
  return toArrayBuffer(new TextEncoder().encode(JSON.stringify({
    teamId: context.teamId, keyEpoch: context.keyEpoch, keyId: context.keyId,
  })));
}

export function isTeamMemoryEnvelope(value: unknown): value is TeamMemoryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (data.v === 1 || data.v === TEAM_ENC_VERSION) &&
    Object.keys(data).every((key) => ['v', 'iv', 'ct'].includes(key)) &&
    typeof data.iv === 'string' && data.iv.trim().length > 0 &&
    typeof data.ct === 'string' && data.ct.trim().length > 0;
}

/** Explicit legacy helper, for reading old documents and compatibility tests. */
export async function encryptLegacyTeamMemoryFields(
  teamKey: CryptoKey,
  fields: { text: string; title?: string | null },
): Promise<LegacyTeamMemoryEnvelope> {
  const sealed = await encryptTextAesGcm(memoryPayload(fields), teamKey);
  return { v: 1, iv: sealed.iv, ct: sealed.data };
}

/** v2 binds the ciphertext to team, epoch, and key ID with AES-GCM AAD. */
export async function encryptTeamMemoryFields(
  teamKey: CryptoKey,
  fields: { text: string; title?: string | null },
  context: TeamMemoryContext,
): Promise<TeamMemoryEnvelopeV2> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: contextAad(context) },
    teamKey, toArrayBuffer(new TextEncoder().encode(memoryPayload(fields))),
  );
  return { v: TEAM_ENC_VERSION, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(encrypted)) };
}

/** Exact serialized payload for cryptographic maintenance; does not normalize fields. */
export async function decryptTeamMemoryPayload(
  teamKey: CryptoKey,
  envelope: TeamMemoryEnvelope,
  context?: TeamMemoryContext,
  options?: { strictPayload?: boolean },
): Promise<string> {
  if (!isTeamMemoryEnvelope(envelope)) throw new Error('Envelope de memória de equipa inválido.');
  let plaintext: string;
  if (envelope.v === 1) {
    plaintext = await decryptTextAesGcm({ iv: envelope.iv, data: envelope.ct }, teamKey);
  } else {
    if (!context) throw new Error('Contexto de chave necessário para envelope v2.');
    const opened = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(envelope.iv)), additionalData: contextAad(context) },
      teamKey, toArrayBuffer(base64ToBytes(envelope.ct)),
    );
    plaintext = new TextDecoder().decode(opened);
  }
  const parsed = JSON.parse(plaintext) as { text?: unknown; title?: unknown };
  if (options?.strictPayload && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      typeof parsed.text !== 'string' || (parsed.title !== undefined && parsed.title !== null && typeof parsed.title !== 'string') ||
      Object.keys(parsed).some(key => !['text', 'title'].includes(key)))) {
    throw new Error('Conteúdo cifrado incompatível com a recifragem.');
  }
  return plaintext;
}

export async function decryptTeamMemoryEnvelope(
  teamKey:CryptoKey,envelope:TeamMemoryEnvelope,context?:TeamMemoryContext,options?:{strictPayload?:boolean},
):Promise<{text:string;title:string|null}>{
  const parsed=JSON.parse(await decryptTeamMemoryPayload(teamKey,envelope,context,options)) as {text?:unknown;title?:unknown};
  return {
    text: typeof parsed.text === 'string' ? parsed.text : '',
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : null,
  };
}

/** Preserve the exact valid legacy JSON while moving it to the current AAD context. */
export async function recipherTeamMemoryEnvelope(sourceKey:CryptoKey,envelope:TeamMemoryEnvelope,sourceContext:TeamMemoryContext|undefined,targetKey:CryptoKey,targetContext:TeamMemoryContext):Promise<TeamMemoryEnvelopeV2>{
  const plaintext=await decryptTeamMemoryPayload(sourceKey,envelope,sourceContext,{strictPayload:true});
  const iv=window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await window.crypto.subtle.encrypt({name:'AES-GCM',iv:toArrayBuffer(iv),additionalData:contextAad(targetContext)},targetKey,toArrayBuffer(new TextEncoder().encode(plaintext)));
  const result:TeamMemoryEnvelopeV2={v:TEAM_ENC_VERSION,iv:bytesToBase64(iv),ct:bytesToBase64(new Uint8Array(encrypted))};
  if(await decryptTeamMemoryPayload(targetKey,result,targetContext,{strictPayload:true})!==plaintext)throw new Error('A recifragem não conservou o conteúdo original.');
  return result;
}

export async function buildTeamMemoryDocFields(
  teamId: string,
  teamKey: CryptoKey,
  text: string,
  title?: string | null,
  keyEpoch?: number,
  keyId?: string,
): Promise<TeamMemoryFields> {
  if (keyEpoch === undefined || keyId === undefined) {
    throw new Error('Época ativa e keyId necessários para novas memórias de equipa.');
  }
  const context = { teamId, keyEpoch, keyId };
  const enc = await encryptTeamMemoryFields(teamKey, { text, title }, context);
  return { text: '', title: null, enc, ...context };
}

/** Helper de testes: gera um par RSA local sem vault/mnemónica. */
export async function generateTestRsaIdentity(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  pemPublic: string;
}> {
  const pair = await generateRSAKeyPair();
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    pemPublic: await exportPublicKey(pair.publicKey),
  };
}
