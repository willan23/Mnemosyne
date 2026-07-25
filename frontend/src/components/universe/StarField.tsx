import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const STAR_COUNT = 2000;

const createSeededRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

export const StarField: React.FC = () => {
  const pointsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);

  const { positions, sizes, opacities } = useMemo(() => {
    const random = createSeededRandom(2000);
    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const opacities = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const r = 80 + random() * 120;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      sizes[i] = 0.5 + random() * 1.5;
      opacities[i] = 0.3 + random() * 0.7;
    }

    return { positions, sizes, opacities };
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    return geo;
  }, [positions, sizes, opacities]);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: '#ffffff',
        size: 0.15,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    []
  );

  useFrame((_, delta) => {
    timeRef.current += delta * 0.02;
    if (pointsRef.current) {
      pointsRef.current.rotation.y = timeRef.current * 0.1;
      pointsRef.current.rotation.x = Math.sin(timeRef.current * 0.05) * 0.05;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
};
