import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEncryptedMemoryFields,
  encryptMemoryFields,
  isMemoryCryptoReady,
  LOCKED_MEMORY_PLACEHOLDER,
  setMemoryCryptoMnemonic,
} from './memoryCrypto';
import {
  buildSessionWriteFields,
  parseSessionTeamId,
  resolveSessionSecretFields,
  sessionWriteMode,
  TEAM_LOCKED_PLACEHOLDER,
} from './sessionMemoryFields';
import {
  buildTeamMemoryDocFields,
  cacheTeamKey,
  clearTeamKeyCache,
  encryptLegacyTeamMemoryFields,
  generateTeamKey,
} from './teamVault';

const SAMPLE_MNEMONIC = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
];

afterEach(() => {
  setMemoryCryptoMnemonic(null);
  clearTeamKeyCache();
});

describe('sessionMemoryFields · branch team vs personal', () => {
  it('classifica o destino e lê teamId só quando é string não vazia', () => {
    expect(sessionWriteMode(null)).toBe('personal');
    expect(sessionWriteMode('')).toBe('personal');
    expect(sessionWriteMode('  ')).toBe('personal');
    expect(sessionWriteMode('team-1')).toBe('team');
    expect(parseSessionTeamId({ teamId: 'abc' })).toBe('abc');
    expect(parseSessionTeamId({ teamId: '' })).toBeNull();
    expect(parseSessionTeamId({ text: 'x' })).toBeNull();
  });

  it('caminho pessoal: decifra com a mnemónica e não exige teamKey', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    expect(isMemoryCryptoReady()).toBe(true);
    const enc = await encryptMemoryFields({ text: 'nota pessoal', title: 'Eu' });
    const resolved = await resolveSessionSecretFields({ text: '', title: null, enc });
    expect(resolved.text).toBe('nota pessoal');
    expect(resolved.title).toBe('Eu');
    expect(resolved.encrypted).toBe(true);
    expect(resolved.locked).toBe(false);
  });

  it('caminho de equipa: decifra com teamKey e ignora a mnemónica pessoal', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const teamKey = await generateTeamKey();
    const fields = await buildTeamMemoryDocFields('team-9', teamKey, 'stand-up secreto', 'Daily', 2, 'key-2');

    const opened = await resolveSessionSecretFields(fields as unknown as Record<string, unknown>, { teamKey });
    expect(opened.text).toBe('stand-up secreto');
    expect(opened.title).toBe('Daily');
    expect(opened.locked).toBe(false);

    const withoutKey = await resolveSessionSecretFields(fields as unknown as Record<string, unknown>, { teamKey: null });
    expect(withoutKey.text).toBe(TEAM_LOCKED_PLACEHOLDER);
    expect(withoutKey.locked).toBe(true);
    expect(withoutKey.text).not.toBe('stand-up secreto');
    expect(withoutKey.text).not.toBe(LOCKED_MEMORY_PLACEHOLDER);
  });

  it('doc de equipa com mnemónica ativa mas sem unwrap fica encLocked (não tenta a chave pessoal)', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const teamKey = await generateTeamKey();
    const fields = await buildTeamMemoryDocFields('team-locked', teamKey, 'nunca via pessoal', null, 2, 'key-2');

    const resolved = await resolveSessionSecretFields(
      fields as unknown as Record<string, unknown>,
      { teamKey: null },
    );
    expect(resolved.locked).toBe(true);
    expect(resolved.text).toBe(TEAM_LOCKED_PLACEHOLDER);
    expect(resolved.text).not.toContain('nunca via pessoal');
  });

  it('doc de equipa com teamKey errada fica locked sem corromper o envelope', async () => {
    const a = await generateTeamKey();
    const b = await generateTeamKey();
    const fields = await buildTeamMemoryDocFields('team-x', a, 'payload', null, 2, 'key-2');
    const resolved = await resolveSessionSecretFields(
      fields as unknown as Record<string, unknown>,
      { teamKey: b },
    );
    expect(resolved.locked).toBe(true);
    expect(resolved.text).toBe(TEAM_LOCKED_PLACEHOLDER);
    expect(fields.enc.ct).toBeTruthy();
  });

  it('usa a cache da teamKey quando options não força teamKey', async () => {
    const teamKey = await generateTeamKey();
    cacheTeamKey('team-cache', teamKey);
    const fields = await buildTeamMemoryDocFields('team-cache', teamKey, 'da cache', null, 1, 'key-1');
    const resolved = await resolveSessionSecretFields(fields as unknown as Record<string, unknown>);
    expect(resolved.text).toBe('da cache');
    expect(resolved.locked).toBe(false);
  });

  it('continua a ler v1 e bloqueia v2 se faltar o keyId autenticado', async () => {
    const teamKey = await generateTeamKey();
    const legacy = await encryptLegacyTeamMemoryFields(teamKey, { text: 'antigo sintético' });
    const old = await resolveSessionSecretFields({ teamId: 'team-a', enc: legacy }, { teamKey });
    expect(old.text).toBe('antigo sintético');
    const next = await buildTeamMemoryDocFields('team-a', teamKey, 'novo sintético', null, 2, 'key-2');
    const missingKeyId = { ...next, keyId: undefined };
    const locked = await resolveSessionSecretFields(missingKeyId, { teamKey });
    expect(locked.locked).toBe(true);
  });

  it('buildSessionWriteFields marca explicitamente o âmbito pessoal', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const fields = await buildSessionWriteFields({ text: 'só eu', title: 'P' });
    expect(fields.text).toBe('');
    expect(fields.title).toBeNull();
    expect(fields.teamId).toBeNull();
    const personal = await buildEncryptedMemoryFields('só eu', 'P');
    expect(fields.enc.v).toBe(personal.enc.v);
  });

  it('recusa novas escritas de equipa no lançamento pessoal', async () => {
    const teamKey = await generateTeamKey();
    await expect(buildSessionWriteFields({
      text: 'partilhado',
      title: 'Eq',
      teamId: 'team-write',
      teamKey,
    })).rejects.toThrow(/modo de leitura/);
  });

  it('recusa escrita de equipa mesmo sem teamKey', async () => {
    await expect(buildSessionWriteFields({
      text: 'x',
      teamId: 'team-1',
    })).rejects.toThrow(/modo de leitura/);
  });
});
