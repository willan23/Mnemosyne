import React, { useRef, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { MemoryObject } from '../../types/universe';
import { CELESTIAL_CONFIGS } from '../../types/universe';
import { useUniverseStore } from '../../store/universeStore';
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

export const CelestialObject: React.FC<CelestialObjectProps> = ({ memory }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(Math.random() * 100);

  const { selectMemory, hoverMemory, selectedMemoryId, hoveredMemoryId } = useUniverseStore();

  const config = CELESTIAL_CONFIGS[memory.celestialType];
  const shaders = getShaders(memory.celestialType);
  const isSelected = selectedMemoryId === memory.id;
  const isHovered = hoveredMemoryId === memory.id;

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

  useFrame((_, delta) => {
    timeRef.current += delta;
    if (material.uniforms.uTime) {
      material.uniforms.uTime.value = timeRef.current;
    }
    if (meshRef.current) {
      meshRef.current.rotation.y += config.rotationSpeed;
      if (isSelected || isHovered) {
        meshRef.current.scale.setScalar(scale * (1 + 0.1 * Math.sin(timeRef.current * 3)));
      }
    }
  });

  const handleClick = useCallback((e: THREE.Event) => {
    (e as any).stopPropagation?.();
    selectMemory(isSelected ? null : memory.id);
  }, [isSelected, memory.id, selectMemory]);

  const handlePointerOver = useCallback((e: THREE.Event) => {
    (e as any).stopPropagation?.();
    hoverMemory(memory.id);
    document.body.style.cursor = 'pointer';
  }, [memory.id, hoverMemory]);

  const handlePointerOut = useCallback(() => {
    hoverMemory(null);
    document.body.style.cursor = 'auto';
  }, [hoverMemory]);

  const glowScale = scale * 2.2;
  const showLabel = isHovered || isSelected;

  return (
    <group position={memory.position}>
      <Sphere
        ref={meshRef}
        args={[scale, 32, 32]}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <primitive object={material} attach="material" />
      </Sphere>

      <Sphere ref={glowRef} args={[glowScale, 16, 16]}>
        <meshBasicMaterial
          color={emissiveColor}
          transparent
          opacity={isSelected ? 0.12 : isHovered ? 0.09 : 0.04}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </Sphere>

      {isSelected && (
        <Sphere args={[scale * 3.5, 32, 32]}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.05}
            side={THREE.BackSide}
            depthWrite={false}
          />
        </Sphere>
      )}

      {showLabel && (
        <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
          <Text
            position={[0, scale * 2.5, 0]}
            fontSize={0.35}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            maxWidth={6}
          >
            {memory.title || memory.text.substring(0, 40)}
          </Text>
        </Billboard>
      )}
    </group>
  );
};
