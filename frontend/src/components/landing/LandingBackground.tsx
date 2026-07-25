import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const createSeededRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

/* ─── Mouse parallax hook ─────────────────────────────────── */
function useMouseParallax() {
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      setMouse({
        x: (e.clientX / window.innerWidth  - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2,
      });
    };
    window.addEventListener('mousemove', handler, { passive: true });
    return () => window.removeEventListener('mousemove', handler);
  }, []);
  return mouse;
}

/* ─── Camera parallax ─────────────────────────────────────── */
const CameraRig: React.FC<{ mouse: { x: number; y: number } }> = ({ mouse }) => {
  const { camera } = useThree();
  const targetRef = useRef({ x: 0, y: 0 });

  useFrame(() => {
    targetRef.current.x += (mouse.x * 1.5 - targetRef.current.x) * 0.05;
    targetRef.current.y += (-mouse.y * 1.0 - targetRef.current.y) * 0.05;
    camera.position.x = targetRef.current.x;
    camera.position.y = targetRef.current.y;
    camera.lookAt(0, 0, 0);
  });
  return null;
};

/* ─── Layered stars ───────────────────────────────────────── */
interface StarLayerProps {
  count: number;
  spread: [number, number, number];
  size: number;
  color: string;
  opacity: number;
  speed: number;
}
const StarLayer: React.FC<StarLayerProps> = ({ count, spread, size, color, opacity, speed }) => {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const random = createSeededRandom(count + Math.round(spread[0] * 100) + Math.round(size * 1000));
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (random() - 0.5) * spread[0];
      pos[i * 3 + 1] = (random() - 0.5) * spread[1];
      pos[i * 3 + 2] = (random() - 0.5) * spread[2];
    }
    return pos;
  }, [count, spread]);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * speed;
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * speed * 0.4) * 0.06;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        color={color}
        transparent
        opacity={opacity}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};

/* ─── Nebula nodes (glowing larger stars) ─────────────────── */
const NebulaNodes: React.FC = () => {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors } = useMemo(() => {
    const random = createSeededRandom(3507);
    const count = 35; // Increased nodes
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const palette = [
      new THREE.Color('#8b5cf6'),
      new THREE.Color('#22d3ee'),
      new THREE.Color('#f472b6'),
      new THREE.Color('#c4b5fd'),
    ];
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (random() - 0.5) * 80;
      pos[i * 3 + 1] = (random() - 0.5) * 55;
      pos[i * 3 + 2] = (random() - 0.5) * 30;
      const c = palette[Math.floor(random() * palette.length)];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    return { positions: pos, colors: col };
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.015;
    const mat = ref.current.material as THREE.PointsMaterial;
    mat.opacity = 0.7 + Math.sin(state.clock.elapsedTime * 1.5) * 0.3;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color"    args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.6}
        vertexColors
        transparent
        opacity={0.8}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};

/* ─── Connections ─────────────────────────────────────────── */
const Connections: React.FC = () => {
  const ref = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const random = createSeededRandom(6518);
    const nodeCount = 65; // increased density
    const nodes = Array.from({ length: nodeCount }, () =>
      new THREE.Vector3(
        (random() - 0.5) * 80,
        (random() - 0.5) * 55,
        (random() - 0.5) * 28,
      )
    );
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
    ref.current.rotation.y = state.clock.elapsedTime * 0.015;
    const mat = ref.current.material as THREE.LineBasicMaterial;
    mat.opacity = 0.2 + Math.sin(state.clock.elapsedTime * 0.8) * 0.1;
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color="#8b5cf6" transparent opacity={0.25} depthWrite={false} blending={THREE.AdditiveBlending} />
    </lineSegments>
  );
};

/* ─── Scene ───────────────────────────────────────────────── */
const Scene: React.FC<{ mouse: { x: number; y: number } }> = ({ mouse }) => (
  <>
    <CameraRig mouse={mouse} />
    {/* Far dim stars */}
    <StarLayer count={1200} spread={[140,95,70]} size={0.05} color="#64748b" opacity={0.5} speed={0.005} />
    {/* Mid stars */}
    <StarLayer count={900}  spread={[120,80,55]} size={0.10} color="#8b5cf6" opacity={0.65} speed={0.010} />
    {/* Bright near stars */}
    <StarLayer count={400}  spread={[90, 60, 35]} size={0.18} color="#22d3ee" opacity={0.80} speed={0.015} />
    {/* Nebula nodes */}
    <NebulaNodes />
    {/* Connections */}
    <Connections />
  </>
);

/* ─── CSS nebulae overlay ─────────────────────────────────── */
const CSSNebulae: React.FC = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    {/* Top-left violet */}
    <div
      className="absolute rounded-full animate-nebula-drift"
      style={{
        top: '10%', left: '10%',
        width: '45vw', height: '45vw',
        background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 60%)',
        filter: 'blur(90px)',
        animationDuration: '24s',
      }}
    />
    {/* Bottom-right cyan */}
    <div
      className="absolute rounded-full animate-nebula-drift"
      style={{
        bottom: '5%', right: '5%',
        width: '50vw', height: '50vw',
        background: 'radial-gradient(circle, rgba(34,211,238,0.12) 0%, transparent 60%)',
        filter: 'blur(100px)',
        animationDuration: '30s',
        animationDelay: '-10s',
      }}
    />
    {/* Centre pink accent */}
    <div
      className="absolute rounded-full animate-nebula-pulse"
      style={{
        top: '40%', left: '45%',
        width: '30vw', height: '30vw',
        background: 'radial-gradient(circle, rgba(244,114,182,0.10) 0%, transparent 65%)',
        filter: 'blur(80px)',
        animationDuration: '10s',
      }}
    />
  </div>
);

/* ─── Export ──────────────────────────────────────────────── */
export const LandingBackground: React.FC = () => {
  const mouse = useMouseParallax();

  return (
    <div className="fixed inset-0 z-0 bg-transparent" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 38], fov: 68 }}
        gl={{ antialias: false, alpha: true }}
        dpr={[1, 1.5]}
        style={{ background: 'transparent' }}
      >
        <Scene mouse={mouse} />
      </Canvas>
      <CSSNebulae />
    </div>
  );
};
