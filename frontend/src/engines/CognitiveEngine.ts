import { embeddingService } from '../services/embeddingService';
import { CURRENT_EMBEDDING_SPACE, sameEmbeddingSpace } from '../services/embeddingModel';
import type { MemoryObject, CelestialType, CognitiveGraph, GraphEdge, GraphNode } from '../types/universe';
import { selectSemanticWriteNeighbors, withSemanticWriteScope, type SemanticWriteOptions, type SemanticWriteSelection } from '../services/semanticWriteClient';
import { SEMANTIC_WRITE_LIMITS, type SemanticWriteCandidate } from '../services/semanticWriteProtocol';

const SIMILARITY_THRESHOLD = SEMANTIC_WRITE_LIMITS.threshold;
const WEAK_LINK_THRESHOLD = 0.32;
const REPAIR_LINK_THRESHOLD = 0.4;
const DUPLICATE_THRESHOLD = 0.96;

export interface CognitiveAnomaly {
  memoryId: string;
  issue: string;
  suggestion: string;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  syndromeDensity: number;
  relatedMemoryId?: string;
}

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
    existingMemories: Iterable<SemanticWriteCandidate>,
    options: SemanticWriteOptions = {},
  ): Promise<{
    embedding: number[];
    embeddingModel: string;
    celestialType: CelestialType;
    connections: string[];
    semanticClusterId: string;
    position: [number, number, number];
    importance: number;
  }> {
    return withSemanticWriteScope(options, async scope => {
      const embedding = await embeddingService.getEmbedding(text); scope.assertCurrent();
      const selection = await selectSemanticWriteNeighbors(embedding, existingMemories, { ...options, ...scope });
      scope.assertCurrent();
      const celestialType = this.classifyCelestialType(text, selection.count);
      const { connections, importance } = this.connectionResult(selection);
      // Only seven selected metadata records are needed for the cluster and centroid.
      const connected = [...selection.neighbors].sort((a, b) => a.ordinal - b.ordinal).map(({ candidate }) => {
        const position = candidate.position ?? [0, 0, 0];
        if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new Error('semantic_write_unavailable');
        return { id: candidate.id, position: position as [number, number, number], semanticClusterId: candidate.semanticClusterId };
      });
      const semanticClusterId = this.deriveSemanticClusterId(text, connections, connected);
      const position = this.computeSemanticPosition(embedding, connected, connections, selection.count);
      return { embedding, embeddingModel: CURRENT_EMBEDDING_SPACE, celestialType, connections, semanticClusterId, position, importance };
    });
  }

  private classifyCelestialType(
    text: string,
    existingCount: number,
  ): CelestialType {
    const wordCount = text.trim().split(/\s+/).length;
    const charCount = text.length;
    const hasQuestions = /\?/.test(text);
    const isPhilosophical = /\b(why|what|how|meaning|purpose|truth|existence|consciousness)\b/i.test(text);
    const isPersonal = /\b(i |my |me |myself|we |our )\b/i.test(text);
    const isFactual = /\b(is|are|was|were|will be|defined as|known as)\b/i.test(text);
    const isComplex = wordCount > 100;
    const isPivotal = existingCount === 0 || (existingCount > 0 && charCount > 300);

    if (existingCount === 0) return 'sun';
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
    existing: Iterable<SemanticWriteCandidate>,
    options: SemanticWriteOptions = {},
  ): Promise<{ connections: string[]; importance: number }> {
    return withSemanticWriteScope(options, async scope => this.connectionResult(
      await selectSemanticWriteNeighbors(embedding, existing, { ...options, ...scope })));
  }

  private connectionResult({ count, neighbors }: SemanticWriteSelection) {
    if (!count) return { connections: [], importance: 1.0 };
    const connections = neighbors.map(row => row.candidate.id);
    const avgSimilarity = neighbors.length ? neighbors.reduce((sum, row) => sum + row.score, 0) / neighbors.length : 0;
    const importance = Math.min(1.0, 0.3 + avgSimilarity * 0.4 + connections.length * 0.05);

    return { connections, importance };
  }

  private deriveSemanticClusterId(
    text: string,
    connections: string[],
    existing: Array<Pick<MemoryObject, 'id' | 'semanticClusterId'>>,
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
    existing: Array<Pick<MemoryObject, 'id' | 'position'>>,
    connections: string[],
    existingCount = existing.length,
  ): [number, number, number] {
    if (existingCount === 0) {
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
    const memoryById = new Map(memories.map((memory) => [memory.id, memory]));

    for (const mem of memories) {
      for (const connId of mem.connections) {
        const edgeKey = [mem.id, connId].sort().join('--');
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey);
          const target = memoryById.get(connId);
          if (target && mem.embedding.length > 0 && target.embedding.length > 0 && mem.embedding.length === target.embedding.length && sameEmbeddingSpace(mem.embeddingModel, target.embeddingModel)) {
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

    const clusters = this.similarityThresholdGroups(nodes, edges);

    return { nodes, edges, clusters };
  }

  private similarityThresholdGroups(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): Map<number, string[]> {
    const indexById = new Map(nodes.map((node, index) => [node.id, index]));
    const parent = nodes.map((_, index) => index);
    const find = (index: number): number => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };

    for (const edge of edges) {
      if (edge.similarity > 0.7) {
        const source = indexById.get(edge.source);
        const target = indexById.get(edge.target);
        if (source !== undefined && target !== undefined) parent[find(target)] = find(source);
      }
    }

    const groups = new Map<number, string[]>();
    nodes.forEach((node, index) => {
      const group = find(index);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(node.id);
    });

    return groups;
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
      const incoming = new Map(memories.map((memory) => [memory.id, 0]));
      for (const memory of memories) {
        const contribution = (scores.get(memory.id) || 0) / Math.max(memory.connections.length, 1);
        for (const targetId of new Set(memory.connections)) {
          if (incoming.has(targetId)) {
            incoming.set(targetId, (incoming.get(targetId) || 0) + contribution);
          }
        }
      }
      for (const memory of memories) {
        newScores.set(memory.id, (1 - damping) / n + damping * (incoming.get(memory.id) || 0));
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

  // Correcao de erros cognitivos inspirada no fluxo Ising:
  // detectar sindromes, propor pre-correcao local e deixar a decisao final explicita.
  detectAnomalies(memories: MemoryObject[]): CognitiveAnomaly[] {
    const anomalies: CognitiveAnomaly[] = [];
    if (memories.length < 2) return anomalies;

    const timeThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days old
    const memoryById = new Map(memories.map((memory) => [memory.id, memory]));

    for (const mem of memories) {
      const isOld = (mem.timestamp || 0) < timeThreshold;
      const existingConnections = mem.connections.filter((connId) => memoryById.has(connId));
      const brokenLinks = mem.connections.filter((connId) => !memoryById.has(connId));
      const isIsolated = existingConnections.length === 0;
      const weakLinks = existingConnections.filter((connId) => {
        const target = memoryById.get(connId);
        if (!target || mem.embedding.length === 0 || target.embedding.length === 0 || mem.embedding.length !== target.embedding.length || !sameEmbeddingSpace(mem.embeddingModel, target.embeddingModel)) return false;
        return embeddingService.cosineSimilarity(mem.embedding, target.embedding) < WEAK_LINK_THRESHOLD;
      });
      const excludedRepairIds = new Set([mem.id, ...existingConnections]);
      const repairCandidate = this.findBestRepairCandidate(mem, memories, excludedRepairIds);
      const duplicateCandidate = this.findBestRepairCandidate(
        mem,
        memories,
        excludedRepairIds,
        DUPLICATE_THRESHOLD
      );
      const syndromeDensity = this.computeSyndromeDensity({
        brokenLinks: brokenLinks.length,
        weakLinks: weakLinks.length,
        isIsolated,
        isOld,
        hasRepairCandidate: !!repairCandidate,
        hasDuplicateCandidate: !!duplicateCandidate,
      });

      if (isIsolated && isOld) {
        anomalies.push({
          memoryId: mem.id,
          issue: 'Memória Isolada e Antiga',
          suggestion: repairCandidate
            ? `Arquivar ou ligar a ${repairCandidate.id}`
            : 'Arquivar',
          severity: repairCandidate ? 'medium' : 'high',
          confidence: repairCandidate ? repairCandidate.similarity : 0.72,
          syndromeDensity,
        });
      } else if (isIsolated && !isOld) {
        if (repairCandidate) {
          anomalies.push({
            memoryId: mem.id,
            issue: 'Memória Órfã Recente',
            suggestion: `Ligar a ${repairCandidate.id}`,
            severity: repairCandidate.similarity > SIMILARITY_THRESHOLD ? 'medium' : 'low',
            confidence: repairCandidate.similarity,
            syndromeDensity,
            relatedMemoryId: repairCandidate.id,
          });
        }
      }

      if (brokenLinks.length > 0) {
        anomalies.push({
          memoryId: mem.id,
          issue: 'Ligações Quebradas',
          suggestion: `Remover ${brokenLinks.length} ligação(ões) inválida(s)`,
          severity: 'high',
          confidence: Math.min(1, 0.68 + brokenLinks.length * 0.08),
          syndromeDensity,
        });
      }

      if (weakLinks.length > 0) {
        anomalies.push({
          memoryId: mem.id,
          issue: 'Ligações Fracas',
          suggestion: `Revalidar ${weakLinks.length} ligação(ões) com baixa similaridade`,
          severity: weakLinks.length > 2 ? 'medium' : 'low',
          confidence: Math.min(1, 0.46 + weakLinks.length * 0.1),
          syndromeDensity,
        });
      }

      if (duplicateCandidate) {
        anomalies.push({
          memoryId: mem.id,
          issue: 'Possível Duplicado',
          suggestion: `Comparar/fundir com ${duplicateCandidate.id}`,
          severity: 'low',
          confidence: duplicateCandidate.similarity,
          syndromeDensity,
          relatedMemoryId: duplicateCandidate.id,
        });
      }
    }

    return anomalies.sort((a, b) => (
      severityRank(b.severity) - severityRank(a.severity) ||
      b.syndromeDensity - a.syndromeDensity ||
      b.confidence - a.confidence
    ));
  }

  private findBestRepairCandidate(
    memory: MemoryObject,
    memories: MemoryObject[],
    excludedIds: Set<string>,
    minSimilarity = REPAIR_LINK_THRESHOLD
  ): { id: string; similarity: number } | null {
    if (memory.embedding.length === 0) return null;

    const candidate = memories
      .filter((other) => !excludedIds.has(other.id) && other.embedding.length > 0 && other.embedding.length === memory.embedding.length && sameEmbeddingSpace(memory.embeddingModel, other.embeddingModel))
      .map((other) => ({
        id: other.id,
        similarity: embeddingService.cosineSimilarity(memory.embedding, other.embedding),
      }))
      .filter((other) => other.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))[0];

    return candidate || null;
  }

  private computeSyndromeDensity(input: {
    brokenLinks: number;
    weakLinks: number;
    isIsolated: boolean;
    isOld: boolean;
    hasRepairCandidate: boolean;
    hasDuplicateCandidate: boolean;
  }): number {
    const score =
      input.brokenLinks * 0.24 +
      input.weakLinks * 0.14 +
      (input.isIsolated ? 0.28 : 0) +
      (input.isOld ? 0.16 : 0) +
      (input.hasRepairCandidate ? 0.1 : 0) +
      (input.hasDuplicateCandidate ? 0.08 : 0);

    return Math.min(1, Number(score.toFixed(3)));
  }
}

function severityRank(severity: CognitiveAnomaly['severity']): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

export const cognitiveEngine = CognitiveEngine.getInstance();
