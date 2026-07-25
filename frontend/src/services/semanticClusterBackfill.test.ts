import { describe, expect, it } from 'vitest';
import { buildSemanticClusterBackfillPatches } from './semanticClusterBackfill';

describe('buildSemanticClusterBackfillPatches', () => {
  it('inherits an existing cluster from connected memories', () => {
    const patches = buildSemanticClusterBackfillPatches([
      { id: 'a', connections: ['b'] },
      { id: 'b', connections: [], semanticClusterId: 'semantic:known' },
    ]);

    expect(patches).toEqual([
      { id: 'a', semanticClusterId: 'semantic:known' },
    ]);
  });

  it('assigns the same deterministic component cluster to connected legacy memories', () => {
    const first = buildSemanticClusterBackfillPatches([
      { id: 'a', connections: ['b'] },
      { id: 'b', connections: ['c'] },
      { id: 'c', connections: [] },
    ]);
    const second = buildSemanticClusterBackfillPatches([
      { id: 'c', connections: [] },
      { id: 'b', connections: ['c'] },
      { id: 'a', connections: ['b'] },
    ]);

    expect(first).toEqual(second);
    expect(new Set(first.map((patch) => patch.semanticClusterId)).size).toBe(1);
    expect(first[0].semanticClusterId).toMatch(/^semantic:component-/);
  });

  it('keeps isolated legacy memories in solo clusters', () => {
    const patches = buildSemanticClusterBackfillPatches([
      { id: 'a', connections: [] },
      { id: 'b', connections: [] },
    ]);

    expect(patches).toHaveLength(2);
    expect(patches[0].semanticClusterId).toMatch(/^semantic:solo-/);
    expect(patches[1].semanticClusterId).toMatch(/^semantic:solo-/);
    expect(patches[0].semanticClusterId).not.toBe(patches[1].semanticClusterId);
  });

  it('does not patch memories that already have a persisted cluster', () => {
    const patches = buildSemanticClusterBackfillPatches([
      { id: 'a', semanticClusterId: 'semantic:ready' },
    ]);

    expect(patches).toEqual([]);
  });

  it('ignores broken connection ids', () => {
    const patches = buildSemanticClusterBackfillPatches([
      { id: 'a', connections: ['missing'] },
    ]);

    expect(patches).toHaveLength(1);
    expect(patches[0].semanticClusterId).toMatch(/^semantic:solo-/);
  });
});
