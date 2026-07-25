import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { MemoryObject } from '../../types/universe';
import { useUniverseStore } from '../../store/universeStore';
import { getDynamicPosition } from '../../engines/celestialLayout';

interface ConnectionLinesProps {
  memories: MemoryObject[];
  maxConnections?: number;
}

export const ConnectionLines: React.FC<ConnectionLinesProps> = ({
  memories,
  maxConnections = 900,
}) => {
  const { selectedMemoryId, hoveredMemoryId } = useUniverseStore();

  const activeId = selectedMemoryId || hoveredMemoryId;

  const connections = useMemo(() => {
    const lines: Array<{
      id: string;
      sourceId: string;
      targetId: string;
      active: boolean;
      opacity: number;
      score: number;
    }> = [];

    const memMap = new Map(memories.map((m) => [m.id, m]));
    const seen = new Set<string>();
    const activeMemory = activeId ? memMap.get(activeId) : null;

    for (const mem of memories) {
      for (const connId of mem.connections) {
        const edgeKey = [mem.id, connId].sort().join('--');
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);

        const target = memMap.get(connId);
        if (!target) continue;

        const isActive =
          activeId === mem.id ||
          activeId === connId ||
          (activeMemory?.connections.includes(mem.id) &&
            activeMemory?.connections.includes(connId));

        const connectedImportance = Math.max(mem.importance || 0, target.importance || 0);

        lines.push({
          id: edgeKey,
          sourceId: mem.id,
          targetId: connId,
          active: !!isActive,
          opacity: isActive ? 0.72 : 0.11,
          score: (isActive ? 100 : 0) + connectedImportance * 10,
        });
      }
    }

    return lines
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, maxConnections);
  }, [memories, activeId, maxConnections]);

  if (connections.length === 0) return null;

  return (
    <group>
      {connections.map((conn) => (
        <ConnectionLine
          key={conn.id}
          sourceId={conn.sourceId}
          targetId={conn.targetId}
          active={conn.active}
          opacity={conn.opacity}
          memories={memories}
        />
      ))}
    </group>
  );
};

interface ConnectionLineProps {
  sourceId: string;
  targetId: string;
  active: boolean;
  opacity: number;
  memories: MemoryObject[];
}

const ConnectionLine: React.FC<ConnectionLineProps> = ({
  sourceId,
  targetId,
  active,
  opacity,
  memories,
}) => {
  const geometry = useMemo(() => {
    return new THREE.BufferGeometry();
  }, []);

  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: active ? '#c4b5fd' : '#2a3550',
        transparent: true,
        opacity: active ? Math.max(opacity, 0.62) : opacity,
        linewidth: 1,
        depthWrite: false,
        blending: active ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [active, opacity]
  );

  const pulseMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#a78bfa',
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);
  const pulseRef = React.useRef<THREE.Mesh | null>(null);
  const curvePointsRef = React.useRef<THREE.Vector3[]>([]);

  useFrame((state) => {
    if (!geometry) return;
    const time = state.clock.getElapsedTime();
    const sourceMem = memories.find((m) => m.id === sourceId);
    const targetMem = memories.find((m) => m.id === targetId);
    if (!sourceMem || !targetMem) return;

    const sourcePosArray = getDynamicPosition(sourceMem, memories, time);
    const targetPosArray = getDynamicPosition(targetMem, memories, time);

    const start = new THREE.Vector3(...sourcePosArray);
    const end = new THREE.Vector3(...targetPosArray);

    const points = buildConnectionArc(start, end, active);
    curvePointsRef.current = points;
    geometry.setFromPoints(points);
    if (geometry.attributes.position) {
      geometry.attributes.position.needsUpdate = true;
    }

    // Partícula de sinal a percorrer ligações ativas
    if (active && pulseRef.current && points.length > 1) {
      const t = (time * 0.22) % 1;
      const idx = Math.min(points.length - 1, Math.floor(t * (points.length - 1)));
      const next = Math.min(points.length - 1, idx + 1);
      const localT = t * (points.length - 1) - idx;
      const pos = points[idx].clone().lerp(points[next], localT);
      pulseRef.current.position.copy(pos);
      pulseRef.current.visible = true;
      const scale = 0.08 + 0.04 * Math.sin(time * 6);
      pulseRef.current.scale.setScalar(scale);
    } else if (pulseRef.current) {
      pulseRef.current.visible = false;
    }
  });

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      pulseMaterial.dispose();
    };
  }, [geometry, material, pulseMaterial]);

  return (
    <group>
      <primitive object={line} />
      {active && (
        <mesh ref={pulseRef} visible={false}>
          <sphereGeometry args={[1, 10, 10]} />
          <primitive object={pulseMaterial} attach="material" />
        </mesh>
      )}
    </group>
  );
};

function buildConnectionArc(
  start: THREE.Vector3,
  end: THREE.Vector3,
  active: boolean
): THREE.Vector3[] {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const distance = Math.max(start.distanceTo(end), 0.001);
  const liftDirection =
    midpoint.lengthSq() > 0.001 ? midpoint.clone().normalize() : new THREE.Vector3(0, 1, 0);
  const control = midpoint.add(
    liftDirection.multiplyScalar(Math.min(7, Math.max(0.8, distance * 0.16)))
  );
  const curve = new THREE.QuadraticBezierCurve3(start, control, end);

  return curve.getPoints(active ? 32 : 14);
}
