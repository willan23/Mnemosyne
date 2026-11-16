/** Pure canonical attachment policy/format, imported by both backend and browser. No network or secrets. */
export type AttachmentCategory = 'image' | 'audio' | 'document' | 'video';
export type AttachmentScope = { kind: 'personal'; uid: string } | { kind: 'team'; teamId: string; keyEpoch: number; keyId: string };
export interface AttachmentEnvelopeHeader {
  v: 1; id: string; uid: string; scope: AttachmentScope; category: AttachmentCategory;
  plainBytes: number; metadataBytes: number; cipherBytes: number; iv: string; wrappedKey: { iv: string; ct: string };
}
export const ATTACHMENT_MAGIC = new Uint8Array([77, 78, 69, 77, 65, 84, 84, 49]); // MNEMATT1
export const MAX_ATTACHMENT_HEADER_BYTES = 2048;
export const MAX_ATTACHMENT_METADATA_BYTES = 4096;
export const ATTACHMENT_MAX_BYTES = { image: 25 * 1024 * 1024, document: 25 * 1024 * 1024, audio: 50 * 1024 * 1024, video: 200 * 1024 * 1024 } as const;
export class AttachmentPolicyError extends Error { constructor() { super('Formato do anexo não permitido.'); } }
export const attachmentIdValid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const attachmentActorIdValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') &&
  !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const map = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const keys = (value: Record<string, unknown>, fields: string[]) => Object.keys(value).length === fields.length && fields.every(field => field in value);
const ivValid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9+/]{16}$/.test(value);
export function parseAttachmentScope(input: unknown): AttachmentScope {
  if (!map(input)) throw new AttachmentPolicyError();
  if (input.kind === 'personal' && keys(input, ['kind', 'uid']) && attachmentActorIdValid(input.uid)) return { kind: 'personal', uid: input.uid };
  if (input.kind === 'team' && keys(input, ['kind', 'teamId', 'keyEpoch', 'keyId']) && attachmentActorIdValid(input.teamId) &&
      Number.isSafeInteger(input.keyEpoch) && (input.keyEpoch as number) >= 1 && attachmentIdValid(input.keyId)) {
    return { kind: 'team', teamId: input.teamId, keyEpoch: input.keyEpoch as number, keyId: input.keyId };
  }
  throw new AttachmentPolicyError();
}
export function attachmentKeyBinding(header: Pick<AttachmentEnvelopeHeader, 'id' | 'uid' | 'scope'>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ purpose: 'mnemosyne:attachment-key:v1', id: header.id, uid: header.uid, scope: parseAttachmentScope(header.scope) }));
}
export function parseAttachmentHeader(input: unknown): AttachmentEnvelopeHeader {
  if (!map(input) || !keys(input, ['v', 'id', 'uid', 'scope', 'category', 'plainBytes', 'metadataBytes', 'cipherBytes', 'iv', 'wrappedKey']) ||
      input.v !== 1 || !attachmentIdValid(input.id) || !attachmentActorIdValid(input.uid) ||
      typeof input.category !== 'string' || !Object.prototype.hasOwnProperty.call(ATTACHMENT_MAX_BYTES, input.category) ||
      !Number.isSafeInteger(input.plainBytes) || (input.plainBytes as number) < 1 ||
      (input.plainBytes as number) > ATTACHMENT_MAX_BYTES[input.category as AttachmentCategory] ||
      !Number.isSafeInteger(input.metadataBytes) || (input.metadataBytes as number) < 2 || (input.metadataBytes as number) > MAX_ATTACHMENT_METADATA_BYTES ||
      input.cipherBytes !== (input.plainBytes as number) + (input.metadataBytes as number) + 4 + 16 || !ivValid(input.iv) ||
      !map(input.wrappedKey) || !keys(input.wrappedKey, ['iv', 'ct']) || !ivValid(input.wrappedKey.iv) ||
      typeof input.wrappedKey.ct !== 'string' || !/^[A-Za-z0-9+/]{64}$/.test(input.wrappedKey.ct)) throw new AttachmentPolicyError();
  const scope = parseAttachmentScope(input.scope);
  if (scope.kind === 'personal' && scope.uid !== input.uid) throw new AttachmentPolicyError();
  return { v: 1, id: input.id, uid: input.uid, scope, category: input.category as AttachmentCategory,
    plainBytes: input.plainBytes as number, metadataBytes: input.metadataBytes as number, cipherBytes: input.cipherBytes as number,
    iv: input.iv, wrappedKey: { iv: input.wrappedKey.iv, ct: input.wrappedKey.ct } };
}
export function encodeAttachmentHeader(input: AttachmentEnvelopeHeader): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(parseAttachmentHeader(input)));
  if (json.byteLength > MAX_ATTACHMENT_HEADER_BYTES) throw new AttachmentPolicyError();
  const prefix = new Uint8Array(12 + json.byteLength); prefix.set(ATTACHMENT_MAGIC);
  new DataView(prefix.buffer).setUint32(8, json.byteLength, false); prefix.set(json, 12); return prefix;
}
/** Backend uses a bounded range read plus trusted object size; browser uses the full blob. */
export function decodeAttachmentHeader(prefix: Uint8Array, totalBytes: number): { header: AttachmentEnvelopeHeader; prefixBytes: number; aad: Uint8Array } {
  if (prefix.byteLength < 12 || !ATTACHMENT_MAGIC.every((byte, index) => prefix[index] === byte)) throw new AttachmentPolicyError();
  const length = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(8, false);
  if (length < 2 || length > MAX_ATTACHMENT_HEADER_BYTES || prefix.byteLength < 12 + length) throw new AttachmentPolicyError();
  let header: AttachmentEnvelopeHeader;
  try { header = parseAttachmentHeader(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(prefix.subarray(12, 12 + length)))); }
  catch { throw new AttachmentPolicyError(); }
  const canonical = encodeAttachmentHeader(header);
  if (totalBytes !== canonical.byteLength + header.cipherBytes || !canonical.every((byte, index) => byte === prefix[index])) throw new AttachmentPolicyError();
  return { header, prefixBytes: canonical.byteLength, aad: canonical };
}

export interface AttachmentContentPolicy { category: AttachmentCategory; mimeType: string; delivery: 'preview' | 'download-only' }
const textExtensions = new Set('txt md markdown csv json jsonld log xml yaml yml py js jsx ts tsx mjs cjs rs go c cpp h hpp java kt swift sh bat ps1 sql css scss ini toml conf env vue svelte mdx'.split(' '));
const signature = (bytes: Uint8Array, expected: number[], offset = 0) => expected.every((byte, index) => bytes[offset + index] === byte);
const specs: Record<string, { category: AttachmentCategory; mimeType: string; signature: string }> = {
  png: { category: 'image', mimeType: 'image/png', signature: 'png' }, apng: { category: 'image', mimeType: 'image/png', signature: 'png' },
  jpg: { category: 'image', mimeType: 'image/jpeg', signature: 'jpeg' }, jpeg: { category: 'image', mimeType: 'image/jpeg', signature: 'jpeg' },
  gif: { category: 'image', mimeType: 'image/gif', signature: 'gif' }, webp: { category: 'image', mimeType: 'image/webp', signature: 'webp' },
  bmp: { category: 'image', mimeType: 'image/bmp', signature: 'bmp' }, avif: { category: 'image', mimeType: 'image/avif', signature: 'avif' },
  heic: { category: 'image', mimeType: 'image/heic', signature: 'heic' }, heif: { category: 'image', mimeType: 'image/heif', signature: 'heic' },
  mp3: { category: 'audio', mimeType: 'audio/mpeg', signature: 'mp3' }, wav: { category: 'audio', mimeType: 'audio/wav', signature: 'wav' },
  flac: { category: 'audio', mimeType: 'audio/flac', signature: 'flac' }, aac: { category: 'audio', mimeType: 'audio/aac', signature: 'aac' },
  m4a: { category: 'audio', mimeType: 'audio/mp4', signature: 'audio-mp4' }, ogg: { category: 'audio', mimeType: 'audio/ogg', signature: 'ogg' },
  oga: { category: 'audio', mimeType: 'audio/ogg', signature: 'ogg' }, opus: { category: 'audio', mimeType: 'audio/ogg', signature: 'ogg' },
  mp4: { category: 'video', mimeType: 'video/mp4', signature: 'mp4' }, m4v: { category: 'video', mimeType: 'video/mp4', signature: 'mp4' },
  mov: { category: 'video', mimeType: 'video/quicktime', signature: 'mp4' }, avi: { category: 'video', mimeType: 'video/x-msvideo', signature: 'avi' },
  mkv: { category: 'video', mimeType: 'video/x-matroska', signature: 'webm' }, webm: { category: 'video', mimeType: 'video/webm', signature: 'webm' },
  ogv: { category: 'video', mimeType: 'video/ogg', signature: 'ogg' }, mpeg: { category: 'video', mimeType: 'video/mpeg', signature: 'mpeg' },
  mpg: { category: 'video', mimeType: 'video/mpeg', signature: 'mpeg' }, pdf: { category: 'document', mimeType: 'application/pdf', signature: 'pdf' },
};
/** Original bytes are inspected locally. Backend may use this only for separately consented plaintext. */
export function validateAttachmentContent(bytes: Uint8Array, name: string, suppliedMime = ''): AttachmentContentPolicy {
  if (typeof name !== 'string' || name.length < 1 || new TextEncoder().encode(name).length > 1024 ||
      Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new AttachmentPolicyError();
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const officeZip = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'pages', 'key', 'numbers'].includes(extension);
  const officeOle = ['doc', 'xls', 'ppt'].includes(extension);
  const activeText = ['svg', 'html', 'htm'].includes(extension);
  const spec = specs[extension];
  const audioWebm = extension === 'webm' && suppliedMime.split(';')[0].trim().toLowerCase() === 'audio/webm';
  const category = audioWebm ? 'audio' : spec?.category ?? 'document';
  if (bytes.byteLength < 1 || bytes.byteLength > ATTACHMENT_MAX_BYTES[category]) throw new AttachmentPolicyError();
  const prefix = (expected: number[], offset = 0) => signature(bytes, expected, offset);
  const bmff = prefix([102, 116, 121, 112], 4);
  const brands = new TextDecoder().decode(bytes.subarray(8, 64));
  let valid = false;
  if (spec) {
    const sig = spec.signature;
    valid = (sig === 'png' && prefix([137, 80, 78, 71, 13, 10, 26, 10])) || (sig === 'jpeg' && prefix([255, 216, 255])) ||
      (sig === 'gif' && (prefix([71, 73, 70, 56, 55, 97]) || prefix([71, 73, 70, 56, 57, 97]))) ||
      (sig === 'webp' && prefix([82, 73, 70, 70]) && prefix([87, 69, 66, 80], 8)) || (sig === 'bmp' && prefix([66, 77])) ||
      (sig === 'avif' && bmff && /avif|avis/.test(brands)) || (sig === 'heic' && bmff && /heic|heix|hevc|hevx|mif1|msf1/.test(brands)) ||
      (sig === 'mp3' && (prefix([73, 68, 51]) || (bytes[0] === 255 && (bytes[1] & 224) === 224))) ||
      (sig === 'aac' && bytes[0] === 255 && (bytes[1] & 246) === 240) || (sig === 'wav' && prefix([82, 73, 70, 70]) && prefix([87, 65, 86, 69], 8)) ||
      (sig === 'flac' && prefix([102, 76, 97, 67])) || (sig === 'ogg' && prefix([79, 103, 103, 83])) ||
      (['mp4', 'audio-mp4'].includes(sig) && bmff && !/avif|avis|heic|heix|hevc|hevx/.test(brands)) ||
      (sig === 'avi' && prefix([82, 73, 70, 70]) && prefix([65, 86, 73, 32], 8)) || (sig === 'webm' && prefix([26, 69, 223, 163])) ||
      (sig === 'mpeg' && prefix([0, 0, 1]) && [179, 186].includes(bytes[3])) || (sig === 'pdf' && prefix([37, 80, 68, 70, 45]));
  } else if (officeZip) valid = prefix([80, 75, 3, 4]) || prefix([80, 75, 5, 6]);
  else if (officeOle) valid = prefix([208, 207, 17, 224, 161, 177, 26, 225]);
  else if (extension === 'rtf') valid = prefix([123, 92, 114, 116, 102]);
  else if (textExtensions.has(extension) || activeText) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      valid = !Array.from(text).some(char => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)));
    } catch { valid = false; }
  }
  const mime = suppliedMime.split(';')[0].trim().toLowerCase();
  const alias = spec?.signature === 'wav' && ['audio/x-wav', 'audio/wave'].includes(mime);
  if (!valid || (spec && mime && mime !== 'application/octet-stream' && mime !== (audioWebm ? 'audio/webm' : spec.mimeType) && !alias)) throw new AttachmentPolicyError();
  // Only raster/browser-safe media have an inline preview. Documents/code/SVG/HTML stay download-only.
  const preview = category !== 'document' && !['heic', 'heif', 'mkv', 'avi', 'mpeg', 'mpg', 'mov'].includes(extension);
  return { category, mimeType: preview ? (audioWebm ? 'audio/webm' : spec!.mimeType) : 'application/octet-stream', delivery: preview ? 'preview' : 'download-only' };
}
