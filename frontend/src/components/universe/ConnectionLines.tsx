import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { MemoryObject } from '../../types/universe';
import { useUniverseStore } from '../../store/universeStore';

interface ConnectionLinesProps {
  memories: MemoryObject[];
}

export const ConnectionLines: React.FC<ConnectionLinesProps> = ({ memories }) => {
  const { selectedMemoryId, hoveredMemoryId } = useUniverseStore();
  const timeRef = useRef(0);

  const activeId = selectedMemoryId || hoveredMemoryId;

  const connections = useMemo(() => {
    const lines: Array<{
      id: string;
      points: THREE.Vector3[];
      active: boolean;
      opacity: number;
    }> = [];

    const memMap = new Map(memories.map((m) => [m.id, m]));
    const seen = new Set<string>();

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
          (activeId &&
            memMap.get(activeId)?.connections.includes(mem.id) &&
            memMap.get(activeId)?.connections.includes(connId));

        lines.push({
          id: edgeKey,
          points: [
            new THREE.Vector3(...mem.position),
            new THREE.Vector3(...target.position),
          ],
          active: !!isActive,
          opacity: isActive ? 0.6 : 0.08,
        });
      }
    }

    return lines;
  }, [memories, activeId]);

  if (connections.length === 0) return null;

  return (
    <group>
      {connections.map((conn) => (
        <ConnectionLine
          key={conn.id}
          points={conn.points}
          active={conn.active}
          opacity={conn.opacity}
          timeRef={timeRef}
        />
      ))}
    </group>
  );
};

interface ConnectionLineProps {
  points: THREE.Vector3[];
  active: boolean;
  opacity: number;
  timeRef: React.RefObject<number>;
}

const ConnectionLine: React.FC<ConnectionLineProps> = ({ points, active, opacity }) => {
  const lineRef = useRef<THREE.Line>(null);

  const geometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [points]);

  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: active ? '#88aaff' : '#334466',
        transparent: true,
        opacity,
        linewidth: 1,
        depthWrite: false,
      }),
    [active, opacity]
  );

  return <primitive object={new THREE.Line(geometry, material)} ref={lineRef} />;
};
