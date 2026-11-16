import { afterEach, describe, expect, it } from 'vitest';
import { setMemoryCryptoMnemonic } from './memoryCrypto';
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from './recentSearches';
import { scrubLegacyKeyMaterial } from '../utils/sessionMnemonic';

const WORDS = ['abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];
const key = (uid: string) => `mnemosyne.search.recent.v2.${uid}`;

afterEach(() => { setMemoryCryptoMnemonic(null); localStorage.clear(); });

describe('encrypted recent searches', () => {
  it('stores only ciphertext and binds the payload to its user', async () => {
    setMemoryCryptoMnemonic(WORDS);
    await pushRecentSearch('alice', 'private research phrase');
    const raw = localStorage.getItem(key('alice'))!;
    expect(raw).not.toContain('private research phrase');
    expect(await readRecentSearches('alice')).toEqual(['private research phrase']);
    expect(await readRecentSearches('bob')).toEqual([]);
    localStorage.setItem(key('bob'), raw);
    await expect(readRecentSearches('bob')).rejects.toThrow();
    setMemoryCryptoMnemonic(null);
    await expect(readRecentSearches('alice')).rejects.toThrow();
  });

  it('serializes concurrent writes and keeps at most eight distinct recent queries', async () => {
    setMemoryCryptoMnemonic(WORDS);
    await Promise.all(Array.from({ length: 10 }, (_, index) => pushRecentSearch('alice', `query ${index}`)));
    expect(await readRecentSearches('alice')).toEqual(
      Array.from({ length: 8 }, (_, index) => `query ${9 - index}`));
    await pushRecentSearch('alice', 'QUERY 5');
    expect((await readRecentSearches('alice')).filter((query) => query.toLowerCase() === 'query 5')).toEqual(['QUERY 5']);
  });

  it('does not restore history after clear or return plaintext after a vault lock', async () => {
    setMemoryCryptoMnemonic(WORDS);
    const pending = pushRecentSearch('alice', 'cancelled query');
    clearRecentSearches('alice');
    await expect(pending).rejects.toThrow();
    expect(localStorage.getItem(key('alice'))).toBeNull();
    await pushRecentSearch('alice', 'saved query');
    const reading = readRecentSearches('alice');
    setMemoryCryptoMnemonic(null);
    await expect(reading).rejects.toThrow();
  });

  it('preserves unreadable ciphertext and scrubs the old plaintext history', async () => {
    setMemoryCryptoMnemonic(WORDS);
    localStorage.setItem(key('alice'), 'corrupt');
    await expect(pushRecentSearch('alice', 'new query')).rejects.toThrow();
    expect(localStorage.getItem(key('alice'))).toBe('corrupt');
    localStorage.setItem('mnemosyne.search.recent.v1', '["old private phrase"]');
    scrubLegacyKeyMaterial();
    expect(localStorage.getItem('mnemosyne.search.recent.v1')).toBeNull();
  });
});
