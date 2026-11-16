import { beforeEach, expect, it } from 'vitest';
import { attachmentKeyWrapper, openAttachment, personalAttachmentKeyWrapper, sealAttachment } from './attachmentCrypto';
import { setMemoryCryptoKeyForTests } from './memoryCrypto';
import { decodeAttachmentHeader, encodeAttachmentHeader } from '../../../functions/src/attachmentEnvelope';
const id = '11111111-1111-4111-8111-111111111111';
const keyId = '22222222-2222-4222-8222-222222222222';
const makeKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
beforeEach(() => setMemoryCryptoKeyForTests(null));
it('encrypts filename and bytes under a fresh per-file key, then opens locally with the personal vault and bound context', async () => {
  setMemoryCryptoKeyForTests(await makeKey());
  const bytes = new TextEncoder().encode('Synthetic private file content');
  const input = { id, uid: 'alice', scope: { kind: 'personal' as const, uid: 'alice' }, bytes, name: 'synthetic-secret.md' };
  const sealed = await sealAttachment(input, personalAttachmentKeyWrapper, () => undefined);
  expect(new TextDecoder().decode(sealed.bytes).includes(input.name)).toBe(false);
  expect(new TextDecoder().decode(sealed.bytes).includes(new TextDecoder().decode(bytes))).toBe(false);
  const opened = await openAttachment(sealed.bytes, input, personalAttachmentKeyWrapper, () => undefined);
  expect(opened.metadata.name === input.name).toBe(true); expect(new TextDecoder().decode(opened.bytes) === new TextDecoder().decode(bytes)).toBe(true);
  expect(opened.metadata.delivery).toBe('download-only');
  setMemoryCryptoKeyForTests(await makeKey());
  await expect(openAttachment(sealed.bytes, input, personalAttachmentKeyWrapper, () => undefined)).rejects.toThrow('Não foi possível cifrar ou abrir o anexo.');
});
it('binds the team file to its active epoch/id and prevents another team, file, uploader or old key opening future bytes', async () => {
  const active = attachmentKeyWrapper(await makeKey()); const old = attachmentKeyWrapper(await makeKey());
  const input = { id, uid: 'alice', scope: { kind: 'team' as const, teamId: 'crew', keyEpoch: 2, keyId },
    bytes: Uint8Array.from([137,80,78,71,13,10,26,10]), name: 'synthetic.png', mimeType: 'image/png' };
  const sealed = await sealAttachment(input, active, () => undefined);
  expect((await openAttachment(sealed.bytes, input, active, () => undefined)).metadata.delivery).toBe('preview');
  await expect(openAttachment(sealed.bytes, input, old, () => undefined)).rejects.toBeTruthy();
  for (const changed of [{ id: keyId }, { uid: 'bob' }, { scope: { ...input.scope, teamId: 'other' } }, { scope: { ...input.scope, keyEpoch: 1 } }]) {
    await expect(openAttachment(sealed.bytes, { ...input, ...changed }, active, () => undefined)).rejects.toBeTruthy();
  }
  const decoded = decodeAttachmentHeader(sealed.bytes, sealed.bytes.length);
  const edited = encodeAttachmentHeader({ ...decoded.header, scope: { ...input.scope, teamId: 'other' } });
  const transplanted = new Uint8Array(edited.length + decoded.header.cipherBytes); transplanted.set(edited); transplanted.set(sealed.bytes.subarray(decoded.prefixBytes), edited.length);
  await expect(openAttachment(transplanted, { ...input, scope: { ...input.scope, teamId: 'other' } }, active, () => undefined)).rejects.toBeTruthy();
  const damaged = sealed.bytes.slice(); damaged[damaged.length - 1] ^= 1;
  await expect(openAttachment(damaged, input, active, () => undefined)).rejects.toBeTruthy();
});
it('fails closed for locked vault, mismatched content or changed context instead of returning a prepared file', async () => {
  const input = { id, uid: 'alice', scope: { kind: 'personal' as const, uid: 'alice' }, bytes: new TextEncoder().encode('synthetic'), name: 'synthetic.md' };
  await expect(sealAttachment(input, personalAttachmentKeyWrapper, () => undefined)).rejects.toBeTruthy();
  const wrapper = attachmentKeyWrapper(await makeKey());
  await expect(sealAttachment({ ...input, name: 'synthetic.png', mimeType: 'image/png' }, wrapper, () => undefined)).rejects.toBeTruthy();
  let guards = 0;
  await expect(sealAttachment(input, wrapper, () => { if (++guards === 4) throw Error('context changed'); })).rejects.toThrow('Não foi possível cifrar ou abrir o anexo.');
});
it('bounds file-key wrapping and clears the raw key if wrapping fails', async () => {
  const wrapper = attachmentKeyWrapper(await makeKey()); const aad = new Uint8Array([1]);
  await expect(wrapper.wrap(new Uint8Array(33), aad)).rejects.toBeTruthy();
  await expect(wrapper.unwrap({ iv: 'A'.repeat(16), ct: 'A'.repeat(64000) }, aad)).rejects.toBeTruthy();
  let captured: Uint8Array | undefined;
  await expect(sealAttachment({ id, uid: 'alice', scope: { kind: 'personal', uid: 'alice' },
    bytes: new TextEncoder().encode('synthetic'), name: 'synthetic.md' }, {
    ...wrapper, wrap: async bytes => { captured = bytes; throw Error('synthetic wrapping failure'); },
  }, () => undefined)).rejects.toThrow('Não foi possível cifrar ou abrir o anexo.');
  expect(captured?.length === 32 && captured.every(byte => byte === 0)).toBe(true);
});
