import { SemanticWriteIndex } from './semanticWriteIndex';
import type { SemanticWriteMessage } from './semanticWriteProtocol';
const index = new SemanticWriteIndex();
self.addEventListener('message', (event: MessageEvent<SemanticWriteMessage>) => {
  const seq = Number.isSafeInteger(event.data?.seq) ? event.data.seq : null;
  try { self.postMessage({ v: 1, seq, ok: true, scores: index.handle(event.data) }); }
  catch { index.clear(); self.postMessage({ v: 1, seq, ok: false }); }
});
