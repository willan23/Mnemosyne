import { HybridSearchIndex } from './hybridSearchIndex';
import type { HybridSearchRequest } from './hybridSearchProtocol';

const index = new HybridSearchIndex();
self.addEventListener('message', (event: MessageEvent<HybridSearchRequest>) => {
  const id = Number.isSafeInteger(event.data?.id) ? event.data.id : null;
  try { self.postMessage({ id, ok: true, ...index.handle(event.data) }); }
  catch { index.clear(); self.postMessage({ id, ok: false }); }
});
