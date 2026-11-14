import type { MemoryObject } from '../types/universe';
import { orbitPosition, type OrbitPosition } from './orbitMath';

export type UniverseDetailLevel = 'high' | 'medium' | 'low';

export interface UniverseRenderBudget {
  detail: UniverseDetailLevel;
  maxObjects: number;
  connectionLimit: number;
  starCount: number;
  sphereSegments: number;
  fogNear: number;
  fogFar: number;
  showConstellationLabels: boolean;
}

export interface CognitiveConstellation {
  id: string;
  label: string;
  center: [number, number, number];
  radius: number;
  count: number;
  color: string;
}

const DEFAULT_CLUSTER_COLOR = '#88aaff';

export function getUniverseRenderBudget(visibleMemoryCount: number): UniverseRenderBudget {
  if (visibleMemoryCount > 420) {
    return {
      detail: 'low',
      maxObjects: 220,
      connectionLimit: 260,
      starCount: 1400,
      sphereSegments: 12,
      fogNear: 70,
      fogFar: 210,
      showConstellationLabels: false,
    };
  }

  if (visibleMemoryCount > 140) {
    return {
      detail: 'medium',
      maxObjects: 320,
      connectionLimit: 520,
      starCount: 2200,
      sphereSegments: 20,
      fogNear: 55,
      fogFar: 180,
      showConstellationLabels: false,
    };
  }

  return {
    detail: 'high',
    maxObjects: 700,
    connectionLimit: 900,
    starCount: 3200,
    sphereSegments: 32,
    fogNear: 40,
    fogFar: 150,
    showConstellationLabels: true,
  };
}

export function rankMemoriesForRender(
  memories: MemoryObject[],
  activeMemoryId: string | null,
  limit: number
): MemoryObject[] {
  if (memories.length <= limit) return memories;

  const activeMemory = activeMemoryId
    ? memories.find((memory) => memory.id === activeMemoryId)
    : null;
  const activeConnections = new Set(activeMemory?.connections || []);
  const now = Date.now();

  return [...memories]
    .sort((a, b) => {
      const scoreA = getRenderPriority(a, activeMemoryId, activeConnections, now);
      const scoreB = getRenderPriority(b, activeMemoryId, activeConnections, now);
      return scoreB - scoreA || a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

export function buildCognitiveConstellations(
  memories: MemoryObject[],
  maxConstellations = 10,
  time = 0,
  positions?: ReadonlyMap<string, OrbitPosition>,
): CognitiveConstellation[] {
  const groups = new Map<string, MemoryObject[]>();

  for (const memory of positions ? memories.filter(row => positions.has(row.id)) : memories) {
    const key = getConstellationKey(memory);
    const group = groups.get(key) || [];
    group.push(memory);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([id, group]) => {
      const center = weightedCenter(group, memories, time, positions);
      const radius = Math.max(
        2.5,
        Math.min(18, Math.max(...group.map((memory) => { const point = positions ? positions.get(memory.id) : getDynamicPosition(memory, memories, time); return point ? distance(center, point) : 0; })) + 1.6)
      );

      return {
        id,
        label: getConstellationLabel(id),
        center,
        radius,
        count: group.length,
        color: group.find((memory) => memory.color)?.color || DEFAULT_CLUSTER_COLOR,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, maxConstellations);
}

export function getRenderPriority(
  memory: Pick<MemoryObject, 'id' | 'importance' | 'connections' | 'updatedAt'>,
  activeMemoryId: string | null,
  activeConnections: Set<string>,
  now: number
): number {
  const isActive = memory.id === activeMemoryId;
  const isConnectedToActive = activeConnections.has(memory.id);
  const importance = memory.importance || 0.5;
  const connectionWeight = Math.min(memory.connections.length, 12) / 12;
  const ageDays = memory.updatedAt > 0 ? Math.max(0, (now - memory.updatedAt) / 86_400_000) : 365;
  const recency = Math.max(0, 1 - ageDays / 180);

  return (
    (isActive ? 1000 : 0) +
    (isConnectedToActive ? 520 : 0) +
    importance * 160 +
    connectionWeight * 70 +
    recency * 35
  );
}

function getConstellationKey(memory: MemoryObject): string {
  if (memory.semanticClusterId?.trim()) return memory.semanticClusterId.trim();
  if (memory.category?.trim()) return `category:${memory.category.trim()}`;
  if (memory.tags?.[0]?.trim()) return `tag:${memory.tags[0].trim()}`;
  return `type:${memory.celestialType}`;
}

function getConstellationLabel(id: string): string {
  return id
    .replace(/^semantic:/, '')
    .replace(/^category:/, '')
    .replace(/^tag:/, '#')
    .replace(/^type:/, '')
    .replace(/^solo-/, 'solo ')
    .replace(/[-_]+/g, ' ')
    .slice(0, 28);
}

function weightedCenter(
  memories: MemoryObject[],
  allMemories: readonly MemoryObject[],
  time: number,
  positions?: ReadonlyMap<string, OrbitPosition>,
): [number, number, number] {
  const center: [number, number, number] = [0, 0, 0];
  let totalWeight = 0;

  for (const memory of memories) {
    const weight = Math.max(0.2, memory.importance || 0.5);
    const dynamicPos = positions ? positions.get(memory.id) : getDynamicPosition(memory, allMemories, time);
    if (!dynamicPos) continue;
    totalWeight += weight;
    center[0] += dynamicPos[0] * weight;
    center[1] += dynamicPos[1] * weight;
    center[2] += dynamicPos[2] * weight;
  }

  if (totalWeight === 0) return center;

  return [
    center[0] / totalWeight,
    center[1] / totalWeight,
    center[2] / totalWeight,
  ];
}

function distance(a: OrbitPosition, b: OrbitPosition): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Compatibility helper for small callers. Scene frames consume Worker coordinates instead. */
export function getDynamicPosition(memory: MemoryObject, allMemories: readonly MemoryObject[], time: number, lookup?: ReadonlyMap<string, MemoryObject>): [number, number, number] {
  if (!Number.isFinite(time)) throw new Error('orbit_layout_unavailable');
  const resolve = (value: MemoryObject): MemoryObject | null => {
    let parent = value.parentId ? (lookup?.get(value.parentId) ?? allMemories.find(row => row.id === value.parentId)) ?? null : null;
    if (!parent && value.celestialType === 'moon') parent = allMemories.find(row => row.celestialType === 'planet' && value.connections.includes(row.id)) ?? null;
    else if (!parent && ['planet', 'star', 'comet'].includes(value.celestialType)) parent = allMemories.find(row => ['sun', 'black_hole', 'nebula'].includes(row.celestialType) && value.connections.includes(row.id)) ?? null;
    return parent;
  };
  const seen = new Map<string, number>(), parents = new Map<string, MemoryObject | null>(), nodes: MemoryObject[] = [];
  let cursor: MemoryObject | null = memory;
  while (cursor && !seen.has(cursor.id)) { seen.set(cursor.id, nodes.length); nodes.push(cursor); const parent = resolve(cursor); parents.set(cursor.id, parent); cursor = parent; }
  if (cursor) {
    const order = new Map<string, number>(); let ordinal = 0; for (const row of allMemories) { if (!order.has(row.id)) order.set(row.id, ordinal); ordinal++; }
    const cycle = nodes.slice(seen.get(cursor.id)!); let anchor = cycle[0];
    for (const row of cycle) { const rank = order.get(row.id) ?? Infinity, best = order.get(anchor.id) ?? Infinity; if (rank < best || rank === best && row.id < anchor.id) anchor = row; }
    parents.set(anchor.id, null);
  }
  nodes.length = 0; cursor = memory; while (cursor) { nodes.push(cursor); cursor = parents.get(cursor.id) ?? null; }
  let position: OrbitPosition | null = null; const now = Date.now();
  for (let at = nodes.length - 1; at >= 0; at--) { const row = nodes[at]; position = orbitPosition({ id: row.id, celestialType: row.celestialType, position: row.position || [0, 0, 0], orbitRadius: row.orbitRadius ?? null, orbitSpeed: row.orbitSpeed ?? null, importance: row.importance, updatedAt: row.updatedAt }, position, time, now); if (!position.every(Number.isFinite)) throw new Error('orbit_layout_unavailable'); }
  return [position![0], position![1], position![2]];
}
