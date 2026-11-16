import { beforeEach, describe, expect, it, vi } from 'vitest';
import {createHash} from 'node:crypto';
import {
  decryptTextAesGcm,
  deriveAesKeyFromMnemonic,
  deriveAesKeyFromPassphrase,
  encryptTextAesGcm,
  generateBip39Mnemonic,
  getOrCreateIdentity,
  clearVolatileIdentities,
  validateBip39Mnemonic,
  sha256ExactHex,
} from './crypto';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
const otherMnemonic = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'.split(' ');

describe('zero-knowledge crypto utilities', () => {
  it('fingerprints exact bytes with an independent SHA-256 implementation, preserving key case and whitespace', async () => {
    const values = ['A\n', 'a\n', 'A', ' A\n'];
    const digests = await Promise.all(values.map(sha256ExactHex));
    expect(digests).toEqual(values.map(value => createHash('sha256').update(value, 'utf8').digest('hex')));
    expect(new Set(digests).size).toBe(values.length);
  });
  beforeEach(() => {
    localStorage.clear();
    clearVolatileIdentities();
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

  it('round-trips AES-GCM from a passphrase-derived key', async () => {
    const salt = new Uint8Array(16).fill(7);
    const key = await deriveAesKeyFromPassphrase('passphrase-forte', salt, 1_000);
    const encrypted = await encryptTextAesGcm('export vault', key);
    await expect(decryptTextAesGcm(encrypted, key)).resolves.toBe('export vault');
  });
  it('round-trips a large encrypted creation checkpoint without spreading its ciphertext as function arguments', async () => {
    const key = await deriveAesKeyFromMnemonic(mnemonic, 'mnemosyne:large-checkpoint', 1_000);
    const plaintext = 'Synthetic checkpoint ç € '.repeat(20000);
    const sealed = await encryptTextAesGcm(plaintext, key);
    const opened = await decryptTextAesGcm(sealed, key);
    // Avoid printing the synthetic payload even if the assertion fails.
    expect(opened === plaintext).toBe(true);
    expect(window.atob(sealed.data).length).toBe(new TextEncoder().encode(plaintext).length + 16);
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
  it('a context loss during real RSA preparation never stores the prepared private key',async()=>{
    let live=true;const generate=window.crypto.subtle.generateKey.bind(window.crypto.subtle);
    const spy=vi.spyOn(window.crypto.subtle,'generateKey').mockImplementation(async(...args)=>{const result=await generate(...args);live=false;return result;});
    try{await expect(getOrCreateIdentity('lost-context',mnemonic,()=>{if(!live)throw Error('Synthetic context lost');})).rejects.toThrow();expect(localStorage.getItem('mnemosyne_identity_vault_lost-context')).toBeNull();}finally{spy.mockRestore();}
  });
  it('a competing stored identity is never overwritten by slow RSA preparation',async()=>{
    const generate=window.crypto.subtle.generateKey.bind(window.crypto.subtle);const other='Synthetic concurrent encrypted identity';
    const spy=vi.spyOn(window.crypto.subtle,'generateKey').mockImplementation(async(...args)=>{const result=await generate(...args);localStorage.setItem('mnemosyne_identity_vault_concurrent-context',other);return result;});
    try{await expect(getOrCreateIdentity('concurrent-context',mnemonic)).rejects.toThrow();expect(localStorage.getItem('mnemosyne_identity_vault_concurrent-context')).toBe(other);}finally{spy.mockRestore();}
  });
  it('a caller cannot use the unlocked cache after its guard becomes invalid',async()=>{
    await getOrCreateIdentity('cached-context',mnemonic);await expect(getOrCreateIdentity('cached-context',mnemonic,()=>{throw Error('Synthetic context lost');})).rejects.toThrow();
  });
  it('the cache cannot hide an encrypted primary changed by another tab',async()=>{
    await getOrCreateIdentity('replaced-primary',mnemonic);localStorage.setItem('mnemosyne_identity_vault_replaced-primary','Synthetic damaged replacement');
    await expect(getOrCreateIdentity('replaced-primary',mnemonic)).rejects.toThrow();expect(localStorage.getItem('mnemosyne_identity_vault_replaced-primary')).toBe('Synthetic damaged replacement');
  });
});
