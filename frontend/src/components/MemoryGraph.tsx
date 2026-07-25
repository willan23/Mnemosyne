import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { forceCollide } from 'd3-force-3d';
import { MemoryActionPanel } from './MemoryActionPanel';
import type { SessionData } from '../hooks/useSessions';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { getGraphRenderBudget, rankNodesForGraph } from '../utils/graphPerformance';

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
    parentId?: string;
    importance?: number;
    connectionCount?: number;
    isForgotten?: boolean;
    timestamp?: number;
    lastViewedAt?: number;
    isReceived?: boolean;
    isSelected?: boolean;
    isNewborn?: boolean;
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
    onTransmitMemory?: (session: SessionData, options?: { includeLinked?: boolean }) => void;
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
    const isFirstMountRef = useRef(true);
    const lastClickRef = useRef<{ time: number; nodeId: string | null }>({ time: 0, nodeId: null });
    const nodesRef = useRef<Map<string, any>>(new Map());
    const knownNodeIdsRef = useRef<Set<string>>(new Set());
    const [newbornIds, setNewbornIds] = useState<Set<string>>(new Set());
    const hasRealSessions = sessions.length > 0;

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
        const needsPulse = receivedNodeIds.length > 0 || newbornIds.size > 0 || searchResultNodeIds.length > 0;
        if (needsPulse) {
            pulseRef.current = setInterval(() => {
                setPulseTick((t) => t + 1);
            }, 50);
        } else if (pulseRef.current) {
            clearInterval(pulseRef.current);
            pulseRef.current = null;
        }
        return () => { if (pulseRef.current) clearInterval(pulseRef.current); };
    }, [receivedNodeIds.length, newbornIds.size, searchResultNodeIds.length]);

    const rawData = data && data.nodes.length > 0
        ? data
        : { nodes: [] as Node[], links: [] as Link[] };

    // Detect newly appeared nodes for birth flash
    useEffect(() => {
        const currentIds = new Set(rawData.nodes.map((n) => n.id));
        const born: string[] = [];
        currentIds.forEach((id) => {
            if (!knownNodeIdsRef.current.has(id) && knownNodeIdsRef.current.size > 0) {
                born.push(id);
            }
        });
        knownNodeIdsRef.current = currentIds;
        if (born.length === 0) return;
        setNewbornIds((prev) => new Set([...prev, ...born]));
        const t = window.setTimeout(() => {
            setNewbornIds((prev) => {
                const next = new Set(prev);
                born.forEach((id) => next.delete(id));
                return next;
            });
        }, 3200);
        return () => window.clearTimeout(t);
    }, [rawData.nodes]);

    const processedGraphData = useMemo(() => {
        let cleanData: { nodes: any[]; links: any[] };
        try {
            cleanData = JSON.parse(JSON.stringify(rawData));
        } catch (e) {
            console.error('Grave: Erro ao clonar dados do grafo', e);
            return { nodes: [], links: [] };
        }

        const budget = getGraphRenderBudget(cleanData.nodes.length);
        const getId = (n: any) => (typeof n === 'object' && n !== null ? n.id : n);

        let incomingNodes: any[] = cleanData.nodes.filter((n: any) => !deletedIds.has(n.id));
        const links: any[] = cleanData.links;

        if (incomingNodes.length > budget.maxNodes) {
            incomingNodes = rankNodesForGraph(incomingNodes, budget.maxNodes, {
                focusedId: focusedNodeId,
                searchIds: searchResultSet,
            }) as any[];
        }

        const nodeIds = new Set(incomingNodes.map((n: any) => getId(n)));

        const safeLinks = links.reduce((acc: any[], link: any) => {
            const sourceId = getId(link.source);
            const targetId = getId(link.target);
            if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
                acc.push({ source: sourceId, target: targetId, value: link.value });
            }
            return acc;
        }, []);

        const clusterCounts: Record<string, number> = {};
        incomingNodes.forEach((n: any) => {
            if (n.cluster && n.cluster !== 'unclustered') {
                clusterCounts[n.cluster] = (clusterCounts[n.cluster] || 0) + 1;
            }
        });

        const currentNodesMap = nodesRef.current;
        const finalNodes: any[] = [];

        incomingNodes.forEach((n: any, index: number) => {
            n.clusterSize = n.cluster && n.cluster !== 'unclustered'
                ? clusterCounts[n.cluster]
                : 0;
            n.isReceived = receivedNodeIds.includes(n.id);
            n.isNewborn = newbornIds.has(n.id);

            const existing = currentNodesMap.get(n.id);
            if (existing) {
                existing.name = n.name;
                existing.val = n.val;
                existing.cluster = n.cluster;
                existing.clusterSize = n.clusterSize;
                existing.celestialType = n.celestialType;
                existing.parentId = n.parentId;
                existing.importance = n.importance;
                existing.connectionCount = n.connectionCount;
                existing.isForgotten = n.isForgotten;
                existing.timestamp = n.timestamp;
                existing.lastViewedAt = n.lastViewedAt;
                existing.isReceived = n.isReceived;
                existing.isNewborn = n.isNewborn;

                if (existing.x === undefined && n.x !== undefined) {
                    existing.x = n.x;
                    existing.y = n.y;
                    existing.z = n.z;
                }

                finalNodes.push(existing);
            } else {
                if (typeof n.x !== 'number' || typeof n.y !== 'number' || typeof n.z !== 'number') {
                    // Tentar fazer spawn relativo ao redor do Sol pai se existir
                    const getParentPos = (): { x: number; y: number; z: number } | null => {
                        if (!n.parentId) return null;
                        const existingParent = currentNodesMap.get(n.parentId);
                        if (existingParent && typeof existingParent.x === 'number') {
                            return { x: existingParent.x, y: existingParent.y, z: existingParent.z };
                        }
                        const rawParent = incomingNodes.find((item: any) => item.id === n.parentId);
                        if (rawParent) {
                            if (typeof rawParent.x === 'number' && typeof rawParent.y === 'number' && typeof rawParent.z === 'number') {
                                return { x: rawParent.x, y: rawParent.y, z: rawParent.z };
                            }
                            // Calcular posição espiral do pai na hora para servir de âncora
                            const parentIdx = incomingNodes.indexOf(rawParent);
                            const phi = Math.acos(-1 + (2 * parentIdx) / Math.max(1, incomingNodes.length));
                            const theta = Math.sqrt(Math.max(1, incomingNodes.length) * Math.PI) * phi;
                            const radius = 180 + (parentIdx % 8) * 35;
                            const x = radius * Math.cos(theta) * Math.sin(phi);
                            const y = radius * Math.sin(theta) * Math.sin(phi);
                            const z = radius * Math.cos(phi);
                            rawParent.x = x;
                            rawParent.y = y;
                            rawParent.z = z;
                            return { x, y, z };
                        }
                        return null;
                    };

                    const parentPos = getParentPos();
                    if (parentPos) {
                        const r = 90 + Math.random() * 40; // Órbita planetária aproximada de 90-130px
                        const theta = Math.random() * Math.PI * 2;
                        const phi = Math.acos((Math.random() * 2) - 1);
                        n.x = parentPos.x + r * Math.sin(phi) * Math.cos(theta);
                        n.y = parentPos.y + r * Math.sin(phi) * Math.sin(theta);
                        n.z = parentPos.z + r * Math.cos(phi);
                    } else {
                        // Espiral global se não houver Sol pai
                        const phi = Math.acos(-1 + (2 * index) / Math.max(1, incomingNodes.length));
                        const theta = Math.sqrt(Math.max(1, incomingNodes.length) * Math.PI) * phi;
                        const radius = 180 + (index % 8) * 35;
                        n.x = radius * Math.cos(theta) * Math.sin(phi);
                        n.y = radius * Math.sin(theta) * Math.sin(phi);
                        n.z = radius * Math.cos(phi);
                    }
                }

                currentNodesMap.set(n.id, n);
                finalNodes.push(n);
            }
        });

        for (const id of currentNodesMap.keys()) {
            if (!nodeIds.has(id)) {
                currentNodesMap.delete(id);
            }
        }

        return {
            nodes: finalNodes,
            links: safeLinks,
            budget: getGraphRenderBudget(rawData.nodes.length),
            totalAvailable: rawData.nodes.length,
        };
    }, [rawData, deletedIds, receivedNodeIds, newbornIds, focusedNodeId, searchResultSet]);

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
        
        // Amortecimento da câmara: dampingFactor mais alto = resposta mais rápida e suave
        const controls = fgRef.current.controls();
        if (controls) {
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;  // Aumentado: câmara mais responsiva sem tremer
            controls.rotateSpeed = 0.8;
            controls.zoomSpeed = 1.0;
            controls.minDistance = 50;   // Zoom máximo (superfície do planeta)
            controls.maxDistance = 5000; // Zoom mínimo (visão galáctica profunda)
        }

        // Repulsão gravitacional baseada no tipo celeste: Sóis repelem com força interestelar, Planetas de forma padrão
        fgRef.current.d3Force('charge').strength((node: any) => {
            if (node.celestialType === 'sun') {
                return -8000; // Super repulsão para empurrar outros Sóis/projetos
            }
            return -1200; // Repulsão suave para planetas ordinários
        });
        
        // Distância dos links inteligente: Órbita curta Sol-Planeta, vastidão interestelar Sol-Sol
        fgRef.current.d3Force('link').distance((link: any) => {
            const source = typeof link.source === 'object' ? link.source : nodesRef.current.get(link.source);
            const target = typeof link.target === 'object' ? link.target : nodesRef.current.get(link.target);
            
            if (source && target) {
                // Se for um link de órbita entre o Sol do projeto e um de seus arquivos/planetas
                const isOrbit = (source.celestialType === 'sun' && target.celestialType === 'planet') ||
                                (source.celestialType === 'planet' && target.celestialType === 'sun');
                if (isOrbit) {
                    return 110; // Órbitas próximas e compactas para arquivos do projeto
                }
                
                // Conexões interestelares diretas entre Sóis de projetos
                if (source.celestialType === 'sun' && target.celestialType === 'sun') {
                    return 480; // Expansão imensa entre diferentes projetos
                }
            }
            return 200; // Distância média padrão para conexões comuns
        });

        // Força de colisão física tridimensional com 2 iterações para separação estável sem tremores
        fgRef.current.d3Force('collide', forceCollide((node: any) => {
            const baseVal = typeof node.val === 'number' ? node.val : 7;
            let size = Math.max(6, Math.min(13, baseVal));
            
            if (node.celestialType === 'sun') {
                size = 32;
                return size + 160;
            }

            if (node.clusterSize) {
                if (node.clusterSize > 20) size += 6;
                else if (node.clusterSize > 10) size += 4;
                else if (node.clusterSize > 3) size += 2;
            }
            return size + 25;
        }).iterations(2)); // 2 iterações por tick = separação física mais precisa e estável
        
        // Câmera afastada apenas na montagem inicial para evitar pulos de zoom irritantes
        if (isFirstMountRef.current) {
            fgRef.current.cameraPosition({ z: 1200 });
            isFirstMountRef.current = false;
        }
    }, [processedGraphData, sessionMap]);

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
        const now = Date.now();
        const doubleClickThreshold = 300; // ms
        if (lastClickRef.current.nodeId === node.id && (now - lastClickRef.current.time) < doubleClickThreshold) {
            // Duplo clique detectado! Desafixar o nó liberando as coordenadas fx, fy, fz
            node.fx = undefined;
            node.fy = undefined;
            node.fz = undefined;
            fgRef.current?.d3ReheatSimulation();
            
            // Limpar ref para evitar disparos repetidos
            lastClickRef.current = { time: 0, nodeId: null };
            return;
        }

        lastClickRef.current = { time: now, nodeId: node.id };
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
        const isNewborn = node.isNewborn || newbornIds.has(node.id);
        const isForgotten = node.isForgotten;
        const isSun = node.celestialType === 'sun';
        const isPlanet = node.celestialType === 'planet';
        
        const index = getColorIndex(String(node.id));
        const color = nodeColors[index];
        
        const baseVal = typeof node.val === 'number' ? node.val : 7;
        let size = isSelected ? 14 : isHighlighted ? 12 : Math.max(6, Math.min(13, baseVal));
        if (isNewborn) size *= 1.25;
        
        if (isSun) {
            size = isSelected ? 32 : isHighlighted ? 28 : 24;
        } else if (!isSelected && node.clusterSize) {
            if (node.clusterSize > 20) size += 6;
            else if (node.clusterSize > 10) size += 4;
            else if (node.clusterSize > 3) size += 2;
        }

        let nodeColor = isNewborn ? '#a78bfa' : isSearchResult ? '#38bdf8' : isReceived ? '#22d3ee' : isForgotten ? '#f59e0b' : color;
        let emissiveColor = isNewborn ? '#22d3ee' : isSearchResult ? '#38bdf8' : isReceived ? '#22d3ee' : isForgotten ? '#f59e0b' : color;
        let emissiveIntensity = isNewborn ? 1.4 : isSelected ? 0.8 : (isSearchResult ? 0.7 : isForgotten ? 0.45 : isHighlighted ? 0.5 : 0.2);
        let shininess = 100;
        
        if (isSun) {
            nodeColor = '#ff7e15'; // Laranja solar rico
            emissiveColor = '#ff2b00'; // Vermelho incandescente de fusão nuclear
            emissiveIntensity = isSelected ? 1.6 : isHighlighted ? 1.3 : 0.9;
            shininess = 30; // Efeito fosco brilhante de calor de estrela
        } else if (isSelected) {
            emissiveColor = '#ffffff';
        }

        // Esfera principal
        const material = new THREE.MeshPhongMaterial({
            color: nodeColor,
            transparent: true,
            opacity: isHighlighted || isSelected || isSun ? 1.0 : 0.75,
            emissive: emissiveColor,
            emissiveIntensity,
            shininess
        });

        const segments = processedGraphData.budget?.sphereSegments ?? 32;
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(size, segments, segments),
            material
        );
        group.add(sphere);

        if (isSun || isSelected || isReceived || isSearchResult || isForgotten || isNewborn) {
            const haloColor = isNewborn
                ? '#a78bfa'
                : isSun
                ? '#ffaa33'
                : (isSearchResult ? '#38bdf8' : isReceived ? '#22d3ee' : isForgotten ? '#f59e0b' : '#ffffff');
            
            const haloMaterial = new THREE.MeshBasicMaterial({
                color: haloColor,
                transparent: true,
                opacity: isNewborn
                    ? 0.22 + 0.18 * Math.sin(pulseTick * 0.2)
                    : isSun
                    ? (isSelected ? 0.35 : isHighlighted ? 0.28 : 0.18)
                    : (isSearchResult ? 0.24 : isForgotten ? 0.18 : 0.3),
                side: THREE.BackSide
            });
            
            const pulseFactor = isNewborn
                ? Math.sin(pulseTick * 0.22)
                : isSun
                ? Math.sin(pulseTick * 0.05)
                : Math.sin(pulseTick * 0.12);
            const haloSize = isNewborn
                ? size * (1.6 + 0.55 * pulseFactor)
                : isSun
                ? size * (1.3 + 0.15 * pulseFactor)
                : (isReceived || isSearchResult || isForgotten ? size * (1.2 + 0.3 * pulseFactor) : size * 1.4);
                
            const segs = Math.max(8, (processedGraphData.budget?.sphereSegments ?? 32) / 2);
            const halo = new THREE.Mesh(
                new THREE.SphereGeometry(haloSize, segs, segs),
                haloMaterial
            );
            group.add(halo);

            if (isNewborn) {
                const ringGeo = new THREE.RingGeometry(size * 1.8, size * 2.4, Math.max(24, segs));
                ringGeo.rotateX(Math.PI / 2);
                const ringMat = new THREE.MeshBasicMaterial({
                    color: '#22d3ee',
                    transparent: true,
                    opacity: 0.35 + 0.25 * Math.sin(pulseTick * 0.25),
                    side: THREE.DoubleSide,
                });
                group.add(new THREE.Mesh(ringGeo, ringMat));
            }
        }

        // Anel planetário ornamentado para planetas (Saturno Style) para arquivos com alta relevância
        if (isPlanet && (isSelected || isHighlighted || baseVal >= 10)) {
            const ringGeometry = new THREE.RingGeometry(size * 1.4, size * 1.8, 64);
            ringGeometry.rotateX(Math.PI / 3.2); // Inclinação dramática de 3D
            ringGeometry.rotateY(Math.PI / 8);
            
            const ringMaterial = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: isSelected ? 0.45 : isHighlighted ? 0.32 : 0.15,
                side: THREE.DoubleSide
            });
            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            group.add(ring);
        }

        // Labels: always for focus/sun; otherwise only under LOD budget
        const showLabel =
            isHighlighted ||
            isSelected ||
            isSun ||
            isNewborn ||
            processedGraphData.nodes.length < (processedGraphData.budget?.labelThreshold ?? 80);

        if (showLabel) {
            const sprite = new SpriteText(node.name);
            sprite.color = isSun ? '#ffeaa7' : '#ffffff';
            const segs = processedGraphData.budget?.sphereSegments ?? 32;
            sprite.textHeight = isSun ? Math.min(18, size * 0.55) : Math.max(segs < 16 ? 6 : 8, size * 1.0);
            sprite.position.y = isSun ? -size - 22 : -size - 12;
            sprite.backgroundColor = 'rgba(8, 8, 12, 0.85)';
            sprite.borderColor = isSun ? '#ff7e15' : 'rgba(255, 255, 255, 0.15)';
            sprite.borderWidth = 1;
            sprite.padding = isSun ? 6 : 3;
            sprite.borderRadius = 6;
            group.add(sprite);
        }

        return group;
    }, [highlightNodes, selectedNode, pulseTick, processedGraphData.nodes.length, processedGraphData.budget, getColorIndex, searchResultSet, newbornIds]);

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
            {/* Fundos Cósmicos — nunca pure black */}
            <div className="pointer-events-none absolute inset-0 bg-[#020617]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#0f172a_0%,_#020617_72%)] opacity-95" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,_rgba(139,92,246,0.12)_0%,_transparent_45%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,_rgba(34,211,238,0.07)_0%,_transparent_40%)]" />
            <div className="mnem-universe-grain pointer-events-none absolute inset-0 opacity-[0.03]" />

            {!hasRealSessions && processedGraphData.nodes.length === 0 && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6">
                    <div className="mnem-graph-empty max-w-md rounded-3xl px-8 py-10 text-center backdrop-blur-xl">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/35 bg-violet-500/20 shadow-[0_0_28px_rgba(139,92,246,0.35)]">
                            <span className="text-2xl text-violet-100">✦</span>
                        </div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200/70">
                            Grafo cognitivo
                        </p>
                        <h2 className="mt-2 text-lg font-semibold text-white">O teu universo está vazio</h2>
                        <p className="mt-2 text-sm leading-relaxed text-slate-400">
                            Abre o <strong className="text-cyan-200">Flow</strong> e cristaliza o primeiro pensamento.
                            Ele aparece aqui como estrela e começa a ligar-se sozinho.
                        </p>
                        <p className="mt-4 text-[11px] uppercase tracking-widest text-slate-500">
                            Ctrl+K pesquisa · Universe para o 3D espacial · Pulso diário
                        </p>
                    </div>
                </div>
            )}

            {(processedGraphData.totalAvailable ?? 0) > processedGraphData.nodes.length && (
                <div className="absolute top-4 left-4 z-10 rounded-full border border-yellow-500/30 bg-black/40 px-3 py-2 text-xs text-yellow-400 backdrop-blur-md">
                    ⚡ LOD · {processedGraphData.nodes.length} de {processedGraphData.totalAvailable} nós
                    {' · '}{processedGraphData.budget?.detail}
                </div>
            )}

            {newbornIds.size > 0 && (
                <div className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-violet-400/40 bg-violet-950/50 px-4 py-2 text-xs font-medium text-violet-100 backdrop-blur-md">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-violet-300 shadow-[0_0_12px_rgba(167,139,250,0.9)]" />
                    Nova memória a cristalizar
                </div>
            )}

            {receivedNodeIds.length > 0 && (
                <div className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-950/40 px-4 py-2 text-xs font-medium text-cyan-300 backdrop-blur-md">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                    {receivedNodeIds.length} memória(s) recebida(s)
                </div>
            )}

            {searchResultNodeIds.length > 0 && (
                <div className={`absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-sky-500/40 bg-sky-950/40 px-4 py-2 text-xs font-medium text-sky-200 backdrop-blur-md ${newbornIds.size > 0 || receivedNodeIds.length > 0 ? 'top-16' : 'top-4'}`}>
                    <span className="h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.9)]" />
                    {searchResultNodeIds.length} resultado(s) em destaque
                </div>
            )}

            <div className="pointer-events-none absolute bottom-28 left-4 z-10 select-none space-y-0.5 rounded-xl border border-white/5 bg-black/35 p-2.5 font-mono text-[10px] text-white/40 backdrop-blur-sm sm:bottom-4 sm:text-[11px]">
                <div>Arrastar · rodar</div>
                <div>Scroll · zoom</div>
                <div>Click · focar memória</div>
                <div className="pt-1 text-violet-300/70">✦ Violeta · recém-criada</div>
                <div className="text-amber-300/70">✦ Âmbar · ideia antiga</div>
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
                    linkColor={(link: any) => highlightLinks.has(link) ? '#a78bfa' : isSearchLink(link) ? '#38bdf8' : 'rgba(100,116,139,0.28)'}
                    linkWidth={(link: any) => highlightLinks.has(link) ? 2.8 : isSearchLink(link) ? 1.4 : 0.45}
                    linkResolution={12}
                    linkDirectionalParticles={(link: any) => {
                        if (!processedGraphData.budget?.linkParticles) {
                            return highlightLinks.has(link) ? 2 : 0;
                        }
                        return highlightLinks.has(link) ? 6 : isSearchLink(link) ? 3 : 0;
                    }}
                    linkDirectionalParticleWidth={(link: any) => highlightLinks.has(link) ? 2.4 : 1.6}
                    linkDirectionalParticleSpeed={0.006}
                    linkDirectionalParticleColor={() => '#c4b5fd'}
                    d3AlphaDecay={0.02}
                    d3VelocityDecay={0.7}
                    warmupTicks={processedGraphData.budget?.warmupTicks ?? 60}
                    cooldownTicks={processedGraphData.budget?.cooldownTicks ?? 200}
                    onNodeHover={handleNodeHover}
                    onNodeClick={handleNodeClick}
                    enableNodeDrag={true}
                    onNodeDragEnd={(node: any) => {
                        // Fixar permanentemente na nova posição: fx/fy/fz ancoram o nó para a biblioteca
                        node.fx = node.x;
                        node.fy = node.y;
                        node.fz = node.z;
                        
                        // Persistir a nova posição no Firestore se for um nó de memória real
                        if (sessionMap.has(node.id) && typeof node.x === 'number' && typeof node.y === 'number' && typeof node.z === 'number') {
                            const semanticScale = 36;
                            const dbRef = doc(db, 'sessions', node.id);
                            updateDoc(dbRef, {
                                position: [node.x / semanticScale, node.y / semanticScale, node.z / semanticScale],
                                updatedAt: Date.now()
                            }).catch((err) => {
                                console.error('Erro ao salvar posição do planeta:', err);
                            });
                        }
                        // Sem d3ReheatSimulation(): o nó está ancorado em fx/fy/fz.
                        // Reanimar a simulação só faria os vizinhos voarem para longe desnecessariamente.
                    }}
                    onBackgroundClick={() => {
                        setHighlightNodes(new Set());
                        setHighlightLinks(new Set());
                        setSelectedNode(null);
                        setSelectedSession(null);
                        if (fgRef.current) {
                            // Limpar a seleção e focar suavemente no centro de gravidade mantendo o nível de zoom/distância da câmara atual
                            const camPos = fgRef.current.cameraPosition();
                            fgRef.current.cameraPosition(
                                camPos, // Mantém a posição exata da câmara
                                { x: 0, y: 0, z: 0 }, // Foca no centro
                                1200 // Transição fluida de 1.2s
                            );
                        }
                    }}
                />
            </div>

            <MemoryActionPanel
                node={selectedNode}
                session={selectedSession}
                allSessions={sessions}
                onClose={handlePanelClose}
                containerRef={containerRef}
                graphRef={fgRef}
                onDeleted={handleDeleted}
                onTransmit={onTransmitMemory}
            />
        </div>
    );
};
