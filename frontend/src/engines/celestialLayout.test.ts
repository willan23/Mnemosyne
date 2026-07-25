import { describe, expect, it, vi } from 'vitest';
import type { MemoryObject } from '../types/universe';
import {
  buildCognitiveConstellations,
  getUniverseRenderBudget,
  rankMemoriesForRender,
} from './celestialLayout';

const memory = (overrides: Partial<MemoryObject> & Pick<MemoryObject, 'id'>): MemoryObject => ({
  id: overrides.id,
  text: `Memory ${overrides.id}`,
  celestialType: 'planet',
  position: [0, 0, 0],
  embedding: [1],
  connections: [],
  importance: 0.5,
  timestamp: Date.now(),
  updatedAt: Date.now(),
  uid: 'user-1',
  ...overrides,
});

describe('celestial layout helpers', () => {
  it('reduces visual detail as the universe grows', () => {
    expect(getUniverseRenderBudget(30)).toMatchObject({
      detail: 'high',
      sphereSegments: 32,
      showConstellationLabels: true,
    });

    expect(getUniverseRenderBudget(180)).toMatchObject({
      detail: 'medium',
      sphereSegments: 20,
      showConstellationLabels: false,
    });

    expect(getUniverseRenderBudget(700)).toMatchObject({
      detail: 'low',
      sphereSegments: 12,
      showConstellationLabels: false,
    });
  });

  it('keeps selected memories and their neighbours in the render set', () => {
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'));

    try {
      const memories = [
        memory({ id: 'active', connections: ['neighbour'], importance: 0.1 }),
        memory({ id: 'neighbour', importance: 0.1 }),
        ...Array.from({ length: 8 }, (_, index) => (
          memory({ id: `important-${index}`, importance: 0.95, updatedAt: Date.now() })
        )),
      ];

      const ranked = rankMemoriesForRender(memories, 'active', 4);

      expect(ranked.map((item) => item.id)).toContain('active');
      expect(ranked.map((item) => item.id)).toContain('neighbour');
    } finally {
      vi.useRealTimers();
    }
  });

  it('summarizes semantic clusters into cognitive constellations', () => {
    const constellations = buildCognitiveConstellations([
      memory({ id: 'a', semanticClusterId: 'semantic:trust', position: [0, 0, 0] }),
      memory({ id: 'b', semanticClusterId: 'semantic:trust', position: [4, 0, 0] }),
      memory({ id: 'c', semanticClusterId: 'semantic:solo', position: [20, 0, 0] }),
    ]);

    expect(constellations).toHaveLength(1);
    expect(constellations[0]).toMatchObject({
      id: 'semantic:trust',
      label: 'trust',
      count: 2,
    });
    expect(constellations[0].radius).toBeGreaterThan(2.5);
  });
});
