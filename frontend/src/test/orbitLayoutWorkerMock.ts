import { vi } from 'vitest';
import { OrbitLayoutIndex } from '../services/orbitLayoutIndex';
import type { OrbitLayoutMessage } from '../services/orbitLayoutProtocol';
/** Real index and structured-clone boundary; actual scheduling is checked in Chromium. */
export class OrbitLayoutWorkerMock {
  static instances: OrbitLayoutWorkerMock[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null; onmessageerror: (() => void) | null = null;
  index = new OrbitLayoutIndex(); terminate = vi.fn(() => this.index.clear());
  postMessage = vi.fn((message: OrbitLayoutMessage) => {
    let data: unknown; try { data = { v: 1, seq: message.seq, ok: true, ...this.index.handle(structuredClone(message)) }; } catch { data = { v: 1, seq: message.seq, ok: false }; }
    queueMicrotask(() => { if (!this.terminate.mock.calls.length) this.onmessage?.({ data: structuredClone(data) }); });
  });
  constructor() { OrbitLayoutWorkerMock.instances.push(this); }
}
