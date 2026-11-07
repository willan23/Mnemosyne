import { afterEach, describe, expect, it } from 'vitest';
import { setMemoryCryptoMnemonic } from '../services/memoryCrypto';
import {
  buildSovereignExportPayload,
  decryptExportBytes,
  encryptExportBytes,
  EXPORT_PASSPHRASE_MIN_LENGTH,
  serializeSovereignExportFiles,
  SOVEREIGN_EXPORT_FORMAT,
  SovereignExportLockedError,
  type SovereignExportMemoryInput,
} from './sovereignExport';

const SAMPLE = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
];

const memories: SovereignExportMemoryInput[] = [
  {
    id: 'a',
    text: 'Pensamento alfa em claro',
    title: 'Alfa',
    tags: ['projeto', 'ia'],
    category: 'Trabalho',
    timestamp: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    connections: ['b', 'missing'],
    position: [1, 2, 3],
    celestialType: 'star',
    importance: 0.8,
  },
  {
    id: 'b',
    text: 'Pensamento beta',
    title: null,
    tags: [],
    timestamp: 1_700_000_200_000,
    connections: ['a'],
    position: [4, 5, 6],
    celestialType: 'planet',
  },
];

afterEach(() => {
  setMemoryCryptoMnemonic(null);
});

describe('buildSovereignExportPayload', () => {
  it('recusa export com cofre bloqueado', () => {
    expect(() => buildSovereignExportPayload(memories, { vaultUnlocked: false }))
      .toThrow(SovereignExportLockedError);
  });

  it('recusa memórias ainda cifradas (encLocked)', () => {
    expect(() =>
      buildSovereignExportPayload(
        [{ ...memories[0], encLocked: true }],
        { vaultUnlocked: true }
      )
    ).toThrow(/ainda cifradas/);
  });

  it('inclui texto decifrado e metadados do grafo (conexões, tags, posições)', () => {
    const payload = buildSovereignExportPayload(memories, {
      vaultUnlocked: true,
      exportedAt: '2026-08-31T12:00:00.000Z',
    });

    expect(payload.manifest.format).toBe(SOVEREIGN_EXPORT_FORMAT);
    expect(payload.manifest.version).toBe(1);
    expect(payload.manifest.memoryCount).toBe(2);
    expect(payload.manifest.passphraseProtected).toBe(false);
    expect(payload.memories[0].text).toBe('Pensamento alfa em claro');
    expect(payload.memories[0].title).toBe('Alfa');
    expect(payload.memories[0].tags).toEqual(['projeto', 'ia']);
    expect(payload.memories[0].position).toEqual([1, 2, 3]);
    expect(payload.graph.nodes).toHaveLength(2);
    expect(payload.graph.nodes[0].position).toEqual([1, 2, 3]);
    expect(payload.graph.edges).toEqual([{ source: 'a', target: 'b' }]);
    expect(payload.manifest.edgeCount).toBe(1);
    expect(JSON.stringify(payload)).not.toContain('embedding');
  });

  it('serializa JSON+manifest sem JSZip', () => {
    const payload = buildSovereignExportPayload(memories, {
      vaultUnlocked: true,
      exportedAt: '2026-08-31T12:00:00.000Z',
      passphraseProtected: true,
    });
    const files = serializeSovereignExportFiles(payload);

    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'graph.json',
      'manifest.json',
      'memories.json',
    ]);

    const manifest = JSON.parse(files['manifest.json']);
    const graph = JSON.parse(files['graph.json']);
    const exportedMemories = JSON.parse(files['memories.json']);

    expect(manifest.memoryCount).toBe(2);
    expect(manifest.passphraseProtected).toBe(true);
    expect(graph.edges[0]).toEqual({ source: 'a', target: 'b' });
    expect(exportedMemories[0].text).toContain('alfa');
    expect(files['README.txt']).toContain('decifrado localmente');
  });
});

describe('encryptExportBytes (AES-GCM, sem JSZip)', () => {
  it('rejeita passphrase curta', async () => {
    const bytes = new TextEncoder().encode('payload').buffer;
    await expect(encryptExportBytes(bytes, 'short')).rejects.toThrow(
      String(EXPORT_PASSPHRASE_MIN_LENGTH)
    );
  });

  it('cifra e decifra o payload binário com passphrase', async () => {
    setMemoryCryptoMnemonic(SAMPLE);
    const plain = new TextEncoder().encode('{"memories":["segredo soberano"]}');
    const envelope = await encryptExportBytes(plain.buffer as ArrayBuffer, 'passphrase-forte');

    expect(envelope.v).toBe(1);
    expect(envelope.alg).toBe('AES-GCM-256');
    expect(envelope.kdf).toBe('PBKDF2-SHA256');
    expect(envelope.ct).not.toContain('segredo');

    const opened = await decryptExportBytes(envelope, 'passphrase-forte');
    expect(new TextDecoder().decode(opened)).toBe('{"memories":["segredo soberano"]}');

    await expect(decryptExportBytes(envelope, 'passphrase-errada-xx')).rejects.toThrow();
  });
});
