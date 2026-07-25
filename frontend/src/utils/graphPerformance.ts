/**
 * Orçamento de renderização do grafo force-3D.
 * Prioriza nós importantes, ligados, recentes e o foco atual.
 */

export type GraphDetailLevel = 'high' | 'medium' | 'low' | 'ultra-low';

export interface GraphRenderBudget {
  detail: GraphDetailLevel;
  maxNodes: number;
  labelThreshold: number; // show labels when node count under this OR node highlighted
  sphereSegments: number;
  linkParticles: boolean;
  warmupTicks: number;
  cooldownTicks: number;
}

export function getGraphRenderBudget(totalNodes: number): GraphRenderBudget {
  if (totalNodes > 4000) {
    return {
      detail: 'ultra-low',
      maxNodes: 1200,
      labelThreshold: 80,
      sphereSegments: 8,
      linkParticles: false,
      warmupTicks: 20,
      cooldownTicks: 80,
    };
  }
  if (totalNodes > 1500) {
    return {
      detail: 'low',
      maxNodes: 1800,
      labelThreshold: 120,
      sphereSegments: 12,
      linkParticles: false,
      warmupTicks: 30,
      cooldownTicks: 120,
    };
  }
  if (totalNodes > 500) {
    return {
      detail: 'medium',
      maxNodes: 900,
      labelThreshold: 200,
      sphereSegments: 16,
      linkParticles: true,
      warmupTicks: 40,
      cooldownTicks: 160,
    };
  }
  return {
    detail: 'high',
    maxNodes: 5000,
    labelThreshold: 80,
    sphereSegments: 32,
    linkParticles: true,
    warmupTicks: 60,
    cooldownTicks: 200,
  };
}

export interface RankableNode {
  id: string;
  importance?: number;
  connectionCount?: number;
  timestamp?: number;
  lastViewedAt?: number;
  celestialType?: string;
  val?: number;
}

/**
 * Mantém o foco, vizinhos e os nós com maior score; corta o resto.
 */
export function rankNodesForGraph(
  nodes: RankableNode[],
  limit: number,
  opts: {
    focusedId?: string | null;
    highlightIds?: Set<string>;
    searchIds?: Set<string>;
  } = {}
): RankableNode[] {
  if (nodes.length <= limit) return nodes;

  const { focusedId, highlightIds, searchIds } = opts;
  const now = Date.now();
  const mustKeep = new Set<string>();
  if (focusedId) mustKeep.add(focusedId);
  highlightIds?.forEach((id) => mustKeep.add(id));
  searchIds?.forEach((id) => mustKeep.add(id));

  const scored = nodes.map((node) => {
    const ageDays = node.timestamp
      ? Math.max(0, (now - node.timestamp) / 86_400_000)
      : 365;
    const recency = Math.max(0, 1 - ageDays / 180);
    const connections = node.connectionCount ?? 0;
    const importance = node.importance ?? (typeof node.val === 'number' ? node.val / 20 : 0.4);
    const isSun = node.celestialType === 'sun' ? 1 : 0;
    const forced = mustKeep.has(node.id) ? 1000 : 0;
    const score =
      forced +
      isSun * 40 +
      importance * 30 +
      Math.min(connections, 20) * 2 +
      recency * 15;
    return { node, score };
  });

  scored.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));

  const picked = new Set<string>();
  const result: RankableNode[] = [];

  // Always include must-keep first
  for (const id of mustKeep) {
    const found = nodes.find((n) => n.id === id);
    if (found && !picked.has(id)) {
      picked.add(id);
      result.push(found);
    }
  }

  for (const { node } of scored) {
    if (result.length >= limit) break;
    if (picked.has(node.id)) continue;
    picked.add(node.id);
    result.push(node);
  }

  return result;
}
