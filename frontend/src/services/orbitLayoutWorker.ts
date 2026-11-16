import { OrbitLayoutIndex } from './orbitLayoutIndex';
import type { OrbitLayoutMessage } from './orbitLayoutProtocol';
const index = new OrbitLayoutIndex();
self.addEventListener('message', (event: MessageEvent<OrbitLayoutMessage>) => {
  const seq = Number.isSafeInteger(event.data?.seq) ? event.data.seq : null;
  try { self.postMessage({ v: 1, seq, ok: true, ...index.handle(event.data) }); }
  catch { index.clear(); self.postMessage({ v: 1, seq, ok: false }); }
});
