import React, { useRef, useMemo, useCallback, useEffect, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { SceneLabel } from './SceneLabel';
import * as THREE from 'three';
import type { MemoryObject } from '../../types/universe';
import { CELESTIAL_CONFIGS } from '../../types/universe';
import { useUniverseStore } from '../../store/universeStore';
import type { UniverseDetailLevel } from '../../engines/celestialLayout';
import { getDynamicPosition } from '../../engines/celestialLayout';
import { createRingBands, type RingBand } from '../../engines/space3dBackdrop';
import type { Attachment } from '../../types/attachments';
import { useUniverseRuntime } from './universeRuntime';
import {
  starVertexShader, starFragmentShader,
  sunVertexShader, sunFragmentShader,
  blackHoleVertexShader, blackHoleFragmentShader,
  nebulaVertexShader, nebulaFragmentShader,
  cometVertexShader, cometFragmentShader,
  planetVertexShader, planetFragmentShader,
} from '../../engines/shaders';

interface CelestialObjectProps {
  memory: MemoryObject;
  detailLevel?: UniverseDetailLevel;
}

function getShaders(type: MemoryObject['celestialType']) {
  switch (type) {
    case 'sun': return { vertex: sunVertexShader, fragment: sunFragmentShader };
    case 'black_hole': return { vertex: blackHoleVertexShader, fragment: blackHoleFragmentShader };
    case 'nebula': return { vertex: nebulaVertexShader, fragment: nebulaFragmentShader };
    case 'comet': return { vertex: cometVertexShader, fragment: cometFragmentShader };
    case 'planet': return { vertex: planetVertexShader, fragment: planetFragmentShader };
    default: return { vertex: starVertexShader, fragment: starFragmentShader };
  }
}

export const CelestialObject: React.FC<CelestialObjectProps> = memo(({
  memory,
  detailLevel = 'high',
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const timeRef = useRef(Math.random() * 100);
  const { memoriesRef, lookupRef, sphereGeometry, glowGeometry, quality } = useUniverseRuntime();

  const isSelected = useUniverseStore((state) => state.selectedMemoryId === memory.id);
  const isSpawning = useUniverseStore(
    (state) => state.spawnedMemoryId === memory.id && Date.now() - state.spawnedAt < 2800,
  );

  const config = CELESTIAL_CONFIGS[memory.celestialType];
  const shaders = getShaders(memory.celestialType);

  useEffect(() => {
    if (!isSpawning) return;
    const t = window.setTimeout(() => {
      if (useUniverseStore.getState().spawnedMemoryId === memory.id) {
        useUniverseStore.getState().clearSpawn();
      }
    }, 2800);
    return () => window.clearTimeout(t);
  }, [isSpawning, memory.id]);

  const scale = config.baseScale * (memory.scale || 1) * (memory.importance || 0.5) * 1.5;

  const color = useMemo(() => new THREE.Color(memory.color || config.color), [memory.color, config.color]);
  const emissiveColor = useMemo(() => new THREE.Color(config.emissiveColor), [config.emissiveColor]);
  const accentColor = useMemo(() => new THREE.Color(config.emissiveColor).multiplyScalar(1.5), [config.emissiveColor]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: color },
    uColor2: { value: emissiveColor },
    uIntensity: { value: config.glowIntensity },
    uAccretionColor: { value: accentColor },
  }), [color, emissiveColor, config.glowIntensity, accentColor]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: shaders.vertex,
    fragmentShader: shaders.fragment,
    uniforms,
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: memory.celestialType !== 'nebula',
  }), [shaders, uniforms, memory.celestialType]);

  useEffect(() => () => {
    material.dispose();
  }, [material]);

  useFrame((state, delta) => {
    timeRef.current += delta;
    const time = state.clock.getElapsedTime();

    if (groupRef.current) {
      const dynPos = getDynamicPosition(memory, memoriesRef.current, time, lookupRef.current);
      groupRef.current.position.set(dynPos[0], dynPos[1], dynPos[2]);
    }

    if (material.uniforms.uTime) {
      material.uniforms.uTime.value = timeRef.current;
    }

    if (meshRef.current) {
      meshRef.current.rotation.y += config.rotationSpeed;

      // 2. Cognitive Gravity Decay Visual adjustments
      const importance = memory.importance || 0.5;
      const ageDays = memory.updatedAt > 0 ? Math.max(0, (Date.now() - memory.updatedAt) / 86_400_000) : 365;
      const recency = Math.max(0, 1 - ageDays / 180);
      const decayScale = 0.5 + 0.5 * recency + 0.3 * importance; // forgotten nodes shrink to ~0.5x, active/important stay large

      const spawnBoost = isSpawning
        ? 1 + 0.55 * Math.sin(timeRef.current * 8) * Math.exp(-(timeRef.current % 3) * 0.4)
        : 1;
      const selectPulse = isSelected || isSpawning
        ? 1 + 0.06 * Math.sin(timeRef.current * (isSpawning ? 5 : 3))
        : 1;
      meshRef.current.scale.setScalar(scale * selectPulse * decayScale * spawnBoost);
    }

    const hovered = useUniverseStore.getState().hoveredMemoryId === memory.id;
    if (glowMatRef.current) {
      if (isSpawning) {
        glowMatRef.current.opacity = 0.08 + 0.18 * (0.5 + 0.5 * Math.sin(timeRef.current * 6));
      } else {
        glowMatRef.current.opacity = isSelected ? 0.14 : hovered ? 0.1 : 0.045;
      }
    }
  });

  const handleClick = useCallback((e: THREE.Event) => {
    (e as any).stopPropagation?.();
    const selected = useUniverseStore.getState().selectedMemoryId;
    useUniverseStore.getState().selectMemory(selected === memory.id ? null : memory.id);
  }, [memory.id]);

  const handlePointerOver = useCallback((e: THREE.Event) => {
    (e as any).stopPropagation?.();
    useUniverseStore.getState().hoverMemory(memory.id);
    document.body.style.cursor = 'pointer';
  }, [memory.id]);

  const handlePointerOut = useCallback(() => {
    useUniverseStore.getState().hoverMemory(null);
    document.body.style.cursor = 'auto';
  }, []);

  const glowScale = scale * 2.2;
  const showAmbientGlow = detailLevel !== 'low' || isSelected;
  const showRings = memory.celestialType === 'planet' && (isSelected || (memory.importance || 0) >= 0.72);
  const showAttachments = Boolean(memory.attachments?.length) && (detailLevel === 'high' || isSelected);
  const statusRingColor =
    memory.projectStatus === 'planned'
      ? '#94a3b8'
      : memory.projectStatus === 'active'
        ? '#38bdf8'
        : memory.projectStatus === 'done'
          ? '#4ade80'
          : null;

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        geometry={sphereGeometry}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <primitive object={material} attach="material" />
      </mesh>

      {showAmbientGlow && (
        <mesh geometry={glowGeometry} scale={glowScale}>
          <meshBasicMaterial
            ref={glowMatRef}
            color={emissiveColor}
            transparent
            opacity={isSelected ? 0.14 : 0.045}
            side={THREE.BackSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {(isSelected || isSpawning) && (
        <mesh geometry={glowGeometry} scale={scale * (isSpawning ? 5.5 : 3.5)}>
          <meshBasicMaterial
            color={isSpawning ? '#22d3ee' : color}
            transparent
            opacity={isSpawning ? 0.14 : 0.05}
            side={THREE.BackSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {isSpawning && !quality.reduceEffects && (
        <mesh geometry={glowGeometry} scale={scale * 7}>
          <meshBasicMaterial
            color="#a78bfa"
            transparent
            opacity={0.06}
            side={THREE.BackSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {showRings && detailLevel !== 'low' && (
        <Space3DRings
          memoryId={memory.id}
          baseScale={scale}
          baseColor={color}
          isActive={isSelected}
          detailLevel={detailLevel}
        />
      )}

      {statusRingColor && detailLevel !== 'low' && (
        <mesh rotation={[Math.PI / 2.4, 0.15, 0]} scale={scale * 1.55}>
          <torusGeometry args={[1, 0.045, 8, 48]} />
          <meshBasicMaterial color={statusRingColor} transparent opacity={0.85} depthWrite={false} />
        </mesh>
      )}

      {showAttachments && (
        <group>
          {memory.attachments!.map((attach, idx) => (
            <AttachmentOrbitNode
              key={`${memory.id}-attach-${idx}`}
              attachment={attach}
              index={idx}
              total={memory.attachments!.length}
              parentScale={scale}
            />
          ))}
        </group>
      )}

      {isSelected && (
        <Billboard follow lockX={false} lockY={false} lockZ={false}>
          <SceneLabel
            position={[0, scale * 2.5, 0]}
            fontSize={0.35}
            color="#ffffff"
            maxWidth={6}
          >
            {memory.title || memory.text.substring(0, 40)}
          </SceneLabel>
        </Billboard>
      )}
    </group>
  );
});

CelestialObject.displayName = 'CelestialObject';

const Space3DRings: React.FC<{
  memoryId: string;
  baseScale: number;
  baseColor: THREE.Color;
  isActive: boolean;
  detailLevel: UniverseDetailLevel;
}> = ({ memoryId, baseScale, baseColor, isActive, detailLevel }) => {
  const groupRef = useRef<THREE.Group>(null);
  const bands = useMemo<RingBand[]>(() => (
    createRingBands(memoryId, baseScale, baseColor, isActive ? 1.18 : 0.92)
  ), [baseColor, baseScale, isActive, memoryId]);
  const segments = detailLevel === 'high' ? 128 : 72;

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.z += delta * 0.045;
    }
  });

  return (
    <group ref={groupRef} rotation={[Math.PI / 2.35, 0.12, -0.28]}>
      {bands.map((band, index) => (
        <mesh key={`${memoryId}-ring-${index}`} rotation={[0, 0, band.tilt]}>
          <ringGeometry args={[band.innerRadius, band.outerRadius, segments, 1]} />
          <meshBasicMaterial
            color={band.color}
            transparent
            opacity={Math.min(0.26, band.opacity)}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
};

function getAttachmentCategory(attachment: Attachment): 'library' | 'temple' | 'tech' | 'hologram' | 'satellite' | 'pulsation' {
  const type = attachment.type;
  const name = attachment.name.toLowerCase();

  if (type === 'image') return 'hologram';
  if (type === 'video') return 'satellite';
  if (type === 'audio') return 'pulsation';

  if (type === 'document') {
    if (name.endsWith('.md') || name.endsWith('.txt')) {
      return 'library';
    }
    if (name.endsWith('.pdf')) {
      return 'temple';
    }
    if (name.match(/\.(js|ts|tsx|jsx|html|css|py|cpp|h|java|json|rs|go|sh)$/)) {
      return 'tech';
    }
  }
  return 'library';
}

interface AttachmentOrbitNodeProps {
  attachment: Attachment;
  index: number;
  total: number;
  parentScale: number;
}

const AttachmentOrbitNode: React.FC<AttachmentOrbitNodeProps> = ({
  attachment,
  index,
  total,
  parentScale,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const beaconMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const waveRef = useRef<THREE.Mesh>(null);

  const category = useMemo(() => getAttachmentCategory(attachment), [attachment]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.getElapsedTime();

    // Orbit paths tilt, alternating directions, staggered radii
    const speed = (0.35 + index * 0.12) * (index % 2 === 0 ? 1 : -1);
    const radius = parentScale * 2.2 + index * 0.7;
    const tilt = index * (Math.PI / 6);
    const angle = time * speed + (index * (Math.PI * 2)) / total;

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * Math.cos(tilt);
    const y = Math.sin(angle) * radius * Math.sin(tilt);

    groupRef.current.position.set(x, y, z);

    // Self rotation
    groupRef.current.rotation.y += 0.015;
    groupRef.current.rotation.x += 0.008;

    // Beacon blink animation
    if (beaconMaterialRef.current) {
      const isLit = Math.sin(time * 12) > 0;
      beaconMaterialRef.current.color.set(new THREE.Color(isLit ? '#ff3333' : '#440000'));
    }

    // Audio sphere pulsation scale
    if (pulseRef.current) {
      const pulseScale = 1.0 + 0.3 * Math.sin(time * 8.0);
      pulseRef.current.scale.setScalar(pulseScale);
    }

    // Audio sound waves expanding opacity and scale
    if (waveRef.current) {
      const waveCycle = (time * 1.5) % 1.0;
      waveRef.current.scale.setScalar(1.0 + waveCycle * 1.5);
      if (waveRef.current.material) {
        (waveRef.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1.0 - waveCycle);
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* 1. Luminous Libraries (Cyan boxes with wireframe grids) */}
      {category === 'library' && (
        <group>
          <mesh>
            <boxGeometry args={[0.26, 0.26, 0.26]} />
            <meshStandardMaterial
              color="#00ffff"
              emissive="#0088ff"
              emissiveIntensity={2.0}
              roughness={0.1}
            />
          </mesh>
          <mesh>
            <boxGeometry args={[0.32, 0.32, 0.32]} />
            <meshBasicMaterial color="#00ffff" wireframe transparent opacity={0.3} />
          </mesh>
        </group>
      )}

      {/* 2. Ancient Temples (Purple/Violet dodecahedrons with dark violet rings) */}
      {category === 'temple' && (
        <group>
          <mesh>
            <dodecahedronGeometry args={[0.2]} />
            <meshStandardMaterial
              color="#330066"
              emissive="#8800ff"
              emissiveIntensity={1.8}
              roughness={0.2}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.3, 0.32, 16]} />
            <meshBasicMaterial color="#8800ff" side={THREE.DoubleSide} transparent opacity={0.6} />
          </mesh>
        </group>
      )}

      {/* 3. Neon Tech (Magenta wireframe octahedrons/pyramids) */}
      {category === 'tech' && (
        <group>
          <mesh>
            <octahedronGeometry args={[0.2]} />
            <meshStandardMaterial
              color="#ff00bb"
              emissive="#ff5500"
              emissiveIntensity={2.2}
            />
          </mesh>
          <mesh>
            <octahedronGeometry args={[0.24]} />
            <meshBasicMaterial color="#ff5500" wireframe transparent opacity={0.7} />
          </mesh>
        </group>
      )}

      {/* 4. Orbital Holograms (Emerald spheres with glowing green bands) */}
      {category === 'hologram' && (
        <group>
          <mesh>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshBasicMaterial color="#00ff66" transparent opacity={0.7} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.22, 0.26, 24]} />
            <meshBasicMaterial color="#00ff66" side={THREE.DoubleSide} transparent opacity={0.6} />
          </mesh>
        </group>
      )}

      {/* 5. Live Satellites (Hub sphere + solar panel boxes + blinking beacon) */}
      {category === 'satellite' && (
        <group>
          {/* Main Hub */}
          <mesh>
            <sphereGeometry args={[0.13, 10, 10]} />
            <meshStandardMaterial color="#8899a6" roughness={0.3} metalness={0.8} />
          </mesh>
          {/* Solar Panel Left */}
          <mesh position={[-0.22, 0, 0]}>
            <boxGeometry args={[0.22, 0.08, 0.02]} />
            <meshStandardMaterial color="#002244" roughness={0.2} emissive="#003366" emissiveIntensity={0.5} />
          </mesh>
          {/* Solar Panel Right */}
          <mesh position={[0.22, 0, 0]}>
            <boxGeometry args={[0.22, 0.08, 0.02]} />
            <meshStandardMaterial color="#002244" roughness={0.2} emissive="#003366" emissiveIntensity={0.5} />
          </mesh>
          {/* Blinking Beacon */}
          <mesh position={[0, 0.16, 0]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshBasicMaterial ref={beaconMaterialRef} color="#ff3333" />
          </mesh>
        </group>
      )}

      {/* 6. Energetic Pulsations (Pink pulsating sphere + expanding waves) */}
      {category === 'pulsation' && (
        <group>
          <mesh ref={pulseRef}>
            <sphereGeometry args={[0.16, 16, 16]} />
            <meshStandardMaterial
              color="#ff0077"
              emissive="#ff00cc"
              emissiveIntensity={2.5}
            />
          </mesh>
          <mesh ref={waveRef}>
            <sphereGeometry args={[0.16, 16, 16]} />
            <meshBasicMaterial color="#ff0077" transparent opacity={0.4} depthWrite={false} />
          </mesh>
        </group>
      )}
    </group>
  );
};
