# MNEMOSYNE: ARQUITETURA TÉCNICA DETALHADA

## ÍNDICE

1. [Visão Geral da Arquitetura](#visão-geral)
2. [Stack Tecnológica](#stack-tecnológica)
3. [Cognitive Engine](#cognitive-engine)
4. [Graph Engine](#graph-engine)
5. [Spatial Navigation Engine](#spatial-navigation-engine)
6. [Visual Rendering Engine](#visual-rendering-engine)
7. [Data Layer](#data-layer)
8. [Integration Layer](#integration-layer)
9. [Performance & Optimization](#performance)
10. [Security & Privacy](#security)

---

## VISÃO GERAL DA ARQUITETURA

### Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                     MNEMOSYNE UNIVERSE                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────────────────────────────────────────┐   │
│  │              USER INTERFACE LAYER                   │   │
│  │  - Spatial Canvas                                   │   │
│  │  - Memory Reveal Panel                              │   │
│  │  - Command Palette                                  │   │
│  │  - Notification System                              │   │
│  └────────────────────────────────────────────────────┘   │
│                          ↕                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │           VISUAL RENDERING ENGINE                   │   │
│  │  - Three.js Scene Manager                           │   │
│  │  - Celestial Object Renderer                        │   │
│  │  - Shader System                                    │   │
│  │  - Particle System                                  │   │
│  │  - Animation Controller                             │   │
│  └────────────────────────────────────────────────────┘   │
│                          ↕                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │        SPATIAL NAVIGATION ENGINE                    │   │
│  │  - Camera Controller                                │   │
│  │  - Physics Simulator                                │   │
│  │  - Collision Detection                              │   │
│  │  - Semantic Gravity                                 │   │
│  │  - Path Finding                                     │   │
│  └────────────────────────────────────────────────────┘   │
│                          ↕                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │              GRAPH ENGINE                           │   │
│  │  - d3-celestial Integration                         │   │
│  │  - Graph Algorithms                                 │   │
│  │  - Clustering & Communities                         │   │
│  │  - Spatial Layout                                   │   │
│  │  - Relationship Manager                             │   │
│  └────────────────────────────────────────────────────┘   │
│                          ↕                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │            COGNITIVE ENGINE                         │   │
│  │  - NLP Processor                                    │   │
│  │  - Embedding Generator                              │   │
│  │  - Pattern Detector                                 │   │
│  │  - Contradiction Analyzer                           │   │
│  │  - Suggestion Engine                                │   │
│  └────────────────────────────────────────────────────┘   │
│                          ↕                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │               DATA LAYER                            │   │
│  │  - Vector Database (Qdrant)                         │   │
│  │  - Graph Database (Neo4j)                           │   │
│  │  - Local Storage (IndexedDB)                        │   │
│  │  - E2E Encryption                                   │   │
│  └────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## STACK TECNOLÓGICA

### Frontend

```json
{
  "core": {
    "framework": "React 18 + TypeScript",
    "build": "Vite",
    "state": "Zustand + Immer"
  },
  "visualization": {
    "3d": "Three.js + React Three Fiber",
    "2d": "d3-celestial (customizado)",
    "canvas": "OffscreenCanvas + Web Workers"
  },
  "ai": {
    "runtime": "ONNX Runtime Web",
    "models": "Transformers.js",
    "embeddings": "all-MiniLM-L6-v2 (local)"
  },
  "data": {
    "vector": "Qdrant (WASM)",
    "graph": "Neo4j (embedded)",
    "local": "IndexedDB + Dexie.js"
  },
  "crypto": {
    "encryption": "Web Crypto API",
    "e2e": "libsodium.js"
  }
}
```

### Backend (Opcional - apenas para sync)

```json
{
  "runtime": "Node.js + TypeScript",
  "framework": "Fastify",
  "database": "PostgreSQL + pgvector",
  "cache": "Redis",
  "queue": "BullMQ",
  "realtime": "Socket.io"
}
```

---

## COGNITIVE ENGINE

### Arquitetura

```typescript
// src/engine/cognitive/CognitiveEngine.ts

import { pipeline, env } from '@huggingface/transformers';
import { QdrantClient } from '@qdrant/js-client-rest';

interface Memory {
  id: string;
  content: string;
  embedding: number[];
  type: CelestialObjectType;
  metadata: MemoryMetadata;
  relations: Relation[];
  conflicts: Conflict[];
  position: Vector3;
}

interface MemoryMetadata {
  created: Date;
  modified: Date;
  accessed: number;
  category: string;
  tags: string[];
  importance: number;
}

class CognitiveEngine {
  private embedder: any;
  private classifier: any;
  private vectorDB: QdrantClient;
  private cache: Map<string, number[]>;

  constructor() {
    this.initializeModels();
    this.initializeVectorDB();
    this.cache = new Map();
  }

  private async initializeModels() {
    // Carregar modelo de embeddings (local)
    this.embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );

    // Carregar classificador de tipo
    this.classifier = await pipeline(
      'zero-shot-classification',
      'Xenova/mobilebert-uncased-mnli'
    );
  }

  private async initializeVectorDB() {
    // Qdrant em WASM (local)
    this.vectorDB = new QdrantClient({
      url: 'http://localhost:6333'
    });

    await this.vectorDB.createCollection('memories', {
      vectors: {
        size: 384, // all-MiniLM-L6-v2 dimension
        distance: 'Cosine'
      }
    });
  }

  async processMemory(content: string): Promise<Memory> {
    // 1. Gerar embedding
    const embedding = await this.generateEmbedding(content);

    // 2. Classificar tipo de objeto celeste
    const type = await this.classifyType(content, embedding);

    // 3. Encontrar relações semânticas
    const relations = await this.findRelations(embedding);

    // 4. Detectar contradições
    const conflicts = await this.detectConflicts(content, relations);

    // 5. Calcular importância
    const importance = this.calculateImportance(content, relations);

    // 6. Determinar posição espacial
    const position = await this.calculateSpatialPosition(
      embedding,
      relations,
      type
    );

    // 7. Extrair metadados
    const metadata = this.extractMetadata(content);

    const memory: Memory = {
      id: this.generateId(),
      content,
      embedding,
      type,
      metadata: {
        ...metadata,
        created: new Date(),
        modified: new Date(),
        accessed: 0,
        importance
      },
      relations,
      conflicts,
      position
    };

    // 8. Armazenar
    await this.storeMemory(memory);

    return memory;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // Cache check
    if (this.cache.has(text)) {
      return this.cache.get(text)!;
    }

    // Gerar embedding
    const output = await this.embedder(text, {
      pooling: 'mean',
      normalize: true
    });

    const embedding = Array.from(output.data);

    // Cache
    this.cache.set(text, embedding);

    return embedding;
  }

  private async classifyType(
    content: string,
    embedding: number[]
  ): Promise<CelestialObjectType> {
    const labels = [
      'simple idea',
      'central concept',
      'supporting detail',
      'sudden insight',
      'contradiction',
      'cluster of ideas'
    ];

    const result = await this.classifier(content, labels);

    const typeMap: Record<string, CelestialObjectType> = {
      'simple idea': 'star',
      'central concept': 'sun',
      'supporting detail': 'moon',
      'sudden insight': 'comet',
      'contradiction': 'blackhole',
      'cluster of ideas': 'nebula'
    };

    return typeMap[result.labels[0]] || 'star';
  }

  private async findRelations(
    embedding: number[]
  ): Promise<Relation[]> {
    // Buscar memórias similares
    const searchResult = await this.vectorDB.search('memories', {
      vector: embedding,
      limit: 20,
      score_threshold: 0.7
    });

    return searchResult.map(result => ({
      targetId: result.id as string,
      similarity: result.score,
      type: this.determineRelationType(result.score)
    }));
  }

  private determineRelationType(similarity: number): RelationType {
    if (similarity > 0.95) return 'identical';
    if (similarity > 0.85) return 'strong';
    if (similarity > 0.75) return 'moderate';
    return 'weak';
  }

  private async detectConflicts(
    content: string,
    relations: Relation[]
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // Analisar cada relação forte
    for (const relation of relations.filter(r => r.similarity > 0.8)) {
      const relatedMemory = await this.getMemory(relation.targetId);
      
      // Usar LLM local para detectar contradição
      const isConflict = await this.analyzeContradiction(
        content,
        relatedMemory.content
      );

      if (isConflict) {
        conflicts.push({
          memoryId: relation.targetId,
          type: 'contradiction',
          severity: this.calculateConflictSeverity(relation.similarity)
        });
      }
    }

    return conflicts;
  }

  private async analyzeContradiction(
    text1: string,
    text2: string
  ): Promise<boolean> {
    // Usar modelo de NLI (Natural Language Inference)
    const result = await this.classifier(
      `${text1} [SEP] ${text2}`,
      ['contradiction', 'entailment', 'neutral']
    );

    return result.labels[0] === 'contradiction' && result.scores[0] > 0.7;
  }

  private calculateImportance(
    content: string,
    relations: Relation[]
  ): number {
    // Fatores:
    // 1. Número de relações
    // 2. Força das relações
    // 3. Comprimento do conteúdo
    // 4. Presença de palavras-chave importantes

    const relationScore = relations.length * 0.3;
    const strengthScore = relations.reduce((sum, r) => sum + r.similarity, 0) * 0.3;
    const lengthScore = Math.min(content.length / 1000, 1) * 0.2;
    const keywordScore = this.analyzeKeywords(content) * 0.2;

    return Math.min(relationScore + strengthScore + lengthScore + keywordScore, 1);
  }

  private analyzeKeywords(content: string): number {
    const importantKeywords = [
      'strategy', 'important', 'critical', 'key', 'fundamental',
      'essential', 'core', 'primary', 'main', 'central'
    ];

    const words = content.toLowerCase().split(/\s+/);
    const matches = words.filter(w => importantKeywords.includes(w)).length;

    return Math.min(matches / 5, 1);
  }

  private async calculateSpatialPosition(
    embedding: number[],
    relations: Relation[],
    type: CelestialObjectType
  ): Promise<Vector3> {
    // Usar PCA ou t-SNE para reduzir dimensionalidade
    // Por simplicidade, usar primeiras 3 dimensões normalizadas

    const x = embedding[0] * 1000;
    const y = embedding[1] * 1000;
    const z = embedding[2] * 1000;

    // Ajustar baseado em relações (gravidade semântica)
    if (relations.length > 0) {
      const strongRelations = relations.filter(r => r.similarity > 0.8);
      
      if (strongRelations.length > 0) {
        // Posicionar perto de memórias relacionadas
        const relatedPositions = await Promise.all(
          strongRelations.map(r => this.getMemoryPosition(r.targetId))
        );

        const avgX = relatedPositions.reduce((sum, p) => sum + p.x, 0) / relatedPositions.length;
        const avgY = relatedPositions.reduce((sum, p) => sum + p.y, 0) / relatedPositions.length;
        const avgZ = relatedPositions.reduce((sum, p) => sum + p.z, 0) / relatedPositions.length;

        // Interpolar entre posição calculada e posição média
        return {
          x: x * 0.3 + avgX * 0.7,
          y: y * 0.3 + avgY * 0.7,
          z: z * 0.3 + avgZ * 0.7
        };
      }
    }

    return { x, y, z };
  }

  private extractMetadata(content: string): Partial<MemoryMetadata> {
    // Extrair categoria, tags, etc.
    const category = this.extractCategory(content);
    const tags = this.extractTags(content);

    return { category, tags };
  }

  private extractCategory(content: string): string {
    // Usar classificação zero-shot
    const categories = [
      'business', 'technology', 'personal', 'creative',
      'research', 'planning', 'reflection'
    ];

    // Simplificado - em produção usar classifier
    return 'general';
  }

  private extractTags(content: string): string[] {
    // Extrair hashtags ou palavras-chave
    const hashtagRegex = /#(\w+)/g;
    const matches = content.match(hashtagRegex);
    
    return matches ? matches.map(m => m.slice(1)) : [];
  }

  async suggestConnections(memoryId: string): Promise<Suggestion[]> {
    const memory = await this.getMemory(memoryId);
    
    // Encontrar memórias relacionadas que ainda não estão conectadas
    const potentialConnections = await this.vectorDB.search('memories', {
      vector: memory.embedding,
      limit: 10,
      score_threshold: 0.6
    });

    const suggestions: Suggestion[] = [];

    for (const result of potentialConnections) {
      if (result.id === memoryId) continue;
      
      const isAlreadyConnected = memory.relations.some(
        r => r.targetId === result.id
      );

      if (!isAlreadyConnected) {
        suggestions.push({
          targetId: result.id as string,
          reason: this.generateConnectionReason(memory, result),
          confidence: result.score
        });
      }
    }

    return suggestions;
  }

  private generateConnectionReason(
    memory: Memory,
    result: any
  ): string {
    const similarity = result.score;

    if (similarity > 0.9) {
      return 'Extremamente similar';
    } else if (similarity > 0.8) {
      return 'Fortemente relacionado';
    } else if (similarity > 0.7) {
      return 'Relacionado';
    } else {
      return 'Possivelmente relacionado';
    }
  }

  async detectPatterns(): Promise<Pattern[]> {
    // Usar clustering para detectar padrões
    const allMemories = await this.getAllMemories();
    const embeddings = allMemories.map(m => m.embedding);

    // Usar DBSCAN ou K-means
    const clusters = await this.clusterEmbeddings(embeddings);

    return clusters.map(cluster => ({
      id: this.generateId(),
      type: 'constellation',
      memoryIds: cluster.memberIds,
      centroid: cluster.centroid,
      coherence: cluster.coherence
    }));
  }

  private async clusterEmbeddings(
    embeddings: number[][]
  ): Promise<Cluster[]> {
    // Implementação simplificada de K-means
    // Em produção, usar biblioteca especializada

    const k = Math.min(Math.floor(embeddings.length / 10), 20);
    const clusters: Cluster[] = [];

    // ... implementação de clustering

    return clusters;
  }

  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async storeMemory(memory: Memory): Promise<void> {
    // Armazenar no vector DB
    await this.vectorDB.upsert('memories', {
      points: [{
        id: memory.id,
        vector: memory.embedding,
        payload: {
          content: memory.content,
          type: memory.type,
          metadata: memory.metadata,
          position: memory.position
        }
      }]
    });
  }

  private async getMemory(id: string): Promise<Memory> {
    const result = await this.vectorDB.retrieve('memories', {
      ids: [id]
    });

    return result[0] as any; // Simplificado
  }

  private async getMemoryPosition(id: string): Promise<Vector3> {
    const memory = await this.getMemory(id);
    return memory.position;
  }

  private async getAllMemories(): Promise<Memory[]> {
    // Implementação simplificada
    return [];
  }
}

export default CognitiveEngine;
```

---

## GRAPH ENGINE

### Arquitetura

```typescript
// src/engine/graph/GraphEngine.ts

import * as d3 from 'd3';
import Celestial from 'd3-celestial';

interface GraphNode {
  id: string;
  memory: Memory;
  celestialObject: CelestialObject;
  neighbors: string[];
  degree: number;
  centrality: number;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type: RelationType;
}

class GraphEngine {
  private nodes: Map<string, GraphNode>;
  private edges: GraphEdge[];
  private celestialMap: any;
  private communities: Map<string, string[]>;

  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.communities = new Map();
    this.initializeCelestialMap();
  }

  private initializeCelestialMap() {
    this.celestialMap = Celestial.display({
      container: 'celestial-map',
      width: 0, // Full width
      projection: 'orthographic',
      transform: 'equatorial',
      center: [0, 0, 0],
      orientationfixed: false,
      interactive: true,
      zoomextend: 100,
      adaptable: true,
      
      stars: {
        show: false // Vamos desenhar nossas próprias "estrelas"
      },
      
      constellations: {
        show: false // Vamos desenhar nossas próprias "constelações"
      },
      
      lines: {
        graticule: false,
        equatorial: false,
        ecliptic: false
      }
    });
  }

  addNode(memory: Memory): GraphNode {
    const node: GraphNode = {
      id: memory.id,
      memory,
      celestialObject: this.createCelestialObject(memory),
      neighbors: [],
      degree: 0,
      centrality: 0
    };

    this.nodes.set(memory.id, node);

    // Adicionar ao mapa celestial
    this.addToMap(node);

    // Recalcular métricas
    this.updateMetrics();

    return node;
  }

  addEdge(sourceId: string, targetId: string, weight: number, type: RelationType) {
    const edge: GraphEdge = {
      source: sourceId,
      target: targetId,
      weight,
      type
    };

    this.edges.push(edge);

    // Atualizar vizinhos
    const sourceNode = this.nodes.get(sourceId);
    const targetNode = this.nodes.get(targetId);

    if (sourceNode && targetNode) {
      sourceNode.neighbors.push(targetId);
      targetNode.neighbors.push(sourceId);
      sourceNode.degree++;
      targetNode.degree++;
    }

    // Desenhar conexão no mapa
    this.drawConnection(edge);

    // Recalcular métricas
    this.updateMetrics();
  }

  private createCelestialObject(memory: Memory): CelestialObject {
    // Converter posição 3D para coordenadas celestiais
    const coords = this.cartesianToCelestial(memory.position);

    return {
      type: memory.type,
      coordinates: coords,
      magnitude: this.calculateMagnitude(memory),
      color: this.determineColor(memory),
      size: this.calculateSize(memory)
    };
  }

  private cartesianToCelestial(position: Vector3): [number, number] {
    // Converter (x, y, z) para (longitude, latitude)
    const r = Math.sqrt(position.x ** 2 + position.y ** 2 + position.z ** 2);
    const longitude = Math.atan2(position.y, position.x) * (180 / Math.PI);
    const latitude = Math.asin(position.z / r) * (180 / Math.PI);

    return [longitude, latitude];
  }

  private calculateMagnitude(memory: Memory): number {
    // Magnitude baseada em importância (invertida - menor = mais brilhante)
    return 6 - (memory.metadata.importance * 6);
  }

  private determineColor(memory: Memory): string {
    const colorMap: Record<string, string> = {
      business: '#4A90E2',
      technology: '#50E3C2',
      personal: '#F5A623',
      creative: '#BD10E0',
      research: '#7ED321',
      planning: '#D0021B',
      reflection: '#9013FE'
    };

    return colorMap[memory.metadata.category] || '#FFFFFF';
  }

  private calculateSize(memory: Memory): number {
    // Tamanho baseado em número de acessos e relações
    const accessScore = Math.log(memory.metadata.accessed + 1);
    const relationScore = memory.relations.length;

    return Math.max(1, accessScore + relationScore);
  }

  private addToMap(node: GraphNode) {
    const feature = {
      type: 'Feature',
      id: node.id,
      properties: {
        name: this.extractTitle(node.memory.content),
        type: node.celestialObject.type,
        magnitude: node.celestialObject.magnitude,
        color: node.celestialObject.color
      },
      geometry: {
        type: 'Point',
        coordinates: node.celestialObject.coordinates
      }
    };

    // Adicionar ao d3-celestial
    Celestial.add({
      type: 'point',
      callback: () => [feature],
      redraw: () => {
        this.renderNode(node);
      }
    });
  }

  private renderNode(node: GraphNode) {
    // Customizar renderização baseado no tipo
    const ctx = this.celestialMap.context;
    const coords = this.celestialMap.projection(node.celestialObject.coordinates);

    if (!coords) return;

    ctx.save();
    ctx.fillStyle = node.celestialObject.color;
    ctx.globalAlpha = 0.8;

    switch (node.memory.type) {
      case 'star':
        this.drawStar(ctx, coords, node.celestialObject.size);
        break;
      case 'sun':
        this.drawSun(ctx, coords, node.celestialObject.size);
        break;
      case 'planet':
        this.drawPlanet(ctx, coords, node.celestialObject.size);
        break;
      case 'moon':
        this.drawMoon(ctx, coords, node.celestialObject.size);
        break;
      case 'comet':
        this.drawComet(ctx, coords, node.celestialObject.size);
        break;
      case 'blackhole':
        this.drawBlackHole(ctx, coords, node.celestialObject.size);
        break;
      case 'nebula':
        this.drawNebula(ctx, coords, node.celestialObject.size);
        break;
    }

    ctx.restore();
  }

  private drawStar(ctx: CanvasRenderingContext2D, coords: [number, number], size: number) {
    ctx.beginPath();
    ctx.arc(coords[0], coords[1], size, 0, 2 * Math.PI);
    ctx.fill();

    // Glow
    const gradient = ctx.createRadialGradient(
      coords[0], coords[1], 0,
      coords[0], coords[1], size * 2
    );
    gradient.addColorStop(0, ctx.fillStyle as string);
    gradient.addColorStop(1, 'transparent');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(coords[0], coords[1], size * 2, 0, 2 * Math.PI);
    ctx.fill();
  }

  private drawSun(ctx: CanvasRenderingContext2D, coords: [number, number], size: number) {
    // Sol maior com corona
    this.drawStar(ctx, coords, size * 2);

    // Corona
    ctx.globalAlpha = 0.3;
    const gradient = ctx.createRadialGradient(
      coords[0], coords[1], size * 2,
      coords[0], coords[1], size * 4
    );
    gradient.addColorStop(0, ctx.fillStyle as string);
    gradient.addColorStop(1, 'transparent');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(coords[0], coords[1], size * 4, 0, 2 * Math.PI);
    ctx.fill();
  }

  private drawPlanet(ctx: CanvasRenderingContext2D, coords: [number, number], size: number) {
    // Planeta com atmosfera
    ctx.beginPath();
    ctx.arc(coords[0], coords[1], size * 1.5, 0, 2 * Math.PI);
    ctx.fill();

    // Atmosfera
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.lineWidth = size * 0.3;
    ctx.stroke();
  }

  private drawMoon(ctx: CanvasRenderingContext2D, coords: [number, number], size: number) {
    // Lua pequena
    ctx.beginPath();
    ctx.arc(coords[0], coords[1], size * 0.8, 0, 2 * Math.PI);
    ctx.fill();
  }

  private drawComet(ctx: CanvasRenderingContext2D, coords: [number, number], size: number) {
    // Núcleo
    ctx.beginPath();
    ctx.arc(coords[0], coords[1], size, 0, 2 * Math.PI);
    ctx.fill();

    // Cauda
    const gradient = ctx.createLinearGradient(
      coords[0], coords[1],
      coords[0] - size * 10, coords[1] - size * 5
    );
    gradient.addColorStop(0, ctx.fillStyle as string);
    gradient.addColorStop(1, 'transparent');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(coords[0], coords[1]);
    ctx.lineTo(coords[0] - size * 10, coords[1] - size * 5);
    ctx.lineTo(coords[0] - size * 8, coords[1] - size * 3);
    ctx.closePath();
    ctx.fill();
  }

  private drawBlackHole(ctx: CanvasRenderingContext2D, coords: [number, number], size: number) {
    // Horizonte de eventos (preto)
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(coords[0], coords[1], size, 0, 2 * Math.PI);
    ctx.fill();

    // Disco de acreção
    ctx.strokeStyle = '#FF6B6B';
    ctx.lineWidth = size * 0.5;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(coords[0], coords[1], size * 2, 0, 2 * Math.PI);
    ctx.stroke();

    // Distorção (linhas curvas)
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(coords[0], coords[1], size * (3 + i), 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  private drawNebula(ctx: CanvasRenderingContext2D, coords: [number, number], size: number) {
    // Nuvem de partículas
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 50; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const distance = Math.random() * size * 5;
      const x = coords[0] + Math.cos(angle) * distance;
      const y = coords[1] + Math.sin(angle) * distance;
      const particleSize = Math.random() * size * 0.5;

      ctx.beginPath();
      ctx.arc(x, y, particleSize, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  private drawConnection(edge: GraphEdge) {
    const sourceNode = this.nodes.get(edge.source);
    const targetNode = this.nodes.get(edge.target);

    if (!sourceNode || !targetNode) return;

    const feature = {
      type: 'Feature',
      id: `${edge.source}_${edge.target}`,
      properties: {
        weight: edge.weight,
        type: edge.type
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          sourceNode.celestialObject.coordinates,
          targetNode.celestialObject.coordinates
        ]
      }
    };

    Celestial.add({
      type: 'line',
      callback: () => [feature],
      redraw: () => {
        this.renderConnection(edge);
      }
    });
  }

  private renderConnection(edge: GraphEdge) {
    const sourceNode = this.nodes.get(edge.source);
    const targetNode = this.nodes.get(edge.target);

    if (!sourceNode || !targetNode) return;

    const ctx = this.celestialMap.context;
    const sourceCoords = this.celestialMap.projection(sourceNode.celestialObject.coordinates);
    const targetCoords = this.celestialMap.projection(targetNode.celestialObject.coordinates);

    if (!sourceCoords || !targetCoords) return;

    ctx.save();
    ctx.strokeStyle = this.getConnectionColor(edge.type);
    ctx.lineWidth = edge.weight * 2;
    ctx.globalAlpha = 0.3;

    ctx.beginPath();
    ctx.moveTo(sourceCoords[0], sourceCoords[1]);
    ctx.lineTo(targetCoords[0], targetCoords[1]);
    ctx.stroke();

    ctx.restore();
  }

  private getConnectionColor(type: RelationType): string {
    const colorMap: Record<RelationType, string> = {
      identical: '#FFFFFF',
      strong: '#4A90E2',
      moderate: '#7ED321',
      weak: '#9B9B9B'
    };

    return colorMap[type] || '#9B9B9B';
  }

  private updateMetrics() {
    // Calcular centralidade (PageRank simplificado)
    this.calculateCentrality();

    // Detectar comunidades (Louvain)
    this.detectCommunities();
  }

  private calculateCentrality() {
    const damping = 0.85;
    const iterations = 20;
    const nodeCount = this.nodes.size;

    // Inicializar PageRank
    const pageRank = new Map<string, number>();
    this.nodes.forEach((node, id) => {
      pageRank.set(id, 1 / nodeCount);
    });

    // Iterar
    for (let i = 0; i < iterations; i++) {
      const newPageRank = new Map<string, number>();

      this.nodes.forEach((node, id) => {
        let sum = 0;

        // Somar contribuições dos vizinhos
        node.neighbors.forEach(neighborId => {
          const neighbor = this.nodes.get(neighborId);
          if (neighbor) {
            sum += pageRank.get(neighborId)! / neighbor.degree;
          }
        });

        newPageRank.set(id, (1 - damping) / nodeCount + damping * sum);
      });

      pageRank.clear();
      newPageRank.forEach((value, key) => pageRank.set(key, value));
    }

    // Atualizar centralidade nos nós
    this.nodes.forEach((node, id) => {
      node.centrality = pageRank.get(id)!;
    });
  }

  private detectCommunities() {
    // Implementação simplificada de Louvain
    // Em produção, usar biblioteca especializada (graphology-communities)

    this.communities.clear();

    // Inicializar cada nó em sua própria comunidade
    const nodeToCommunity = new Map<string, string>();
    this.nodes.forEach((node, id) => {
      nodeToCommunity.set(id, id);
    });

    // ... algoritmo de Louvain

    // Agrupar nós por comunidade
    nodeToCommunity.forEach((communityId, nodeId) => {
      if (!this.communities.has(communityId)) {
        this.communities.set(communityId, []);
      }
      this.communities.get(communityId)!.push(nodeId);
    });
  }

  getCommunities(): Map<string, string[]> {
    return this.communities;
  }

  getShortestPath(sourceId: string, targetId: string): string[] {
    // Dijkstra
    const distances = new Map<string, number>();
    const previous = new Map<string, string>();
    const unvisited = new Set<string>();

    this.nodes.forEach((node, id) => {
      distances.set(id, Infinity);
      unvisited.add(id);
    });

    distances.set(sourceId, 0);

    while (unvisited.size > 0) {
      // Encontrar nó não visitado com menor distância
      let current: string | null = null;
      let minDistance = Infinity;

      unvisited.forEach(id => {
        const distance = distances.get(id)!;
        if (distance < minDistance) {
          minDistance = distance;
          current = id;
        }
      });

      if (current === null || current === targetId) break;

      unvisited.delete(current);

      // Atualizar distâncias dos vizinhos
      const currentNode = this.nodes.get(current)!;
      currentNode.neighbors.forEach(neighborId => {
        if (unvisited.has(neighborId)) {
          const edge = this.edges.find(
            e => (e.source === current && e.target === neighborId) ||
                 (e.target === current && e.source === neighborId)
          );

          const distance = distances.get(current!)! + (1 / (edge?.weight || 1));

          if (distance < distances.get(neighborId)!) {
            distances.set(neighborId, distance);
            previous.set(neighborId, current!);
          }
        }
      });
    }

    // Reconstruir caminho
    const path: string[] = [];
    let current: string | undefined = targetId;

    while (current) {
      path.unshift(current);
      current = previous.get(current);
    }

    return path;
  }

  private extractTitle(content: string): string {
    // Extrair primeira linha ou primeiras palavras
    const firstLine = content.split('\n')[0];
    return firstLine.slice(0, 50) + (firstLine.length > 50 ? '...' : '');
  }
}

export default GraphEngine;
```

---

## SPATIAL NAVIGATION ENGINE

```typescript
// src/engine/navigation/SpatialNavigator.ts

import * as THREE from 'three';

interface CameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  fov: number;
}

interface PhysicsState {
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  damping: number;
  gravity: boolean;
}

class SpatialNavigator {
  private camera: THREE.PerspectiveCamera;
  private physics: PhysicsState;
  private objects: Map<string, THREE.Object3D>;
  private selectedObject: string | null;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  constructor(scene: THREE.Scene, canvas: HTMLCanvasElement) {
    this.initializeCamera(canvas);
    this.initializePhysics();
    this.objects = new Map();
    this.selectedObject = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.setupEventListeners(canvas);
  }

  private initializeCamera(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(
      45,
      canvas.width / canvas.height,
      0.1,
      100000
    );

    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);
  }

  private initializePhysics() {
    this.physics = {
      velocity: new THREE.Vector3(0, 0, 0),
      angularVelocity: new THREE.Vector3(0, 0, 0),
      damping: 0.95,
      gravity: true
    };
  }

  private setupEventListeners(canvas: HTMLCanvasElement) {
    // Mouse wheel - zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.handleZoom(e.deltaY);
    });

    // Mouse drag - rotation
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const deltaX = e.clientX - lastX;
        const deltaY = e.clientY - lastY;
        this.handleRotation(deltaX, deltaY);
        lastX = e.clientX;
        lastY = e.clientY;
      }

      // Update mouse position for raycasting
      this.mouse.x = (e.clientX / canvas.width) * 2 - 1;
      this.mouse.y = -(e.clientY / canvas.height) * 2 + 1;
    });

    canvas.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Click - selection
    canvas.addEventListener('click', (e) => {
      this.handleClick(e);
    });

    // Double click - zoom to object
    canvas.addEventListener('dblclick', (e) => {
      this.handleDoubleClick(e);
    });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      this.handleKeyboard(e);
    });
  }

  private handleZoom(delta: number) {
    const zoomSpeed = 0.1;
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    
    this.physics.velocity.add(
      direction.multiplyScalar(-delta * zoomSpeed)
    );
  }

  private handleRotation(deltaX: number, deltaY: number) {
    const rotationSpeed = 0.005;
    
    this.physics.angularVelocity.y += deltaX * rotationSpeed;
    this.physics.angularVelocity.x += deltaY * rotationSpeed;
  }

  private handleClick(e: MouseEvent) {
    const intersected = this.raycast();
    
    if (intersected) {
      this.selectObject(intersected.object.userData.memoryId);
    } else {
      this.deselectObject();
    }
  }

  private handleDoubleClick(e: MouseEvent) {
    const intersected = this.raycast();
    
    if (intersected) {
      this.zoomToObject(intersected.object.userData.memoryId, 1000);
    }
  }

  private handleKeyboard(e: KeyboardEvent) {
    const moveSpeed = 10;

    switch (e.key) {
      case 'ArrowUp':
      case 'w':
        this.physics.velocity.z -= moveSpeed;
        break;
      case 'ArrowDown':
      case 's':
        this.physics.velocity.z += moveSpeed;
        break;
      case 'ArrowLeft':
      case 'a':
        this.physics.velocity.x -= moveSpeed;
        break;
      case 'ArrowRight':
      case 'd':
        this.physics.velocity.x += moveSpeed;
        break;
      case ' ':
        // Create memory
        this.emit('createMemory');
        break;
      case 'Escape':
        this.deselectObject();
        this.returnToOverview();
        break;
    }
  }

  private raycast(): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const intersects = this.raycaster.intersectObjects(
      Array.from(this.objects.values()),
      true
    );

    return intersects.length > 0 ? intersects[0] : null;
  }

  addObject(id: string, object: THREE.Object3D) {
    this.objects.set(id, object);
    object.userData.memoryId = id;
  }

  removeObject(id: string) {
    this.objects.delete(id);
  }

  selectObject(id: string) {
    this.selectedObject = id;
    this.emit('objectSelected', { id });
  }

  deselectObject() {
    this.selectedObject = null;
    this.emit('objectDeselected');
  }

  zoomToObject(id: string, duration: number = 1000) {
    const object = this.objects.get(id);
    if (!object) return;

    const targetPosition = this.calculateOptimalViewPosition(object);
    
    this.animateCamera(
      this.camera.position.clone(),
      targetPosition,
      duration
    );
  }

  private calculateOptimalViewPosition(object: THREE.Object3D): THREE.Vector3 {
    // Calcular posição ideal baseada no tamanho do objeto
    const boundingBox = new THREE.Box3().setFromObject(object);
    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    
    const distance = maxDim * 3; // 3x o tamanho do objeto
    
    const direction = object.position.clone()
      .sub(this.camera.position)
      .normalize();
    
    return object.position.clone()
      .sub(direction.multiplyScalar(distance));
  }

  private animateCamera(
    start: THREE.Vector3,
    end: THREE.Vector3,
    duration: number
  ) {
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing (ease-in-out)
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      this.camera.position.lerpVectors(start, end, eased);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }

  returnToOverview(duration: number = 1000) {
    const overviewPosition = new THREE.Vector3(0, 0, 1000);
    this.animateCamera(this.camera.position.clone(), overviewPosition, duration);
  }

  update(deltaTime: number) {
    // Aplicar velocidade
    this.camera.position.add(
      this.physics.velocity.clone().multiplyScalar(deltaTime / 1000)
    );

    // Aplicar rotação angular
    if (this.physics.angularVelocity.length() > 0.001) {
      const axis = new THREE.Vector3(
        this.physics.angularVelocity.x,
        this.physics.angularVelocity.y,
        0
      ).normalize();
      
      const angle = this.physics.angularVelocity.length() * deltaTime / 1000;
      
      this.camera.position.applyAxisAngle(axis, angle);
      this.camera.lookAt(0, 0, 0);
    }

    // Aplicar damping
    this.physics.velocity.multiplyScalar(this.physics.damping);
    this.physics.angularVelocity.multiplyScalar(this.physics.damping);

    // Aplicar gravidade semântica
    if (this.physics.gravity) {
      this.applySemanticGravity(deltaTime);
    }
  }

  private applySemanticGravity(deltaTime: number) {
    const gravityRadius = 500;
    const gravityStrength = 100;

    this.objects.forEach((object, id) => {
      const distance = this.camera.position.distanceTo(object.position);
      
      if (distance < gravityRadius) {
        const force = (gravityStrength / (distance * distance)) * deltaTime / 1000;
        const direction = object.position.clone()
          .sub(this.camera.position)
          .normalize();
        
        this.physics.velocity.add(direction.multiplyScalar(force));
      }
    });
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  private emit(event: string, data?: any) {
    window.dispatchEvent(new CustomEvent(`mnemosyne:${event}`, { detail: data }));
  }
}

export default SpatialNavigator;
```

---

*Continua na próxima parte...*
