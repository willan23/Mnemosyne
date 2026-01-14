import React, { useRef, useMemo, useState, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

interface Node {
    id: string;
    name: string;
    val: number;
}

interface Link {
    source: string;
    target: string;
}

interface GraphData {
    nodes: Node[];
    links: Link[];
}

export const MemoryGraph: React.FC<{ data?: GraphData }> = ({ data }) => {
    const fgRef = useRef<any>(null);
    const [highlightNodes, setHighlightNodes] = useState(new Set());
    const [highlightLinks, setHighlightLinks] = useState(new Set());

    // Use mock data if none provided
    const rawGraphData = data || {
        nodes: [
            { id: '1', name: 'Mnemosyne', val: 10 },
            { id: '2', name: 'Início', val: 5 },
            { id: '3', name: 'Design', val: 7 },
            { id: '4', name: 'E2EE', val: 8 },
            { id: '5', name: 'Vite', val: 4 },
        ],
        links: [
            { source: '1', target: '2' },
            { source: '1', target: '3' },
            { source: '1', target: '4' },
            { source: '3', target: '5' },
        ]
    };

    // Lazy loading: limit to 150 nodes for performance
    const graphData = useMemo(() => {
        const maxNodes = 150;
        if (rawGraphData.nodes.length > maxNodes) {
            const limitedNodes = rawGraphData.nodes.slice(0, maxNodes);
            const nodeIds = new Set(limitedNodes.map(n => n.id));
            const limitedLinks = rawGraphData.links.filter(
                l => nodeIds.has(l.source.toString()) && nodeIds.has(l.target.toString())
            );
            return { nodes: limitedNodes, links: limitedLinks };
        }
        return rawGraphData;
    }, [rawGraphData]);

    // Vibrant color palette for nodes
    const nodeColors = [
        '#FF6B6B', // Coral Red
        '#4ECDC4', // Turquoise
        '#FFE66D', // Sunny Yellow
        '#A8E6CF', // Mint Green
        '#FF8B94', // Pink
        '#C7CEEA', // Lavender
        '#FFDAC1', // Peach
        '#B4F8C8', // Light Green
        '#FBE7C6', // Cream
        '#A0E7E5', // Aqua
    ];

    // Warm up the graph on mount for smooth initial animation
    useEffect(() => {
        if (fgRef.current) {
            fgRef.current.d3Force('charge').strength(-100);
            fgRef.current.d3Force('link').distance(50);
        }
    }, []);

    const handleNodeHover = (node: any) => {
        const nodes = new Set();
        const links = new Set();

        if (node) {
            nodes.add(node.id);
            graphData.links.forEach((link: any) => {
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
    };

    return (
        <div className="w-full h-full relative">
            {/* Vibrant gradient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-indigo-900/20 to-pink-900/20" />

            {/* Performance indicator for large graphs */}
            {rawGraphData.nodes.length > 150 && (
                <div className="absolute top-4 left-4 glass-card px-3 py-2 text-xs text-yellow-400 z-10">
                    ⚡ Mostrando {graphData.nodes.length} de {rawGraphData.nodes.length} nós
                </div>
            )}

            <ForceGraph2D
                ref={fgRef}
                graphData={graphData}
                backgroundColor="transparent"
                nodeLabel="name"
                nodeColor={(node: any) => {
                    const index = parseInt(node.id) % nodeColors.length;
                    return nodeColors[index];
                }}
                linkColor={(link: any) => {
                    return highlightLinks.has(link)
                        ? 'rgba(139, 92, 246, 0.8)'
                        : 'rgba(139, 92, 246, 0.4)';
                }}
                linkWidth={(link: any) => highlightLinks.has(link) ? 3 : 2}
                nodeRelSize={8}
                nodeCanvasObject={(node: any, ctx, globalScale) => {
                    const label = node.name;
                    const fontSize = 12 / globalScale;
                    ctx.font = `${fontSize}px Sans-Serif`;

                    // Get node color
                    const index = parseInt(node.id) % nodeColors.length;
                    const nodeColor = nodeColors[index];

                    // Highlight effect
                    const isHighlighted = highlightNodes.has(node.id);
                    const nodeSize = isHighlighted ? 10 : 8;

                    // Draw glow effect
                    ctx.shadowBlur = isHighlighted ? 20 : 15;
                    ctx.shadowColor = nodeColor;

                    // Draw node circle
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI, false);
                    ctx.fillStyle = nodeColor;
                    ctx.fill();

                    // Draw white border
                    ctx.strokeStyle = isHighlighted ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.8)';
                    ctx.lineWidth = isHighlighted ? 3 / globalScale : 2 / globalScale;
                    ctx.stroke();

                    // Reset shadow for text
                    ctx.shadowBlur = 0;

                    // Draw label
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = isHighlighted ? '#FFFFFF' : 'rgba(255, 255, 255, 0.9)';
                    ctx.font = `${isHighlighted ? 'bold ' : ''}${fontSize}px Sans-Serif`;
                    ctx.fillText(label, node.x, node.y + nodeSize + 8);
                }}
                // Smooth animations
                warmupTicks={100}
                cooldownTicks={100}
                cooldownTime={3000}
                onEngineStop={() => console.log('🎨 Grafo estabilizado')}
                // Interactivity
                autoPauseRedraw={false}
                enableNodeDrag={true}
                enableZoomInteraction={true}
                enablePanInteraction={true}
                onNodeHover={handleNodeHover}
                // Performance
                nodeCanvasObjectMode={() => 'replace'}
            />
        </div>
    );
};
