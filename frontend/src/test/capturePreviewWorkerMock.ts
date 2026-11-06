import { vi } from 'vitest';
import { CapturePreviewIndex, type CapturePreviewRequest } from '../services/capturePreviewIndex';
export class CapturePreviewWorkerMock {
  static instances: CapturePreviewWorkerMock[] = [];
  private index = new CapturePreviewIndex();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() { CapturePreviewWorkerMock.instances.push(this); }
  postMessage = vi.fn((input: CapturePreviewRequest) => {
    const message = structuredClone(input);
    queueMicrotask(() => {
      try { this.onmessage?.({ data: { v: 1, id: message.id, ok: true, hits: this.index.handle(message) } }); }
      catch { this.onmessage?.({ data: { v: 1, id: message.id, ok: false } }); }
    });
  });
  terminate = vi.fn(() => { this.index.clear(); });
}
