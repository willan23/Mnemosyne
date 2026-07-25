import type { Attachment } from './attachments';

export type CelestialType =
  | 'star'
  | 'sun'
  | 'planet'
  | 'moon'
  | 'comet'
  | 'black_hole'
  | 'nebula';

export type UniverseType =
  | 'stellar'
  | 'solar'
  | 'quantum'
  | 'mythic'
  | 'oceanic'
  | 'crystalline'
  | 'void'
  | 'garden';

export type DeletionType =
  | 'supernova'
  | 'collapse'
  | 'dissipation'
  | 'fragmentation'
  | 'explosion';

export interface AuditTrailEntry {
  timestamp: number;
  agentId: string;
  action: string;
  signature: string;
  hash: string;
  details?: string;
}

export interface MemoryObject {
  id: string;
  text: string;
  title?: string;
  celestialType: CelestialType;
  position: [number, number, number];
  embedding: number[];
  connections: string[];
  semanticClusterId?: string;
  importance: number;
  timestamp: number;
  updatedAt: number;
  uid: string;
  tags?: string[];
  category?: string;
  attachments?: Attachment[];
  generatedImagePrompt?: string;
  generatedImageProvider?: string;
  generatedImageModel?: string;
  color?: string;
  scale?: number;
  orbitRadius?: number;
  orbitSpeed?: number;
  parentId?: string;
  auditTrail?: AuditTrailEntry[];
  entities?: {
    people?: string[];
    places?: string[];
    events?: string[];
    concepts?: string[];
  };
  processingMethod?: string | null;
}

export interface UniverseState {
  universeType: UniverseType;
  memories: MemoryObject[];
  selectedMemoryId: string | null;
  hoveredMemoryId: string | null;
  isAddingMemory: boolean;
  isLoading: boolean;
  embeddingReady: boolean;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  searchQuery: string;
  filteredIds: string[] | null;
  deletingMemoryId: string | null;
  deletionType: DeletionType | null;
  isGalaxyView: boolean;
  language: 'pt-pt' | 'pt-br' | 'en' | 'fr';
  /** ID da última memória spawnada (flash visual ~2.5s) */
  spawnedMemoryId: string | null;
  spawnedAt: number;
}

export interface GraphNode {
  id: string;
  memoryId: string;
  label: string;
  weight: number;
  cluster?: number;
  pageRank?: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  similarity: number;
}

export interface CognitiveGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: Map<number, string[]>;
}

export interface CelestialConfig {
  type: CelestialType;
  color: string;
  emissiveColor: string;
  baseScale: number;
  glowIntensity: number;
  rotationSpeed: number;
  particleCount?: number;
  hasRings?: boolean;
  hasTail?: boolean;
}

export const CELESTIAL_CONFIGS: Record<CelestialType, CelestialConfig> = {
  star: {
    type: 'star',
    color: '#ffffff',
    emissiveColor: '#aaccff',
    baseScale: 0.4,
    glowIntensity: 1.2,
    rotationSpeed: 0.002,
  },
  sun: {
    type: 'sun',
    color: '#ffdd44',
    emissiveColor: '#ff8800',
    baseScale: 1.4,
    glowIntensity: 2.5,
    rotationSpeed: 0.001,
    particleCount: 200,
  },
  planet: {
    type: 'planet',
    color: '#4488ff',
    emissiveColor: '#2244aa',
    baseScale: 0.8,
    glowIntensity: 0.5,
    rotationSpeed: 0.003,
    hasRings: false,
  },
  moon: {
    type: 'moon',
    color: '#aaaaaa',
    emissiveColor: '#555566',
    baseScale: 0.3,
    glowIntensity: 0.2,
    rotationSpeed: 0.005,
  },
  comet: {
    type: 'comet',
    color: '#aaddff',
    emissiveColor: '#44aaff',
    baseScale: 0.25,
    glowIntensity: 1.0,
    rotationSpeed: 0.01,
    hasTail: true,
  },
  black_hole: {
    type: 'black_hole',
    color: '#110022',
    emissiveColor: '#6600aa',
    baseScale: 1.2,
    glowIntensity: 3.0,
    rotationSpeed: 0.008,
    particleCount: 300,
  },
  nebula: {
    type: 'nebula',
    color: '#ff44aa',
    emissiveColor: '#aa22ff',
    baseScale: 2.0,
    glowIntensity: 0.8,
    rotationSpeed: 0.0005,
    particleCount: 500,
  },
};

export const UNIVERSE_COLORS: Record<UniverseType, { bg: string; ambient: string; fog: string }> = {
  stellar: { bg: '#000510', ambient: '#0a1a3a', fog: '#000510' },
  solar: { bg: '#090604', ambient: '#2a1505', fog: '#050302' },
  quantum: { bg: '#000820', ambient: '#0a0a40', fog: '#050010' },
  mythic: { bg: '#0a0010', ambient: '#200030', fog: '#0a0010' },
  oceanic: { bg: '#000a15', ambient: '#001530', fog: '#000a15' },
  crystalline: { bg: '#080808', ambient: '#202020', fog: '#050505' },
  void: { bg: '#000000', ambient: '#050505', fog: '#000000' },
  garden: { bg: '#000a00', ambient: '#0a1a0a', fog: '#000500' },
};
