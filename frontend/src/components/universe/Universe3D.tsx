import React, { Suspense, useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, OrbitControls } from '@react-three/drei';
import { SceneLabel } from './SceneLabel';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useUniverseStore } from '../../store/universeStore';
import { CelestialObject } from './CelestialObject';
import { ConnectionLines } from './ConnectionLines';
import { Space3DBackdrop } from './Space3DBackdrop';
import { CELESTIAL_CONFIGS } from '../../types/universe';
import { getUniverseTheme } from '../../engines/universeThemes';
import {
  buildCognitiveConstellations,
  getUniverseRenderBudget,
  getDynamicPosition,
  type CognitiveConstellation,
} from '../../engines/celestialLayout';
import {
  computeFocusCameraPosition,
  computeFocusDistance,
  computeMinOrbitDistance,
  expSmoothVec3,
} from './cameraEasing';
import { getUniverseQualityProfile, type UniverseQualityProfile } from './qualityProfile';
import { UniverseRuntimeContext, useUniverseRuntime, type UniverseRuntime } from './universeRuntime';
import { useMemoryView } from '../../hooks/useMemoryView';
import type { MemoryViewOptions } from '../../services/memoryViewProtocol';
import { useTranslation } from '../../utils/translations';
import { attachedSceneEvents } from '../../utils/attachedSceneEvents';

function UniverseScene({ quality, selection }: { quality: UniverseQualityProfile; selection: ReturnType<typeof useMemoryView> }) {
  const memories = useUniverseStore((state) => state.memories);
  const universeType = useUniverseStore((state) => state.universeType);
  const selectedMemoryId = useUniverseStore((state) => state.selectedMemoryId);
  const cameraTarget = useUniverseStore((state) => state.cameraTarget);
  const isGalaxyView = useUniverseStore((state) => state.isGalaxyView);

  const { scene, camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const theme = getUniverseTheme(universeType);

  const lastTrackedPosRef = useRef<THREE.Vector3 | null>(null);
  const prevSelectedIdRef = useRef<string | null>(null);
  const introDoneRef = useRef(false);
  const scratchTarget = useRef(new THREE.Vector3());
  const scratchCam = useRef(new THREE.Vector3());
  const scratchGalaxy = useRef(new THREE.Vector3(0, 55, 95));
  const scratchOrigin = useRef(new THREE.Vector3(0, 0, 0));
  const scratchIntro = useRef(new THREE.Vector3(0, 8, 28));

  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;

  const lookup = selection.lookup;
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  useEffect(() => {
    if (selectedMemoryId !== prevSelectedIdRef.current) {
      lastTrackedPosRef.current = null;
      prevSelectedIdRef.current = selectedMemoryId;
    }
  }, [selectedMemoryId]);

  const minOrbitDistance = useMemo(() => {
    if (!selectedMemoryId) return 4.0;
    const mem = lookup.get(selectedMemoryId);
    if (!mem) return 4.0;
    const config = CELESTIAL_CONFIGS[mem.celestialType];
    const scale = config.baseScale * (mem.scale || 1) * (mem.importance || 0.5) * 1.5;
    return computeMinOrbitDistance(scale);
  }, [lookup, selectedMemoryId]);

  useEffect(() => {
    scene.background = new THREE.Color(theme.bg);
    scene.fog = new THREE.FogExp2(theme.fog, quality.fogDensity * theme.fogDensityMul);
  }, [quality.fogDensity, scene, theme.bg, theme.fog, theme.fogDensityMul]);

  useFrame((state, delta) => {
    if (!controlsRef.current) return;
    const time = state.clock.getElapsedTime();
    const dt = Math.min(0.05, delta);

    if (isGalaxyView) {
      introDoneRef.current = true;
      expSmoothVec3(controlsRef.current.target, scratchOrigin.current, dt, 2.2);
      expSmoothVec3(camera.position, scratchGalaxy.current, dt, 2.2);
      controlsRef.current.update();
      return;
    }

    if (selectedMemoryId) {
      introDoneRef.current = true;
      const mem = lookupRef.current.get(selectedMemoryId);
      if (!mem) return;

      const dynPosArray = getDynamicPosition(mem, memoriesRef.current, time, lookupRef.current);
      const dynamicTarget = scratchTarget.current.set(dynPosArray[0], dynPosArray[1], dynPosArray[2]);

      if (!lastTrackedPosRef.current) {
        const scale = mem.scale ?? CELESTIAL_CONFIGS[mem.celestialType].baseScale;
        const focusDistance = computeFocusDistance(scale);
        const targetCamPos = computeFocusCameraPosition(
          dynamicTarget,
          camera.position,
          controlsRef.current.target,
          focusDistance,
          scratchCam.current,
        );

        expSmoothVec3(controlsRef.current.target, dynamicTarget, dt, 3.4);
        expSmoothVec3(camera.position, targetCamPos, dt, 3.2);
        controlsRef.current.update();

        if (controlsRef.current.target.distanceTo(dynamicTarget) < 0.12) {
          lastTrackedPosRef.current = dynamicTarget.clone();
        }
      } else {
        const tracked = lastTrackedPosRef.current;
        camera.position.x += dynamicTarget.x - tracked.x;
        camera.position.y += dynamicTarget.y - tracked.y;
        camera.position.z += dynamicTarget.z - tracked.z;
        controlsRef.current.target.x += dynamicTarget.x - tracked.x;
        controlsRef.current.target.y += dynamicTarget.y - tracked.y;
        controlsRef.current.target.z += dynamicTarget.z - tracked.z;
        tracked.copy(dynamicTarget);
        controlsRef.current.update();
      }
      return;
    }

    if (introDoneRef.current) return;
    expSmoothVec3(camera.position, scratchIntro.current, dt, 1.8);
    expSmoothVec3(controlsRef.current.target, scratchOrigin.current, dt, 2.0);
    controlsRef.current.update();
    if (camera.position.distanceTo(scratchIntro.current) < 0.35) {
      introDoneRef.current = true;
    }
  });

  const budgetCount = selection.loading ? memories.length : selection.count;
  const renderBudget = useMemo(
    () => getUniverseRenderBudget(budgetCount),
    [budgetCount],
  );

  const detailLevel = quality.reduceEffects && renderBudget.detail === 'high'
    ? 'medium'
    : renderBudget.detail;

  const visibleMemories = selection.memories;

  const constellations = useMemo(
    () =>
      buildCognitiveConstellations(
        visibleMemories,
        renderBudget.detail === 'high' && !quality.reduceEffects ? 12 : 7,
        0,
      ),
    [quality.reduceEffects, renderBudget.detail, visibleMemories],
  );

  const sphereGeometry = useMemo(
    () => new THREE.SphereGeometry(1, renderBudget.sphereSegments, renderBudget.sphereSegments),
    [renderBudget.sphereSegments],
  );
  const glowGeometry = useMemo(
    () => {
      const segments = Math.max(12, Math.floor(renderBudget.sphereSegments / 2));
      return new THREE.SphereGeometry(1, segments, segments);
    },
    [renderBudget.sphereSegments],
  );

  useEffect(() => () => {
    sphereGeometry.dispose();
    glowGeometry.dispose();
  }, [glowGeometry, sphereGeometry]);

  const runtime = useMemo<UniverseRuntime>(
    () => ({
      memoriesRef,
      lookupRef,
      sphereGeometry,
      glowGeometry,
      quality,
    }),
    [glowGeometry, quality, sphereGeometry],
  );

  return (
    <UniverseRuntimeContext.Provider value={runtime}>
      <color attach="background" args={[theme.bg]} />
      <hemisphereLight
        color={theme.lights.hemisphereSky}
        groundColor={theme.lights.hemisphereGround}
        intensity={quality.reduceEffects ? theme.lights.hemisphereIntensity * 0.7 : theme.lights.hemisphereIntensity}
      />
      <ambientLight
        color={theme.ambient}
        intensity={quality.reduceEffects ? theme.lights.ambientIntensity * 1.2 : theme.lights.ambientIntensity}
      />
      <directionalLight
        position={[16, 26, 12]}
        intensity={quality.reduceEffects ? theme.lights.directionalIntensity * 0.65 : theme.lights.directionalIntensity}
        color={theme.lights.directionalColor}
      />
      {!quality.reduceEffects && (
        <>
          <pointLight
            position={[0, 0, 0]}
            intensity={theme.lights.corePointIntensity}
            color={theme.lights.corePointColor}
            distance={72}
            decay={2}
          />
          <pointLight
            position={[22, 16, -18]}
            intensity={theme.lights.fillPointIntensity}
            color={theme.lights.fillPointColor}
            distance={90}
            decay={2}
          />
        </>
      )}

      <Space3DBackdrop
        universeType={universeType}
        detailLevel={detailLevel}
        starCount={renderBudget.starCount}
        reduceEffects={quality.reduceEffects}
      />

      {visibleMemories.length === 0 && <ProtoStarField />}

      <ConstellationGuides
        constellations={constellations}
        showLabels={renderBudget.showConstellationLabels && !quality.reduceEffects}
      />

      <ConnectionLines
        memories={visibleMemories}
        maxConnections={renderBudget.connectionLimit}
      />

      {visibleMemories.map((memory) => (
        <CelestialObject
          key={memory.id}
          memory={memory}
          detailLevel={detailLevel}
        />
      ))}

      <MemoryHoverLabel />

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
    </UniverseRuntimeContext.Provider>
  );
}

function MemoryHoverLabel() {
  const hoveredId = useUniverseStore((state) => state.hoveredMemoryId);
  const selectedId = useUniverseStore((state) => state.selectedMemoryId);
  const memories = useUniverseStore((state) => state.memories);
  const groupRef = useRef<THREE.Group>(null);
  const { memoriesRef, lookupRef } = useUniverseRuntime();

  const memory = hoveredId && hoveredId !== selectedId
    ? memories.find((item) => item.id === hoveredId) ?? null
    : null;

  useFrame((state) => {
    if (!groupRef.current || !memory) return;
    const pos = getDynamicPosition(
      memory,
      memoriesRef.current,
      state.clock.getElapsedTime(),
      lookupRef.current,
    );
    const config = CELESTIAL_CONFIGS[memory.celestialType];
    const scale = config.baseScale * (memory.scale || 1) * (memory.importance || 0.5) * 1.5;
    groupRef.current.position.set(pos[0], pos[1] + scale * 2.5, pos[2]);
  });

  if (!memory) return null;

  return (
    <group ref={groupRef}>
      <Billboard follow>
        <SceneLabel
          fontSize={0.32}
          color="#e8eeff"
          maxWidth={6}
          opacity={0.92}
        >
          {memory.title || memory.text.substring(0, 40)}
        </SceneLabel>
      </Billboard>
    </group>
  );
}

function ProtoStarField() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
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

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    seeds.forEach((seed, index) => {
      dummy.position.set(...seed.pos);
      dummy.scale.setScalar(seed.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, color.set(seed.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [seeds]);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.getElapsedTime() * 0.04;
    }
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, seeds.length]}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>
      <mesh>
        <ringGeometry args={[11, 11.35, 64]} />
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

    for (let i = 0; i < 64; i += 1) {
      const t = (i / 64) * Math.PI * 2;
      points.push(
        center
          .clone()
          .addScaledVector(tangent, Math.cos(t) * constellation.radius)
          .addScaledVector(bitangent, Math.sin(t) * constellation.radius),
      );
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: constellation.color,
      transparent: true,
      opacity: 0.16,
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
    [constellation],
  );

  return (
    <group>
      <primitive object={ring} />
      {showLabel && (
        <Billboard position={labelPosition}>
          <SceneLabel
            fontSize={0.32}
            color="#b8c7ff"
            maxWidth={8}
            opacity={0.62}
          >
            {constellation.label} / {constellation.count}
          </SceneLabel>
        </Billboard>
      )}
    </group>
  );
};

function LoadingFallback() {
  return null;
}

export const Universe3D: React.FC = () => {
  const memories = useUniverseStore((state) => state.memories);
  const activeId = useUniverseStore((state) => state.selectedMemoryId);
  const filteredIds = useUniverseStore((state) => state.filteredIds);
  const taxonomy = useUniverseStore((state) => state.taxonomyFilter);
  const options = useMemo<MemoryViewOptions>(() => ({ mode: 'scene', activeId, filteredIds, taxonomy }), [activeId, filteredIds, taxonomy]);
  const selection = useMemoryView(memories, options);
  const quality = useMemo(() => getUniverseQualityProfile(memories.length), [memories.length]);
  const { t } = useTranslation();

  return (
    <div className="absolute inset-0 z-0">
      <Canvas
        events={attachedSceneEvents}
        camera={{ position: [0, 18, 48], fov: 55, near: 0.1, far: 600 }}
        frameloop="always"
        dpr={quality.dpr}
        gl={{
          antialias: quality.antialias,
          alpha: false,
          powerPreference: quality.isAndroid ? 'low-power' : 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.18,
        }}
        style={{ width: '100%', height: '100%', pointerEvents: 'auto' }}
      >
        <Suspense fallback={<LoadingFallback />}>
          <UniverseScene quality={quality} selection={selection} />
        </Suspense>
      </Canvas>
      {(selection.loading || selection.error) && <p role={selection.error ? 'alert' : 'status'}
        className="pointer-events-none absolute bottom-24 left-4 rounded-lg bg-black/70 px-3 py-2 text-xs text-slate-200">
        {selection.error ? t('memoryViewUnavailable') : t('loading')}
        {selection.error && <button type="button" onClick={selection.retry} className="pointer-events-auto ml-3 underline">{t('memoryViewRetry')}</button>}
      </p>}
    </div>
  );
};
