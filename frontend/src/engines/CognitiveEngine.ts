import { embeddingService } from '../services/embeddingService';
import type { MemoryObject, CelestialType, CognitiveGraph, GraphEdge, GraphNode } from '../types/universe';

const SIMILARITY_THRESHOLD = 0.55;
const MAX_CONNECTIONS = 7;

export class CognitiveEngine {
  private static instance: CognitiveEngine;

  static getInstance(): CognitiveEngine {
    if (!CognitiveEngine.instance) {
      CognitiveEngine.instance = new CognitiveEngine();
    }
    return CognitiveEngine.instance;
  }

  async initialize(): Promise<void> {
    await embeddingService.initialize();
  }

  async processMemory(
    text: string,
    existingMemories: MemoryObject[]
  ): Promise<{
    embedding: number[];
    celestialType: CelestialType;
    connections: string[];
    semanticClusterId: string;
    position: [number, number, number];
    importance: number;
  }> {
    const embedding = await embeddingService.getEmbedding(text);
    const celestialType = this.classifyCelestialType(text, embedding, existingMemories);
    const { connections, importance } = await this.findConnections(embedding, existingMemories);
    const semanticClusterId = this.deriveSemanticClusterId(text, connections, existingMemories);
    const position = this.computeSemanticPosition(embedding, existingMemories, connections);

    return { embedding, celestialType, connections, semanticClusterId, position, importance };
  }

  private classifyCelestialType(
    text: string,
    _embedding: number[],
    existing: MemoryObject[]
  ): CelestialType {
    const wordCount = text.trim().split(/\s+/).length;
    const charCount = text.length;
    const hasQuestions = /\?/.test(text);
    const isPhilosophical = /\b(why|what|how|meaning|purpose|truth|existence|consciousness)\b/i.test(text);
    const isPersonal = /\b(i |my |me |myself|we |our )\b/i.test(text);
    const isFactual = /\b(is|are|was|were|will be|defined as|known as)\b/i.test(text);
    const isComplex = wordCount > 100;
    const isPivotal = existing.length === 0 || (existing.length > 0 && charCount > 300);

    if (existing.length === 0) return 'sun';
    if (isPivotal && isPhilosophical) return 'sun';
    if (isComplex && isFactual) return 'nebula';
    if (hasQuestions && isPhilosophical) return 'black_hole';
    if (isPersonal && wordCount < 20) return 'comet';
    if (wordCount > 50 && isFactual) return 'planet';
    if (wordCount < 15) return 'star';
    return 'planet';
  }

  async findConnections(
    embedding: number[],
    existing: MemoryObject[]
  ): Promise<{ connections: string[]; importance: number }> {
    if (existing.length === 0) return { connections: [], importance: 1.0 };

    const similarities: Array<{ id: string; similarity: number }> = [];

    for (const mem of existing) {
      if (mem.embedding && mem.embedding.length > 0) {
        const sim = embeddingService.cosineSimilarity(embedding, mem.embedding);
        if (sim >= SIMILARITY_THRESHOLD) {
          similarities.push({ id: mem.id, similarity: sim });
        }
      }
    }

    similarities.sort((a, b) => b.similarity - a.similarity);
    const topConnections = similarities.slice(0, MAX_CONNECTIONS);
    const connections = topConnections.map((s) => s.id);

    const avgSimilarity = connections.length > 0
      ? topConnections.reduce((sum, s) => sum + s.similarity, 0) / topConnections.length
      : 0;

    const importance = Math.min(1.0, 0.3 + avgSimilarity * 0.4 + connections.length * 0.05);

    return { connections, importance };
  }

  private deriveSemanticClusterId(
    text: string,
    connections: string[],
    existing: MemoryObject[]
  ): string {
    if (connections.length === 0) {
      return `semantic:solo-${this.hashText(text)}`;
    }

    const connected = existing.filter((memory) => connections.includes(memory.id));
    const clusterCounts = new Map<string, number>();

    for (const memory of connected) {
      const clusterId = memory.semanticClusterId || `semantic:${memory.id}`;
      clusterCounts.set(clusterId, (clusterCounts.get(clusterId) || 0) + 1);
    }

    if (clusterCounts.size === 0) {
      return `semantic:${connections[0]}`;
    }

    return [...clusterCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }

  private hashText(text: string): string {
    const normalized = text.toLowerCase().trim().slice(0, 160);
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  computeSemanticPosition(
    _embedding: number[],
    existing: MemoryObject[],
    connections: string[]
  ): [number, number, number] {
    if (existing.length === 0) {
      return [0, 0, 0];
    }

    if (connections.length === 0) {
      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.5) * Math.PI;
      const radius = 8 + Math.random() * 12;
      return [
        radius * Math.cos(elevation) * Math.cos(angle),
        radius * Math.sin(elevation),
        radius * Math.cos(elevation) * Math.sin(angle),
      ];
    }

    const connectedMemories = existing.filter((m) => connections.includes(m.id));
    const centroid: [number, number, number] = [0, 0, 0];

    for (const mem of connectedMemories) {
      centroid[0] += mem.position[0];
      centroid[1] += mem.position[1];
      centroid[2] += mem.position[2];
    }

    centroid[0] /= connectedMemories.length;
    centroid[1] /= connectedMemories.length;
    centroid[2] /= connectedMemories.length;

    const jitter = 2.5;
    return [
      centroid[0] + (Math.random() - 0.5) * jitter,
      centroid[1] + (Math.random() - 0.5) * jitter,
      centroid[2] + (Math.random() - 0.5) * jitter,
    ];
  }

  buildCognitiveGraph(memories: MemoryObject[]): CognitiveGraph {
    const nodes: GraphNode[] = memories.map((m) => ({
      id: m.id,
      memoryId: m.id,
      label: m.title || m.text.substring(0, 40),
      weight: m.importance,
      x: m.position[0],
      y: m.position[1],
      z: m.position[2],
    }));

    const edges: GraphEdge[] = [];
    const seen = new Set<string>();

    for (const mem of memories) {
      for (const connId of mem.connections) {
        const edgeKey = [mem.id, connId].sort().join('--');
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey);
          const target = memories.find((m) => m.id === connId);
          if (target && mem.embedding.length > 0 && target.embedding.length > 0) {
            const similarity = embeddingService.cosineSimilarity(mem.embedding, target.embedding);
            edges.push({
              source: mem.id,
              target: connId,
              weight: similarity,
              similarity,
            });
          }
        }
      }
    }

    const clusters = this.louvainClusters(nodes, edges);

    return { nodes, edges, clusters };
  }

  private louvainClusters(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): Map<number, string[]> {
    const communityMap = new Map<string, number>();
    const communities = new Map<number, string[]>();

    nodes.forEach((n, i) => communityMap.set(n.id, i));

    for (const edge of edges) {
      if (edge.similarity > 0.7) {
        const srcCommunity = communityMap.get(edge.source)!;
        const tgtCommunity = communityMap.get(edge.target)!;
        if (srcCommunity !== tgtCommunity) {
          const smaller = Math.min(srcCommunity, tgtCommunity);
          communityMap.set(edge.source, smaller);
          communityMap.set(edge.target, smaller);
        }
      }
    }

    communityMap.forEach((community, nodeId) => {
      if (!communities.has(community)) communities.set(community, []);
      communities.get(community)!.push(nodeId);
    });

    return communities;
  }

  computePageRank(memories: MemoryObject[]): Map<string, number> {
    const damping = 0.85;
    const iterations = 20;
    const n = memories.length;
    if (n === 0) return new Map();

    const scores = new Map<string, number>();
    memories.forEach((m) => scores.set(m.id, 1 / n));

    for (let iter = 0; iter < iterations; iter++) {
      const newScores = new Map<string, number>();
      for (const mem of memories) {
        let incomingScore = 0;
        for (const other of memories) {
          if (other.connections.includes(mem.id)) {
            const outDegree = Math.max(other.connections.length, 1);
            incomingScore += (scores.get(other.id) || 0) / outDegree;
          }
        }
        newScores.set(mem.id, (1 - damping) / n + damping * incomingScore);
      }
      newScores.forEach((score, id) => scores.set(id, score));
    }

    return scores;
  }

  generateTitle(text: string): string {
    const words = text.trim().split(/\s+/);
    if (words.length <= 5) return text;
    const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'that', 'this', 'it']);
    const meaningful = words.filter((w) => !stopWords.has(w.toLowerCase())).slice(0, 4);
    return meaningful.join(' ');
  }

  // 🧠 CORREÇÃO DE ERROS COGNITIVOS (Ising-inspired)
  detectAnomalies(memories: MemoryObject[]): Array<{ memoryId: string; issue: string; suggestion: string }> {
    const anomalies: Array<{ memoryId: string; issue: string; suggestion: string }> = [];
    if (memories.length < 2) return anomalies;

    const timeThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days old

    for (const mem of memories) {
      const isOld = (mem.timestamp || 0) < timeThreshold;
      const isIsolated = mem.connections.length === 0;
      
      // Memory decay / isolation (Síndrome)
      if (isIsolated && isOld) {
        anomalies.push({
          memoryId: mem.id,
          issue: 'Memória Isolada e Antiga',
          suggestion: 'Arquivar'
        });
      } else if (isIsolated && !isOld) {
        // Try to find a forced connection
        const sim = memories
          .filter(m => m.id !== mem.id && m.embedding?.length > 0 && mem.embedding?.length > 0)
          .map(m => ({ id: m.id, sim: embeddingService.cosineSimilarity(mem.embedding, m.embedding) }))
          .sort((a, b) => b.sim - a.sim)[0];
        
        if (sim && sim.sim > 0.4) {
          anomalies.push({
            memoryId: mem.id,
            issue: 'Memória Órfã Recente',
            suggestion: `Ligar a ${sim.id}`
          });
        }
      }

      // Broken links
      const brokenLinks = mem.connections.filter(cId => !memories.find(m => m.id === cId));
      if (brokenLinks.length > 0) {
        anomalies.push({
          memoryId: mem.id,
          issue: 'Ligações Quebradas',
          suggestion: 'Reorganizar/Limpar'
        });
      }
    }

    return anomalies;
  }
}

export const cognitiveEngine = CognitiveEngine.getInstance();
