import { validateAttachmentContent } from './attachmentEnvelope';

/** Response model identifiers may only describe the selected model, never arbitrary upstream text. */
export function reportedTextModel(value: unknown, requested: string): string {
  const allowed = requested === 'openai/gpt-oss-120b:nscale'
    ? ['openai/gpt-oss-120b', 'openai/gpt-oss-120b:nscale', 'gpt-oss-120b'] : [requested];
  if (typeof value !== 'string' || (!allowed.includes(value) &&
      !(requested === 'gpt-4o-mini' && /^gpt-4o-mini-\d{4}-\d{2}-\d{2}$/.test(value)))) {
    throw new Error('O fornecedor não identificou o modelo selecionado.');
  }
  return value;
}

/** Validate canonical base64, raster signature and declared dimensions; this is not a full image decoder. */
export function decodeProviderImage(value: unknown): {image_base64: string; media_type: string; width: number; height: number} {
  if (typeof value !== 'string' || value.length < 16 || value.length > 16 * 1024 * 1024 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Bytes de imagem inválidos.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('Bytes de imagem inválidos.');
  let width = 0, height = 0, mediaType: string;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.length >= 33 &&
      bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    validateAttachmentContent(bytes, 'generated.png', 'image/png');
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mediaType = 'image/png';
  } else {
    validateAttachmentContent(bytes, 'generated.jpg', 'image/jpeg'); mediaType = 'image/jpeg';
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (width !== 1024 || height !== 1024) throw new Error('Dimensões de imagem fora da política.');
  return {image_base64: value, media_type: mediaType, width, height};
}
