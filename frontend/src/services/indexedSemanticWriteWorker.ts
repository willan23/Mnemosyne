import { IndexedSemanticWriteIndex } from './indexedSemanticWriteIndex';
import type { IndexedSemanticWriteMessage } from './indexedSemanticWriteProtocol';
const index = new IndexedSemanticWriteIndex();
self.addEventListener('message', (event: MessageEvent<IndexedSemanticWriteMessage>) => {
  const seq = Number.isSafeInteger(event.data?.seq) ? event.data.seq : null;
  try { self.postMessage({ v: 1, seq, ok: true, ...index.handle(event.data) }); }
  catch { index.clear(); self.postMessage({ v: 1, seq, ok: false }); }
});
