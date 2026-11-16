import { vi } from 'vitest';
import { MemoryViewTransport } from '../services/memoryViewTransport';
import type { MemoryViewMessage } from '../services/memoryViewProtocol';

/** Structured-clone transport with the real index; does not emulate Worker scheduling. */
export class MemoryViewWorkerMock {
  static instances: MemoryViewWorkerMock[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  index = new MemoryViewTransport();
  terminate = vi.fn(() => this.index.clear());
  postMessage = vi.fn((request: MemoryViewMessage) => {
    let data: unknown;
    try { data = { v: 2, id: request.id, ok: true, ...this.index.handle(structuredClone(request)) }; }
    catch { data = { v: 2, id: request.id, ok: false }; }
    queueMicrotask(() => { if (!this.terminate.mock.calls.length) this.onmessage?.({ data: structuredClone(data) }); });
  });
  constructor() { MemoryViewWorkerMock.instances.push(this); }
}
