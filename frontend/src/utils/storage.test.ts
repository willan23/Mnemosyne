import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadBytesResumable } from 'firebase/storage';

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytesResumable: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
}));

import { assertFileFitsStorageLimits, compressImage, describeUploadError, uploadFile, validateFile } from './storage';
import { validateAttachmentContent } from '../../../functions/src/attachmentEnvelope';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('storage upload guards', () => {
  it('blocks attachment uploads before contacting Storage during personal launch', async () => {
    await expect(uploadFile(new File(['x'], 'foto.png', { type: 'image/png' }), 'alice'))
      .rejects.toThrow(/novos anexos estão suspensos/i);
    expect(uploadBytesResumable).not.toHaveBeenCalled();
  });
  it('validates empty MIME against image/* using the extension', () => {
    const png = new File(['x'], 'foto.PNG', { type: '' });
    expect(validateFile(png, ['image/*'], 25).valid).toBe(true);
  });

  it('rejects oversize files with a clear message', () => {
    const big = { name: 'scan.pdf', type: 'application/pdf', size: 26 * 1024 * 1024 } as File;
    expect(() => assertFileFitsStorageLimits(big)).toThrow(/demasiado grande/i);
  });

  it('maps Firebase permission errors to an actionable sentence', () => {
    expect(describeUploadError({
      code: 'storage/unauthorized',
      message: 'Firebase Storage: User does not have permission',
    })).toMatch(/armazenamento recusou/i);
  });
  it('compression produces a JPEG filename/MIME/content consistent with the encryption validator', async () => {
    vi.stubGlobal('Image', class {
      width = 100; height = 100; onload?: () => void;
      set src(value: string) { void value; queueMicrotask(() => this.onload?.()); }
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob([Uint8Array.from([255, 216, 255, 224])], { type: 'image/jpeg' })));
    const compressed = await compressImage(new File(['synthetic image'], 'synthetic.PNG', { type: 'image/png' }));
    const bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(compressed);
    }));
    expect(compressed.name).toBe('synthetic.jpg'); expect(validateAttachmentContent(bytes, compressed.name, compressed.type).mimeType).toBe('image/jpeg');
  });
});
