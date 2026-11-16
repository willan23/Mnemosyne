/**
 * PIN local opcional para reabrir a sessão sem reescrever as 12 palavras.
 * A mnemónica fica cifrada (AES-GCM) com chave derivada do PIN via PBKDF2.
 * O PIN nunca é guardado em plaintext; só o vault cifrado existe em localStorage.
 *
 * Política:
 * - Criar: mínimo 6 caracteres alfanuméricos.
 * - Unlock: aceita PINs 4 dígitos legados e os novos PINs alfanuméricos (4–12).
 */

import { decryptTextAesGcm, encryptTextAesGcm } from './crypto';

const VAULT_STORAGE_KEY = 'mnemosyne.pin.vault.v1';
const PIN_ITERATIONS = 180_000;
const MIN_CREATE_PIN_LENGTH = 6;
const MIN_UNLOCK_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 12;
const PIN_CHAR_PATTERN = /^[A-Za-z0-9]+$/;

export interface LocalPinVault {
  version: 1;
  salt: string;
  iv: string;
  data: string;
  iterations: number;
  createdAt: number;
  updatedAt: number;
}

export type PinValidationMode = 'create' | 'unlock';

const encoder = new TextEncoder();

const toBase64 = (bytes: Uint8Array): string =>
  window.btoa(String.fromCharCode(...bytes));

const fromBase64 = (value: string): Uint8Array => {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export function normalizePin(pin: string): string {
  return pin.replace(/\s+/g, '').trim();
}

export function validatePinFormat(pin: string, mode: PinValidationMode = 'create'): string | null {
  const normalized = normalizePin(pin);
  const min = mode === 'unlock' ? MIN_UNLOCK_PIN_LENGTH : MIN_CREATE_PIN_LENGTH;
  if (normalized.length < min || normalized.length > MAX_PIN_LENGTH) {
    return `O PIN deve ter entre ${min} e ${MAX_PIN_LENGTH} caracteres.`;
  }
  if (!PIN_CHAR_PATTERN.test(normalized)) {
    return 'O PIN deve ser alfanumérico (letras e números).';
  }
  return null;
}

async function deriveKeyFromPin(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(normalizePin(pin)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function readLocalPinVault(): LocalPinVault | null {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalPinVault;
    if (
      parsed?.version !== 1 ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.data !== 'string' ||
      typeof parsed.iterations !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isLocalPinEnabled(): boolean {
  return Boolean(readLocalPinVault());
}

/** Escreve o vault cifrado. Usado internamente e em testes de PINs legados. */
export async function writeLocalPinVault(pin: string, mnemonic: string[], existing?: LocalPinVault | null): Promise<void> {
  if (!Array.isArray(mnemonic) || mnemonic.length !== 12) {
    throw new Error(existing ? 'Mnemónica inválida para reseal do PIN.' : 'Precisas de uma sessão desbloqueada para ativar o PIN.');
  }

  const salt = existing ? fromBase64(existing.salt) : new Uint8Array(16);
  if (!existing) window.crypto.getRandomValues(salt);
  const iterations = existing?.iterations || PIN_ITERATIONS;
  const key = await deriveKeyFromPin(pin, salt, iterations);
  const encrypted = await encryptTextAesGcm(JSON.stringify(mnemonic), key);
  const now = Date.now();
  const vault: LocalPinVault = {
    version: 1,
    salt: toBase64(salt),
    iv: encrypted.iv,
    data: encrypted.data,
    iterations,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
}

export async function enableLocalPin(pin: string, confirmPin: string, mnemonic: string[]): Promise<void> {
  const formatError = validatePinFormat(pin, 'create');
  if (formatError) throw new Error(formatError);
  if (normalizePin(pin) !== normalizePin(confirmPin)) {
    throw new Error('Os PINs não coincidem.');
  }
  await writeLocalPinVault(pin, mnemonic);
}

/** Atualiza o vault cifrado com a mnemónica atual (após unlock). */
export async function resealLocalPinVault(pin: string, mnemonic: string[]): Promise<void> {
  const existing = readLocalPinVault();
  if (!existing) {
    await enableLocalPin(pin, pin, mnemonic);
    return;
  }
  const formatError = validatePinFormat(pin, 'unlock');
  if (formatError) throw new Error(formatError);
  await writeLocalPinVault(pin, mnemonic, existing);
}

export async function unlockWithLocalPin(pin: string): Promise<string[]> {
  const vault = readLocalPinVault();
  if (!vault) {
    throw new Error('Não há PIN local configurado.');
  }
  const formatError = validatePinFormat(pin, 'unlock');
  if (formatError) throw new Error(formatError);

  try {
    const salt = fromBase64(vault.salt);
    const key = await deriveKeyFromPin(pin, salt, vault.iterations || PIN_ITERATIONS);
    const plaintext = await decryptTextAesGcm({ iv: vault.iv, data: vault.data }, key);
    const words = JSON.parse(plaintext) as unknown;
    if (!Array.isArray(words) || words.length !== 12 || !words.every((w) => typeof w === 'string')) {
      throw new Error('Vault de PIN corrompido.');
    }
    return words as string[];
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('O PIN')) throw error;
    throw new Error('PIN incorreto ou vault corrompido.');
  }
}

export async function disableLocalPin(pin: string): Promise<void> {
  await unlockWithLocalPin(pin);
  localStorage.removeItem(VAULT_STORAGE_KEY);
}

export function clearLocalPinVault(): void {
  try {
    localStorage.removeItem(VAULT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
