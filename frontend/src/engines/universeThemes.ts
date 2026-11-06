/**
 * Perfis visuais por tipo de universo — o que muda quando o user troca o tema.
 * Não é só um tint: densidade, composição do backdrop e luzes mudam de verdade.
 */

import type { UniverseType } from '../types/universe';

export interface UniverseThemeLights {
  hemisphereSky: string;
  hemisphereGround: string;
  hemisphereIntensity: number;
  ambientIntensity: number;
  directionalColor: string;
  directionalIntensity: number;
  corePointColor: string;
  corePointIntensity: number;
  fillPointColor: string;
  fillPointIntensity: number;
}

export interface UniverseThemeBackdrop {
  /** Intensidade relativa da espiral galáctica (0 = ocultar). */
  spiralWeight: number;
  spiralArms: number;
  spiralRadius: number;
  spiralThickness: number;
  /** Disco eclíptico / plano (sistema solar). */
  planeBias: number;
  planeEccentricity: [number, number, number];
  farStarMul: number;
  planeStarMul: number;
  dustMul: number;
  nebulaCount: number;
  nebulaOpacityMul: number;
  /** Núcleo central: tamanho e cor. */
  coreSize: number;
  coreColor: string;
  coreGlowColor: string;
  coreGlowOpacity: number;
  /** Anel de acreção (void) ou disco solar. */
  showAccretionDisk: boolean;
  accretionColor: string;
  accretionOpacity: number;
  /** Rotação relativa das camadas. */
  spiralTilt: [number, number, number];
  starPalette: [string, string, string, string];
  spiralCoreColor: string;
  spiralArmA: string;
  spiralArmB: string;
}

export interface UniverseTheme {
  id: UniverseType;
  /** Labels curtos para UI (pt). */
  labelPt: string;
  labelEn: string;
  blurbPt: string;
  blurbEn: string;
  bg: string;
  ambient: string;
  fog: string;
  fogDensityMul: number;
  lights: UniverseThemeLights;
  backdrop: UniverseThemeBackdrop;
  /** Cores do chip nas Definições (CSS, sem gradient genérico roxo). */
  preview: {
    sky: string;
    mid: string;
    accent: string;
    glow: string;
  };
}

const THEMES: Record<UniverseType, UniverseTheme> = {
  stellar: {
    id: 'stellar',
    labelPt: 'Galáxia',
    labelEn: 'Galaxy',
    blurbPt: 'Braços espirais, núcleo quente e estrelas azuis profundas.',
    blurbEn: 'Spiral arms, warm core and deep-blue field stars.',
    bg: '#02040c',
    ambient: '#0b1630',
    fog: '#02040c',
    fogDensityMul: 1,
    lights: {
      hemisphereSky: '#b7c8ff',
      hemisphereGround: '#070914',
      hemisphereIntensity: 0.58,
      ambientIntensity: 0.22,
      directionalColor: '#e8f0ff',
      directionalIntensity: 0.48,
      corePointColor: '#fff4d6',
      corePointIntensity: 0.62,
      fillPointColor: '#6f9dff',
      fillPointIntensity: 0.28,
    },
    backdrop: {
      spiralWeight: 1,
      spiralArms: 5,
      spiralRadius: 44,
      spiralThickness: 6.5,
      planeBias: 0.22,
      planeEccentricity: [1.3, 0.85, 1.15],
      farStarMul: 1.05,
      planeStarMul: 0.85,
      dustMul: 1,
      nebulaCount: 4,
      nebulaOpacityMul: 0.9,
      coreSize: 2.6,
      coreColor: '#fff1c4',
      coreGlowColor: '#6d8cff',
      coreGlowOpacity: 0.045,
      showAccretionDisk: false,
      accretionColor: '#8ab4ff',
      accretionOpacity: 0,
      spiralTilt: [0.72, -0.2, 0.16],
      starPalette: ['#e8f1ff', '#9ec5ff', '#ffd7a1', '#d4e7ff'],
      spiralCoreColor: '#fff2c4',
      spiralArmA: '#8ab9ff',
      spiralArmB: '#b88cff',
    },
    preview: {
      sky: '#020617',
      mid: '#1e3a8a',
      accent: '#93c5fd',
      glow: '#fde68a',
    },
  },
  solar: {
    id: 'solar',
    labelPt: 'Sistema Solar',
    labelEn: 'Solar System',
    blurbPt: 'Disco eclíptico quente, poeira âmbar e luz solar frontal.',
    blurbEn: 'Warm ecliptic disk, amber dust and frontal solar light.',
    bg: '#070402',
    ambient: '#2a1408',
    fog: '#050301',
    fogDensityMul: 1.15,
    lights: {
      hemisphereSky: '#ffd9b0',
      hemisphereGround: '#1a0a04',
      hemisphereIntensity: 0.5,
      ambientIntensity: 0.28,
      directionalColor: '#ffe2b8',
      directionalIntensity: 0.72,
      corePointColor: '#ffb347',
      corePointIntensity: 1.05,
      fillPointColor: '#ff7a18',
      fillPointIntensity: 0.35,
    },
    backdrop: {
      spiralWeight: 0.35,
      spiralArms: 2,
      spiralRadius: 28,
      spiralThickness: 3.2,
      planeBias: 0.94,
      planeEccentricity: [1.55, 0.12, 1.35],
      farStarMul: 0.55,
      planeStarMul: 1.45,
      dustMul: 1.35,
      nebulaCount: 2,
      nebulaOpacityMul: 0.55,
      coreSize: 3.4,
      coreColor: '#ffd27a',
      coreGlowColor: '#ff8a1c',
      coreGlowOpacity: 0.07,
      showAccretionDisk: true,
      accretionColor: '#ffb04a',
      accretionOpacity: 0.16,
      spiralTilt: [1.12, 0.05, 0.02],
      starPalette: ['#fff1d6', '#ffd59a', '#ffb347', '#ffe8c2'],
      spiralCoreColor: '#ffe6a8',
      spiralArmA: '#ff9f1c',
      spiralArmB: '#f97316',
    },
    preview: {
      sky: '#1c0f05',
      mid: '#9a3412',
      accent: '#fdba74',
      glow: '#fef3c7',
    },
  },
  quantum: {
    id: 'quantum',
    labelPt: 'Quântico',
    labelEn: 'Quantum',
    blurbPt: 'Campo frio ciano-violeta, estrelas pontuais e névoa eléctrica.',
    blurbEn: 'Cold cyan-violet field, pinpoint stars and electric haze.',
    bg: '#01051a',
    ambient: '#0a0f40',
    fog: '#02031a',
    fogDensityMul: 0.9,
    lights: {
      hemisphereSky: '#a5f3fc',
      hemisphereGround: '#05051a',
      hemisphereIntensity: 0.55,
      ambientIntensity: 0.24,
      directionalColor: '#c4b5fd',
      directionalIntensity: 0.5,
      corePointColor: '#67e8f9',
      corePointIntensity: 0.7,
      fillPointColor: '#818cf8',
      fillPointIntensity: 0.4,
    },
    backdrop: {
      spiralWeight: 0.7,
      spiralArms: 6,
      spiralRadius: 40,
      spiralThickness: 9,
      planeBias: 0.15,
      planeEccentricity: [1.2, 1.05, 1.2],
      farStarMul: 1.2,
      planeStarMul: 0.6,
      dustMul: 0.85,
      nebulaCount: 5,
      nebulaOpacityMul: 1.1,
      coreSize: 2.2,
      coreColor: '#e0f2fe',
      coreGlowColor: '#22d3ee',
      coreGlowOpacity: 0.055,
      showAccretionDisk: false,
      accretionColor: '#22d3ee',
      accretionOpacity: 0,
      spiralTilt: [0.55, 0.4, -0.25],
      starPalette: ['#ecfeff', '#a5f3fc', '#c4b5fd', '#e0e7ff'],
      spiralCoreColor: '#e0f2fe',
      spiralArmA: '#22d3ee',
      spiralArmB: '#818cf8',
    },
    preview: {
      sky: '#020617',
      mid: '#1e1b4b',
      accent: '#67e8f9',
      glow: '#c4b5fd',
    },
  },
  mythic: {
    id: 'mythic',
    labelPt: 'Nebulosa',
    labelEn: 'Nebula',
    blurbPt: 'Nuvens densas magenta-âmbar; a espiral fica secundária.',
    blurbEn: 'Dense magenta-amber clouds; the spiral stays secondary.',
    bg: '#090014',
    ambient: '#2a1038',
    fog: '#080012',
    fogDensityMul: 1.25,
    lights: {
      hemisphereSky: '#fbcfe8',
      hemisphereGround: '#140018',
      hemisphereIntensity: 0.52,
      ambientIntensity: 0.3,
      directionalColor: '#f9a8d4',
      directionalIntensity: 0.45,
      corePointColor: '#fb7185',
      corePointIntensity: 0.75,
      fillPointColor: '#c084fc',
      fillPointIntensity: 0.42,
    },
    backdrop: {
      spiralWeight: 0.45,
      spiralArms: 4,
      spiralRadius: 36,
      spiralThickness: 10,
      planeBias: 0.3,
      planeEccentricity: [1.25, 0.7, 1.2],
      farStarMul: 0.75,
      planeStarMul: 0.7,
      dustMul: 1.2,
      nebulaCount: 7,
      nebulaOpacityMul: 1.55,
      coreSize: 2.8,
      coreColor: '#ffe4e6',
      coreGlowColor: '#db2777',
      coreGlowOpacity: 0.06,
      showAccretionDisk: false,
      accretionColor: '#f472b6',
      accretionOpacity: 0,
      spiralTilt: [0.85, -0.35, 0.28],
      starPalette: ['#ffe4e6', '#fbcfe8', '#fde68a', '#e9d5ff'],
      spiralCoreColor: '#fff1f2',
      spiralArmA: '#f472b6',
      spiralArmB: '#c084fc',
    },
    preview: {
      sky: '#1a0518',
      mid: '#9d174d',
      accent: '#f9a8d4',
      glow: '#fde68a',
    },
  },
  oceanic: {
    id: 'oceanic',
    labelPt: 'Oceânico',
    labelEn: 'Oceanic',
    blurbPt: 'Abismo azul-teal, horizonte plano e brilho subaquático.',
    blurbEn: 'Teal abyss, flat horizon and underwater glow.',
    bg: '#000910',
    ambient: '#032033',
    fog: '#00080f',
    fogDensityMul: 1.2,
    lights: {
      hemisphereSky: '#7dd3fc',
      hemisphereGround: '#021018',
      hemisphereIntensity: 0.5,
      ambientIntensity: 0.26,
      directionalColor: '#bae6fd',
      directionalIntensity: 0.42,
      corePointColor: '#38bdf8',
      corePointIntensity: 0.55,
      fillPointColor: '#2dd4bf',
      fillPointIntensity: 0.33,
    },
    backdrop: {
      spiralWeight: 0.4,
      spiralArms: 3,
      spiralRadius: 38,
      spiralThickness: 5,
      planeBias: 0.88,
      planeEccentricity: [1.5, 0.18, 1.4],
      farStarMul: 0.7,
      planeStarMul: 1.2,
      dustMul: 0.9,
      nebulaCount: 4,
      nebulaOpacityMul: 1.05,
      coreSize: 2.3,
      coreColor: '#e0f2fe',
      coreGlowColor: '#0ea5e9',
      coreGlowOpacity: 0.05,
      showAccretionDisk: true,
      accretionColor: '#2dd4bf',
      accretionOpacity: 0.1,
      spiralTilt: [1.05, 0.1, 0],
      starPalette: ['#e0f2fe', '#7dd3fc', '#99f6e4', '#bae6fd'],
      spiralCoreColor: '#ecfeff',
      spiralArmA: '#38bdf8',
      spiralArmB: '#14b8a6',
    },
    preview: {
      sky: '#02131f',
      mid: '#0e7490',
      accent: '#67e8f9',
      glow: '#99f6e4',
    },
  },
  crystalline: {
    id: 'crystalline',
    labelPt: 'Cristalino',
    labelEn: 'Crystalline',
    blurbPt: 'Campo alto-contraste, estrelas frias e reflexos gelados.',
    blurbEn: 'High-contrast field, cold stars and icy reflections.',
    bg: '#050508',
    ambient: '#1a1a22',
    fog: '#040406',
    fogDensityMul: 0.85,
    lights: {
      hemisphereSky: '#f1f5f9',
      hemisphereGround: '#0a0a0f',
      hemisphereIntensity: 0.62,
      ambientIntensity: 0.2,
      directionalColor: '#e2e8f0',
      directionalIntensity: 0.55,
      corePointColor: '#f8fafc',
      corePointIntensity: 0.5,
      fillPointColor: '#a78bfa',
      fillPointIntensity: 0.25,
    },
    backdrop: {
      spiralWeight: 0.55,
      spiralArms: 4,
      spiralRadius: 34,
      spiralThickness: 4,
      planeBias: 0.25,
      planeEccentricity: [1.15, 0.95, 1.15],
      farStarMul: 1.35,
      planeStarMul: 0.65,
      dustMul: 0.55,
      nebulaCount: 2,
      nebulaOpacityMul: 0.45,
      coreSize: 1.9,
      coreColor: '#f8fafc',
      coreGlowColor: '#cbd5e1',
      coreGlowOpacity: 0.04,
      showAccretionDisk: false,
      accretionColor: '#e2e8f0',
      accretionOpacity: 0,
      spiralTilt: [0.4, 0.15, 0.55],
      starPalette: ['#f8fafc', '#e2e8f0', '#c4b5fd', '#bbf7d0'],
      spiralCoreColor: '#ffffff',
      spiralArmA: '#cbd5e1',
      spiralArmB: '#a78bfa',
    },
    preview: {
      sky: '#0a0a0f',
      mid: '#334155',
      accent: '#e2e8f0',
      glow: '#a78bfa',
    },
  },
  void: {
    id: 'void',
    labelPt: 'Buraco Negro',
    labelEn: 'Black Hole',
    blurbPt: 'Campo quase vazio, disco de acreção e horizonte escuro.',
    blurbEn: 'Near-empty field, accretion disk and dark horizon.',
    bg: '#000000',
    ambient: '#0a0612',
    fog: '#000000',
    fogDensityMul: 1.35,
    lights: {
      hemisphereSky: '#4c1d95',
      hemisphereGround: '#000000',
      hemisphereIntensity: 0.28,
      ambientIntensity: 0.12,
      directionalColor: '#c4b5fd',
      directionalIntensity: 0.28,
      corePointColor: '#7c3aed',
      corePointIntensity: 0.35,
      fillPointColor: '#2563eb',
      fillPointIntensity: 0.22,
    },
    backdrop: {
      spiralWeight: 0.55,
      spiralArms: 3,
      spiralRadius: 30,
      spiralThickness: 2.4,
      planeBias: 0.7,
      planeEccentricity: [1.4, 0.15, 1.35],
      farStarMul: 0.4,
      planeStarMul: 0.55,
      dustMul: 0.45,
      nebulaCount: 2,
      nebulaOpacityMul: 0.5,
      coreSize: 1.4,
      coreColor: '#0a0014',
      coreGlowColor: '#4c1d95',
      coreGlowOpacity: 0.08,
      showAccretionDisk: true,
      accretionColor: '#a78bfa',
      accretionOpacity: 0.22,
      spiralTilt: [1.15, 0.08, 0.05],
      starPalette: ['#ddd6fe', '#93c5fd', '#c4b5fd', '#64748b'],
      spiralCoreColor: '#1e1b4b',
      spiralArmA: '#6366f1',
      spiralArmB: '#7c3aed',
    },
    preview: {
      sky: '#000000',
      mid: '#1e1b4b',
      accent: '#8b5cf6',
      glow: '#c4b5fd',
    },
  },
  garden: {
    id: 'garden',
    labelPt: 'Jardim',
    labelEn: 'Garden',
    blurbPt: 'Verde-bioluminescente, poeira viva e núcleo suave.',
    blurbEn: 'Bioluminescent green, living dust and soft core.',
    bg: '#020a04',
    ambient: '#0a1f0e',
    fog: '#010700',
    fogDensityMul: 1.1,
    lights: {
      hemisphereSky: '#bbf7d0',
      hemisphereGround: '#03140a',
      hemisphereIntensity: 0.5,
      ambientIntensity: 0.26,
      directionalColor: '#d9f99d',
      directionalIntensity: 0.45,
      corePointColor: '#86efac',
      corePointIntensity: 0.55,
      fillPointColor: '#22d3ee',
      fillPointIntensity: 0.28,
    },
    backdrop: {
      spiralWeight: 0.5,
      spiralArms: 4,
      spiralRadius: 36,
      spiralThickness: 7,
      planeBias: 0.4,
      planeEccentricity: [1.25, 0.6, 1.2],
      farStarMul: 0.8,
      planeStarMul: 0.9,
      dustMul: 1.1,
      nebulaCount: 4,
      nebulaOpacityMul: 1,
      coreSize: 2.5,
      coreColor: '#ecfccb',
      coreGlowColor: '#22c55e',
      coreGlowOpacity: 0.05,
      showAccretionDisk: false,
      accretionColor: '#4ade80',
      accretionOpacity: 0,
      spiralTilt: [0.65, -0.15, 0.2],
      starPalette: ['#ecfccb', '#bbf7d0', '#86efac', '#a5f3fc'],
      spiralCoreColor: '#f7fee7',
      spiralArmA: '#4ade80',
      spiralArmB: '#22d3ee',
    },
    preview: {
      sky: '#052e16',
      mid: '#166534',
      accent: '#86efac',
      glow: '#d9f99d',
    },
  },
};

/** Tipos oferecidos no picker das Definições (os mais distintos). */
export const SETTINGS_UNIVERSE_TYPES: UniverseType[] = [
  'stellar',
  'solar',
  'mythic',
  'void',
  'quantum',
  'oceanic',
];

export function getUniverseTheme(type: UniverseType): UniverseTheme {
  return THEMES[type] ?? THEMES.stellar;
}

export function listUniverseThemes(ids: UniverseType[] = SETTINGS_UNIVERSE_TYPES): UniverseTheme[] {
  return ids.map((id) => getUniverseTheme(id));
}
