import type { MemoryObject } from '../types/universe';

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
  time = 0
): CognitiveConstellation[] {
  const groups = new Map<string, MemoryObject[]>();

  for (const memory of memories) {
    const key = getConstellationKey(memory);
    const group = groups.get(key) || [];
    group.push(memory);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([id, group]) => {
      const center = weightedCenter(group, memories, time);
      const radius = Math.max(
        2.5,
        Math.min(18, Math.max(...group.map((memory) => distance(center, getDynamicPosition(memory, memories, time)))) + 1.6)
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
  allMemories: MemoryObject[],
  time: number
): [number, number, number] {
  const center: [number, number, number] = [0, 0, 0];
  let totalWeight = 0;

  for (const memory of memories) {
    const weight = Math.max(0.2, memory.importance || 0.5);
    totalWeight += weight;
    const dynamicPos = getDynamicPosition(memory, allMemories, time);
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

function distance(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getDynamicPosition(
  memory: MemoryObject,
  allMemories: MemoryObject[],
  time: number,
  lookup?: ReadonlyMap<string, MemoryObject>,
): [number, number, number] {
  const parentId = memory.parentId;
  let parent = parentId
    ? (lookup?.get(parentId) ?? allMemories.find((m) => m.id === parentId)) ?? null
    : null;

  if (!parent && memory.celestialType !== 'sun' && memory.celestialType !== 'nebula' && memory.celestialType !== 'black_hole') {
    if (memory.celestialType === 'moon') {
      parent = allMemories.find(
        (m) => m.celestialType === 'planet' && memory.connections.includes(m.id)
      ) || null;
    } else if (memory.celestialType === 'planet' || memory.celestialType === 'star' || memory.celestialType === 'comet') {
      parent = allMemories.find(
        (m) =>
          (m.celestialType === 'sun' || m.celestialType === 'black_hole' || m.celestialType === 'nebula') &&
          memory.connections.includes(m.id)
      ) || null;
    }
  }

  const basePos = memory.position || [0, 0, 0];

  if (!parent) {
    const idHash = hashString(memory.id);
    const driftSpeed = 0.04 + (idHash % 5) * 0.015;
    const driftRadius = 0.12 + (idHash % 5) * 0.04;
    const driftX = Math.sin(time * driftSpeed + idHash) * driftRadius;
    const driftY = Math.cos(time * driftSpeed * 0.8 + idHash) * driftRadius;
    const driftZ = Math.sin(time * driftSpeed * 1.2 + idHash) * driftRadius;
    return [basePos[0] + driftX, basePos[1] + driftY, basePos[2] + driftZ];
  }

  const parentPos = getDynamicPosition(parent, allMemories, time, lookup);
  const idHash = hashString(memory.id);

  let orbitRadius = memory.orbitRadius;
  if (!orbitRadius) {
    if (memory.celestialType === 'moon') {
      orbitRadius = 3.5 + (idHash % 20) / 10;
    } else {
      orbitRadius = 12.0 + (idHash % 80) / 10;
    }
  }

  let orbitSpeed = memory.orbitSpeed;
  if (!orbitSpeed) {
    const direction = idHash % 2 === 0 ? 1 : -1;
    if (memory.celestialType === 'moon') {
      orbitSpeed = direction * (0.35 + (idHash % 15) / 50);
    } else {
      orbitSpeed = direction * (0.06 + (idHash % 10) / 100);
    }
  }

  const importance = memory.importance || 0.5;
  const ageDays = memory.updatedAt > 0 ? Math.max(0, (Date.now() - memory.updatedAt) / 86_400_000) : 365;
  const recency = Math.max(0, 1 - ageDays / 180);

  const decayFactor = 1.8 - 0.8 * recency - 0.4 * importance;
  let adjustedRadius = orbitRadius * (1.2 - importance * 0.4) * decayFactor;

  // Impor limites mínimos seguros para evitar colisões / sobreposições
  if (memory.celestialType === 'moon') {
    adjustedRadius = Math.max(adjustedRadius, 2.5);
  } else {
    adjustedRadius = Math.max(adjustedRadius, 8.5);
  }
  const adjustedSpeed = orbitSpeed * (0.8 + importance * 0.4);

  const tilt = ((idHash % 30) - 15) * Math.PI / 180;
  const angleOffset = idHash % 360;
  const angle = time * adjustedSpeed + angleOffset;

  const localX = Math.cos(angle) * adjustedRadius;
  const localZ = Math.sin(angle) * adjustedRadius * Math.cos(tilt);
  const localY = Math.sin(angle) * adjustedRadius * Math.sin(tilt);

  return [
    parentPos[0] + localX,
    parentPos[1] + localY,
    parentPos[2] + localZ,
  ];
}
