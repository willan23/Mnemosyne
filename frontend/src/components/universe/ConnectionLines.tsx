import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { MemoryObject } from '../../types/universe';
import { useUniverseStore } from '../../store/universeStore';
import { getDynamicPosition } from '../../engines/celestialLayout';
import { sampleArcPoint, writeArcLinePairs } from './connectionGeometry';
import { useUniverseRuntime } from './universeRuntime';

interface ConnectionLinesProps {
  memories: MemoryObject[];
  maxConnections?: number;
}

interface EdgeRecord {
  sourceId: string;
  targetId: string;
}

const INACTIVE_COLOR = new THREE.Color('#243044');
const ACTIVE_COLOR = new THREE.Color('#c4b5fd');
const HOVER_COLOR = new THREE.Color('#8b9cff');

export const ConnectionLines: React.FC<ConnectionLinesProps> = ({
  memories,
  maxConnections = 900,
}) => {
  const { lookupRef, quality } = useUniverseRuntime();
  const segments = quality.connectionSegments;
  const maxPulses = quality.maxPulseSignals;

  const edges = useMemo<EdgeRecord[]>(() => {
    const memMap = new Map(memories.map((memory) => [memory.id, memory]));
    const seen = new Set<string>();
    const lines: Array<EdgeRecord & { score: number }> = [];

    for (const mem of memories) {
      for (const connId of mem.connections) {
        const edgeKey = mem.id < connId ? `${mem.id}--${connId}` : `${connId}--${mem.id}`;
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);

        const target = memMap.get(connId);
        if (!target) continue;

        lines.push({
          sourceId: mem.id,
          targetId: connId,
          score: Math.max(mem.importance || 0, target.importance || 0),
        });
      }
    }

    return lines
      .sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
      .slice(0, maxConnections)
      .map(({ sourceId, targetId }) => ({ sourceId, targetId }));
  }, [memories, maxConnections]);

  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const line = useMemo(() => new THREE.LineSegments(geometry, material), [geometry, material]);
  const pulseGroupRef = useRef<THREE.Group>(null);
  const scratchPoint = useMemo(() => new Float32Array(3), []);

  useEffect(() => {
    const vertexCount = edges.length * segments * 2;
    const positions = new Float32Array(Math.max(6, vertexCount * 3));
    const colors = new Float32Array(Math.max(6, vertexCount * 3));
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, vertexCount);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 400);
  }, [edges.length, geometry, segments]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((state) => {
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!positionAttr || !colorAttr || edges.length === 0) return;

    const time = state.clock.getElapsedTime();
    const lookup = lookupRef.current;
    const { selectedMemoryId, hoveredMemoryId } = useUniverseStore.getState();
    const activeId = selectedMemoryId || hoveredMemoryId;
    const positions = positionAttr.array as Float32Array;
    const colors = colorAttr.array as Float32Array;

    let offset = 0;
    let pulseIndex = 0;
    const pulses = pulseGroupRef.current?.children ?? [];

    for (const edge of edges) {
      const source = lookup.get(edge.sourceId);
      const target = lookup.get(edge.targetId);
      if (!source || !target) {
        offset += segments * 6;
        continue;
      }

      const [sx, sy, sz] = getDynamicPosition(source, memories, time, lookup);
      const [ex, ey, ez] = getDynamicPosition(target, memories, time, lookup);
      writeArcLinePairs(positions, offset, sx, sy, sz, ex, ey, ez, segments);

      const isActive = activeId === edge.sourceId || activeId === edge.targetId;
      const color = isActive ? (selectedMemoryId ? ACTIVE_COLOR : HOVER_COLOR) : INACTIVE_COLOR;
      const vertexCount = segments * 2;
      for (let i = 0; i < vertexCount; i += 1) {
        const colorOffset = offset + i * 3;
        colors[colorOffset] = color.r;
        colors[colorOffset + 1] = color.g;
        colors[colorOffset + 2] = color.b;
      }

      if (isActive && selectedMemoryId && pulseIndex < maxPulses && pulses[pulseIndex]) {
        const pulse = pulses[pulseIndex];
        const t = (time * 0.22 + pulseIndex * 0.17) % 1;
        sampleArcPoint(scratchPoint, 0, t, sx, sy, sz, ex, ey, ez);
        pulse.position.set(scratchPoint[0], scratchPoint[1], scratchPoint[2]);
        pulse.visible = true;
        const scale = 0.07 + 0.03 * Math.sin(time * 6 + pulseIndex);
        pulse.scale.setScalar(scale);
        pulseIndex += 1;
      }

      offset += segments * 6;
    }

    for (let i = pulseIndex; i < pulses.length; i += 1) {
      pulses[i].visible = false;
    }

    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  });

  if (edges.length === 0) return null;

  return (
    <group>
      <primitive object={line} />
      <group ref={pulseGroupRef}>
        {Array.from({ length: maxPulses }, (_, index) => (
          <mesh key={`pulse-${index}`} visible={false}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial
              color="#a78bfa"
              transparent
              opacity={0.8}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
};
