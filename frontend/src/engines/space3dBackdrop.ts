import * as THREE from 'three';
import type { UniverseType } from '../types/universe';

export interface PointCloudData {
  positions: Float32Array;
  colors: Float32Array;
}

export interface StarShellOptions {
  count: number;
  radiusMin: number;
  radiusMax: number;
  seed: number | string;
  eccentricity?: [number, number, number];
  planeBias?: number;
  palette?: string[];
}

export interface SpiralGalaxyOptions {
  count: number;
  arms: number;
  radius: number;
  thickness: number;
  seed: number | string;
  coreColor?: string;
  armColorA?: string;
  armColorB?: string;
}

export interface RingBand {
  innerRadius: number;
  outerRadius: number;
  color: string;
  opacity: number;
  tilt: number;
}

export interface NebulaCloud {
  id: string;
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  opacity: number;
  rotation: [number, number, number];
}

const UNIVERSE_NEBULA_PALETTES: Record<UniverseType, string[]> = {
  stellar: ['#233f8f', '#6947d9', '#35b8ff'],
  solar: ['#ff9f1c', '#f97316', '#ffd166'],
  quantum: ['#1756ff', '#7d4dff', '#1bd6d0'],
  mythic: ['#8d2fff', '#ff4aa2', '#ffd166'],
  oceanic: ['#0ea5e9', '#0f766e', '#7dd3fc'],
  crystalline: ['#d7f9ff', '#86efac', '#a78bfa'],
  void: ['#191b30', '#4c1d95', '#2563eb'],
  garden: ['#16a34a', '#84cc16', '#22d3ee'],
};

export function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0;

  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: number | string): () => number {
  let state = hashSeed(seed);

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createStarShell({
  count,
  radiusMin,
  radiusMax,
  seed,
  eccentricity = [1, 1, 1],
  planeBias = 0,
  palette: paletteHex,
}: StarShellOptions): PointCloudData {
  const random = createSeededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = (paletteHex && paletteHex.length > 0
    ? paletteHex
    : ['#e8f1ff', '#a8c7ff', '#ffd7a1', '#c9fff3']
  ).map((hex) => new THREE.Color(hex));

  for (let index = 0; index < count; index += 1) {
    const theta = random() * Math.PI * 2;
    const spherePhi = Math.acos(2 * random() - 1);
    const planePhi = Math.PI / 2 + (random() - 0.5) * 0.42;
    const phi = random() < planeBias ? planePhi : spherePhi;
    const radius = THREE.MathUtils.lerp(radiusMin, radiusMax, Math.pow(random(), 0.35));

    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta) * eccentricity[0];
    positions[index * 3 + 1] = radius * Math.cos(phi) * eccentricity[1];
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) * eccentricity[2];

    const tint = palette[Math.floor(random() * palette.length)].clone();
    const intensity = THREE.MathUtils.lerp(0.45, 1.4, Math.pow(random(), 2));
    tint.multiplyScalar(intensity);
    colors[index * 3] = tint.r;
    colors[index * 3 + 1] = tint.g;
    colors[index * 3 + 2] = tint.b;
  }

  return { positions, colors };
}

export function createSpiralGalaxy({
  count,
  arms,
  radius,
  thickness,
  seed,
  coreColor = '#fff2c4',
  armColorA = '#8ab9ff',
  armColorB = '#b88cff',
}: SpiralGalaxyOptions): PointCloudData {
  const random = createSeededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const core = new THREE.Color(coreColor);
  const armBlue = new THREE.Color(armColorA);
  const armViolet = new THREE.Color(armColorB);

  for (let index = 0; index < count; index += 1) {
    const arm = Math.floor(random() * arms);
    const radial = Math.pow(random(), 1.7) * radius;
    const normalizedRadius = radial / radius;
    const armAngle = (arm / arms) * Math.PI * 2;
    const swirl = normalizedRadius * 4.8;
    const scatter = (random() - 0.5) * (0.9 - normalizedRadius * 0.55);
    const angle = armAngle + swirl + scatter;
    const fuzz = 1 + (random() - 0.5) * 0.18;

    positions[index * 3] = Math.cos(angle) * radial * fuzz;
    positions[index * 3 + 1] = (random() - 0.5) * thickness * (1.15 - normalizedRadius);
    positions[index * 3 + 2] = Math.sin(angle) * radial * fuzz;

    const color = core.clone()
      .lerp(random() > 0.45 ? armBlue : armViolet, Math.min(1, normalizedRadius * 1.25))
      .multiplyScalar(THREE.MathUtils.lerp(0.45, 1.35, random()));
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  return { positions, colors };
}

export function createNebulaClouds(universeType: UniverseType, seed: number | string, count: number, opacityMul = 1): NebulaCloud[] {
  const random = createSeededRandom(`${seed}:${universeType}:nebula`);
  const palette = UNIVERSE_NEBULA_PALETTES[universeType];

  return Array.from({ length: count }, (_, index) => {
    const theta = random() * Math.PI * 2;
    const radius = THREE.MathUtils.lerp(55, 105, random());
    const y = THREE.MathUtils.lerp(-32, 36, random());
    const color = palette[Math.floor(random() * palette.length)];

    return {
      id: `${universeType}-nebula-${index}`,
      position: [
        Math.cos(theta) * radius,
        y,
        Math.sin(theta) * radius,
      ],
      scale: [
        THREE.MathUtils.lerp(18, 36, random()),
        THREE.MathUtils.lerp(9, 24, random()),
        THREE.MathUtils.lerp(18, 42, random()),
      ],
      color,
      opacity: THREE.MathUtils.lerp(0.025, 0.065, random()) * opacityMul,
      rotation: [
        random() * Math.PI,
        random() * Math.PI,
        random() * Math.PI,
      ],
    };
  });
}

/** Poeira cósmica próxima — dá profundidade e parallax ao observador. */
export function createCosmicDust(count: number, seed: number | string, radius = 48): PointCloudData {
  const random = createSeededRandom(`${seed}:dust`);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const warm = new THREE.Color('#ffd9a8');
  const cool = new THREE.Color('#9ec5ff');
  const violet = new THREE.Color('#c4b5fd');

  for (let index = 0; index < count; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const r = radius * Math.pow(random(), 0.55);
    positions[index * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = r * Math.cos(phi) * 0.55;
    positions[index * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const tint = random() > 0.66 ? warm : random() > 0.4 ? cool : violet;
    const intensity = THREE.MathUtils.lerp(0.25, 0.95, random());
    colors[index * 3] = tint.r * intensity;
    colors[index * 3 + 1] = tint.g * intensity;
    colors[index * 3 + 2] = tint.b * intensity;
  }

  return { positions, colors };
}

/** Núcleo galáctico denso — brilho central do universo. */
export function createGalacticCore(count: number, seed: number | string): PointCloudData {
  const random = createSeededRandom(`${seed}:core`);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const core = new THREE.Color('#fff6d8');
  const rim = new THREE.Color('#ffb347');

  for (let index = 0; index < count; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const r = Math.pow(random(), 2.4) * 9.5;
    positions[index * 3] = r * Math.sin(phi) * Math.cos(theta) * 1.1;
    positions[index * 3 + 1] = r * Math.cos(phi) * 0.35;
    positions[index * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) * 1.1;

    const tint = core.clone().lerp(rim, Math.min(1, r / 9));
    const intensity = THREE.MathUtils.lerp(0.7, 1.8, 1 - r / 10);
    colors[index * 3] = tint.r * intensity;
    colors[index * 3 + 1] = tint.g * intensity;
    colors[index * 3 + 2] = tint.b * intensity;
  }

  return { positions, colors };
}

export function createRingBands(seed: number | string, baseRadius: number, baseColor: THREE.Color, emphasis = 1): RingBand[] {
  const random = createSeededRandom(`${seed}:rings`);
  const bandCount = 5 + Math.floor(random() * 5);
  const outerEdge = baseRadius * THREE.MathUtils.lerp(2.2, 3.15, random()) * emphasis;
  const innerEdge = baseRadius * THREE.MathUtils.lerp(1.35, 1.72, random());
  const width = outerEdge - innerEdge;

  return Array.from({ length: bandCount }, (_, index) => {
    const start = index / bandCount;
    const bandWidth = width / bandCount;
    const jitter = (random() - 0.5) * bandWidth * 0.34;
    const innerRadius = innerEdge + start * width + jitter;
    const outerRadius = Math.min(outerEdge, innerRadius + bandWidth * THREE.MathUtils.lerp(0.34, 0.82, random()));
    const color = baseColor.clone()
      .lerp(new THREE.Color(random() > 0.5 ? '#ffffff' : '#8fb8ff'), THREE.MathUtils.lerp(0.12, 0.38, random()))
      .multiplyScalar(THREE.MathUtils.lerp(0.8, 1.45, random()));

    return {
      innerRadius: Math.max(innerEdge, innerRadius),
      outerRadius: Math.max(innerRadius + baseRadius * 0.025, outerRadius),
      color: `#${color.getHexString()}`,
      opacity: THREE.MathUtils.lerp(0.06, 0.18, random()) * emphasis,
      tilt: THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-12, 12, random())),
    };
  });
}
