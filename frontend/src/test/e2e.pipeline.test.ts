/**
 * Suite E2E lógica (sem browser) — cobre o pipeline crítico:
 * crypto cápsula → comms multi-user → search → rate limit client.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptTextAesGcm, decryptTextAesGcm, deriveAesKeyFromMnemonic } from '../utils/crypto';
import { buildRelayTransmissionPayload, canTransmitToRecipient } from '../services/commsService';
import { searchMemories } from '../utils/searchMemories';
import { consumeRateLimit } from '../utils/clientRateLimit';

const SAMPLE_MNEMONIC = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
];

describe('E2E pipeline · crypto capsule', () => {
  it('round-trips memory content with PBKDF2 + AES-GCM', async () => {
    const key = await deriveAesKeyFromMnemonic(SAMPLE_MNEMONIC, 'mnemosyne:e2e-capsule');
    const plaintext = JSON.stringify({
      title: 'Ideia soberana',
      text: 'O Mnemosyne guarda isto cifrado end-to-end.',
      tags: ['e2e', 'zk'],
    });
    const sealed = await encryptTextAesGcm(plaintext, key);
    const opened = await decryptTextAesGcm(sealed, key);
    expect(JSON.parse(opened).title).toBe('Ideia soberana');

    const wrongKey = await deriveAesKeyFromMnemonic(
      [...SAMPLE_MNEMONIC.slice(0, 11), 'zoo'],
      'mnemosyne:e2e-capsule',
    );
    await expect(decryptTextAesGcm(sealed, wrongKey)).rejects.toBeTruthy();
  });
});

describe('E2E pipeline · comms multi-user', () => {
  it('only allows cross-user relay payloads', () => {
    expect(canTransmitToRecipient('user-a', 'user-a').ok).toBe(false);
    const payload = buildRelayTransmissionPayload({
      senderId: 'user-a',
      recipientId: 'user-b',
      encryptedKey: 'wrap',
      encryptedPayload: 'cipher',
      payloadIv: 'iv',
    });
    expect(payload.status).toBe('sent');
    expect(payload.senderId).not.toBe(payload.recipientId);
  });
});

describe('E2E pipeline · search + flow echoes', () => {
  it('finds related memories for a flow draft', () => {
    const hits = searchMemories(
      [
        { id: '1', title: 'Arquitetura cognitiva', text: 'grafo de memórias e embeddings' },
        { id: '2', title: 'Receitas', text: 'massa e molho de tomate' },
      ],
      'memórias no grafo cognitivo',
    );
    expect(hits[0].memory.id).toBe('1');
  });
});

describe('E2E pipeline · client rate limit', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('enforces fair-use window for web research style bucket', () => {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
      expect(consumeRateLimit('e2e-web', 3, 60_000, now + i).allowed).toBe(true);
    }
    expect(consumeRateLimit('e2e-web', 3, 60_000, now + 10).allowed).toBe(false);
  });
});
