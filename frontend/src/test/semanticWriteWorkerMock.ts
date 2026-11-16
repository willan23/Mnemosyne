import { vi } from 'vitest';
import { SemanticWriteIndex } from '../services/semanticWriteIndex';
import type { SemanticWriteMessage } from '../services/semanticWriteProtocol';
export class SemanticWriteWorkerMock {
  static instances: SemanticWriteWorkerMock[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  index = new SemanticWriteIndex();
  terminate = vi.fn(() => this.index.clear());
  postMessage = vi.fn((message: SemanticWriteMessage) => {
    let data: unknown;
    try { data = { v: 1, seq: message.seq, ok: true, scores: this.index.handle(structuredClone(message)) }; }
    catch { data = { v: 1, seq: message.seq, ok: false }; }
    queueMicrotask(() => { if (!this.terminate.mock.calls.length) this.onmessage?.({ data: structuredClone(data) }); });
  });
  constructor() { SemanticWriteWorkerMock.instances.push(this); }
}
