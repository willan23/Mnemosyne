import { vi } from 'vitest';
import { MemoryViewIndex } from '../services/memoryViewIndex';
import type { MemoryViewRequest } from '../services/memoryViewProtocol';

/** Structured-clone transport with the real index; does not emulate Worker scheduling. */
export class MemoryViewWorkerMock {
  static instances: MemoryViewWorkerMock[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  index = new MemoryViewIndex();
  terminate = vi.fn(() => this.index.clear());
  postMessage = vi.fn((request: MemoryViewRequest) => {
    let data: unknown;
    try { data = { v: 1, id: request.id, ok: true, ...this.index.handle(structuredClone(request)) }; }
    catch { data = { v: 1, id: request.id, ok: false }; }
    queueMicrotask(() => { if (!this.terminate.mock.calls.length) this.onmessage?.({ data: structuredClone(data) }); });
  });
  constructor() { MemoryViewWorkerMock.instances.push(this); }
}
