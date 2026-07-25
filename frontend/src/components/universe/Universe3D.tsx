import React, { Suspense, useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { useUniverseStore } from '../../store/universeStore';
import { CelestialObject } from './CelestialObject';
import { ConnectionLines } from './ConnectionLines';
import { UNIVERSE_COLORS } from '../../types/universe';

function UniverseScene() {
  const { memories, universeType, selectedMemoryId, filteredIds, cameraTarget } = useUniverseStore();
  const { scene } = useThree();
  const controlsRef = useRef<any>(null);
  const targetRef = useRef(new THREE.Vector3());

  const colors = UNIVERSE_COLORS[universeType];

  useEffect(() => {
    scene.background = new THREE.Color(colors.bg);
    scene.fog = new THREE.Fog(colors.fog, 40, 150);
  }, [universeType, colors, scene]);

  useEffect(() => {
    if (selectedMemoryId) {
      const mem = memories.find((m) => m.id === selectedMemoryId);
      if (mem) {
        targetRef.current.set(...mem.position);
      }
    }
  }, [selectedMemoryId, memories]);

  useFrame(() => {
    if (controlsRef.current && selectedMemoryId) {
      controlsRef.current.target.lerp(targetRef.current, 0.05);
      controlsRef.current.update();
    }
  });

  const visibleMemories = useMemo(() => {
    if (!filteredIds) return memories;
    return memories.filter((m) => filteredIds.includes(m.id));
  }, [memories, filteredIds]);

  return (
    <>
      <ambientLight color={colors.ambient} intensity={0.4} />
      <pointLight position={[0, 0, 0]} intensity={0.6} color="#ffffff" distance={60} />
      <pointLight position={[20, 15, -20]} intensity={0.3} color="#4466ff" distance={80} />
      <pointLight position={[-20, -15, 20]} intensity={0.2} color="#ff6644" distance={60} />

      <Stars
        radius={100}
        depth={60}
        count={3000}
        factor={4}
        saturation={0}
        fade
        speed={0.5}
      />

      <ConnectionLines memories={visibleMemories} />

      {visibleMemories.map((memory) => (
        <CelestialObject key={memory.id} memory={memory} />
      ))}

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
        panSpeed={0.5}
        minDistance={2}
        maxDistance={120}
        target={cameraTarget}
      />
    </>
  );
}

function LoadingFallback() {
  return null;
}

export const Universe3D: React.FC = () => {
  return (
    <Canvas
      camera={{ position: [0, 0, 25], fov: 60, near: 0.1, far: 500 }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.2,
      }}
      style={{ width: '100%', height: '100%' }}
      dpr={[1, 2]}
    >
      <Suspense fallback={<LoadingFallback />}>
        <UniverseScene />
      </Suspense>
    </Canvas>
  );
};
