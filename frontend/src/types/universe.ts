import type { Attachment } from './attachments';
import type {MemoryEditBaseline} from '../../../functions/src/memoryEditContract';
export type MemorySaveSubmission={kind:'create';assertCurrent:()=>void}|{kind:'edit';baseline:MemoryEditBaseline;title:string|null;metadata:Record<string,unknown>;refreshSemantic:boolean;assertCurrent:()=>void};
export type MemorySaveCallback=(memory:MemoryObject,submission?:MemorySaveSubmission)=>Promise<{id:string}|void>|{id:string}|void;
export type MemoryDeleteCallback=(id:string,source?:MemoryObject,assertCurrent?:()=>void)=>Promise<void>|void;

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
  embeddingModel?: string;
  connections: string[];
  semanticClusterId?: string;
  importance: number;
  timestamp: number;
  updatedAt: number;
  /** Revision read from the server, retained while editing to reject stale team writes. */
  persistedUpdatedAt?: number;
  /** Full raw state digest from the authoritative reader; capture must match it before opening an edit. */
  persistedStateDigest?: string;
  /** Exact stored title, before any presentation fallback. */
  persistedTitle?: string|null;
  uid: string;
  /** Campo de partilha lido do Firestore para isolar cálculos pessoais. */
  sharedWithIds?: unknown;
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
  /** Presente nas memórias E2EE de equipa (`sessions.teamId`). */
  teamId?: string;
  /** `teamId` presente mas inválido; não usar em cálculos pessoais. */
  teamScopeAmbiguous?: boolean;
  /** true quando o conteúdo está cifrado mas a chave da sessão não decifra. */
  encLocked?: boolean;
  /** Lane A–E (metadado em claro). */
  taxonomyLane?: import('../utils/taxonomy').TaxonomyLane | null;
  /** Estado de projecto (metadado em claro). */
  projectStatus?: import('../utils/taxonomy').ProjectStatus | null;
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
  /** Filtro HUD A–E (null = todas). */
  taxonomyFilter: import('../utils/taxonomy').TaxonomyLane | null;
  /** Painel estudo aberto para este memory id. */
  studyMemoryId: string | null;
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
  stellar: { bg: '#02040c', ambient: '#0b1630', fog: '#02040c' },
  solar: { bg: '#070402', ambient: '#2a1408', fog: '#050301' },
  quantum: { bg: '#01051a', ambient: '#0a0f40', fog: '#02031a' },
  mythic: { bg: '#090014', ambient: '#2a1038', fog: '#080012' },
  oceanic: { bg: '#000910', ambient: '#032033', fog: '#00080f' },
  crystalline: { bg: '#050508', ambient: '#1a1a22', fog: '#040406' },
  void: { bg: '#000000', ambient: '#0a0612', fog: '#000000' },
  garden: { bg: '#020a04', ambient: '#0a1f0e', fog: '#010700' },
};
