/**
 * Optional WebAuthn gate before unlocking the local PIN vault.
 * Does not replace the mnemonic — only adds a device-bound unlock step.
 */

const CREDENTIAL_STORAGE_KEY = 'mnemosyne.webauthn.credential.v1';

export function isWebAuthnAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.PublicKeyCredential
    && typeof window.PublicKeyCredential === 'function';
}

export function readWebAuthnCredentialId(): string | null {
  try {
    return localStorage.getItem(CREDENTIAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearWebAuthnCredential(): void {
  try {
    localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = window.atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function registerWebAuthnGate(userId: string, displayName = 'Mnemosyne'): Promise<string> {
  if (!isWebAuthnAvailable()) {
    throw new Error('WebAuthn is not available on this device/browser.');
  }

  const challenge = window.crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(userId.slice(0, 64));

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: 'Mnemosyne',
        id: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname,
      },
      user: {
        id: userIdBytes,
        name: `${userId}@mnemosyne.local`,
        displayName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('WebAuthn registration was cancelled.');

  const credentialId = bufferToBase64Url(credential.rawId);
  localStorage.setItem(CREDENTIAL_STORAGE_KEY, credentialId);
  return credentialId;
}

export async function assertWebAuthnGate(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return true;
  const storedId = readWebAuthnCredentialId();
  if (!storedId) return true;

  const challenge = window.crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      timeout: 60_000,
      userVerification: 'required',
      allowCredentials: [
        {
          type: 'public-key',
          id: base64UrlToBuffer(storedId),
        },
      ],
    },
  });

  return Boolean(assertion);
}
