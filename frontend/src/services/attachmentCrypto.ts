import { attachmentActorIdValid, attachmentIdValid, attachmentKeyBinding, decodeAttachmentHeader, encodeAttachmentHeader,
  MAX_ATTACHMENT_METADATA_BYTES, parseAttachmentScope, validateAttachmentContent,
  type AttachmentEnvelopeHeader, type AttachmentScope, type AttachmentContentPolicy } from '../../../functions/src/attachmentEnvelope';
import { decryptMemoryBinary, encryptMemoryBinary } from './memoryCrypto';

export class AttachmentCryptoError extends Error { constructor() { super('Não foi possível cifrar ou abrir o anexo.'); } }
export interface AttachmentKeyWrapper {
  wrap: (bytes: Uint8Array, aad: Uint8Array) => Promise<{ iv: string; ct: string }>;
  unwrap: (envelope: { iv: string; ct: string }, aad: Uint8Array) => Promise<Uint8Array>;
}
export const personalAttachmentKeyWrapper: AttachmentKeyWrapper = { wrap: encryptMemoryBinary, unwrap: decryptMemoryBinary };
const fromBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const toBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value)); // only the bounded wrapped key and IV
export const attachmentKeyWrapper = (key: CryptoKey): AttachmentKeyWrapper => ({
  wrap: async (bytes, aad) => {
    if (bytes.byteLength !== 32 || aad.byteLength < 1 || aad.byteLength > 2048) throw new AttachmentCryptoError();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer, additionalData: new Uint8Array(aad).buffer }, key, new Uint8Array(bytes).buffer);
    return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
  },
  unwrap: async (envelope, aad) => {
    if (!/^[A-Za-z0-9+/]{16}$/.test(envelope.iv) || !/^[A-Za-z0-9+/]{64}$/.test(envelope.ct) ||
        aad.byteLength < 1 || aad.byteLength > 2048) throw new AttachmentCryptoError();
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv).buffer,
      additionalData: new Uint8Array(aad).buffer }, key, fromBase64(envelope.ct).buffer));
  },
});
export interface OpenAttachmentMetadata extends AttachmentContentPolicy { name: string; plainBytes: number }
/** Encrypts filename/MIME/content under a fresh file key; header and wrap are bound to the immutable scope/id. */
export async function sealAttachment(input: { id: string; uid: string; scope: AttachmentScope; bytes: Uint8Array; name: string; mimeType?: string },
  wrapper: AttachmentKeyWrapper, guard: () => void): Promise<{ header: AttachmentEnvelopeHeader; bytes: Uint8Array }> {
  let raw: Uint8Array | undefined; let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    guard(); if (!attachmentIdValid(input.id) || !attachmentActorIdValid(input.uid)) throw new AttachmentCryptoError();
    const scope = parseAttachmentScope(input.scope); const policy = validateAttachmentContent(input.bytes, input.name, input.mimeType);
    const metadata: OpenAttachmentMetadata = { name: input.name, plainBytes: input.bytes.byteLength, ...policy };
    const encodedMetadata = new TextEncoder().encode(JSON.stringify(metadata));
    if (encodedMetadata.byteLength > MAX_ATTACHMENT_METADATA_BYTES) throw new AttachmentCryptoError();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); guard();
    raw = new Uint8Array(await crypto.subtle.exportKey('raw', key)); guard();
    const wrappedKey = await wrapper.wrap(raw, attachmentKeyBinding({ id: input.id, uid: input.uid, scope })); raw.fill(0); guard();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const header: AttachmentEnvelopeHeader = { v: 1, id: input.id, uid: input.uid, scope, category: policy.category,
      plainBytes: input.bytes.byteLength, metadataBytes: encodedMetadata.byteLength,
      cipherBytes: 4 + encodedMetadata.byteLength + input.bytes.byteLength + 16, iv: toBase64(iv), wrappedKey };
    const aad = encodeAttachmentHeader(header);
    plaintext = new Uint8Array(4 + encodedMetadata.byteLength + input.bytes.byteLength);
    new DataView(plaintext.buffer).setUint32(0, encodedMetadata.byteLength, false); plaintext.set(encodedMetadata, 4); plaintext.set(input.bytes, 4 + encodedMetadata.byteLength);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer, additionalData: new Uint8Array(aad).buffer }, key, plaintext.buffer);
    plaintext.fill(0); guard();
    const bytes = new Uint8Array(aad.byteLength + cipher.byteLength); bytes.set(aad); bytes.set(new Uint8Array(cipher), aad.byteLength);
    return { header, bytes };
  } catch { throw new AttachmentCryptoError(); }
  finally { raw?.fill(0); plaintext?.fill(0); }
}
export async function openAttachment(blob: Uint8Array, expected: { id: string; uid: string; scope: AttachmentScope },
  wrapper: AttachmentKeyWrapper, guard: () => void): Promise<{ metadata: OpenAttachmentMetadata; bytes: Uint8Array }> {
  let raw: Uint8Array | undefined; let plaintext: Uint8Array | undefined; let openedBytes: Uint8Array | undefined; let delivered = false;
  try {
    guard(); const { header, prefixBytes, aad } = decodeAttachmentHeader(blob, blob.byteLength);
    if (header.id !== expected.id || header.uid !== expected.uid || JSON.stringify(header.scope) !== JSON.stringify(parseAttachmentScope(expected.scope))) throw new AttachmentCryptoError();
    raw = await wrapper.unwrap(header.wrappedKey, attachmentKeyBinding(header)); guard();
    if (raw.byteLength !== 32) throw new AttachmentCryptoError();
    const key = await crypto.subtle.importKey('raw', new Uint8Array(raw).buffer, { name: 'AES-GCM' }, false, ['decrypt']); raw.fill(0); guard();
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(header.iv).buffer, additionalData: new Uint8Array(aad).buffer },
      key, new Uint8Array(blob.subarray(prefixBytes)).buffer)); guard();
    const length = new DataView(plaintext.buffer).getUint32(0, false);
    if (length !== header.metadataBytes || plaintext.byteLength !== 4 + length + header.plainBytes) throw new AttachmentCryptoError();
    const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext.subarray(4, 4 + length))) as OpenAttachmentMetadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
        Object.keys(metadata).sort().join(',') !== 'category,delivery,mimeType,name,plainBytes' || metadata.plainBytes !== header.plainBytes ||
        typeof metadata.name !== 'string' || typeof metadata.mimeType !== 'string') throw new AttachmentCryptoError();
    const bytes = plaintext.slice(4 + length); openedBytes = bytes; plaintext.fill(0);
    const policy = validateAttachmentContent(bytes, metadata.name, metadata.mimeType);
    if (policy.category !== header.category || metadata.category !== policy.category || metadata.delivery !== policy.delivery || metadata.mimeType !== policy.mimeType) {
      bytes.fill(0); throw new AttachmentCryptoError();
    }
    guard(); delivered = true; return { metadata, bytes };
  } catch { throw new AttachmentCryptoError(); }
  finally { raw?.fill(0); plaintext?.fill(0); if (!delivered) openedBytes?.fill(0); }
}
