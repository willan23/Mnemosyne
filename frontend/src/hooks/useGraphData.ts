import { useMemo } from 'react';
import type { SessionData } from './useSessions';

export interface GraphNode {
    id: string;
    name: string;
    val: number;
    x?: number;
    y?: number;
    z?: number;
    fx?: number;
    fy?: number;
    fz?: number;
    cluster?: string;
    celestialType?: string;
    importance?: number;
    connectionCount?: number;
    isForgotten?: boolean;
    timestamp?: number;
    lastViewedAt?: number;
}

export interface GraphLink {
    source: string;
    target: string;
}

export interface GraphData {
    nodes: GraphNode[];
    links: GraphLink[];
}

export const useGraphData = (sessions: SessionData[]) => {
    return useMemo(() => {
        const allNodes: GraphNode[] = [];
        const allLinks: GraphLink[] = [];
        const sessionById = new Map(sessions.map((session) => [session.id, session]));
        const parent = new Map<string, string>();
        const now = Date.now();
        const semanticScale = 36;

        const find = (id: string): string => {
            const current = parent.get(id) || id;
            if (current === id) return current;
            const root = find(current);
            parent.set(id, root);
            return root;
        };

        const union = (a: string, b: string) => {
            const rootA = find(a);
            const rootB = find(b);
            if (rootA !== rootB) parent.set(rootB, rootA);
        };

        sessions.forEach((session) => parent.set(session.id, session.id));
        sessions.forEach((session) => {
            session.connections?.forEach((connectionId) => {
                if (sessionById.has(connectionId)) union(session.id, connectionId);
            });
        });

        // Set para evitar duplicatas de IDs de nós
        const nodeIds = new Set<string>();
        const linkIds = new Set<string>();
        const addLink = (source: string, target: string) => {
            if (source === target) return;
            const key = [source, target].sort().join('--');
            if (linkIds.has(key)) return;
            linkIds.add(key);
            allLinks.push({ source, target });
        };

        sessions.forEach((session) => {
            // 1. Nó principal da memória
            const memoryNodeId = session.id;
            
            // Determinar o cluster (priorizar tags de sistema-solar)
            let clusterId = session.category || 'unclustered';
            if (!session.category && session.tags && session.tags.length > 0) {
                const solarSystemTag = session.tags.find((t: string) => t.startsWith('sistema-solar:'));
                clusterId = solarSystemTag || session.tags[0];
            }
            if (session.semanticClusterId) {
                clusterId = session.semanticClusterId;
            } else if ((session.connections?.length || 0) > 0) {
                clusterId = `semantic:${find(session.id)}`;
            }

            const connectionCount = session.connections?.length || 0;
            const importance = typeof session.importance === 'number' ? session.importance : 0.5;
            const ageDays = Math.floor((now - (session.timestamp || now)) / (24 * 60 * 60 * 1000));
            const daysSinceView = Math.floor((now - (session.lastViewedAt || session.timestamp || now)) / (24 * 60 * 60 * 1000));
            const isForgotten = daysSinceView >= 30 && (connectionCount > 0 || importance >= 0.65);
            const semanticPosition = session.position && session.position.length === 3
                ? {
                    x: session.position[0] * semanticScale,
                    y: session.position[1] * semanticScale,
                    z: session.position[2] * semanticScale,
                }
                : undefined;

            if (!nodeIds.has(memoryNodeId)) {
                allNodes.push({
                    id: memoryNodeId,
                    name: session.title || session.text?.substring(0, 30) || 'Memória',
                    val: Math.max(4, Math.min(18, 5 + importance * 7 + connectionCount * 0.8 + (ageDays > 60 ? 1 : 0))),
                    cluster: clusterId,
                    celestialType: session.celestialType,
                    importance,
                    connectionCount,
                    isForgotten,
                    timestamp: session.timestamp,
                    lastViewedAt: session.lastViewedAt || session.timestamp,
                    ...semanticPosition,
                    ...(semanticPosition ? {
                        fx: semanticPosition.x,
                        fy: semanticPosition.y,
                        fz: semanticPosition.z,
                    } : {})
                });
                nodeIds.add(memoryNodeId);
            }

            session.connections?.forEach((connectionId) => {
                if (sessionById.has(connectionId)) addLink(memoryNodeId, connectionId);
            });

            // 2. Nós do Knowledge Graph (se existirem)
            if (session.nodes && Array.isArray(session.nodes)) {
                session.nodes.forEach((node: any) => {
                    // Validação Rigorosa
                    if (!node) return;
                    if (typeof node === 'string') return; // Ignora nós antigos que eram strings
                    if (typeof node !== 'object') return;
                    if (!node.id) return;

                    const nodeId = String(node.id);

                    if (!nodeIds.has(nodeId)) {
                        allNodes.push({
                            id: nodeId,
                            name: String(node.name || node.id),
                            val: Number(node.val || 3),
                            cluster: clusterId,
                            timestamp: session.timestamp,
                            lastViewedAt: session.lastViewedAt || session.timestamp
                        });
                        nodeIds.add(nodeId);
                    }
                });
            }

            // 3. Links do Knowledge Graph
            if (session.links && Array.isArray(session.links)) {
                session.links.forEach((link: any) => {
                    if (!link) return;
                    if (typeof link !== 'object') return;
                    if (!link.source || !link.target) return;

                    // Só adiciona links se ambos os nós existirem (para evitar erros do d3)
                    // Mas como adicionamos nós dinamicamente, vamos confiar na validação do componente ou adicionar todos
                    // O componente MemoryGraph já tem proteção extra, então enviamos dados limpos aqui.
                    addLink(String(link.source), String(link.target));
                });
            }
        });

        return { nodes: allNodes, links: allLinks };
    }, [sessions]);
};
