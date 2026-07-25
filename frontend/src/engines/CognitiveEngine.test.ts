import { describe, expect, it, vi } from 'vitest';
import type { MemoryObject } from '../types/universe';
import { CognitiveEngine } from './CognitiveEngine';

const memory = (overrides: Partial<MemoryObject> & Pick<MemoryObject, 'id' | 'embedding'>): MemoryObject => ({
  text: `Memory ${overrides.id}`,
  celestialType: 'planet',
  position: [0, 0, 0],
  connections: [],
  importance: 0.5,
  timestamp: 1,
  updatedAt: 1,
  uid: 'user-1',
  ...overrides,
});

describe('CognitiveEngine autolink and graph behavior', () => {
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
});
