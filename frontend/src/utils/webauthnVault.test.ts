import { describe, expect, it } from 'vitest';
import {
  clearWebAuthnCredential,
  isWebAuthnAvailable,
  readWebAuthnCredentialId,
} from './webauthnVault';

describe('webauthnVault helpers', () => {
  it('reports availability based on PublicKeyCredential', () => {
    expect(typeof isWebAuthnAvailable()).toBe('boolean');
  });

  it('stores and clears credential id', () => {
    clearWebAuthnCredential();
    expect(readWebAuthnCredentialId()).toBeNull();
    localStorage.setItem('mnemosyne.webauthn.credential.v1', 'abc');
    expect(readWebAuthnCredentialId()).toBe('abc');
    clearWebAuthnCredential();
    expect(readWebAuthnCredentialId()).toBeNull();
  });
});
