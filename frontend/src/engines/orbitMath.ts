import type { OrbitRecord } from '../services/orbitLayoutProtocol';
export type OrbitPosition = readonly [number, number, number];
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
/** Keep the existing arithmetic order so acyclic layouts preserve their coordinates. */
export function orbitPosition(memory: Pick<OrbitRecord, 'id' | 'position' | 'celestialType' | 'orbitRadius' | 'orbitSpeed' | 'importance' | 'updatedAt'>, parent: OrbitPosition | null, time: number, now: number): OrbitPosition {
  const idHash = hashString(memory.id);
  if (!parent) {
    const basePos = memory.position, driftSpeed = 0.04 + (idHash % 5) * 0.015, driftRadius = 0.12 + (idHash % 5) * 0.04;
    return [basePos[0] + Math.sin(time * driftSpeed + idHash) * driftRadius,
      basePos[1] + Math.cos(time * driftSpeed * 0.8 + idHash) * driftRadius,
      basePos[2] + Math.sin(time * driftSpeed * 1.2 + idHash) * driftRadius];
  }
  let orbitRadius = memory.orbitRadius;
  if (!orbitRadius) orbitRadius = memory.celestialType === 'moon' ? 3.5 + (idHash % 20) / 10 : 12.0 + (idHash % 80) / 10;
  let orbitSpeed = memory.orbitSpeed;
  if (!orbitSpeed) { const direction = idHash % 2 === 0 ? 1 : -1; orbitSpeed = memory.celestialType === 'moon' ? direction * (0.35 + (idHash % 15) / 50) : direction * (0.06 + (idHash % 10) / 100); }
  const importance = memory.importance || 0.5, ageDays = memory.updatedAt > 0 ? Math.max(0, (now - memory.updatedAt) / 86_400_000) : 365, recency = Math.max(0, 1 - ageDays / 180);
  const decayFactor = 1.8 - 0.8 * recency - 0.4 * importance;
  let adjustedRadius = orbitRadius * (1.2 - importance * 0.4) * decayFactor;
  adjustedRadius = Math.max(adjustedRadius, memory.celestialType === 'moon' ? 2.5 : 8.5);
  const adjustedSpeed = orbitSpeed * (0.8 + importance * 0.4), tilt = ((idHash % 30) - 15) * Math.PI / 180, angleOffset = idHash % 360, angle = time * adjustedSpeed + angleOffset;
  const localX = Math.cos(angle) * adjustedRadius, localZ = Math.sin(angle) * adjustedRadius * Math.cos(tilt), localY = Math.sin(angle) * adjustedRadius * Math.sin(tilt);
  return [parent[0] + localX, parent[1] + localY, parent[2] + localZ];
}
