import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { embeddingService, legacyEmbeddingService, embeddingServiceForProfile, resetEmbeddingServices } from './embeddingService';
import { LEGACY_EMBEDDING_SPACE } from './embeddingModel';
import { embeddingProfileSpace } from './embeddingProfile';
import type { EmbeddingWorkerRequest, EmbeddingWorkerResponse } from './embeddingWorkerProtocol';

class FakeEmbeddingWorker {
  static instances: FakeEmbeddingWorker[] = [];
  static pauseEmbeddings = false;
  onmessage: ((event: MessageEvent<EmbeddingWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: EmbeddingWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeEmbeddingWorker.instances.push(this);
  }

  postMessage(request: EmbeddingWorkerRequest) {
    this.messages.push(request);
    if (request.type === 'initialize') {
      queueMicrotask(() => this.reply({ id: request.id, ok: true }));
    } else if (!FakeEmbeddingWorker.pauseEmbeddings) {
      const embedding = request.text === 'alpha' ? [1, 0] : [0, 1];
      queueMicrotask(() => this.reply({ id: request.id, ok: true, embedding }));
    }
  }

  reply(response: EmbeddingWorkerResponse) {
    if (!this.terminated) this.onmessage?.({ data: response } as MessageEvent<EmbeddingWorkerResponse>);
  }

  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeEmbeddingWorker.instances = [];
  FakeEmbeddingWorker.pauseEmbeddings = false;
  vi.stubGlobal('Worker', FakeEmbeddingWorker);
});

afterEach(() => {
  resetEmbeddingServices();
  vi.unstubAllGlobals();
});

describe('embeddingService local worker', () => {
  it('uses the reviewed multilingual profile for new embeddings and retains a distinct legacy route', async () => {
    expect(embeddingService.space).toBe(embeddingProfileSpace('multilingualCandidate'));
    expect(embeddingService).toBe(embeddingServiceForProfile('multilingualCandidate'));
    expect(legacyEmbeddingService).not.toBe(embeddingService);
    await embeddingService.getEmbedding('alpha');
    expect(FakeEmbeddingWorker.instances[0].messages.every(message => message.profile === 'multilingualCandidate')).toBe(true);
  });
  it('keeps the historical worker explicitly bound to its original space', () => {
    expect(legacyEmbeddingService.space).toBe(LEGACY_EMBEDDING_SPACE);
    expect(embeddingService).not.toBe(legacyEmbeddingService);
  });
  it('isolates pinned profiles from the legacy worker and clears all profiles on vault reset', async () => {
    const candidate = embeddingServiceForProfile('englishPinned');
    expect(candidate.space).toContain('@751bff37182d3f1213fa05d7196b954e230abad9:q8:mean:norm');
    expect(candidate.space).not.toBe(embeddingService.space);
    await legacyEmbeddingService.getEmbedding('alpha');
    await embeddingService.getEmbedding('alpha');
    await candidate.getEmbedding('alpha');
    expect(FakeEmbeddingWorker.instances).toHaveLength(3);
    expect(FakeEmbeddingWorker.instances[0].messages[0].profile).toBeUndefined();
    expect(FakeEmbeddingWorker.instances[1].messages.every(message => message.profile === 'multilingualCandidate')).toBe(true);
    expect(FakeEmbeddingWorker.instances[2].messages.every(message => message.profile === 'englishPinned')).toBe(true);
    resetEmbeddingServices();
    expect(FakeEmbeddingWorker.instances.every(worker => worker.terminated)).toBe(true);
    expect(candidate.getCacheStats().size).toBe(0);
    expect(embeddingService.getCacheStats().size).toBe(0);
    expect(legacyEmbeddingService.getCacheStats().size).toBe(0);
  });
  it('sends plaintext only to the local worker and reuses cached vectors', async () => {
    expect(await embeddingService.getEmbedding('alpha')).toEqual([1, 0]);
    expect(await embeddingService.getEmbedding('alpha')).toEqual([1, 0]);
    expect(FakeEmbeddingWorker.instances).toHaveLength(1);
    expect(FakeEmbeddingWorker.instances[0].messages.filter((message) => message.type === 'embed'))
      .toEqual([expect.objectContaining({ text: 'alpha' })]);
  });

  it('reuses stored candidates and excludes vectors from other model spaces', async () => {
    const current = { id: 'current', text: 'candidate', embedding: [0.9, 0.1] };
    const future = { id: 'future', text: 'candidate', embedding: [1, 0], embeddingModel: 'future@1' };
    const missing = { id: 'missing', text: 'beta', embedding: [] };
    const matches = await legacyEmbeddingService.findSimilarMemories(
      { id: 'target', text: 'alpha' }, [current, future, missing], 0.8,
    );
    expect(matches.map(({ memory }) => memory.id)).toEqual(['current']);
    expect(FakeEmbeddingWorker.instances[0].messages.filter((message) => message.type === 'embed'))
      .toEqual([expect.objectContaining({ text: 'alpha' }), expect.objectContaining({ text: 'beta' })]);
  });

  it('uses stored future vectors without generating incompatible current-model vectors', async () => {
    const matches = await embeddingService.findSimilarMemories(
      { id: 'target', text: 'alpha', embedding: [1, 0], embeddingModel: 'future@1' },
      [{ id: 'match', text: 'candidate', embedding: [1, 0], embeddingModel: 'future@1' }],
      0.8,
    );
    expect(matches.map(({ memory }) => memory.id)).toEqual(['match']);
    expect(FakeEmbeddingWorker.instances).toHaveLength(0);
  });

  it('rejects pending work and terminates the worker when the vault changes', async () => {
    FakeEmbeddingWorker.pauseEmbeddings = true;
    const pending = embeddingService.getEmbedding('alpha');
    await vi.waitFor(() => expect(FakeEmbeddingWorker.instances[0]?.messages.some(
      (message) => message.type === 'embed',
    )).toBe(true));
    embeddingService.clearCache();
    await expect(pending).rejects.toThrow('cofre mudou');
    expect(FakeEmbeddingWorker.instances[0].terminated).toBe(true);
  });

  it('rejects an embedding resolved immediately before the vault reset reaches the awaiting caller', async () => {
    FakeEmbeddingWorker.pauseEmbeddings = true;
    const pending = embeddingService.getEmbedding('alpha');
    await vi.waitFor(() => expect(FakeEmbeddingWorker.instances[0]?.messages.some(message => message.type === 'embed')).toBe(true));
    const worker = FakeEmbeddingWorker.instances[0], request = worker.messages.find(message => message.type === 'embed')!;
    worker.reply({id:request.id,ok:true,embedding:[1,0]});
    embeddingService.clearCache();
    await expect(pending).rejects.toThrow('cofre mudou');
  });

  it('starts a fresh worker after a processing failure', async () => {
    FakeEmbeddingWorker.pauseEmbeddings = true;
    const pending = embeddingService.getEmbedding('alpha');
    await vi.waitFor(() => expect(FakeEmbeddingWorker.instances[0]?.messages.some(
      (message) => message.type === 'embed',
    )).toBe(true));
    FakeEmbeddingWorker.instances[0].onerror?.();
    await expect(pending).rejects.toThrow('processamento local');
    FakeEmbeddingWorker.pauseEmbeddings = false;
    expect(await embeddingService.getEmbedding('alpha')).toEqual([1, 0]);
    expect(FakeEmbeddingWorker.instances).toHaveLength(2);
  });
});
