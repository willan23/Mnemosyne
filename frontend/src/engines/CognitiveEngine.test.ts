import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryObject } from '../types/universe';
import { CognitiveEngine } from './CognitiveEngine';
import { embeddingService } from '../services/embeddingService';
import { CURRENT_EMBEDDING_SPACE } from '../services/embeddingModel';
import { SemanticWriteWorkerMock } from '../test/semanticWriteWorkerMock';

beforeEach(() => { SemanticWriteWorkerMock.instances = []; vi.stubGlobal('Worker', SemanticWriteWorkerMock); });
afterEach(() => vi.unstubAllGlobals());

const memory = (overrides: Partial<MemoryObject> & Pick<MemoryObject, 'id' | 'embedding'>): MemoryObject => ({
  text: `Memory ${overrides.id}`,
  celestialType: 'planet',
  position: [0, 0, 0],
  connections: [],
  importance: 0.5,
  timestamp: 1,
  updatedAt: 1,
  uid: 'user-1',
  embeddingModel: CURRENT_EMBEDDING_SPACE,
  ...overrides,
});

describe('CognitiveEngine autolink and graph behavior', () => {
  it('keeps the cluster, centroid and importance while performing no candidate cosine work on the UI thread', async () => {
    const generated = vi.spyOn(embeddingService, 'getEmbedding').mockResolvedValue([1, 0]);
    const cosine = vi.spyOn(embeddingService, 'cosineSimilarity').mockImplementation(() => { throw Error('UI cosine forbidden'); });
    const jitter = vi.spyOn(Math, 'random').mockReturnValue(.5);
    try {
      const result = await new CognitiveEngine().processMemory('A synthetic thought', [
        memory({ id: 'first', embedding: [.8, .2], position: [2, 4, 6], semanticClusterId: 'cluster-a' }),
        memory({ id: 'strong', embedding: [1, 0], position: [6, 8, 10], semanticClusterId: 'cluster-b' }),
        memory({ id: 'other', embedding: [0, 1], position: [100, 100, 100] }),
      ]);
      expect(result.connections).toEqual(['strong', 'first']); expect(result.position).toEqual([4, 6, 8]);
      expect(result.semanticClusterId).toBe('cluster-a'); expect(result.celestialType).toBe('star');
      expect(cosine).not.toHaveBeenCalled(); expect(SemanticWriteWorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
    } finally { generated.mockRestore(); cosine.mockRestore(); jitter.mockRestore(); }
  });
  it('preserves the distinction between an empty scope and a populated scope with no compatible vectors', async () => {
    const generated = vi.spyOn(embeddingService, 'getEmbedding').mockResolvedValue([1, 0]), jitter = vi.spyOn(Math, 'random').mockReturnValue(.5);
    try {
      const engine = new CognitiveEngine();
      expect(await engine.processMemory('Synthetic', [])).toMatchObject({ celestialType: 'sun', importance: 1, position: [0, 0, 0] });
      const unrelated = await engine.processMemory('Synthetic', [memory({ id: 'legacy', embedding: [1, 0], embeddingModel: undefined })]);
      expect(unrelated).toMatchObject({ celestialType: 'star', importance: .3, connections: [] });
      expect(unrelated.position).not.toEqual([0, 0, 0]); expect(SemanticWriteWorkerMock.instances).toHaveLength(0);
    } finally { generated.mockRestore(); jitter.mockRestore(); }
  });
  it('marks new memory vectors with the default multilingual space and never autolinks unmarked legacy vectors', async () => {
    const generated = vi.spyOn(embeddingService, 'getEmbedding').mockResolvedValue([1,0,0]);
    try {
      expect(embeddingService.space).toBe(CURRENT_EMBEDDING_SPACE);
      const result = await new CognitiveEngine().processMemory('Synthetic new multilingual memory', [
        memory({id:'current',embedding:[1,0,0]}),memory({id:'legacy',embedding:[1,0,0],embeddingModel:undefined}),
      ]);
      expect(result.embeddingModel).toBe(CURRENT_EMBEDDING_SPACE);
      expect(result.connections).toEqual(['current']);
    } finally { generated.mockRestore(); }
  });
  it('finds only semantically similar memories and orders strongest links first', async () => {
    const engine = new CognitiveEngine();
    const result = await engine.findConnections([1, 0, 0], [
      memory({ id: 'strong', embedding: [0.98, 0.02, 0] }),
      memory({ id: 'weak', embedding: [0.2, 0.8, 0] }),
      memory({ id: 'medium', embedding: [0.7, 0.3, 0] }),
      memory({ id: 'empty', embedding: [] }),
    ]);

    expect(result.connections).toEqual(['strong', 'medium']);
    expect(result.importance).toBeGreaterThan(0.6);
    expect(result.importance).toBeLessThanOrEqual(1);
  });

  it('caps automatic links at seven memories', async () => {
    const engine = new CognitiveEngine();
    const existing = Array.from({ length: 10 }, (_, index) => (
      memory({ id: `m-${index}`, embedding: [1 - index * 0.01, index * 0.01, 0] })
    ));

    const result = await engine.findConnections([1, 0, 0], existing);

    expect(result.connections).toHaveLength(7);
    expect(result.connections).toEqual(['m-0', 'm-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6']);
  });

  it('builds graph edges only for valid declared connections', () => {
    const engine = new CognitiveEngine();
    const graph = engine.buildCognitiveGraph([
      memory({ id: 'a', embedding: [1, 0], connections: ['b', 'missing'], position: [1, 0, 0] }),
      memory({ id: 'b', embedding: [0.9, 0.1], connections: ['a'], position: [2, 0, 0] }),
      memory({ id: 'c', embedding: [0, 1], connections: [], position: [3, 0, 0] }),
    ]);

    expect(graph.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ source: 'a', target: 'b' });
    expect(graph.edges[0].similarity).toBeGreaterThan(0.9);
  });

  it('does not link equally sized vectors from different embedding spaces', async () => {
    const engine = new CognitiveEngine();
    const result = await engine.findConnections([1, 0], [
      memory({ id: 'legacy', embedding: [1, 0], embeddingModel: undefined }),
      memory({ id: 'current', embedding: [1, 0] }),
      memory({ id: 'future', embedding: [1, 0], embeddingModel: 'future-model@revision-1' }),
    ]);

    expect(result.connections).toEqual(['current']);
    const graph = engine.buildCognitiveGraph([
      memory({ id: 'legacy', embedding: [1, 0], connections: ['future'] }),
      memory({ id: 'future', embedding: [1, 0], embeddingModel: 'future-model@revision-1' }),
    ]);
    expect(graph.edges).toEqual([]);
  });

  it('groups transitive high-similarity links regardless of edge order', () => {
    const engine = new CognitiveEngine();
    const graph = engine.buildCognitiveGraph([
      memory({ id: 'b', embedding: [1, 0], connections: ['c'] }),
      memory({ id: 'c', embedding: [1, 0] }),
      memory({ id: 'a', embedding: [1, 0], connections: ['b'] }),
      memory({ id: 'separate', embedding: [0, 1] }),
    ]);

    const groups = [...graph.clusters.values()].map((ids) => [...ids].sort());
    expect(groups).toContainEqual(['a', 'b', 'c']);
    expect(groups).toContainEqual(['separate']);
  });

  it('computes PageRank from incoming declared connections', () => {
    const engine = new CognitiveEngine();
    const scores = engine.computePageRank([
      memory({ id: 'hub', embedding: [1], connections: [] }),
      memory({ id: 'a', embedding: [1], connections: ['hub'] }),
      memory({ id: 'b', embedding: [1], connections: ['hub'] }),
    ]);

    expect(scores.get('hub')).toBeGreaterThan(scores.get('a') || 0);
    expect(scores.get('hub')).toBeGreaterThan(scores.get('b') || 0);
  });

  it('counts repeated links once while retaining their original out-degree', () => {
    const engine = new CognitiveEngine();
    const scores = engine.computePageRank([
      memory({ id: 'a', embedding: [1], connections: [] }),
      memory({ id: 'b', embedding: [1], connections: ['a', 'a', 'missing'] }),
    ]);

    expect(scores.get('b')).toBeCloseTo(0.075, 5);
    expect(scores.get('a')).toBeCloseTo(0.09625, 5);
  });

  it('detects isolated old memories and broken links', () => {
    vi.setSystemTime(new Date('2026-05-11T12:00:00Z'));
    const engine = new CognitiveEngine();
    const oldTimestamp = Date.now() - 45 * 24 * 60 * 60 * 1000;

    try {
      const anomalies = engine.detectAnomalies([
        memory({ id: 'old', embedding: [1], connections: [], timestamp: oldTimestamp }),
        memory({ id: 'broken', embedding: [1], connections: ['missing'] }),
      ]);

      expect(anomalies).toEqual(expect.arrayContaining([
        expect.objectContaining({ memoryId: 'old', issue: 'Memória Isolada e Antiga' }),
        expect.objectContaining({ memoryId: 'broken', issue: 'Ligações Quebradas' }),
      ]));
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds syndrome density and repair candidates to orphan memories', () => {
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'));
    const engine = new CognitiveEngine();

    try {
      const anomalies = engine.detectAnomalies([
        memory({ id: 'orphan', embedding: [1, 0], connections: [], timestamp: Date.now() }),
        memory({ id: 'candidate', embedding: [0.9, 0.1], connections: [], timestamp: Date.now() }),
        memory({ id: 'distant', embedding: [0, 1], connections: [], timestamp: Date.now() }),
      ]);

      expect(anomalies).toEqual(expect.arrayContaining([
        expect.objectContaining({
          memoryId: 'orphan',
          issue: 'Memória Órfã Recente',
          relatedMemoryId: 'candidate',
          severity: 'medium',
        }),
      ]));
      const orphan = anomalies.find((item) => item.memoryId === 'orphan');
      expect(orphan?.confidence).toBeGreaterThan(0.9);
      expect(orphan?.syndromeDensity).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flags low-similarity declared links as weak connections', () => {
    const engine = new CognitiveEngine();

    const anomalies = engine.detectAnomalies([
      memory({ id: 'a', embedding: [1, 0], connections: ['b'] }),
      memory({ id: 'b', embedding: [0, 1], connections: ['a'] }),
    ]);

    expect(anomalies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryId: 'a',
        issue: 'Ligações Fracas',
      }),
    ]));
  });
});
