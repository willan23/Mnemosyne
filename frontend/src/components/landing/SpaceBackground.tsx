import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const createSeededRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const Stars: React.FC = () => {
  const ref = useRef<THREE.Points>(null);

  const { positions, sizes } = useMemo(() => {
    const random = createSeededRandom(1411);
    const count = 1400;
    const pos = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (random() - 0.5) * 120;
      pos[i * 3 + 1] = (random() - 0.5) * 80;
      pos[i * 3 + 2] = (random() - 0.5) * 60;
      sz[i] = random() * 0.8 + 0.1;
    }
    return { positions: pos, sizes: sz };
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.018;
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.008) * 0.04;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.18}
        color="#aabbff"
        transparent
        opacity={0.75}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
};

const Connections: React.FC = () => {
  const ref = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const random = createSeededRandom(4041);
    const nodeCount = 40;
    const nodes = Array.from({ length: nodeCount }, () => new THREE.Vector3(
      (random() - 0.5) * 70,
      (random() - 0.5) * 50,
      (random() - 0.5) * 25,
    ));

    const pts: number[] = [];
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        if (nodes[i].distanceTo(nodes[j]) < 18) {
          pts.push(nodes[i].x, nodes[i].y, nodes[i].z);
          pts.push(nodes[j].x, nodes[j].y, nodes[j].z);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    return geo;
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.012;
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color="#3355aa" transparent opacity={0.12} depthWrite={false} />
    </lineSegments>
  );
};

export const SpaceBackground: React.FC = () => (
  <div
    className="fixed inset-0 z-0"
    style={{ backgroundColor: '#04040f' }}
    aria-hidden="true"
  >
    <Canvas
      camera={{ position: [0, 0, 35], fov: 70 }}
      gl={{ antialias: false, alpha: false }}
      dpr={[1, 1.5]}
      style={{ background: '#04040f' }}
      onCreated={() => undefined}
    >
      <Stars />
      <Connections />
    </Canvas>
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div
        className="absolute rounded-full blur-[130px]"
        style={{ top: '8%', left: '12%', width: '45vw', height: '45vw', background: 'rgba(99,102,241,0.12)' }}
      />
      <div
        className="absolute rounded-full blur-[110px]"
        style={{ bottom: '12%', right: '8%', width: '38vw', height: '38vw', background: 'rgba(168,85,247,0.09)' }}
      />
      <div
        className="absolute rounded-full blur-[90px]"
        style={{ top: '45%', right: '28%', width: '22vw', height: '22vw', background: 'rgba(59,130,246,0.07)' }}
      />
    </div>
  </div>
);
