export interface SemanticClusterBackfillMemory {
  id: string;
  connections?: string[];
  semanticClusterId?: string | null;
}

export interface SemanticClusterBackfillPatch {
  id: string;
  semanticClusterId: string;
}

const isPersistedCluster = (value: string | null | undefined): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const buildSemanticClusterBackfillPatches = (
  memories: SemanticClusterBackfillMemory[]
): SemanticClusterBackfillPatch[] => {
  const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return current;
    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  memories.forEach((memory) => parent.set(memory.id, memory.id));
  memories.forEach((memory) => {
    memory.connections?.forEach((connectionId) => {
      if (memoryById.has(connectionId)) union(memory.id, connectionId);
    });
  });

  const components = new Map<string, SemanticClusterBackfillMemory[]>();
  memories.forEach((memory) => {
    const root = find(memory.id);
    const component = components.get(root) || [];
    component.push(memory);
    components.set(root, component);
  });

  const componentCluster = new Map<string, string>();
  components.forEach((component, root) => {
    const clusterCounts = new Map<string, number>();
    component.forEach((memory) => {
      if (isPersistedCluster(memory.semanticClusterId)) {
        const clusterId = memory.semanticClusterId.trim();
        clusterCounts.set(clusterId, (clusterCounts.get(clusterId) || 0) + 1);
      }
    });

    if (clusterCounts.size > 0) {
      const [winner] = [...clusterCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      componentCluster.set(root, winner);
      return;
    }

    const ids = component.map((memory) => memory.id).sort();
    const prefix = ids.length === 1 ? 'solo' : 'component';
    componentCluster.set(root, `semantic:${prefix}-${stableHash(ids.join('|'))}`);
  });

  return memories
    .filter((memory) => !isPersistedCluster(memory.semanticClusterId))
    .map((memory) => ({
      id: memory.id,
      semanticClusterId: componentCluster.get(find(memory.id)) || `semantic:solo-${stableHash(memory.id)}`,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
};
