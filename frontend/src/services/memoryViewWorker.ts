import { MemoryViewTransport } from './memoryViewTransport';
import type { MemoryViewMessage } from './memoryViewProtocol';
const index = new MemoryViewTransport();
self.addEventListener('message', (event: MessageEvent<MemoryViewMessage>) => {
  const id = Number.isSafeInteger(event.data?.id) ? event.data.id : null;
  try { self.postMessage({ v: 2, id, ok: true, ...index.handle(event.data) }); }
  catch { index.clear(); self.postMessage({ v: 2, id, ok: false }); }
});
