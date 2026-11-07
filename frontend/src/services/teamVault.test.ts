import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTeamMemoryDocFields,
  cacheTeamKeyEpoch,
  clearTeamKeyCache,
  decryptTeamMemoryEnvelope,
  encryptLegacyTeamMemoryFields,
  encryptTeamMemoryFields,
  exportTeamKeyPlaintext,
  fingerprintTeamPublicKey,
  generateTeamKey,
  generateTestRsaIdentity,
  getCachedTeamKey,
  isWrappedTeamKeyEnvelope,
  unwrapTeamKeyWithPrivateKey,
  wrappedTeamKeyLeaksPlaintext,
  wrapTeamKeyForPublicPem,
} from './teamVault';

afterEach(() => {
  clearTeamKeyCache();
});

describe('teamVault · wrap/unwrap RSA-OAEP', () => {
  it('fingerprints normalize line endings but preserve case-sensitive public-key bytes', async () => {
    expect(await fingerprintTeamPublicKey('  synthetic-public-AbC\r\nnext  ')).toBe(await fingerprintTeamPublicKey('synthetic-public-AbC\nnext'));
    expect(await fingerprintTeamPublicKey('synthetic-public-AbC')).not.toBe(await fingerprintTeamPublicKey('synthetic-public-abc'));
  });
  it('embrulha a teamKey com a RSA pública e recupera-a com a privada', async () => {
    const identity = await generateTestRsaIdentity();
    const teamKey = await generateTeamKey();
    const plaintext = await exportTeamKeyPlaintext(teamKey);

    const envelope = await wrapTeamKeyForPublicPem(teamKey, identity.pemPublic);

    expect(isWrappedTeamKeyEnvelope(envelope)).toBe(true);
    expect(envelope.alg).toBe('RSA-OAEP');
    expect(envelope.v).toBe(1);
    expect(envelope.ct).not.toContain(plaintext);
    expect(wrappedTeamKeyLeaksPlaintext(envelope, plaintext)).toBe(false);
    expect(JSON.stringify(envelope)).not.toContain(plaintext);
    expect('teamKey' in envelope).toBe(false);

    const opened = await unwrapTeamKeyWithPrivateKey(envelope, identity.privateKey);
    await expect(exportTeamKeyPlaintext(opened)).resolves.toBe(plaintext);
  });

  it('rejeita envelopes com campos de chave em claro', () => {
    expect(isWrappedTeamKeyEnvelope({
      v: 1,
      alg: 'RSA-OAEP',
      ct: 'cipher-blob-cipher',
      teamKey: 'leaked',
    })).toBe(false);
    expect(isWrappedTeamKeyEnvelope({ teamKey: 'leaked' })).toBe(false);
  });

  it('não abre um wrap feito para outra identidade', async () => {
    const alice = await generateTestRsaIdentity();
    const bob = await generateTestRsaIdentity();
    const teamKey = await generateTeamKey();
    const envelope = await wrapTeamKeyForPublicPem(teamKey, alice.pemPublic);
    await expect(unwrapTeamKeyWithPrivateKey(envelope, bob.privateKey)).rejects.toBeTruthy();
  });
});

describe('teamVault · memórias de equipa enc:{v,iv,ct}', () => {
  it('cifra com a teamKey e deixa text/title vazios no documento', async () => {
    const teamKey = await generateTeamKey();
    const fields = await buildTeamMemoryDocFields('team-1', teamKey, 'segredo de equipa', 'Stand-up', 2, 'key-2');

    expect(fields.text).toBe('');
    expect(fields.title).toBeNull();
    expect(fields.teamId).toBe('team-1');
    expect(fields.enc.v).toBe(2);
    expect(fields.keyEpoch).toBe(2);
    expect(fields.keyId).toBe('key-2');
    expect(fields.enc.ct).not.toContain('segredo');
    expect(JSON.stringify(fields)).not.toContain('segredo de equipa');

    const opened = await decryptTeamMemoryEnvelope(teamKey, fields.enc,
      { teamId: 'team-1', keyEpoch: 2, keyId: 'key-2' });
    expect(opened.text).toBe('segredo de equipa');
    expect(opened.title).toBe('Stand-up');
  });

  it('falha a decifrar com outra teamKey', async () => {
    const a = await generateTeamKey();
    const b = await generateTeamKey();
    const context = { teamId: 'team-1', keyEpoch: 2, keyId: 'key-2' };
    const envelope = await encryptTeamMemoryFields(a, { text: 'interno' }, context);
    await expect(decryptTeamMemoryEnvelope(b, envelope, context)).rejects.toBeTruthy();
  });

  it('liga o ciphertext v2 à equipa, época e keyId', async () => {
    const key = await generateTeamKey();
    const context = { teamId: 'team-a', keyEpoch: 2, keyId: 'key-2' };
    const envelope = await encryptTeamMemoryFields(key, { text: 'sintético' }, context);
    await expect(decryptTeamMemoryEnvelope(key, envelope, { ...context, teamId: 'team-b' })).rejects.toBeTruthy();
    await expect(decryptTeamMemoryEnvelope(key, envelope, { ...context, keyEpoch: 3 })).rejects.toBeTruthy();
    await expect(decryptTeamMemoryEnvelope(key, envelope, { ...context, keyId: 'other' })).rejects.toBeTruthy();
  });

  it('mantém leitura v1 durante a transição e separa a cache por época', async () => {
    const oldKey = await generateTeamKey();
    const newKey = await generateTeamKey();
    const legacy = await encryptLegacyTeamMemoryFields(oldKey, { text: 'histórico sintético' });
    expect((await decryptTeamMemoryEnvelope(oldKey, legacy)).text).toBe('histórico sintético');
    cacheTeamKeyEpoch('team-a', 1, oldKey);
    cacheTeamKeyEpoch('team-a', 2, newKey);
    expect(getCachedTeamKey('team-a', 1)).toBe(oldKey);
    expect(getCachedTeamKey('team-a', 2)).toBe(newKey);
    expect(getCachedTeamKey('team-a', 3)).toBeNull();
  });
});
