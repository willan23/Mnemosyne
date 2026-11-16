import { IncrementalSearchIndex, type IncrementalSearchRequest } from './incrementalSearchIndex';

const index = new IncrementalSearchIndex();
self.addEventListener('message', (event: MessageEvent<IncrementalSearchRequest>) => {
  try {
    self.postMessage({ id: event.data.id, ok: true, scores: index.search(event.data) });
  } catch {
    self.postMessage({ id: event.data.id, ok: false });
  }
});
