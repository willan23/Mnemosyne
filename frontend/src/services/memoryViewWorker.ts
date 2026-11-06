import { MemoryViewIndex } from './memoryViewIndex';
import type { MemoryViewRequest } from './memoryViewProtocol';
const index = new MemoryViewIndex();
self.addEventListener('message', (event: MessageEvent<MemoryViewRequest>) => {
  const id = Number.isSafeInteger(event.data?.id) ? event.data.id : null;
  try { self.postMessage({ v: 1, id, ok: true, ...index.handle(event.data) }); }
  catch { index.clear(); self.postMessage({ v: 1, id, ok: false }); }
});
