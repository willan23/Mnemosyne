/**
 * Partilha por link apenas com payload cifrado (passphrase out-of-band).
 * O servidor nunca recebe o texto em claro de novas cápsulas.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveShareKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase.normalize('NFKD')),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: 210_000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedSharePayload {
  v: 1;
  alg: 'AES-GCM-PBKDF2';
  salt: string;
  iv: string;
  data: string;
}

export async function encryptSharePayload(
  plaintext: string,
  passphrase: string
): Promise<EncryptedSharePayload> {
  if (passphrase.trim().length < 8) {
    throw new Error('A passphrase deve ter pelo menos 8 caracteres.');
  }
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(salt);
  window.crypto.getRandomValues(iv);
  const key = await deriveShareKey(passphrase, salt);
  const cipher = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );
  return {
    v: 1,
    alg: 'AES-GCM-PBKDF2',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  };
}

export async function decryptSharePayload(
  payload: EncryptedSharePayload,
  passphrase: string
): Promise<string> {
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.data);
  const key = await deriveShareKey(passphrase, salt);
  const plain = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
    key,
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  );
  return decoder.decode(plain);
}

export function isEncryptedShare(data: Record<string, unknown>): boolean {
  return data.encrypted === true && typeof data.ciphertext === 'object' && data.ciphertext != null;
}
