import { CapturePreviewIndex } from './capturePreviewIndex';
const index = new CapturePreviewIndex();
self.onmessage = event => {
  try { self.postMessage({ v: 1, id: event.data?.id, ok: true, hits: index.handle(event.data) }); }
  catch { index.clear(); self.postMessage({ v: 1, id: event.data?.id, ok: false }); }
};
