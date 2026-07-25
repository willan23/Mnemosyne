import React, { Suspense, useMemo, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useUniverseStore } from '../../store/universeStore';
import { CelestialObject } from './CelestialObject';
import { ConnectionLines } from './ConnectionLines';
import { Space3DBackdrop } from './Space3DBackdrop';
import { CELESTIAL_CONFIGS, UNIVERSE_COLORS } from '../../types/universe';
import {
  buildCognitiveConstellations,
  getUniverseRenderBudget,
  rankMemoriesForRender,
  getDynamicPosition,
  type CognitiveConstellation,
} from '../../engines/celestialLayout';

function UniverseScene() {
  const {
    memories,
    universeType,
    selectedMemoryId,
    hoveredMemoryId,
    filteredIds,
    cameraTarget,
    isGalaxyView,
  } = useUniverseStore();
  const { scene, camera } = useThree();
  const controlsRef = useRef<any>(null);

  const colors = UNIVERSE_COLORS[universeType];
  const activeMemoryId = selectedMemoryId || hoveredMemoryId;

  // Lockstep Delta Tracking state
  const lastTrackedPosRef = useRef<THREE.Vector3 | null>(null);
  const prevSelectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedMemoryId !== prevSelectedIdRef.current) {
      lastTrackedPosRef.current = null;
      prevSelectedIdRef.current = selectedMemoryId;
    }
  }, [selectedMemoryId]);

  const minOrbitDistance = useMemo(() => {
    if (!selectedMemoryId) return 4.0;
    const mem = memories.find((m) => m.id === selectedMemoryId);
    if (!mem) return 4.0;
    const config = CELESTIAL_CONFIGS[mem.celestialType];
    const scale = config.baseScale * (mem.scale || 1) * (mem.importance || 0.5) * 1.5;
    // O raio da esfera foi ajustado para 1, então a escala final real no espaço é 'scale'.
    // Mantemos uma folga de segurança proporcional à escala real para evitar que a câmera entre na atmosfera do corpo celeste.
    return Math.max(1.5, scale * 1.35 + 0.8);
  }, [selectedMemoryId, memories]);

  // Throttled clock for high-performance constellation layout updates
  const [constellationTime, setConstellationTime] = useState(0);
  const lastUpdateTimeRef = useRef(0);

  useEffect(() => {
    scene.background = new THREE.Color(colors.bg);
  }, [universeType, colors.bg, scene]);

  useFrame((state) => {
    if (!controlsRef.current) return;
    const time = state.clock.getElapsedTime();

    // Throttle constellation layout updates to 10fps for ultimate smooth performance
    if (time - lastUpdateTimeRef.current > 0.1) {
      lastUpdateTimeRef.current = time;
      setConstellationTime(time);
    }

    if (isGalaxyView) {
      // Galaxy Overview Observatory zoom-out perspective [0, 55, 95]
      const targetGalaxyPos = new THREE.Vector3(0, 55, 95);
      const targetCenter = new THREE.Vector3(0, 0, 0);

      controlsRef.current.target.lerp(targetCenter, 0.04);
      camera.position.lerp(targetGalaxyPos, 0.04);
      controlsRef.current.update();
    } else if (selectedMemoryId) {
      // 360 Lock-on Dynamic camera tracking (Lockstep Delta Tracking)
      const mem = memories.find((m) => m.id === selectedMemoryId);
      if (mem) {
        const dynPosArray = getDynamicPosition(mem, memories, time);
        const dynamicTarget = new THREE.Vector3(...dynPosArray);

        if (!lastTrackedPosRef.current) {
          // Fase 1: Lerp inicial e suave de aproximação até o corpo celeste
          const scale = mem.scale ?? CELESTIAL_CONFIGS[mem.celestialType].baseScale;
          const focusDistance = Math.max(5.5, scale * 4 + 3);

          const currentTarget = controlsRef.current.target.clone();
          const cameraOffset = camera.position.clone().sub(currentTarget);
          if (cameraOffset.lengthSq() < 0.001) cameraOffset.set(0, 0, 1);
          const targetCamPos = dynamicTarget.clone().add(cameraOffset.normalize().multiplyScalar(focusDistance));

          controlsRef.current.target.lerp(dynamicTarget, 0.06);
          camera.position.lerp(targetCamPos, 0.06);
          controlsRef.current.update();

          // Uma vez muito perto do corpo celeste, entramos em rastreamento síncrono silencioso
          if (controlsRef.current.target.distanceTo(dynamicTarget) < 0.1) {
            lastTrackedPosRef.current = dynamicTarget.clone();
          }
        } else {
          // Fase 2: Lockstep Delta Tracking - move a câmera e o foco na exata mesma translação orbital do planeta
          // Isso resolve o travamento e permite ao usuário rotacionar e usar o scroll de zoom livremente
          const delta = dynamicTarget.clone().sub(lastTrackedPosRef.current);
          
          camera.position.add(delta);
          controlsRef.current.target.add(delta);
          
          lastTrackedPosRef.current.copy(dynamicTarget);
          controlsRef.current.update();
        }
      }
    }
  });

  const filteredMemories = useMemo(() => {
    if (!filteredIds) return memories;
    return memories.filter((m) => filteredIds.includes(m.id));
  }, [memories, filteredIds]);

  const renderBudget = useMemo(
    () => getUniverseRenderBudget(filteredMemories.length),
    [filteredMemories.length]
  );

  useEffect(() => {
    scene.fog = new THREE.Fog(colors.fog, renderBudget.fogNear, renderBudget.fogFar);
  }, [colors.fog, renderBudget.fogFar, renderBudget.fogNear, scene]);

  const visibleMemories = useMemo(
    () => rankMemoriesForRender(filteredMemories, activeMemoryId, renderBudget.maxObjects),
    [activeMemoryId, filteredMemories, renderBudget.maxObjects]
  );

  const constellations = useMemo(
    () =>
      buildCognitiveConstellations(
        visibleMemories,
        renderBudget.detail === 'high' ? 12 : 7,
        constellationTime
      ),
    [renderBudget.detail, visibleMemories, constellationTime]
  );

  // Intro de câmara — chegada ao universo
  const introDoneRef = useRef(false);
  useFrame(() => {
    if (introDoneRef.current || !controlsRef.current || selectedMemoryId || isGalaxyView) {
      introDoneRef.current = true;
      return;
    }
    const targetPos = new THREE.Vector3(0, 8, 28);
    camera.position.lerp(targetPos, 0.035);
    controlsRef.current.target.lerp(new THREE.Vector3(0, 0, 0), 0.04);
    controlsRef.current.update();
    if (camera.position.distanceTo(targetPos) < 0.35) {
      introDoneRef.current = true;
    }
  });

  return (
    <>
      <color attach="background" args={[colors.bg]} />
      <ambientLight color={colors.ambient} intensity={0.45} />
      <pointLight position={[0, 0, 0]} intensity={1.1} color="#fff6e0" distance={90} decay={2} />
      <pointLight position={[24, 18, -22]} intensity={0.45} color="#6d8cff" distance={100} decay={2} />
      <pointLight position={[-22, -12, 26]} intensity={0.32} color="#ff7a5c" distance={80} decay={2} />
      <pointLight position={[0, 40, 10]} intensity={0.18} color="#a78bfa" distance={120} decay={2} />
      <hemisphereLight args={['#9eb6ff', '#0a0a18', 0.22]} />

      <Space3DBackdrop
        universeType={universeType}
        detailLevel={renderBudget.detail}
        starCount={renderBudget.starCount}
      />

      {visibleMemories.length === 0 && <ProtoStarField />}

      <ConstellationGuides
        constellations={constellations}
        showLabels={renderBudget.showConstellationLabels}
      />

      <ConnectionLines
        memories={visibleMemories}
        maxConnections={renderBudget.connectionLimit}
      />

      {visibleMemories.map((memory) => (
        <CelestialObject
          key={memory.id}
          memory={memory}
          detailLevel={renderBudget.detail}
          sphereSegments={renderBudget.sphereSegments}
        />
      ))}

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.055}
        rotateSpeed={0.48}
        zoomSpeed={0.75}
        panSpeed={0.45}
        minDistance={minOrbitDistance}
        maxDistance={Math.max(140, renderBudget.fogFar * 0.9)}
        target={cameraTarget}
        autoRotate={visibleMemories.length === 0}
        autoRotateSpeed={0.28}
      />
    </>
  );
}

/** Estrelas-semente quando o universo ainda não tem memórias — espaço vivo, não ecrã vazio. */
function ProtoStarField() {
  const groupRef = useRef<THREE.Group>(null);
  const seeds = useMemo(() => {
    const out: Array<{ pos: [number, number, number]; scale: number; color: string }> = [];
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2;
      const r = 6 + (i % 5) * 2.2;
      out.push({
        pos: [Math.cos(a) * r, Math.sin(a * 1.7) * 2.5, Math.sin(a) * r],
        scale: 0.12 + (i % 4) * 0.04,
        color: i % 3 === 0 ? '#a78bfa' : i % 3 === 1 ? '#67e8f9' : '#fde68a',
      });
    }
    return out;
  }, []);

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.getElapsedTime() * 0.04;
  });

  return (
    <group ref={groupRef}>
      {seeds.map((seed, index) => (
        <mesh key={`proto-${index}`} position={seed.pos}>
          <sphereGeometry args={[seed.scale, 12, 12]} />
          <meshBasicMaterial
            color={seed.color}
            transparent
            opacity={0.55}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
      <mesh>
        <ringGeometry args={[11, 11.35, 96]} />
        <meshBasicMaterial
          color="#6366f1"
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

interface ConstellationGuidesProps {
  constellations: CognitiveConstellation[];
  showLabels: boolean;
}

const ConstellationGuides: React.FC<ConstellationGuidesProps> = ({ constellations, showLabels }) => {
  if (constellations.length === 0) return null;

  return (
    <group>
      {constellations.map((constellation) => (
        <ConstellationGuide
          key={constellation.id}
          constellation={constellation}
          showLabel={showLabels}
        />
      ))}
    </group>
  );
};

const ConstellationGuide: React.FC<{
  constellation: CognitiveConstellation;
  showLabel: boolean;
}> = ({ constellation, showLabel }) => {
  const ring = useMemo(() => {
    const center = new THREE.Vector3(...constellation.center);
    const normal = center.lengthSq() > 0.001 ? center.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const fallback = Math.abs(normal.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(normal, fallback).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const points: THREE.Vector3[] = [];

    for (let i = 0; i < 96; i += 1) {
      const t = (i / 96) * Math.PI * 2;
      points.push(
        center
          .clone()
          .add(tangent.clone().multiplyScalar(Math.cos(t) * constellation.radius))
          .add(bitangent.clone().multiplyScalar(Math.sin(t) * constellation.radius))
      );
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: constellation.color,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });

    return new THREE.LineLoop(geometry, material);
  }, [constellation]);

  useEffect(() => {
    return () => {
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    };
  }, [ring]);

  const labelPosition = useMemo<[number, number, number]>(
    () => [
      constellation.center[0],
      constellation.center[1] + constellation.radius + 0.8,
      constellation.center[2],
    ],
    [constellation]
  );

  return (
    <group>
      <primitive object={ring} />
      {showLabel && (
        <Billboard position={labelPosition}>
          <Text
            fontSize={0.32}
            color="#b8c7ff"
            anchorX="center"
            anchorY="middle"
            maxWidth={8}
            fillOpacity={0.62}
          >
            {constellation.label} / {constellation.count}
          </Text>
        </Billboard>
      )}
    </group>
  );
};

function LoadingFallback() {
  return null;
}

export const Universe3D: React.FC = () => {
  return (
    <Canvas
      camera={{ position: [0, 18, 48], fov: 55, near: 0.1, far: 600 }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.28,
      }}
      style={{ width: '100%', height: '100%' }}
      dpr={[1, 1.75]}
    >
      <Suspense fallback={<LoadingFallback />}>
        <UniverseScene />
      </Suspense>
    </Canvas>
  );
};
