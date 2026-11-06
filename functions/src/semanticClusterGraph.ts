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
  let second = 2246822519; for (let i = value.length - 1; i >= 0; i--) { second ^= value.charCodeAt(i); second = Math.imul(second, 3266489917); } return (hash >>> 0).toString(36) + (second >>> 0).toString(36);
};

export const semanticClusterComponents = <T extends SemanticClusterBackfillMemory>(memories: T[]): T[][] => {
  const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!;
    while (id !== root) { const next = parent.get(id)!; parent.set(id, root); id = next; }
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

  const components = new Map<string, T[]>();
  memories.forEach((memory) => {
    const root = find(memory.id);
    const component = components.get(root) || [];
    component.push(memory);
    components.set(root, component);
  });

  return [...components.values()];
};

export const buildSemanticClusterBackfillPatches = (
  memories: SemanticClusterBackfillMemory[], namespace?: string
): SemanticClusterBackfillPatch[] => {
  const patches: SemanticClusterBackfillPatch[] = [];
  semanticClusterComponents(memories).forEach((component) => {
    let componentCluster: string;
    const clusterCounts = new Map<string, number>();
    component.forEach((memory) => {
      if (isPersistedCluster(memory.semanticClusterId)) {
        const clusterId = memory.semanticClusterId.trim();
        clusterCounts.set(clusterId, (clusterCounts.get(clusterId) || 0) + 1);
      }
    });

    if (clusterCounts.size > 0) {
      const [winner] = [...clusterCounts.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0];
      componentCluster = winner;
    } else {
      const ids = component.map((memory) => memory.id).sort();
      const prefix = ids.length === 1 ? 'solo' : 'component';
      componentCluster = `semantic:${namespace ? 'scope-' + namespace + ':' : ''}${prefix}-${stableHash(ids.join('|'))}`;
    }

    for (const memory of component) if (!isPersistedCluster(memory.semanticClusterId)) {
      patches.push({id: memory.id, semanticClusterId: componentCluster});
    }
  });

  return patches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};
