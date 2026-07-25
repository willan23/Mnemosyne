import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { MemoryActionPanel } from './MemoryActionPanel';
import type { SessionData } from '../hooks/useSessions';

interface Node {
    id: string;
    name: string;
    val: number;
    x?: number;
    y?: number;
    z?: number;
    cluster?: string;
    clusterSize?: number;
    celestialType?: string;
    importance?: number;
    connectionCount?: number;
    isForgotten?: boolean;
    timestamp?: number;
    lastViewedAt?: number;
    isReceived?: boolean;
    isSelected?: boolean;
}

interface Link {
    source: string | Node;
    target: string | Node;
}

interface GraphData {
    nodes: Node[];
    links: Link[];
}

interface Props {
    data?: GraphData;
    sessions?: SessionData[];
    receivedNodeIds?: string[];
    searchResultNodeIds?: string[];
    focusedNodeId?: string | null;
    onTransmitMemory?: (session: SessionData) => void;
}

export const MemoryGraph: React.FC<Props> = ({
    data,
    sessions = [],
    receivedNodeIds = [],
    searchResultNodeIds = [],
    focusedNodeId = null,
    onTransmitMemory,
}) => {
    const fgRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [highlightNodes, setHighlightNodes] = useState(new Set<string>());
    const [highlightLinks, setHighlightLinks] = useState(new Set<any>());
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const [selectedSession, setSelectedSession] = useState<SessionData | null>(null);
    const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
    const [pulseTick, setPulseTick] = useState(0);
    const pulseRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const sessionMap = useMemo(() => {
        const m = new Map<string, SessionData>();
        sessions.forEach((s) => m.set(s.id, s));
        return m;
    }, [sessions]);

    const searchResultSet = useMemo(() => new Set(searchResultNodeIds), [searchResultNodeIds]);

    useEffect(() => {
        const updateDimensions = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight,
                });
            }
        };
        window.addEventListener('resize', updateDimensions);
        updateDimensions();
        setTimeout(updateDimensions, 100);
        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    useEffect(() => {
        if (receivedNodeIds.length > 0) {
            pulseRef.current = setInterval(() => {
                setPulseTick((t) => t + 1);
            }, 60);
        } else {
            if (pulseRef.current) clearInterval(pulseRef.current);
        }
        return () => { if (pulseRef.current) clearInterval(pulseRef.current); };
    }, [receivedNodeIds.length]);

    const rawData = data || {
        nodes: [
            { id: '1', name: 'Mnemosyne', val: 10 },
            { id: '2', name: 'Início', val: 5 },
            { id: '3', name: 'Design', val: 7 },
            { id: '4', name: 'E2EE', val: 8 },
            { id: '5', name: 'Grafo 3D', val: 4 },
        ],
        links: [
            { source: '1', target: '2' },
            { source: '1', target: '3' },
            { source: '1', target: '4' },
            { source: '3', target: '5' },
        ],
    };

    const processedGraphData = useMemo(() => {
        let cleanData: { nodes: any[]; links: any[] };
        try {
            cleanData = JSON.parse(JSON.stringify(rawData));
        } catch (e) {
            console.error('Grave: Erro ao clonar dados do grafo', e);
            return { nodes: [], links: [] };
        }

        const maxNodes = 5000;
        const getId = (n: any) => (typeof n === 'object' && n !== null ? n.id : n);

        let nodes: any[] = cleanData.nodes.filter((n: any) => !deletedIds.has(n.id));
        const links: any[] = cleanData.links;

        if (nodes.length > maxNodes) nodes = nodes.slice(0, maxNodes);

        const nodeIds = new Set(nodes.map((n: any) => getId(n)));

        const safeLinks = links.reduce((acc: any[], link: any) => {
            const sourceId = getId(link.source);
            const targetId = getId(link.target);
            if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
                acc.push({ source: sourceId, target: targetId, value: link.value });
            }
            return acc;
        }, []);

        const clusterCounts: Record<string, number> = {};
        nodes.forEach((n: any) => {
            if (n.cluster && n.cluster !== 'unclustered') {
                clusterCounts[n.cluster] = (clusterCounts[n.cluster] || 0) + 1;
            }
        });
        nodes.forEach((n: any) => {
            n.clusterSize = n.cluster && n.cluster !== 'unclustered'
                ? clusterCounts[n.cluster]
                : 0;
            n.isReceived = receivedNodeIds.includes(n.id);
        });

        return { nodes, links: safeLinks };
    }, [rawData, deletedIds, receivedNodeIds]);

    const nodeColors = [
        '#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF',
        '#FF8B94', '#C7CEEA', '#FFDAC1', '#B4F8C8',
        '#FBE7C6', '#A0E7E5',
    ];

    const getColorIndex = useCallback((id: string) => {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = ((hash << 5) - hash) + id.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash) % nodeColors.length;
    }, []);

    useEffect(() => {
        if (!fgRef.current) return;
        fgRef.current.d3Force('charge').strength(-400);
        fgRef.current.d3Force('link').distance((link: any) => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            return sessionMap.has(sourceId) && sessionMap.has(targetId) ? 90 : 120;
        });
        
        // Câmera afastada para ver todo o universo
        fgRef.current.cameraPosition({ z: 1200 });
    }, [processedGraphData]);

    const handleNodeHover = useCallback((node: any) => {
        const nodes = new Set<string>();
        const links = new Set<any>();
        if (node) {
            nodes.add(node.id);
            processedGraphData.links.forEach((link: any) => {
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                if (sourceId === node.id || targetId === node.id) {
                    links.add(link);
                    nodes.add(sourceId);
                    nodes.add(targetId);
                }
            });
        }
        setHighlightNodes(nodes);
        setHighlightLinks(links);
    }, [processedGraphData]);

    const focusNode = useCallback((node: any) => {
        setSelectedNode(node);
        const session = sessionMap.get(node.id) || null;
        setSelectedSession(session);
        
        if (fgRef.current && node) {
            // Mergulho da câmera no nó 3D
            const distance = 250;
            const x = typeof node.x === 'number' ? node.x : 0;
            const y = typeof node.y === 'number' ? node.y : 0;
            const z = typeof node.z === 'number' ? node.z : 1;
            const distRatio = 1 + distance / Math.max(1, Math.hypot(x, y, z));
            fgRef.current.cameraPosition(
                { x: x * distRatio, y: y * distRatio, z: z * distRatio },
                { x, y, z }, // foca no nó
                1500  // duração suave de 1.5s
            );
        }
    }, [sessionMap]);

    const handleNodeClick = useCallback((node: any) => {
        focusNode(node);
    }, [focusNode]);

    useEffect(() => {
        if (!focusedNodeId || !fgRef.current) return;
        const node = processedGraphData.nodes.find((item: any) => item.id === focusedNodeId);
        if (!node) return;

        const neighborNodes = new Set<string>([focusedNodeId]);
        const neighborLinks = new Set<any>();
        processedGraphData.links.forEach((link: any) => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            if (sourceId === focusedNodeId || targetId === focusedNodeId) {
                neighborLinks.add(link);
                neighborNodes.add(sourceId);
                neighborNodes.add(targetId);
            }
        });

        setHighlightNodes(neighborNodes);
        setHighlightLinks(neighborLinks);
        focusNode(node);
    }, [focusedNodeId, processedGraphData, focusNode]);

    const handlePanelClose = useCallback(() => {
        setSelectedNode(null);
        setSelectedSession(null);
        if (fgRef.current) {
            const camPos = fgRef.current.cameraPosition();
            fgRef.current.cameraPosition(
                { x: camPos.x * 1.5, y: camPos.y * 1.5, z: camPos.z * 1.5 },
                { x: 0, y: 0, z: 0 },
                1000
            );
        }
    }, []);

    const handleDeleted = useCallback((id: string) => {
        setDeletedIds((prev) => new Set([...prev, id]));
    }, []);

    // Renderização do Nó em 3D (Substitui o Canvas 2D)
    const renderNode3D = useCallback((node: any) => {
        const group = new THREE.Group();
        
        const isSearchResult = searchResultSet.has(node.id);
        const isHighlighted = highlightNodes.has(node.id) || selectedNode?.id === node.id || isSearchResult;
        const isSelected = selectedNode?.id === node.id;
        const isReceived = node.isReceived;
        const isForgotten = node.isForgotten;
        
        const index = getColorIndex(String(node.id));
        const color = nodeColors[index];
        
        const baseVal = typeof node.val === 'number' ? node.val : 7;
        let size = isSelected ? 14 : isHighlighted ? 12 : Math.max(6, Math.min(13, baseVal));
        if (!isSelected && node.clusterSize) {
            if (node.clusterSize > 20) size += 6;
            else if (node.clusterSize > 10) size += 4;
            else if (node.clusterSize > 3) size += 2;
        }

        // Esfera principal
        const material = new THREE.MeshPhongMaterial({
            color: isSearchResult ? '#38bdf8' : isReceived ? '#22d3ee' : isForgotten ? '#f59e0b' : color,
            transparent: true,
            opacity: isHighlighted || isSelected ? 1 : 0.8,
            emissive: isSearchResult ? '#38bdf8' : isReceived ? '#22d3ee' : isForgotten ? '#f59e0b' : (isSelected ? '#ffffff' : color),
            emissiveIntensity: isSelected ? 0.8 : (isSearchResult ? 0.7 : isForgotten ? 0.45 : isHighlighted ? 0.5 : 0.2),
            shininess: 100
        });

        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(size, 32, 32),
            material
        );
        group.add(sphere);

        // Brilho externo (Halo) para nós selecionados ou recebidos
        if (isSelected || isReceived || isSearchResult || isForgotten) {
            const haloMaterial = new THREE.MeshBasicMaterial({
                color: isSearchResult ? '#38bdf8' : isReceived ? '#22d3ee' : isForgotten ? '#f59e0b' : '#ffffff',
                transparent: true,
                opacity: isSearchResult ? 0.24 : isForgotten ? 0.18 : 0.3,
                side: THREE.BackSide
            });
            const haloSize = isReceived || isSearchResult || isForgotten ? size * (1.2 + 0.3 * Math.sin(pulseTick * 0.12)) : size * 1.4;
            const halo = new THREE.Mesh(
                new THREE.SphereGeometry(haloSize, 32, 32),
                haloMaterial
            );
            group.add(halo);
        }

        // Rótulo flutuante em 3D
        if (isHighlighted || isSelected || processedGraphData.nodes.length < 40) {
            const sprite = new SpriteText(node.name);
            sprite.color = '#ffffff';
            sprite.textHeight = size * 1.2;
            sprite.position.y = -size - 12;
            sprite.backgroundColor = 'rgba(0,0,0,0.7)';
            sprite.padding = 3;
            sprite.borderRadius = 4;
            group.add(sprite);
        }

        return group;
    }, [highlightNodes, selectedNode, pulseTick, processedGraphData.nodes.length, getColorIndex, searchResultSet]);

    const getLinkIds = (link: any) => ({
        sourceId: typeof link.source === 'object' ? link.source.id : link.source,
        targetId: typeof link.target === 'object' ? link.target.id : link.target,
    });

    const isSearchLink = (link: any) => {
        const { sourceId, targetId } = getLinkIds(link);
        return searchResultSet.has(sourceId) || searchResultSet.has(targetId);
    };

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden" style={{ minHeight: '400px' }}>
            {/* Fundos Cósmicos */}
            <div className="absolute inset-0 bg-black pointer-events-none opacity-100" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--bg-deep)_0%,_var(--bg-void)_100%)] pointer-events-none opacity-80" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(139,92,246,0.05)_0%,_transparent_70%)] pointer-events-none" />

            {rawData.nodes.length > 5000 && (
                <div className="absolute top-4 left-4 px-3 py-2 text-xs text-yellow-400 z-10 rounded-full border border-yellow-500/30 bg-black/40 backdrop-blur-md">
                    ⚡ Exibindo top {processedGraphData.nodes.length} de {rawData.nodes.length} nós
                </div>
            )}

            {receivedNodeIds.length > 0 && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full border border-cyan-500/40 bg-cyan-950/40 backdrop-blur-md text-cyan-300 text-xs font-medium flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    {receivedNodeIds.length} nova(s) memória(s) recebida(s)
                </div>
            )}

            {searchResultNodeIds.length > 0 && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full border border-sky-500/40 bg-sky-950/40 backdrop-blur-md text-sky-200 text-xs font-medium flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.9)]" />
                    {searchResultNodeIds.length} resultado(s) destacados
                </div>
            )}

            <div className="absolute bottom-4 left-4 z-10 text-white/40 text-[11px] font-mono space-y-0.5 select-none pointer-events-none bg-black/30 p-2 rounded-lg backdrop-blur-sm border border-white/5">
                <div>🖱 Arrastar: Rodar Universo</div>
                <div>🖱 Scroll: Zoom Intergalático</div>
                <div>🖱 Right-Click: Pan (Mover eixo)</div>
                <div>🖱 Click: Mergulhar no Conhecimento</div>
                <div className="pt-1 text-amber-300/70">✦ Âmbar: ideia antiga a ressurgir</div>
            </div>

            <div className="absolute inset-0 z-10">
                <ForceGraph3D
                    ref={fgRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    graphData={processedGraphData}
                    backgroundColor="rgba(0,0,0,0)" // Transparente para ver os CSS radiais
                    nodeLabel="" // Desativado pois usamos SpriteText personalizado
                    nodeThreeObject={renderNode3D}
                    linkColor={(link: any) => highlightLinks.has(link) ? '#8B5CF6' : isSearchLink(link) ? '#38bdf8' : 'rgba(75,85,99,0.3)'}
                    linkWidth={(link: any) => highlightLinks.has(link) ? 2.5 : isSearchLink(link) ? 1.2 : 0.4}
                    linkResolution={12}
                    linkDirectionalParticles={(link: any) => highlightLinks.has(link) ? 4 : isSearchLink(link) ? 2 : 0}
                    linkDirectionalParticleWidth={2}
                    d3VelocityDecay={0.3}
                    warmupTicks={100}
                    cooldownTicks={100}
                    onNodeHover={handleNodeHover}
                    onNodeClick={handleNodeClick}
                    onBackgroundClick={() => {
                        setHighlightNodes(new Set());
                        setHighlightLinks(new Set());
                        setSelectedNode(null);
                        setSelectedSession(null);
                        if (fgRef.current) {
                            fgRef.current.cameraPosition({ x: 0, y: 0, z: 1200 }, { x: 0, y: 0, z: 0 }, 1500);
                        }
                    }}
                />
            </div>

            <MemoryActionPanel
                node={selectedNode}
                session={selectedSession}
                onClose={handlePanelClose}
                containerRef={containerRef}
                graphRef={fgRef}
                onDeleted={handleDeleted}
                onTransmit={onTransmitMemory}
            />
        </div>
    );
};
