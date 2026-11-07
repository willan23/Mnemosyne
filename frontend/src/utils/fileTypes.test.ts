import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_FILE_ACCEPT,
  fileExtension,
  fileMatchesAllowedTypes,
  inferUploadContentType,
  maxUploadBytesForFile,
  sanitizeStorageFileName,
  uploadKindForFile,
} from './fileTypes';

describe('fileTypes', () => {
  it('infers MIME when Windows sends an empty type', () => {
    const md = new File(['# hi'], 'Notas.MD', { type: '' });
    expect(fileExtension(md.name)).toBe('md');
    expect(inferUploadContentType(md)).toBe('text/plain');
    expect(uploadKindForFile(md)).toBe('document');
    expect(sanitizeStorageFileName(md.name)).toBe('Notas.md');
  });

  it('does not treat TypeScript as MPEG-TS video', () => {
    const ts = new File(['export {}'], 'app.ts', { type: 'video/mp2t' });
    expect(inferUploadContentType(ts)).toBe('text/plain');
    expect(uploadKindForFile(ts)).toBe('document');
  });

  it('matches image/* using the extension when MIME is empty', () => {
    const png = new File(['x'], 'foto.PNG', { type: '' });
    expect(fileMatchesAllowedTypes(png, ['image/*'])).toBe(true);
  });

  it('caps documents at 25 MB like storage.rules', () => {
    const pdf = new File(['x'], 'scan.pdf', { type: 'application/pdf' });
    expect(maxUploadBytesForFile(pdf)).toBe(25 * 1024 * 1024);
  });

  it('exposes document accept tokens the file picker uses', () => {
    expect(DOCUMENT_FILE_ACCEPT).toContain('.pdf');
    expect(DOCUMENT_FILE_ACCEPT).toContain('.ts');
    expect(DOCUMENT_FILE_ACCEPT).toContain('image/*');
  });
});
