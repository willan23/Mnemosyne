import { afterEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  buildEncryptedMemoryFields,
  decryptMemoryEnvelope,
  encryptMemoryFields,
  isEncryptedMemoryEnvelope,
  isLegacyNestedMemoryCandidate,
  isLegacyPersonalMemoryCandidate,
  isMemoryCryptoReady,
  LOCKED_MEMORY_PLACEHOLDER,
  MemoryCryptoLockedError,
  resolveMemoryDocFields,
  setMemoryCryptoMnemonic,
  sameUpdatedAt,
} from './memoryCrypto';

const SAMPLE_MNEMONIC = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
];

const OTHER_MNEMONIC = [
  ...SAMPLE_MNEMONIC.slice(0, 11), 'zoo',
];

afterEach(() => {
  setMemoryCryptoMnemonic(null);
});

describe('memoryCrypto · chave ativa', () => {
  it('fica pronto após definir mnemónica e bloqueia após limpar', () => {
    expect(isMemoryCryptoReady()).toBe(false);
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    expect(isMemoryCryptoReady()).toBe(true);
    setMemoryCryptoMnemonic(null);
    expect(isMemoryCryptoReady()).toBe(false);
  });

  it('lança MemoryCryptoLockedError ao cifrar sem chave', async () => {
    await expect(encryptMemoryFields({ text: 'x' })).rejects.toBeInstanceOf(MemoryCryptoLockedError);
  });
});

describe('memoryCrypto · migração pessoal legada', () => {
  it('seleciona apenas texto antigo do dono sem chave de equipa ou partilha', () => {
    expect(isLegacyPersonalMemoryCandidate({ uid: 'alice', text: 'legado' }, 'alice')).toBe(true);
    expect(isLegacyPersonalMemoryCandidate({ uid: 'alice', title: 'legado', teamId: null }, 'alice')).toBe(true);
    expect(isLegacyPersonalMemoryCandidate({ uid: 'bob', text: 'legado' }, 'alice')).toBe(false);
    expect(isLegacyPersonalMemoryCandidate({ uid: 'alice', text: 'legado', teamId: 'crew' }, 'alice')).toBe(false);
    expect(isLegacyPersonalMemoryCandidate({ uid: 'alice', text: 'legado', sharedWithIds: ['bob'] }, 'alice')).toBe(false);
    expect(isLegacyPersonalMemoryCandidate({ uid: 'alice', text: 'legado', enc: { v: 1, iv: 'iv', ct: 'ct' } }, 'alice')).toBe(false);
  });

  it('seleciona legado no caminho do dono mesmo sem uid no documento', () => {
    expect(isLegacyNestedMemoryCandidate({ text: 'legado' }, 'alice')).toBe(true);
    expect(isLegacyNestedMemoryCandidate({ uid: 'alice', text: 'legado' }, 'alice')).toBe(true);
    expect(isLegacyNestedMemoryCandidate({ uid: 'bob', text: 'legado' }, 'alice')).toBe(false);
    expect(isLegacyNestedMemoryCandidate({ text: 'legado', teamId: 'crew' }, 'alice')).toBe(false);
    expect(isLegacyNestedMemoryCandidate({ text: 'legado', sharedWithIds: ['bob'] }, 'alice')).toBe(false);
    expect(isLegacyNestedMemoryCandidate({ text: 'legado', enc: { v: 1, iv: 'iv', ct: 'ct' } }, 'alice')).toBe(false);
  });

  it('reconhece timestamps iguais vindos de leituras Firestore separadas', () => {
    expect(sameUpdatedAt(new Timestamp(12, 34), new Timestamp(12, 34))).toBe(true);
    expect(sameUpdatedAt(new Timestamp(12, 34), new Timestamp(13, 34))).toBe(false);
  });
});

describe('memoryCrypto · envelope', () => {
  it('rejeita versão desconhecida, campos vazios e propriedades adicionais', () => {
    expect(isEncryptedMemoryEnvelope({ v: 2, iv: 'iv', ct: 'ct' })).toBe(false);
    expect(isEncryptedMemoryEnvelope({ v: 1, iv: '', ct: 'ct' })).toBe(false);
    expect(isEncryptedMemoryEnvelope({ v: 1, iv: 'iv', ct: '' })).toBe(false);
    expect(isEncryptedMemoryEnvelope({ v: 1, iv: 'iv', ct: 'ct', debug: true })).toBe(false);
  });

  it('cifra e decifra text + title (round-trip)', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const envelope = await encryptMemoryFields({ text: 'Pensamento secreto', title: 'Título' });

    expect(isEncryptedMemoryEnvelope(envelope)).toBe(true);
    expect(envelope.v).toBe(1);
    expect(envelope.ct).not.toContain('Pensamento');

    const opened = await decryptMemoryEnvelope(envelope);
    expect(opened.text).toBe('Pensamento secreto');
    expect(opened.title).toBe('Título');
  });

  it('gera IV único por documento', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const a = await encryptMemoryFields({ text: 'mesmo texto' });
    const b = await encryptMemoryFields({ text: 'mesmo texto' });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('falha a decifrar com mnemónica errada', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const envelope = await encryptMemoryFields({ text: 'segredo' });

    setMemoryCryptoMnemonic(OTHER_MNEMONIC);
    await expect(decryptMemoryEnvelope(envelope)).rejects.toBeTruthy();
  });

  it('buildEncryptedMemoryFields zera text/title em claro', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const fields = await buildEncryptedMemoryFields('conteúdo', 'título');
    expect(fields.text).toBe('');
    expect(fields.title).toBeNull();
    expect(isEncryptedMemoryEnvelope(fields.enc)).toBe(true);
  });
});

describe('memoryCrypto · leitura tolerante (legado + cifrado)', () => {
  it('lê documento legado em texto claro sem chave', async () => {
    const resolved = await resolveMemoryDocFields({ text: 'legado', title: 'Antigo' });
    expect(resolved.text).toBe('legado');
    expect(resolved.title).toBe('Antigo');
    expect(resolved.encrypted).toBe(false);
    expect(resolved.locked).toBe(false);
  });

  it('decifra documento cifrado quando a chave está ativa', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const enc = await encryptMemoryFields({ text: 'cifrado', title: 'T' });
    const resolved = await resolveMemoryDocFields({ text: '', title: null, enc });
    expect(resolved.text).toBe('cifrado');
    expect(resolved.title).toBe('T');
    expect(resolved.encrypted).toBe(true);
    expect(resolved.locked).toBe(false);
  });

  it('devolve placeholder bloqueado quando a chave não está disponível', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const enc = await encryptMemoryFields({ text: 'cifrado' });
    setMemoryCryptoMnemonic(null);

    const resolved = await resolveMemoryDocFields({ text: '', title: null, enc });
    expect(resolved.text).toBe(LOCKED_MEMORY_PLACEHOLDER);
    expect(resolved.locked).toBe(true);
  });

  it('devolve placeholder bloqueado com chave errada (sem corromper)', async () => {
    setMemoryCryptoMnemonic(SAMPLE_MNEMONIC);
    const enc = await encryptMemoryFields({ text: 'cifrado' });
    setMemoryCryptoMnemonic(OTHER_MNEMONIC);

    const resolved = await resolveMemoryDocFields({ text: '', title: null, enc });
    expect(resolved.text).toBe(LOCKED_MEMORY_PLACEHOLDER);
    expect(resolved.locked).toBe(true);
  });

  it('ignora envelopes malformados e cai para texto claro', async () => {
    const resolved = await resolveMemoryDocFields({
      text: 'fallback',
      enc: { v: 99, foo: 'bar' },
    });
    expect(resolved.text).toBe('fallback');
    expect(resolved.encrypted).toBe(false);
  });
});
