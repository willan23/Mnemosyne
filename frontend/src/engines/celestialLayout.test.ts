import { describe, expect, it, vi } from 'vitest';
import type { MemoryObject } from '../types/universe';
import {
  buildCognitiveConstellations,
  getUniverseRenderBudget,
  rankMemoriesForRender,
  getDynamicPosition,
} from './celestialLayout';
import golden from '../test/fixtures/orbit-golden.json';

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

it.each(golden.cases)('preserves the frozen layout in the iterative compatibility helper: $name', fixture => {
  vi.useFakeTimers(); vi.setSystemTime(golden.now);
  try {
    const rows = fixture.rows.map(row => memory({ ...row, celestialType: row.celestialType as MemoryObject['celestialType'], position: row.position as [number, number, number] })), lookup = new Map(rows.map(row => [row.id, row]));
    for (const sample of fixture.samples) expect(rows.map(row => [row.id, getDynamicPosition(row, rows, sample.time, lookup)])).toEqual(sample.positions);
  } finally { vi.useRealTimers(); }
});
it('keeps cyclic compatibility callers finite with the first published cycle node as anchor', () => {
  const rows = [memory({ id: 'b', parentId: 'a', updatedAt: 0 }), memory({ id: 'a', parentId: 'b', updatedAt: 0 }), memory({ id: 'self', parentId: 'self', updatedAt: 0 })], lookup = new Map(rows.map(row => [row.id, row]));
  for (const row of rows) expect(getDynamicPosition(row, rows, 2, lookup).every(Number.isFinite)).toBe(true);
  expect(getDynamicPosition(rows[0], rows, 2, lookup)).toEqual(getDynamicPosition({ ...rows[0], parentId: undefined }, [], 2));
});
it('uses prepared constellation positions without following any raw connections', () => {
  const rows = [memory({ id: 'a', semanticClusterId: 'semantic:prepared' }), memory({ id: 'b', semanticClusterId: 'semantic:prepared' }), memory({ id: 'omitted', semanticClusterId: 'semantic:prepared' })];
  for (const row of rows) Object.defineProperty(row, 'connections', { get() { throw Error('Constellations followed raw parent candidates'); } });
  const positions = new Map<string, readonly [number, number, number]>([['a', [0, 0, 0]], ['b', [4, 0, 0]]]);
  expect(buildCognitiveConstellations(rows, 10, 0, positions)).toEqual([expect.objectContaining({ count: 2, center: [2, 0, 0], radius: 3.6 })]);
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
