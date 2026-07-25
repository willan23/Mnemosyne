import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptTextAesGcm,
  deriveAesKeyFromMnemonic,
  encryptTextAesGcm,
  generateBip39Mnemonic,
  getOrCreateIdentity,
  validateBip39Mnemonic,
} from './crypto';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
const otherMnemonic = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'.split(' ');

describe('zero-knowledge crypto utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates valid 12-word BIP39 mnemonics', async () => {
    const generated = await generateBip39Mnemonic();

    expect(generated).toHaveLength(12);
    expect(await validateBip39Mnemonic(generated)).toBe(true);
  });

  it('validates checksum and rejects malformed mnemonics', async () => {
    expect(await validateBip39Mnemonic(mnemonic)).toBe(true);
    expect(await validateBip39Mnemonic([...mnemonic.slice(0, 11), 'abandon'])).toBe(false);
    expect(await validateBip39Mnemonic([...mnemonic.slice(0, 11), 'notaword'])).toBe(false);
  });

  it('round-trips AES-GCM payloads derived from the same mnemonic and salt', async () => {
    const key = await deriveAesKeyFromMnemonic(mnemonic, 'mnemosyne:test', 1_000);
    const encrypted = await encryptTextAesGcm('private memory', key);

    await expect(decryptTextAesGcm(encrypted, key)).resolves.toBe('private memory');
  });

  it('rejects decryption with a different mnemonic-derived key', async () => {
    const key = await deriveAesKeyFromMnemonic(mnemonic, 'mnemosyne:test', 1_000);
    const wrongKey = await deriveAesKeyFromMnemonic(otherMnemonic, 'mnemosyne:test', 1_000);
    const encrypted = await encryptTextAesGcm('private memory', key);

    await expect(decryptTextAesGcm(encrypted, wrongKey)).rejects.toThrow();
  });

  it('stores identity private keys only inside the encrypted vault', async () => {
    await getOrCreateIdentity('test-scope', mnemonic);

    expect(localStorage.getItem('mnemosyne_private_jwk')).toBeNull();
    expect(localStorage.getItem('mnemosyne_public_jwk')).toBeNull();
    const vault = localStorage.getItem('mnemosyne_identity_vault_test-scope');
    expect(vault).toBeTruthy();
    expect(vault).not.toContain('privateJwk');
  });

  it('does not reuse an unlocked identity cache for a different mnemonic', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await getOrCreateIdentity('guarded-scope', mnemonic);

      await expect(getOrCreateIdentity('guarded-scope', otherMnemonic)).rejects.toThrow(
        'Não foi possível desbloquear a identidade local com esta mnemónica.'
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
